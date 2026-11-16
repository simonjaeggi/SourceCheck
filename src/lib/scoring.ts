import type { OpenAlexWork } from "@/data/mockWorks"
import { RATING_SCORE, type AssessmentResponse, type Verdict } from "@/lib/assessment"

/**
 * METRICS — the eight criteria of the source-quality rubric (expert form v2).
 * Every rating comes from the AI assessment; there are no heuristic scores. `fact`
 * names what OpenAlex contributes as input for the AI on that criterion.
 */
export const METRICS = [
  { key: "relevance", label: "Relevance to the use", short: "Relevance", fact: "your thesis context and the abstract", hint: "Does the source contribute to answering the research question?" },
  { key: "currency", label: "Currency", short: "Currency", fact: "OpenAlex: publication_year (the AI weighs it against the pace of the field)", hint: "Current enough for this topic, or a foundational work whose age does not matter" },
  { key: "authority", label: "Authority", short: "Authority", fact: "OpenAlex: authors' institutions and h-index", hint: "Do the authors or the issuing institution have recognised expertise?" },
  { key: "venue", label: "Venue & peer review", short: "Venue", fact: "OpenAlex: primary_location.source, type, version", hint: "How reputable is the venue, and was the source peer-reviewed?" },
  { key: "evidence", label: "Evidence & method", short: "Evidence", fact: "OpenAlex: abstract, referenced_works_count, is_retracted", hint: "Are claims supported by data, method or literature, and coherently argued?" },
  { key: "objectivity", label: "Purpose & objectivity", short: "Objectivity", fact: "OpenAlex: abstract and venue", hint: "Does the source inform objectively, or pursue commercial, political or other interests?" },
  { key: "reception", label: "Reception in the field", short: "Reception", fact: "OpenAlex: cited_by_count, citation_normalized_percentile", hint: "How widely is the source taken up, relative to its age and discipline?" },
  { key: "retrievability", label: "Referencing & retrievability", short: "Retrievability", fact: "your reference and the OpenAlex DOI", hint: "Is the source cited correctly and can it be located unambiguously?" },
] as const

export type MetricKey = (typeof METRICS)[number]["key"]
export type Signal = "green" | "amber" | "red"

export const VERDICT_SIGNAL: Record<Verdict, Signal> = { suitable: "green", usable_with_reservations: "amber", not_usable: "red" }

export interface ScoredWork {
  work: OpenAlexWork
  /** null until the AI assessment has run for this source */
  assessment: AssessmentResponse | null
  /** 0..10 per criterion from the AI rating; null when not assessed or rated "no rating" */
  metrics: Record<MetricKey, number | null>
  /** mean of the rated criteria (equal weights), 0..10; null until assessed */
  overall: number | null
  /** from the AI's overall verdict; null until assessed */
  signal: Signal | null
  /** what OpenAlex says per criterion, shown next to the AI's rating */
  facts: Record<MetricKey, string>
  peerReviewed: boolean | null
  flags: { label: string; tone: "good" | "warn" | "bad" | "neutral" }[]
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Peer review as far as the metadata shows it (a fact for the AI and a badge, not a score). */
export function peerReviewStatus(work: OpenAlexWork): boolean | null {
  const src = work.primary_location.source
  if (work.type === "preprint" || work.primary_location.version === "submittedVersion" || src?.type === "repository") return false
  if (src && (src.type === "journal" || src.type === "conference")) return src.is_core || !!src.host_organization_name ? true : null
  return null
}

export function scoreWork(work: OpenAlexWork, assessment: AssessmentResponse | null = null, currentYear = new Date().getFullYear()): ScoredWork {
  const src = work.primary_location.source
  const pct = work.citation_normalized_percentile?.value
  const peerReviewed = peerReviewStatus(work)
  const age = currentYear - work.publication_year
  const h = work._sourcecheck.max_author_h_index
  const refs = work.referenced_works_count

  const metrics = Object.fromEntries(
    METRICS.map((m) => {
      const r = assessment?.criteria[m.key].rating
      return [m.key, r && r !== "no_rating" ? RATING_SCORE[r] : null]
    })
  ) as Record<MetricKey, number | null>
  const rated = Object.values(metrics).filter((v): v is number => v != null)
  const overall = assessment && rated.length ? r1(rated.reduce((s, v) => s + v, 0) / rated.length) : null
  const signal = assessment ? VERDICT_SIGNAL[assessment.overall] : null

  const facts: Record<MetricKey, string> = {
    relevance: work._sourcecheck.abstract ? "abstract available" : "no abstract; title only",
    currency: `${work.publication_year} (${age} year${age === 1 ? "" : "s"} old)`,
    authority: h == null ? "no author h-index found" : `highest author h-index ${h}`,
    venue: `${src?.display_name ?? "no venue"}${src ? ` (${src.type}${src.is_core ? ", CWTS core" : ""})` : ""}${peerReviewed === false ? ", not peer reviewed" : ""}`,
    evidence: work.is_retracted ? "RETRACTED" : `${refs.toLocaleString("en-US")} references`,
    objectivity: src?.host_organization_name ? `published by ${src.host_organization_name}` : "publisher unknown",
    reception: `${work.cited_by_count.toLocaleString("en-US")} citations${pct != null ? `, ${(pct * 100).toFixed(1)}th percentile for age & field` : ""}`,
    retrievability: work.doi ? "DOI resolves" : src ? "no DOI, venue identifiable" : "no DOI, venue unknown",
  }

  const flags: ScoredWork["flags"] = []
  if (work.is_retracted) flags.push({ label: "Retracted", tone: "bad" })
  if (peerReviewed === true) flags.push({ label: "Peer reviewed", tone: "good" })
  if (peerReviewed === false) flags.push({ label: "Preprint", tone: "warn" })
  if (peerReviewed === null) flags.push({ label: "Venue unverified", tone: "warn" })
  if (work.citation_normalized_percentile?.is_in_top_1_percent) flags.push({ label: "Top 1% cited", tone: "good" })
  if (work.open_access.is_oa) flags.push({ label: "Open access", tone: "neutral" })
  if (!work.doi) flags.push({ label: "No DOI", tone: "warn" })
  if (work._sourcecheck.match?.confidence === "uncertain") flags.push({ label: "Check match", tone: "warn" })

  return { work, assessment, metrics, overall, signal, facts, peerReviewed, flags }
}

export function formatAuthors(work: OpenAlexWork, max = 3) {
  const names = work.authorships.map((x) => x.author.display_name)
  return names.length > max ? `${names.slice(0, max).join(", ")} et al.` : names.join(", ")
}

export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
