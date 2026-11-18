/**
 * "Add details": facts you enter for a source, as on the expert form.
 *   - "How the source is used" (where and for which statement the thesis cites it) is sent
 *     as use_of_source; the AI then judges relevance for that use, as the experts did.
 *   - For an OpenAlex record, a filled field replaces OpenAlex's value for that fact
 *     (e.g. the venue metric, which OpenAlex does not have, or a citation count as of a date).
 *   - For a source OpenAlex does not have (not found, or a web source), the details make
 *     a "manual" source that can be assessed like any other. Nothing is checked automatically.
 */
import { z } from "zod"
import type { OpenAlexWork, SourceDetails } from "@/data/types"
import { LIMITS } from "@/lib/assessment"
import type { Unmatched } from "@/lib/lookup"

export type DetailKey = keyof SourceDetails

export const DETAIL_FIELDS: { key: DetailKey; label: string; placeholder: string; wide?: boolean; multiline?: boolean; manualOnly?: boolean }[] = [
  { key: "title", label: "Title", placeholder: "What Are The Different Roles Available In Private Banking?", wide: true, manualOnly: true },
  { key: "use", label: "How the source is used", placeholder: "Cited in the background chapter for the definition of private banking (p. 34)", wide: true, multiline: true },
  { key: "source_type", label: "Type of source", placeholder: "Article on a company website" },
  { key: "venue", label: "Published in", placeholder: "Website of a UK recruitment firm" },
  { key: "authors", label: "Authors", placeholder: "Not named", wide: true },
  { key: "year", label: "Year", placeholder: "2024" },
  { key: "peer_review", label: "Peer review", placeholder: "no" },
  { key: "venue_metric", label: "Venue metric", placeholder: "SJR 2025: 0.43, Q2" },
  { key: "citations", label: "Citations", placeholder: "not indexed in OpenAlex" },
  { key: "link", label: "Link", placeholder: "https://…", wide: true },
  { key: "abstract", label: "Abstract", placeholder: "Optional", wide: true, multiline: true },
]

const field = (max: number) => z.string().trim().max(max, `at most ${max} characters`).optional()
export const DetailsSchema = z.object({
  title: field(300),
  use: field(LIMITS.useOfSource),
  source_type: field(LIMITS.fact),
  venue: field(LIMITS.fact),
  authors: field(LIMITS.fact),
  year: field(LIMITS.fact),
  peer_review: field(LIMITS.fact),
  venue_metric: field(LIMITS.fact),
  citations: field(LIMITS.fact),
  link: field(LIMITS.fact),
  abstract: field(LIMITS.abstract),
})

/** Drops empty fields; returns null when nothing is left. */
export function cleanDetails(d: SourceDetails): SourceDetails | null {
  const out = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v)) as SourceDetails
  return Object.keys(out).length ? out : null
}

export const isManual = (w: OpenAlexWork) => w._sourcecheck.origin === "manual"

/** A source OpenAlex does not have, built from your details. It keeps the list position of the reference. */
export function manualWork(u: Unmatched, details: SourceDetails): OpenAlexWork {
  const year = Number(details.year?.match(/\d{4}/)?.[0] ?? u.web?.year ?? 0)
  return {
    id: `manual:${u.index}`,
    doi: null,
    display_name: details.title || u.web?.title || u.reference.slice(0, 120),
    publication_year: year,
    type: "manual",
    authorships: [],
    primary_location: {
      version: null,
      source: details.venue ? { display_name: details.venue, type: "other", host_organization_name: null, issn_l: null, is_core: false, is_in_doaj: false } : null,
    },
    cited_by_count: 0,
    fwci: null,
    citation_normalized_percentile: null,
    counts_by_year: [],
    referenced_works_count: 0,
    is_retracted: false,
    open_access: { is_oa: false, oa_status: "closed" },
    indexed_in: [],
    topics: [],
    _sourcecheck: {
      max_author_h_index: null,
      raw_reference: u.reference,
      input_index: u.index,
      origin: "manual",
      details,
      unmatched: { reason: u.reason, ...(u.web ? { web: u.web } : {}) },
    },
  }
}

/** Back from a manual source to the unmatched entry it was made from. */
export function toUnmatched(w: OpenAlexWork): Unmatched {
  const u = w._sourcecheck.unmatched
  return { reference: w._sourcecheck.raw_reference, index: w._sourcecheck.input_index ?? 0, reason: (u?.reason ?? "not_found") as Unmatched["reason"], ...(u?.web ? { web: u.web } : {}) }
}

/** A suggested title for a reference without one: the quoted title, or the sentence after "(2024)." */
export function guessTitle(u: Unmatched): string {
  if (u.web?.title) return u.web.title
  const ref = u.reference.replace(/^\s*(\[\d+\]|\d+\.)\s*/, "")
  const quoted = ref.match(/[“"]([^”"]{4,})[”"]/)?.[1]
  if (quoted) return quoted.replace(/[,.]$/, "")
  const apa = ref.match(/\(\d{4}[^)]*\)\.\s*(.+?)\.(\s|$)/)?.[1]
  if (apa) return apa
  if (/\(n\.d\.\)\.\s*(.+?)\.(\s|$)/.test(ref)) return ref.match(/\(n\.d\.\)\.\s*(.+?)\.(\s|$)/)![1]
  return ""
}
