import type { OpenAlexWork } from "@/data/mockWorks"

/**
 * PROVISIONAL METRICS
 * These six dimensions are placeholders until the interview results are in.
 * Each maps raw API fields to a 0..10 score so they fit one spider chart.
 */
export const METRICS = [
  { key: "impact", label: "Citation impact", api: "OpenAlex: citation_normalized_percentile", hint: "Field-normalised citation percentile" },
  { key: "influence", label: "Influence", api: "Semantic Scholar: influentialCitationCount", hint: "Share of citations that build substantially on the work" },
  { key: "venue", label: "Venue & peer review", api: "OpenAlex: primary_location.source (type, is_core) + type", hint: "Peer-reviewed venue vs. preprint or unknown outlet" },
  { key: "recency", label: "Recency", api: "OpenAlex: publication_year", hint: "How current the work is" },
  { key: "relevance", label: "Relevance to context", api: "SourceCheck: embedding similarity to your abstract", hint: "Match between the paper and your context" },
  { key: "integrity", label: "Integrity", api: "OpenAlex: is_retracted (Retraction Watch), DOI present", hint: "No retraction, resolvable identifier" },
] as const

export type MetricKey = (typeof METRICS)[number]["key"]
export type Signal = "green" | "amber" | "red"

export interface ScoredWork {
  work: OpenAlexWork
  metrics: Record<MetricKey, number>
  raw: Record<MetricKey, string>
  overall: number
  signal: Signal
  peerReviewed: boolean | null
  flags: { label: string; tone: "good" | "warn" | "bad" | "neutral" }[]
}

const clamp = (n: number) => Math.max(0, Math.min(10, n))
const r1 = (n: number) => Math.round(n * 10) / 10

const WEIGHTS: Record<MetricKey, number> = { impact: 0.2, influence: 0.1, venue: 0.25, recency: 0.1, relevance: 0.2, integrity: 0.15 }

export function scoreWork(work: OpenAlexWork, currentYear = 2026): ScoredWork {
  const src = work.primary_location.source
  const s2 = work._semantic_scholar
  const pct = work.citation_normalized_percentile?.value ?? 0

  const peerReviewed =
    work.type === "preprint" || src?.type === "repository" ? false : src && (src.type === "journal" || src.type === "conference") ? (src.is_core || !!src.host_organization_name ? true : null) : null

  const infRatio = s2.citationCount > 0 ? s2.influentialCitationCount / s2.citationCount : 0
  const age = currentYear - work.publication_year

  const metrics: Record<MetricKey, number> = {
    impact: clamp(pct * 10),
    influence: clamp((infRatio / 0.12) * 10),
    venue: clamp(peerReviewed === true ? (src?.is_core ? 9.5 : 7.5) : peerReviewed === false ? 3.5 : 1.5),
    recency: clamp(10 - age * 1.2),
    relevance: clamp(work._sourcecheck.relevance_to_context * 10),
    integrity: work.is_retracted ? 0 : work.doi ? 10 : 7,
  }
  Object.keys(metrics).forEach((k) => (metrics[k as MetricKey] = r1(metrics[k as MetricKey])))

  const raw: Record<MetricKey, string> = {
    impact: `${(pct * 100).toFixed(1)}th percentile, ${work.cited_by_count.toLocaleString("en-US")} citations`,
    influence: `${s2.influentialCitationCount.toLocaleString("en-US")} of ${s2.citationCount.toLocaleString("en-US")} citations influential (${(infRatio * 100).toFixed(1)}%)`,
    venue: `${src?.type ?? "unknown"}${src?.is_core ? ", CWTS core source" : ""}${peerReviewed === false ? ", not peer reviewed" : ""}`,
    recency: `${work.publication_year} (${age} year${age === 1 ? "" : "s"} old)`,
    relevance: `similarity ${work._sourcecheck.relevance_to_context.toFixed(2)}`,
    integrity: work.is_retracted ? "RETRACTED (Retraction Watch)" : work.doi ? "not retracted, DOI resolves" : "not retracted, no DOI",
  }

  let overall = (Object.keys(WEIGHTS) as MetricKey[]).reduce((s, k) => s + metrics[k] * WEIGHTS[k], 0)
  if (work.is_retracted) overall = Math.min(overall, 2)
  overall = r1(overall)

  const signal: Signal = work.is_retracted || overall < 4.5 ? "red" : overall < 7 ? "amber" : "green"

  const flags: ScoredWork["flags"] = []
  if (work.is_retracted) flags.push({ label: "Retracted", tone: "bad" })
  if (peerReviewed === true) flags.push({ label: "Peer reviewed", tone: "good" })
  if (peerReviewed === false) flags.push({ label: "Preprint", tone: "warn" })
  if (peerReviewed === null) flags.push({ label: "Venue unverified", tone: "bad" })
  if (work.citation_normalized_percentile?.is_in_top_1_percent) flags.push({ label: "Top 1% cited", tone: "good" })
  if (work.open_access.is_oa) flags.push({ label: "Open access", tone: "neutral" })
  if (!work.doi) flags.push({ label: "No DOI", tone: "warn" })

  return { work, metrics, raw, overall, signal, peerReviewed, flags }
}

export function formatAuthors(work: OpenAlexWork, max = 3) {
  const names = work.authorships.map((x) => x.author.display_name)
  return names.length > max ? `${names.slice(0, max).join(", ")} et al.` : names.join(", ")
}

export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
