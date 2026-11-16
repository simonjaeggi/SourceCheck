/**
 * Core of POST /api/lookup: reference strings → OpenAlex records.
 * Flow: origin check → body size cap → strict input validation → rate limit → OpenAlex.
 * No AI and no model cost; the limits protect the shared OpenAlex budget.
 */
import { LOOKUP_ERROR_MESSAGES, LOOKUP_LIMITS, LookupRequestSchema, type LookupErrorCode, type LookupResult } from "../src/lib/lookup.js"
import { clientIp, formatIssues, sameOrigin } from "./assess.js"
import { lookupReferences, openAlexFetch, type Fetcher } from "./openalex.js"
import { checkRateLimit } from "./rateLimit.js"

const STATUS: Record<LookupErrorCode, number> = {
  invalid_request: 400,
  payload_too_large: 413,
  forbidden_origin: 403,
  rate_limited: 429,
  upstream_error: 502,
}

function fail(code: LookupErrorCode, opts: { message?: string; retryAfter?: number } = {}) {
  const body: LookupResult = { ok: false, error: { code, message: opts.message ?? LOOKUP_ERROR_MESSAGES[code], ...(opts.retryAfter ? { retry_after_s: opts.retryAfter } : {}) } }
  const headers: Record<string, string> = { "Cache-Control": "no-store" }
  if (opts.retryAfter) headers["Retry-After"] = String(opts.retryAfter)
  return Response.json(body, { status: STATUS[code], headers })
}

export async function handleLookup(request: Request, deps: { fetcher?: Fetcher; rateLimit?: typeof checkRateLimit } = {}): Promise<Response> {
  if (!sameOrigin(request)) return fail("forbidden_origin")

  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > LOOKUP_LIMITS.requestBytes) return fail("payload_too_large")
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > LOOKUP_LIMITS.requestBytes) return fail("payload_too_large")

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fail("invalid_request", { message: "The request body is not valid JSON." })
  }
  const input = LookupRequestSchema.safeParse(body)
  if (!input.success) return fail("invalid_request", { message: `${LOOKUP_ERROR_MESSAGES.invalid_request}\n${formatIssues(input.error, 5)}` })

  try {
    const limit = await (deps.rateLimit ?? checkRateLimit)(clientIp(request), Date.now(), "lookup")
    if (!limit.allowed) return fail("rate_limited", { retryAfter: limit.retryAfterSeconds })
  } catch (e) {
    console.error("[lookup] rate limit store failed", e)
    return fail("upstream_error")
  }

  const { works, unmatched, meta } = await lookupReferences(input.data.references, deps.fetcher ?? openAlexFetch)
  // Nothing found and every miss was OpenAlex failing: report that instead of an empty list.
  if (!works.length && unmatched.length && unmatched.every((u) => u.reason === "openalex_rate_limited")) return fail("rate_limited", { retryAfter: 60 })
  if (!works.length && unmatched.length && unmatched.every((u) => u.reason === "openalex_error")) return fail("upstream_error")

  const result: LookupResult = { ok: true, works, unmatched, meta }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}
