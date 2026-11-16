/**
 * LOOKUP DTOs for POST /api/lookup (references → OpenAlex records).
 * Shared by the browser and the server function. Strict, like the assessment DTOs.
 */
import { z } from "zod"
import type { OpenAlexWork } from "../data/types.js"

export const LOOKUP_LIMITS = {
  /** whole request body in bytes, checked before JSON parsing */
  requestBytes: 64_000,
  /** references per request; each one without a DOI costs one OpenAlex search */
  references: 60,
  /** characters per reference line */
  reference: 800,
} as const

export const LookupRequestSchema = z.strictObject({
  references: z.array(z.string().trim().min(1).max(LOOKUP_LIMITS.reference)).min(1).max(LOOKUP_LIMITS.references),
})
export type LookupRequest = z.infer<typeof LookupRequestSchema>

export type Unmatched = {
  reference: string
  reason: "not_found" | "no_confident_match" | "openalex_rate_limited" | "openalex_error"
}

export const UNMATCHED_LABELS: Record<Unmatched["reason"], string> = {
  not_found: "No matching record in OpenAlex.",
  no_confident_match: "OpenAlex found similar records, but none matched the title closely enough.",
  openalex_rate_limited: "OpenAlex rate limit reached; try again later.",
  openalex_error: "OpenAlex could not be reached for this reference.",
}

export const LOOKUP_ERROR_CODES = ["invalid_request", "payload_too_large", "forbidden_origin", "rate_limited", "upstream_error"] as const
export type LookupErrorCode = (typeof LOOKUP_ERROR_CODES)[number]

export const LOOKUP_ERROR_MESSAGES: Record<LookupErrorCode, string> = {
  invalid_request: `Check the reference list: at most ${LOOKUP_LIMITS.references} references, each at most ${LOOKUP_LIMITS.reference} characters.`,
  payload_too_large: "The reference list is too long.",
  forbidden_origin: "This request was blocked because it did not come from SourceCheck.",
  rate_limited: "Too many lookups in a short time. Please wait a moment and try again.",
  upstream_error: "OpenAlex could not be reached. Please try again later.",
}

export type LookupResult =
  | {
      ok: true
      /** in input order; a reference that matches the same record as an earlier one is left out */
      works: OpenAlexWork[]
      unmatched: Unmatched[]
      meta: { doi_matches: number; title_matches: number; cached: number; api_key: boolean }
    }
  | { ok: false; error: { code: LookupErrorCode; message: string; retry_after_s?: number } }
