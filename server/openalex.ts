/**
 * OpenAlex client: turns pasted reference strings into OpenAlex work records.
 * Plain code, no AI: the same reference always produces the same requests.
 *
 *   1. DOI in the reference  → one batched request:  /works?filter=doi:a|b|c
 *   2. no DOI (or not found) → one search each:      /works?search=<title>
 *      accepted only if the found title closely matches the reference
 *   3. authors of all works  → one batched request:  /authors?filter=id:A1|A2
 *      (h-index and last known institution)
 *
 * Set OPENALEX_API_KEY (free at openalex.org/settings/api). Without it, all
 * requests share an anonymous daily budget per IP, and searches are throttled.
 */
import type { OpenAlexWork } from "../src/data/mockWorks"
import type { Unmatched } from "../src/lib/lookup"

const BASE = "https://api.openalex.org"
const TIMEOUT_MS = 15_000
/** parallel searches; lower without a key, where OpenAlex throttles anonymous search */
const concurrency = () => (process.env.OPENALEX_API_KEY?.trim() ? 4 : 2)
const ABSTRACT_CHARS = 1_500
const MAX_AUTHORS_PER_WORK = 10
const CACHE_TTL_MS = 24 * 3_600_000

const WORK_FIELDS = [
  "id", "doi", "display_name", "publication_year", "type", "authorships", "primary_location",
  "cited_by_count", "fwci", "citation_normalized_percentile", "counts_by_year", "referenced_works_count",
  "is_retracted", "open_access", "indexed_in", "topics", "abstract_inverted_index",
].join(",")

export class OpenAlexError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// ── HTTP with a small per-instance cache ─────────────────────────────────────

export type Fetcher = (url: string) => Promise<unknown>

const cache = new Map<string, { at: number; value: unknown }>()
let cacheHits = 0

function withKey(url: string) {
  const key = process.env.OPENALEX_API_KEY?.trim()
  return key ? `${url}&api_key=${encodeURIComponent(key)}` : url
}

export const openAlexFetch: Fetcher = async (url) => {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cacheHits++
    return hit.value
  }
  const get = () => fetch(withKey(url), { headers: { "User-Agent": "SourceCheck-prototype" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  let res = await get()
  // One retry on a short throttle; longer waits are reported as rate limited.
  const wait = Number(res.headers.get("retry-after"))
  if (res.status === 429 && wait > 0 && wait <= 3) {
    await new Promise((r) => setTimeout(r, wait * 1000))
    res = await get()
  }
  if (!res.ok) throw new OpenAlexError(res.status, `OpenAlex returned ${res.status}`)
  const value = await res.json()
  if (cache.size > 2_000) cache.delete(cache.keys().next().value!)
  cache.set(url, { at: Date.now(), value })
  return value
}

// ── Parsing references ───────────────────────────────────────────────────────

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i

export function extractDoi(ref: string): string | null {
  const m = ref.match(DOI_RE)
  return m ? m[1].replace(/[.,;:)\]]+$/, "").toLowerCase() : null
}

export function extractYear(ref: string): number | null {
  const m = ref.match(/\((\d{4})[a-z]?\)/) ?? ref.match(/\b(19[5-9]\d|20[0-4]\d)\b/)
  return m ? Number(m[1]) : null
}

/** Best guess at the title: quoted (IEEE), or the sentence after "(2020)." (APA), else the cleaned reference. */
export function extractTitle(ref: string): string {
  const clean = ref.replace(/^\s*(\[\d+\]|\d+\.)\s*/, "").replace(DOI_RE, "").replace(/https?:\/\/\S+/g, "")
  const quoted = clean.match(/[“"]([^”"]{10,})[”"]/)
  if (quoted) return quoted[1].replace(/[,.]$/, "").trim()
  const apa = clean.match(/\(\d{4}[a-z]?(?:,[^)]*)?\)\.\s*(.+?[.?!])(\s|$)/)
  if (apa) return apa[1].replace(/\.$/, "").trim()
  return clean.replace(/\s+/g, " ").trim().slice(0, 250)
}

const normalize = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/** Share of the candidate title's words that appear in the reference (0..1). */
export function titleOverlap(candidateTitle: string, reference: string): number {
  const words = normalize(candidateTitle).split(" ").filter((w) => w.length > 1)
  if (words.length === 0) return 0
  const ref = new Set(normalize(reference).split(" "))
  return words.filter((w) => ref.has(w)).length / words.length
}

/** "likely" ≥ 0.9 overlap, "uncertain" ≥ 0.75, else no match. A year off by more than 1 lowers it one step. */
export function matchConfidence(candidateTitle: string, candidateYear: number | null, reference: string): "likely" | "uncertain" | null {
  const overlap = titleOverlap(candidateTitle, reference)
  const shortTitle = normalize(candidateTitle).split(" ").length < 4
  let level = overlap >= (shortTitle ? 1 : 0.9) ? 2 : overlap >= 0.75 ? 1 : 0
  const refYear = extractYear(reference)
  if (level && refYear && candidateYear && Math.abs(refYear - candidateYear) > 1) level--
  return level === 2 ? "likely" : level === 1 ? "uncertain" : null
}

// ── Mapping OpenAlex → app record ────────────────────────────────────────────

export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word
  const text = words.filter(Boolean).join(" ")
  return text.length > ABSTRACT_CHARS ? text.slice(0, ABSTRACT_CHARS - 1).trimEnd() + "…" : text || null
}

type RawWork = any

function toWork(raw: RawWork, reference: string, match: NonNullable<OpenAlexWork["_sourcecheck"]["match"]>): OpenAlexWork {
  const src = raw.primary_location?.source ?? null
  return {
    id: raw.id,
    doi: raw.doi ?? null,
    display_name: raw.display_name ?? "(untitled)",
    publication_year: raw.publication_year ?? 0,
    type: raw.type ?? "other",
    authorships: (raw.authorships ?? []).map((a: any) => ({
      author_position: a.author_position,
      author: { id: a.author?.id ?? null, display_name: a.author?.display_name ?? a.raw_author_name ?? "Unknown" },
      institutions: (a.institutions ?? []).map((i: any) => ({ display_name: i.display_name })),
    })),
    primary_location: {
      version: raw.primary_location?.version ?? null,
      source: src && {
        display_name: src.display_name,
        type: src.type ?? "other",
        host_organization_name: src.host_organization_name ?? null,
        issn_l: src.issn_l ?? null,
        is_core: !!src.is_core,
        is_in_doaj: !!src.is_in_doaj,
      },
    },
    cited_by_count: raw.cited_by_count ?? 0,
    fwci: raw.fwci ?? null,
    citation_normalized_percentile: raw.citation_normalized_percentile ?? null,
    counts_by_year: raw.counts_by_year ?? [],
    referenced_works_count: raw.referenced_works_count ?? 0,
    is_retracted: !!raw.is_retracted,
    open_access: { is_oa: !!raw.open_access?.is_oa, oa_status: raw.open_access?.oa_status ?? "closed" },
    indexed_in: raw.indexed_in ?? [],
    topics: (raw.topics ?? []).slice(0, 3).map((t: any) => ({ display_name: t.display_name, score: t.score })),
    _sourcecheck: {
      max_author_h_index: null,
      raw_reference: reference,
      concepts: [],
      origin: "openalex",
      match,
      abstract: rebuildAbstract(raw.abstract_inverted_index),
    },
  }
}

/**
 * OpenAlex often holds several records of one paper (arXiv preprint and published version).
 * Among candidates with the best title match, prefer the one whose venue appears in the
 * reference, then a non-preprint, then the most cited.
 */
export function pickCandidate(candidates: RawWork[], ref: string): { raw: RawWork; c: "likely" | "uncertain" } | null {
  const rated = candidates
    .map((raw) => ({ raw, c: matchConfidence(raw.display_name ?? "", raw.publication_year ?? null, ref) }))
    .filter((x): x is { raw: RawWork; c: "likely" | "uncertain" } => x.c !== null)
  if (!rated.length) return null
  const level = rated.some((x) => x.c === "likely") ? "likely" : "uncertain"
  const score = (raw: RawWork) => {
    const venue = raw.primary_location?.source?.display_name ?? ""
    const preprint = raw.type === "preprint" || raw.primary_location?.source?.type === "repository"
    return (venue ? titleOverlap(venue, ref) * 2 : 0) + (preprint ? 0 : 0.5) + Math.log10(1 + (raw.cited_by_count ?? 0)) / 100
  }
  return rated.filter((x) => x.c === level).sort((a, b) => score(b.raw) - score(a.raw))[0]
}

// ── Lookup ───────────────────────────────────────────────────────────────────

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const failReason = (e: unknown): Unmatched["reason"] => (e instanceof OpenAlexError && e.status === 429 ? "openalex_rate_limited" : "openalex_error")

export async function lookupReferences(references: string[], get: Fetcher = openAlexFetch) {
  const hitsBefore = cacheHits
  const found: (OpenAlexWork | Unmatched)[] = new Array(references.length)

  // 1. DOIs, batched
  const dois = references.map(extractDoi)
  const byDoi = new Map<string, RawWork>()
  const wanted = [...new Set(dois.filter((d): d is string => !!d))]
  for (const batch of chunks(wanted, 50)) {
    try {
      const res: any = await get(`${BASE}/works?filter=doi:${batch.map(encodeURIComponent).join("|")}&per_page=50&select=${WORK_FIELDS}`)
      for (const w of res.results ?? []) if (w.doi) byDoi.set(w.doi.replace("https://doi.org/", "").toLowerCase(), w)
    } catch (e) {
      // fall through to title search for these references
      console.warn("[openalex] DOI batch failed", (e as Error).message)
    }
  }
  references.forEach((ref, i) => {
    const raw = dois[i] && byDoi.get(dois[i]!)
    if (raw) found[i] = toWork(raw, ref, { method: "doi", confidence: "exact" })
  })

  // 2. Title search for the rest
  const rest = references.map((_, i) => i).filter((i) => !found[i])
  await pool(rest, concurrency(), async (i) => {
    const ref = references[i]
    try {
      const q = encodeURIComponent(extractTitle(ref))
      const res: any = await get(`${BASE}/works?search=${q}&per_page=5&select=${WORK_FIELDS}`)
      const candidates: RawWork[] = res.results ?? []
      if (!candidates.length) return void (found[i] = { reference: ref, reason: "not_found" })
      const best = pickCandidate(candidates, ref)
      found[i] = best ? toWork(best.raw, ref, { method: "title_search", confidence: best.c }) : { reference: ref, reason: "no_confident_match" }
    } catch (e) {
      found[i] = { reference: ref, reason: failReason(e) }
    }
  })

  // De-duplicate: two references pointing at the same record keep the first.
  const works: OpenAlexWork[] = []
  const unmatched: Unmatched[] = []
  const seen = new Set<string>()
  for (const f of found) {
    if ("reason" in f) unmatched.push(f)
    else if (!seen.has(f.id)) { seen.add(f.id); works.push(f) }
  }

  // 3. Authors, batched: h-index and institution
  const authorIds = [...new Set(works.flatMap((w) => w.authorships.slice(0, MAX_AUTHORS_PER_WORK).map((a) => a.author.id?.replace("https://openalex.org/", "")).filter((x): x is string => !!x)))]
  const authors = new Map<string, { h: number | null; inst: string | null }>()
  for (const batch of chunks(authorIds, 50)) {
    try {
      const res: any = await get(`${BASE}/authors?filter=id:${batch.join("|")}&per_page=50&select=id,summary_stats,last_known_institutions`)
      for (const a of res.results ?? []) {
        authors.set(a.id.replace("https://openalex.org/", ""), { h: a.summary_stats?.h_index ?? null, inst: a.last_known_institutions?.[0]?.display_name ?? null })
      }
    } catch (e) {
      console.warn("[openalex] author batch failed", (e as Error).message)
    }
  }
  for (const w of works) {
    const details = w.authorships.slice(0, MAX_AUTHORS_PER_WORK).map((a) => {
      const info = a.author.id ? authors.get(a.author.id.replace("https://openalex.org/", "")) : undefined
      return { name: a.author.display_name, institution: a.institutions?.[0]?.display_name ?? info?.inst ?? null, h_index: info?.h ?? null }
    })
    w._sourcecheck.author_details = details
    const hs = details.map((d) => d.h_index).filter((h): h is number => h != null)
    w._sourcecheck.max_author_h_index = hs.length ? Math.max(...hs) : null
  }

  const doiMatches = works.filter((w) => w._sourcecheck.match?.method === "doi").length
  return { works, unmatched, meta: { doi_matches: doiMatches, title_matches: works.length - doiMatches, cached: cacheHits - hitsBefore, api_key: !!process.env.OPENALEX_API_KEY?.trim() } }
}
