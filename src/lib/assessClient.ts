/**
 * Browser side of the AI assessment: builds the request from a source and the thesis
 * context, calls /api/assess and re-validates the answer. Used by the source list
 * ("Assess", "Assess all") and the detail sheet.
 */
import type { OpenAlexWork } from "@/data/types"
import {
  AssessmentRequestSchema,
  AssessmentResponseSchema,
  ERROR_MESSAGES,
  LIMITS,
  type AssessDebug,
  type AssessErrorCode,
  type AssessmentRequest,
  type AssessmentResponse,
} from "@/lib/assessment"
import { peerReviewStatus } from "@/lib/scoring"

/** What the server reported about a call, kept for exports. */
export type AssessMeta = { model?: string; prompt_version?: string; requested_model?: string; at: string; duration_ms: number }

export type AssessState =
  | { status: "loading" }
  | { status: "done"; assessment: AssessmentResponse; attempts: number; context: string; debug?: AssessDebug; meta?: AssessMeta }
  | { status: "error"; code: AssessErrorCode; message: string; debug?: AssessDebug; meta?: AssessMeta; retryAfter?: number }

/** Why the thesis context cannot be sent yet, or null when it is fine. */
export function contextProblem(context: string): string | null {
  const c = context.trim()
  if (!c) return "Add your thesis context (topic and research question) in the input panel first."
  if (c.length > LIMITS.thesisContext) return `Your context is ${c.length} characters; the limit is ${LIMITS.thesisContext}.`
  return null
}

/** The facts the AI gets: the same kinds of information the experts see on the form. */
export function buildRequest(w: OpenAlexWork, context: string): AssessmentRequest {
  const cut = (s: string) => s.slice(0, LIMITS.fact)
  const details = w._sourcecheck.details ?? {}
  const base = w._sourcecheck.origin === "manual" ? manualFacts() : openAlexFacts(w)
  // Your details replace the OpenAlex value fact by fact; empty fields keep it.
  const facts: AssessmentRequest["facts"] = { ...base }
  for (const k of ["source_type", "venue", "authors", "year", "peer_review", "venue_metric", "citations", "link"] as const) if (details[k]) facts[k] = cut(details[k]!)
  if (details.abstract) facts.abstract = details.abstract.slice(0, LIMITS.abstract)
  return {
    thesis_context: context.trim(),
    // where and for which statement the thesis cites it; without it, the AI judges against the thesis context
    ...(details.use ? { use_of_source: details.use.slice(0, LIMITS.useOfSource) } : {}),
    reference: w._sourcecheck.raw_reference.slice(0, LIMITS.reference),
    facts,
    language: "en",
  }
}

/** A source OpenAlex does not have: only what you entered, and that it is not indexed. */
function manualFacts(): AssessmentRequest["facts"] {
  return { citations: "not indexed in OpenAlex" }
}

/** What OpenAlex says about the work. */
export function openAlexFacts(w: OpenAlexWork): AssessmentRequest["facts"] {
  const src = w.primary_location.source
  const cut = (s: string) => s.slice(0, LIMITS.fact)
  const pr = peerReviewStatus(w)
  const authorDetails = w._sourcecheck.author_details
  // Institution and h-index per author when OpenAlex has them, otherwise names only.
  const authors = authorDetails?.length
    ? authorDetails
        .map((d) => {
          const extra = [d.institution, d.h_index != null ? `h-index ${d.h_index}` : null].filter(Boolean).join(", ")
          return extra ? `${d.name} (${extra})` : d.name
        })
        .join("; ")
    : w.authorships.map((a) => a.author.display_name).join(", ")
  const pct = w.citation_normalized_percentile?.value
  return {
    source_type: cut(`${w.type}${w.primary_location.version === "submittedVersion" ? " (submitted version)" : ""}`),
    venue: cut(src ? `${src.display_name}${src.host_organization_name ? ` (${src.host_organization_name})` : ""}, ${src.type}` : "no venue found"),
    authors: cut(authors),
    year: String(w.publication_year),
    peer_review: pr === true ? "yes" : pr === false ? "no" : "unknown",
    citations: cut(`${w.cited_by_count} (OpenAlex)${pct != null ? `, ${(pct * 100).toFixed(0)}th percentile for age and field` : ""}${w.is_retracted ? ", RETRACTED" : ""}`),
    link: w.doi ?? "none",
    ...(w._sourcecheck.abstract ? { abstract: w._sourcecheck.abstract.slice(0, LIMITS.abstract) } : {}),
  }
}

/** `model` picks one free model (no fallback); leave it out for the server's default list. `prompt` is a prompt id. */
export async function requestAssessment(work: OpenAlexWork, context: string, model?: string, prompt?: string): Promise<Exclude<AssessState, { status: "loading" }>> {
  const started = Date.now()
  const at = new Date(started).toISOString()
  const meta = (m: { model?: string; prompt_version?: string } = {}): AssessMeta => ({ ...m, ...(model ? { requested_model: model } : {}), at, duration_ms: Date.now() - started })
  const check = AssessmentRequestSchema.safeParse(buildRequest(work, context))
  if (!check.success) return { status: "error", code: "invalid_request", message: ERROR_MESSAGES.invalid_request, meta: meta() }
  let body: any
  try {
    const res = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...check.data, ...(model ? { model } : {}), ...(prompt ? { prompt } : {}) }) })
    body = await res.json()
  } catch {
    return { status: "error", code: "upstream_error", message: ERROR_MESSAGES.upstream_error, meta: meta() }
  }
  // Present only when the server runs in development (or with ASSESS_DEBUG=1).
  const debug: AssessDebug | undefined = body?.debug && Array.isArray(body.debug.attempts) ? body.debug : undefined
  if (body?.ok === true) {
    // Validate again on the client: the UI only ever renders a schema-valid assessment.
    const parsed = AssessmentResponseSchema.safeParse(body.assessment)
    const m = meta({ model: body.meta?.model, prompt_version: body.meta?.prompt_version })
    if (parsed.success) return { status: "done", assessment: parsed.data, attempts: body.meta?.attempts ?? 1, context: context.trim(), debug, meta: m }
    return { status: "error", code: "model_output_invalid", message: ERROR_MESSAGES.model_output_invalid, debug, meta: m }
  }
  const code: AssessErrorCode = body?.error?.code in ERROR_MESSAGES ? body.error.code : "upstream_error"
  // The server's own message can be more specific (e.g. an unknown model).
  const message = code === "invalid_request" && typeof body?.error?.message === "string" ? body.error.message : ERROR_MESSAGES[code]
  return { status: "error", code, message, debug, meta: meta(), ...(body?.error?.retry_after_s ? { retryAfter: Number(body.error.retry_after_s) } : {}) }
}

// ── Models ───────────────────────────────────────────────────────────────────

export type ModelOption = { id: string; name: string; context_length: number | null; router?: boolean }

/** Free OpenRouter models with structured outputs, from /api/models. */
export async function fetchModels(): Promise<{ models: ModelOption[]; default: string[] } | null> {
  try {
    const res = await fetch("/api/models")
    const body = await res.json()
    return body?.ok ? { models: body.models, default: body.default } : null
  } catch {
    return null
  }
}
