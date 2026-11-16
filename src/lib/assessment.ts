/**
 * ASSESSMENT DTOs
 * ---------------------------------------------------------------------------
 * Shared by the browser and the /api/assess function, so both validate against
 * exactly the same zod schemas. All objects are strict: unknown keys are errors.
 *
 * Mirrors the expert rating form: 8 criteria, each rated on six levels or
 * "no rating", an overall verdict on three levels, and reasons (what was
 * decisive, what the student should do).
 */
import { z } from "zod"

// ── Scale ────────────────────────────────────────────────────────────────────

export const RATINGS = ["very_good", "good", "rather_good", "rather_weak", "weak", "very_weak", "no_rating"] as const
export type Rating = (typeof RATINGS)[number]

export const RATING_LABELS: Record<Rating, string> = {
  very_good: "very good",
  good: "good",
  rather_good: "rather good",
  rather_weak: "rather weak",
  weak: "weak",
  very_weak: "very weak",
  no_rating: "no rating",
}

/** Position on the 0..10 radar scale. `no_rating` has none and is left out of averages. */
export const RATING_SCORE: Record<Exclude<Rating, "no_rating">, number> = {
  very_good: 10,
  good: 8,
  rather_good: 6,
  rather_weak: 4,
  weak: 2,
  very_weak: 0,
}

export const VERDICTS = ["suitable", "usable_with_reservations", "not_usable"] as const
export type Verdict = (typeof VERDICTS)[number]

export const VERDICT_LABELS: Record<Verdict, string> = {
  suitable: "Suitable for use",
  usable_with_reservations: "Usable with reservations",
  not_usable: "Not usable",
}

// ── Criteria (same keys as METRICS in scoring.ts) ───────────────────────────

export const CRITERIA = [
  { key: "relevance", label: "Relevance to the use", question: "Does the source support the statement for which it is cited, and does it contribute to answering the research question?" },
  { key: "currency", label: "Currency", question: "Is it current enough for this topic and this use?" },
  { key: "authority", label: "Authority", question: "Do the authors or the issuing institution have recognised expertise?" },
  { key: "venue", label: "Venue and peer review", question: "How reputable is the publication venue, and was the source peer-reviewed?" },
  { key: "evidence", label: "Evidence and method", question: "Are the claims supported by data, method or literature, and verifiable?" },
  { key: "objectivity", label: "Purpose and objectivity", question: "Does the source aim to inform objectively, or does it pursue commercial, political or other interests?" },
  { key: "reception", label: "Reception in the field", question: "How widely is it taken up in the field, relative to its age and discipline?" },
  { key: "retrievability", label: "Referencing and retrievability", question: "Is the source cited completely and correctly, and can it be located unambiguously?" },
] as const
export type CriterionKey = (typeof CRITERIA)[number]["key"]

// ── Limits (shared so the UI can enforce them before sending) ───────────────

export const LIMITS = {
  /** whole request body in bytes, checked before JSON parsing */
  requestBytes: 12_000,
  thesisContext: 2_000,
  useOfSource: 1_500,
  reference: 800,
  fact: 400,
  /** abstract from OpenAlex, shortened on the server to 1,500 */
  abstract: 1_600,
  /** per criterion reason, in characters */
  reason: 320,
  bullet: 240,
} as const

// ── Request ──────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max)
const fact = z.string().trim().max(LIMITS.fact).optional()

export const AssessmentRequestSchema = z.strictObject({
  /** thesis title, degree programme, research question (and optionally a short abstract) */
  thesis_context: text(LIMITS.thesisContext),
  /**
   * where and for which statement the thesis cites the source. Optional: the app leaves it
   * out and the AI judges against the thesis context; gold-standard runs can pass it.
   */
  use_of_source: text(LIMITS.useOfSource).optional(),
  /** the reference exactly as it appears in the bibliography */
  reference: text(LIMITS.reference),
  /** metadata facts about the source, as shown to the expert raters */
  facts: z.strictObject({
    source_type: fact,
    venue: fact,
    authors: fact,
    year: fact,
    peer_review: fact,
    venue_metric: fact,
    citations: fact,
    link: fact,
    /** from OpenAlex; lets the model judge evidence and method from what the paper says it does */
    abstract: z.string().trim().max(LIMITS.abstract).optional(),
  }),
  /** language of all free text in the response */
  language: z.enum(["en", "de"]),
})
export type AssessmentRequest = z.infer<typeof AssessmentRequestSchema>

// ── Response ─────────────────────────────────────────────────────────────────

const CriterionAssessmentSchema = z.strictObject({
  /** 1–2 sentences, written before the rating so the rating follows from it */
  reason: text(LIMITS.reason),
  rating: z.enum(RATINGS),
})

export const AssessmentResponseSchema = z.strictObject({
  criteria: z.strictObject({
    relevance: CriterionAssessmentSchema,
    currency: CriterionAssessmentSchema,
    authority: CriterionAssessmentSchema,
    venue: CriterionAssessmentSchema,
    evidence: CriterionAssessmentSchema,
    objectivity: CriterionAssessmentSchema,
    reception: CriterionAssessmentSchema,
    retrievability: CriterionAssessmentSchema,
  }),
  overall: z.enum(VERDICTS),
  /** what was decisive for the overall rating */
  decisive_reasons: z.array(text(LIMITS.bullet)).min(1).max(4),
  /** what the student should do */
  advice: z.array(text(LIMITS.bullet)).min(1).max(3),
})
export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>

// ── API envelope ─────────────────────────────────────────────────────────────

export const ERROR_CODES = [
  "invalid_request",
  "payload_too_large",
  "forbidden_origin",
  "rate_limited",
  "not_configured",
  "model_refused",
  "model_output_invalid",
  "upstream_error",
] as const
export type AssessErrorCode = (typeof ERROR_CODES)[number]

/**
 * What happened between the server and the LLM, for the dev panel. Sent only when the
 * server runs in development or with ASSESS_DEBUG=1, never by default in production.
 */
export type AssessDebug = {
  prompt_version: string
  models_requested: string[]
  /** the <case> message sent as the first user turn */
  user_message: string
  attempts: {
    n: number
    /** model that answered (OpenRouter may fall back) */
    model?: string
    finish_reason: string | null
    duration_ms: number
    tokens?: { prompt?: number; completion?: number; reasoning?: number }
    /** the model's text output, exactly as returned */
    raw: string
    /** reasoning text, if the model returns it */
    reasoning?: string
    refusal?: string | null
    valid: boolean
    /** zod issues (or JSON/length problems) when invalid */
    issues?: string
    /** the repair prompt sent back to the model after this attempt */
    repair_message?: string
  }[]
  /** set when the call itself failed (HTTP error, timeout) */
  error?: string
  total_ms: number
}

export type AssessResult =
  | { ok: true; assessment: AssessmentResponse; meta: { model: string; prompt_version: string; attempts: number }; debug?: AssessDebug }
  | { ok: false; error: { code: AssessErrorCode; message: string; retry_after_s?: number }; debug?: AssessDebug }

/** Messages the UI shows for each error code. */
export const ERROR_MESSAGES: Record<AssessErrorCode, string> = {
  invalid_request: "Some fields are missing or too long. Check the inputs and try again.",
  payload_too_large: "The input is too long. Shorten the texts and try again.",
  forbidden_origin: "This request was blocked because it did not come from SourceCheck.",
  rate_limited: "Too many assessments in a short time. Please wait a moment and try again.",
  not_configured: "The AI assessment is not set up on this deployment yet.",
  model_refused: "The AI declined to assess this source.",
  model_output_invalid: "The AI did not return a valid assessment after 3 attempts. Please try again.",
  upstream_error: "The AI service could not be reached. Please try again later.",
}
