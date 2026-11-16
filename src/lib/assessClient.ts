/**
 * Browser side of the AI assessment: builds the request from a source and the thesis
 * context, calls /api/assess and re-validates the answer. Used by the source list
 * ("Assess", "Assess all") and the detail sheet.
 */
import type { OpenAlexWork } from "@/data/mockWorks"
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

export type AssessState =
  | { status: "loading" }
  | { status: "done"; assessment: AssessmentResponse; attempts: number; context: string; debug?: AssessDebug }
  | { status: "error"; code: AssessErrorCode; message: string; debug?: AssessDebug }

/** Why the thesis context cannot be sent yet, or null when it is fine. */
export function contextProblem(context: string): string | null {
  const c = context.trim()
  if (!c) return "Add your thesis context (topic and research question) in the input panel first."
  if (c.length > LIMITS.thesisContext) return `Your context is ${c.length} characters; the limit is ${LIMITS.thesisContext}.`
  return null
}

/** The facts the AI gets: the same kinds of information the experts see on the form. */
export function buildRequest(w: OpenAlexWork, context: string): AssessmentRequest {
  const src = w.primary_location.source
  const cut = (s: string) => s.slice(0, LIMITS.fact)
  const pr = peerReviewStatus(w)
  const details = w._sourcecheck.author_details
  // OpenAlex records carry institution and h-index per author; mock records only names.
  const authors = details?.length
    ? details
        .map((d) => {
          const extra = [d.institution, d.h_index != null ? `h-index ${d.h_index}` : null].filter(Boolean).join(", ")
          return extra ? `${d.name} (${extra})` : d.name
        })
        .join("; ")
    : w.authorships.map((a) => a.author.display_name).join(", ")
  const pct = w.citation_normalized_percentile?.value
  return {
    thesis_context: context.trim(),
    reference: w._sourcecheck.raw_reference.slice(0, LIMITS.reference),
    facts: {
      source_type: cut(`${w.type}${w.primary_location.version === "submittedVersion" ? " (submitted version)" : ""}`),
      venue: cut(src ? `${src.display_name}${src.host_organization_name ? ` (${src.host_organization_name})` : ""}, ${src.type}` : "no venue found"),
      authors: cut(authors),
      year: String(w.publication_year),
      peer_review: pr === true ? "yes" : pr === false ? "no" : "unknown",
      citations: cut(`${w.cited_by_count} (OpenAlex)${pct != null ? `, ${(pct * 100).toFixed(0)}th percentile for age and field` : ""}${w.is_retracted ? ", RETRACTED" : ""}`),
      link: w.doi ?? "none",
      ...(w._sourcecheck.abstract ? { abstract: w._sourcecheck.abstract.slice(0, LIMITS.abstract) } : {}),
    },
    language: "en",
  }
}

export async function requestAssessment(work: OpenAlexWork, context: string): Promise<Exclude<AssessState, { status: "loading" }>> {
  const check = AssessmentRequestSchema.safeParse(buildRequest(work, context))
  if (!check.success) return { status: "error", code: "invalid_request", message: ERROR_MESSAGES.invalid_request }
  let body: any
  try {
    const res = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(check.data) })
    body = await res.json()
  } catch {
    return { status: "error", code: "upstream_error", message: ERROR_MESSAGES.upstream_error }
  }
  // Present only when the server runs in development (or with ASSESS_DEBUG=1).
  const debug: AssessDebug | undefined = body?.debug && Array.isArray(body.debug.attempts) ? body.debug : undefined
  if (body?.ok === true) {
    // Validate again on the client: the UI only ever renders a schema-valid assessment.
    const parsed = AssessmentResponseSchema.safeParse(body.assessment)
    if (parsed.success) return { status: "done", assessment: parsed.data, attempts: body.meta?.attempts ?? 1, context: context.trim(), debug }
    return { status: "error", code: "model_output_invalid", message: ERROR_MESSAGES.model_output_invalid, debug }
  }
  const code: AssessErrorCode = body?.error?.code in ERROR_MESSAGES ? body.error.code : "upstream_error"
  return { status: "error", code, message: ERROR_MESSAGES[code], debug }
}
