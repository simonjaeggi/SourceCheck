/**
 * Core of POST /api/assess, independent of Vercel so it runs in the Vite dev
 * server, in tests (with a stubbed model) and in the Vercel function alike.
 *
 * Flow: origin check → body size cap → strict input validation → rate limit →
 * model call → strict output validation → up to 2 repair prompts with the zod
 * issues → success, or a typed error the UI can show.
 */
import { z } from "zod"
import {
  AssessmentRequestSchema,
  AssessmentResponseSchema,
  ERROR_MESSAGES,
  LIMITS,
  type AssessDebug,
  type AssessErrorCode,
  type AssessResult,
  type AssessmentRequest,
  type AssessmentResponse,
} from "../src/lib/assessment"
import { PROMPT_VERSION, SYSTEM_PROMPT, buildRepairMessage, buildUserMessage } from "./prompt"
import { checkRateLimit } from "./rateLimit"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
/**
 * Free models only. Each must support structured outputs (json_schema) on OpenRouter.
 * The first is tried first; OpenRouter falls back to the next if it is down or rate limited.
 * Override with OPENROUTER_MODEL (comma-separated); every entry must be free.
 */
export const DEFAULT_MODELS = ["nvidia/nemotron-3.5-super-vl:free", "baidu/ernie-5.5-flash-preview:free"]
export const isFreeModel = (id: string) => id.endsWith(":free") || id === "openrouter/free"
export const modelNames = () => {
  const env = process.env.OPENROUTER_MODEL?.split(",").map((m) => m.trim()).filter(Boolean)
  return env?.length ? env : DEFAULT_MODELS
}
export const modelName = () => modelNames()[0]
/** Repair prompts after the first attempt. 2 repairs = at most 3 model calls. */
export const MAX_REPAIRS = 2
/** Output cap per call, reasoning included, set well above the ~1,500 tokens the JSON needs. */
const MAX_TOKENS = 6_000
/** Abort a hanging call well before the function's 120 s limit. */
const CALL_TIMEOUT_MS = 90_000

/** JSON Schema for structured outputs, generated from the same zod schema. */
export const OUTPUT_SCHEMA = z.toJSONSchema(AssessmentResponseSchema, { target: "draft-7" })

// ── Model call (injectable for tests) ────────────────────────────────────────

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }
export type ModelTurn = {
  text: string
  /** OpenAI-style finish reason: "stop", "length", "content_filter", ... */
  finishReason: string | null
  refusal?: string | null
  /** the model that actually answered (OpenRouter may fall back) */
  model?: string
  reasoning?: string
  tokens?: { prompt?: number; completion?: number; reasoning?: number }
}
export type CallModel = (messages: ChatMessage[]) => Promise<ModelTurn>

/** OPENROUTER_MODEL names a model that is not free. */
export class PaidModelError extends Error {
  constructor(public models: string[]) {
    super(`Refusing paid model(s): ${models.join(", ")}. OPENROUTER_MODEL must list free models only (ending in ":free").`)
  }
}

/** HTTP failure from OpenRouter, mapped to an error code in handleAssess. */
export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function openRouterCaller(apiKey = process.env.OPENROUTER_API_KEY ?? "", models: string | string[] = modelNames()): CallModel {
  const list = Array.isArray(models) ? models : [models]
  // Hard stop: never send a request to a paid model.
  const paid = list.filter((m) => !isFreeModel(m))
  if (paid.length) throw new PaidModelError(paid)
  return async (messages) => {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "SourceCheck" },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      body: JSON.stringify({
        ...(list.length > 1 ? { models: list } : { model: list[0] }),
        max_tokens: MAX_TOKENS,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        response_format: { type: "json_schema", json_schema: { name: "source_assessment", strict: true, schema: OUTPUT_SCHEMA } },
        // Only route to providers that honour response_format, never silently drop it.
        provider: { require_parameters: true },
      }),
    })
    const body: any = await res.json().catch(() => null)
    if (!res.ok || body?.error) {
      const status = body?.error?.code && typeof body.error.code === "number" ? body.error.code : res.status
      throw new UpstreamError(status, body?.error?.message ?? `OpenRouter returned ${res.status}`)
    }
    const choice = body?.choices?.[0]
    const u = body?.usage
    return {
      text: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? null,
      refusal: choice?.message?.refusal ?? null,
      model: body?.model,
      reasoning: typeof choice?.message?.reasoning === "string" ? choice.message.reasoning : undefined,
      tokens: u ? { prompt: u.prompt_tokens, completion: u.completion_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens } : undefined,
    }
  }
}

// ── Validation helpers ───────────────────────────────────────────────────────

/** Short, model-readable list of zod issues. */
export function formatIssues(error: z.ZodError, max = 12): string {
  const lines = error.issues.slice(0, max).map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
  if (error.issues.length > max) lines.push(`- ...and ${error.issues.length - max} more`)
  return lines.join("\n")
}

type Parsed = { ok: true; data: AssessmentResponse } | { ok: false; issues: string }

export function parseModelOutput(text: string, finishReason: string | null): Parsed {
  if (finishReason === "length") return { ok: false, issues: "- (root): the response was cut off at the length limit. Keep each reason within the character limits." }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, issues: "- (root): the response was not valid JSON." }
  }
  const result = AssessmentResponseSchema.safeParse(json)
  return result.success ? { ok: true, data: result.data } : { ok: false, issues: formatIssues(result.error) }
}

// ── Assessment with repair loop ──────────────────────────────────────────────

class AssessError extends Error {
  constructor(public code: AssessErrorCode, message = ERROR_MESSAGES[code], public retryAfter?: number) {
    super(message)
  }
}

/** Starts an empty trace for the dev panel; runAssessment fills it in as it goes, also when it fails. */
export function newTrace(models: string[] = modelNames()): AssessDebug {
  return { prompt_version: PROMPT_VERSION, models_requested: models, user_message: "", attempts: [], total_ms: 0 }
}

export async function runAssessment(req: AssessmentRequest, callModel: CallModel, log: (msg: string) => void = console.warn, trace: AssessDebug = newTrace()) {
  const started = Date.now()
  const messages: ChatMessage[] = [{ role: "user", content: buildUserMessage(req) }]
  trace.user_message = messages[0].content

  try {
    for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt++) {
      const t0 = Date.now()
      const turn = await callModel(messages)
      const entry: AssessDebug["attempts"][number] = {
        n: attempt,
        model: turn.model,
        finish_reason: turn.finishReason,
        duration_ms: Date.now() - t0,
        tokens: turn.tokens,
        raw: turn.text,
        reasoning: turn.reasoning,
        refusal: turn.refusal,
        valid: false,
      }
      trace.attempts.push(entry)
      if (turn.refusal || turn.finishReason === "content_filter") throw new AssessError("model_refused")

      const parsed = parseModelOutput(turn.text, turn.finishReason)
      if (parsed.ok) {
        entry.valid = true
        return { assessment: parsed.data, attempts: attempt, model: turn.model }
      }

      entry.issues = parsed.issues
      log(`[assess] attempt ${attempt} invalid:\n${parsed.issues}`)
      if (attempt > MAX_REPAIRS) break
      entry.repair_message = buildRepairMessage(parsed.issues)
      messages.push({ role: "assistant", content: turn.text })
      messages.push({ role: "user", content: entry.repair_message })
    }
    throw new AssessError("model_output_invalid")
  } catch (e) {
    if (!(e instanceof AssessError)) trace.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    throw e
  } finally {
    trace.total_ms = Date.now() - started
  }
}

/** Dev panel data is sent in development, or in production only with ASSESS_DEBUG=1. */
export const debugEnabled = () => process.env.ASSESS_DEBUG === "1" || process.env.NODE_ENV !== "production"

// ── HTTP handler ─────────────────────────────────────────────────────────────

const STATUS: Record<AssessErrorCode, number> = {
  invalid_request: 400,
  payload_too_large: 413,
  forbidden_origin: 403,
  rate_limited: 429,
  not_configured: 503,
  model_refused: 422,
  model_output_invalid: 502,
  upstream_error: 502,
}

function fail(code: AssessErrorCode, opts: { message?: string; retryAfter?: number; debug?: AssessDebug } = {}) {
  const body: AssessResult = {
    ok: false,
    error: { code, message: opts.message ?? ERROR_MESSAGES[code], ...(opts.retryAfter ? { retry_after_s: opts.retryAfter } : {}) },
    ...(opts.debug ? { debug: opts.debug } : {}),
  }
  const headers: Record<string, string> = { "Cache-Control": "no-store" }
  if (opts.retryAfter) headers["Retry-After"] = String(opts.retryAfter)
  return Response.json(body, { status: STATUS[code], headers })
}

export function clientIp(request: Request) {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
}

/** Browsers send Origin on cross-site POSTs; reject any that is not this site. */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return true
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))
  } catch {
    return false
  }
}

export async function handleAssess(request: Request, deps: { callModel?: CallModel; rateLimit?: typeof checkRateLimit } = {}): Promise<Response> {
  if (!sameOrigin(request)) return fail("forbidden_origin")

  // Size cap before parsing: read at most requestBytes.
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > LIMITS.requestBytes) return fail("payload_too_large")
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > LIMITS.requestBytes) return fail("payload_too_large")

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fail("invalid_request", { message: "The request body is not valid JSON." })
  }
  const input = AssessmentRequestSchema.safeParse(body)
  if (!input.success) return fail("invalid_request", { message: `${ERROR_MESSAGES.invalid_request}\n${formatIssues(input.error, 5)}` })

  if (!deps.callModel && !process.env.OPENROUTER_API_KEY) return fail("not_configured")
  if (!deps.callModel && !modelNames().every(isFreeModel)) {
    console.error(`[assess] ${new PaidModelError(modelNames().filter((m) => !isFreeModel(m))).message}`)
    return fail("not_configured")
  }

  try {
    const limit = await (deps.rateLimit ?? checkRateLimit)(clientIp(request))
    if (!limit.allowed) return fail("rate_limited", { retryAfter: limit.retryAfterSeconds })
  } catch (e) {
    console.error("[assess] rate limit store failed", e)
    return fail("upstream_error")
  }

  const trace = newTrace()
  const debug = debugEnabled() ? trace : undefined
  try {
    const { assessment, attempts, model } = await runAssessment(input.data, deps.callModel ?? openRouterCaller(), undefined, trace)
    const body: AssessResult = { ok: true, assessment, meta: { model: model ?? modelName(), prompt_version: PROMPT_VERSION, attempts }, ...(debug ? { debug } : {}) }
    return Response.json(body, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    if (e instanceof AssessError) return fail(e.code, { message: e.message, debug })
    if (e instanceof UpstreamError) {
      console.error(`[assess] OpenRouter ${e.status}: ${e.message}`)
      if (e.status === 429) return fail("rate_limited", { retryAfter: 30, debug })
      if (e.status === 401 || e.status === 403) return fail("not_configured", { debug })
    }
    console.error("[assess] model call failed", e)
    return fail("upstream_error", { debug })
  }
}
