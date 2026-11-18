/**
 * OpenAlex client: turns pasted reference strings into OpenAlex work records.
 * Plain code, no AI: the same reference always produces the same requests.
 *
 *   1. DOI in the reference  → one batched request:  /works?filter=doi:a|b|c
 *   2. web pages, repositories and docs (a non-scholarly link, no journal or publisher
 *      details) are not searched; they are reported as web sources
 *   3. no DOI (or not found) → one search each:      /works?search=<title>
 *      accepted only if the title matches both ways AND an author, the year or the
 *      venue agrees; a weaker match is returned as a possible match to confirm
 *   4. authors of all works  → one batched request:  /authors?filter=id:A1|A2
 *      (h-index and last known institution)
 *
 * Set OPENALEX_API_KEY (free at openalex.org/settings/api). Without it, all
 * requests share an anonymous daily budget per IP, and searches are throttled.
 */
import type { OpenAlexWork } from "../src/data/types.js"
import type { Unmatched, WebSource } from "../src/lib/lookup.js"

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

type RawWork = any

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i

export function extractDoi(ref: string): string | null {
  const m = ref.match(DOI_RE)
  return m ? m[1].replace(/[.,;:)\]]+$/, "").toLowerCase() : null
}

/** "Accessed: Apr. 27, 2026." / "Retrieved May 3, 2024, from" — a visit date, not a publication date. */
const ACCESSED_RE = /\b(?:accessed|retrieved|abgerufen|zugegriffen)(?:\s+on)?:?\s*([^\[\]\n]{0,25}?\b(?:19|20)\d{2})\b\.?/gi

/** Year the reference says it was accessed, if any (a match published later cannot be the source). */
export function extractAccessedYear(ref: string): number | null {
  const years = [...ref.matchAll(ACCESSED_RE)].map((m) => Number(m[1].match(/(19|20)\d{2}$/)?.[0]))
  return years.length ? Math.max(...years) : null
}

/** Publication year: "(2020)" (APA), else the first plausible year outside an "Accessed:" note. */
export function extractYear(ref: string): number | null {
  const body = ref.replace(ACCESSED_RE, " ").replace(/https?:\/\/\S+/g, " ")
  const m = body.match(/\((\d{4})[a-z]?\)/) ?? body.match(/\b(19[5-9]\d|20[0-4]\d)\b/)
  return m ? Number(m[1]) : null
}

/**
 * Best guess at the title: quoted (IEEE), or the sentence after "(2020)." (APA). Otherwise the
 * cleaned reference, flagged as not reliable: it still contains authors and venue, so it can
 * only be checked one way (are the candidate's title words in it?).
 */
export function parseTitle(ref: string): { title: string; reliable: boolean; alternatives: string[] } {
  const clean = ref.replace(/^\s*(\[\d+\]|\d+\.)\s*/, "").replace(DOI_RE, "").replace(/https?:\/\/\S+/g, "")
  const quoted = clean.match(/[“"]([^”"]{10,})[”"]/)
  if (quoted) {
    const title = quoted[1].replace(/[,.]$/, "").trim()
    return { title, reliable: true, alternatives: [title] }
  }
  // APA: the title ends at the first "." — or at a "?"/"!", unless a subtitle follows it.
  const apa = clean.match(/\(\d{4}[a-z]?(?:,[^)]*)?\)\.\s*(.+?[.?!])(\s|$)/)
  if (apa) {
    const short = apa[1].replace(/\.$/, "").trim()
    const long = clean.slice(clean.indexOf(apa[1])).match(/^(.+?)\.(\s|$)/)?.[1].trim()
    return { title: short, reliable: true, alternatives: long && long !== short ? [short, long] : [short] }
  }
  const title = clean.replace(ACCESSED_RE, " ").replace(/\s+/g, " ").trim().slice(0, 250)
  return { title, reliable: false, alternatives: [title] }
}
export const extractTitle = (ref: string) => parseTitle(ref).title

/** Lower-case words; letters of any script are kept, so "入門ガイド" still counts as a difference. */
const tokens = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 || /\d/.test(w))

/** Share of the candidate title's words that appear in the given text (one way, 0..1). */
export function titleOverlap(candidateTitle: string, text: string): number {
  const words = tokens(candidateTitle)
  if (words.length === 0) return 0
  const ref = new Set(tokens(text))
  return words.filter((w) => ref.has(w)).length / words.length
}

/** Two-way title similarity: shared words over the longer title's words (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / Math.max(A.size, B.size)
}

// ── Web and grey sources ─────────────────────────────────────────────────────

/** Hosts of publishers and indexes: a link there points at a scholarly record. */
const SCHOLARLY_HOSTS = /(^|\.)(doi\.org|arxiv\.org|ieeexplore\.ieee\.org|dl\.acm\.org|acm\.org|sciencedirect\.com|springer\.com|nature\.com|wiley\.com|tandfonline\.com|sagepub\.com|mdpi\.com|jstor\.org|ncbi\.nlm\.nih\.gov|pubmed\.gov|frontiersin\.org|plos\.org|biomedcentral\.com|bmj\.com|thelancet\.com|cell\.com|elsevier\.com|emerald\.com|cambridge\.org|oup\.com|academic\.oup\.com|degruyter\.com|iop\.org|aps\.org|aclanthology\.org|openreview\.net|usenix\.org|ndss-symposium\.org|neurips\.cc|mlr\.press|ssrn\.com|researchgate\.net|semanticscholar\.org|intechopen\.com|hindawi\.com|jmir\.org|scielo\.\w+|nih\.gov|europepmc\.org|zenodo\.org|osf\.io|hal\.science|hal\.archives-ouvertes\.fr)$/i

/** Signs of a published work: volume, issue, pages, ISBN/ISSN, proceedings, publisher, edition. */
const SCHOLARLY_MARKERS = [
  /\b(vol|no|pp|nr|bd|jg|hft)\.\s*\d/i, /\bvolume\s+\d/i, /\b\d+\s*\(\d+\)\s*[,:]/, /\bpp?\.\s*\d+/i,
  /\bisbn\b/i, /\bissn\b/i, /\bin\s+(proc(eedings)?\.?|[A-Z][\w.]*\s+(conference|symposium|workshop))/i,
  /\b(proceedings|conference|symposium|workshop|journal|transactions|review of)\b/i,
  /\b(press|verlag|publishing|publishers|addison-wesley|springer|elsevier|wiley|routledge|sage)\b/i,
  /\b\d+(st|nd|rd|th)\s+ed\./i, /\barxiv\b/i, /\b(thesis|dissertation)\b/i,
]

const urlsIn = (ref: string) => [...ref.matchAll(/\b(?:https?:\/\/|www\.)([^\s/)\]>"']+)/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, "").replace(/[.,;:]+$/, ""))

/**
 * A web page, repository, documentation or other grey source: it links somewhere that is not a
 * publisher or index and shows none of the details of a published work. Searching OpenAlex for
 * these mostly finds unrelated papers that share a few title words, so they are not looked up.
 */
export function isWebSource(ref: string): boolean {
  if (extractDoi(ref)) return false
  const hosts = urlsIn(ref)
  if (!hosts.length) return false
  if (hosts.some((h) => SCHOLARLY_HOSTS.test(h))) return false
  const body = ref.replace(/https?:\/\/\S+/g, " ").replace(/\bwww\.\S+/g, " ").replace(ACCESSED_RE, " ")
  return !SCHOLARLY_MARKERS.some((re) => re.test(body))
}

/** Title, link and site of a web source, for listing it without an OpenAlex record. */
export function describeWebSource(ref: string): WebSource {
  const url = ref.match(/https?:\/\/[^\s)\]>"']+/)?.[0]?.replace(/[.,;:]+$/, "") ?? null
  const site = urlsIn(ref)[0] ?? null
  const { title: parsed, reliable } = parseTitle(ref)
  // Short quoted titles ("Dementia", "Keycloak") count here, unlike in the title search.
  const shortQuoted = ref.match(/[“"]([^”"]{2,})[”"]/)?.[1].replace(/[,.]$/, "").trim()
  let title = reliable ? parsed : shortQuoted ?? ""
  if (!title) {
    // Unquoted: the longest comma-separated part that is not a date, link or "[Online]" note.
    const body = ref.replace(/^\s*(\[\d+\]|\d+\.)\s*/, "").replace(ACCESSED_RE, " ").replace(/\[?online\]?\.?|available:?/gi, " ").replace(/https?:\/\/\S+|\bwww\.\S+|\[[^\]]*\]\([^)]*\)/g, " ")
    title = body.split(/,|\.\s/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length > 1 && !/^(19|20)\d{2}$/.test(x)).sort((a, b) => b.length - a.length)[0] ?? ""
  }
  if (!title && url) title = url.replace(/^https?:\/\/(www\.)?/, "")
  return { title: title.slice(0, 300) || ref.slice(0, 120), url, site, year: extractYear(ref), accessed: extractAccessedYear(ref) }
}

// ── Matching a candidate to the reference ────────────────────────────────────

/** Record types that are never the cited work itself. */
const REJECTED_TYPES = new Set(["paratext", "erratum", "retraction", "peer-review", "supplementary-materials", "grant", "libguides"])

/** "Brown, Tom B." → "brown"; "Tom B. Brown" → "brown". Too short a name gives "". */
function surname(name: string): string {
  const part = name.includes(",") ? name.split(",")[0] : name
  const w = tokens(part)
  const last = name.includes(",") ? w[w.length - 1] : w.pop()
  return last && last.length > 2 ? last : ""
}

export type Rating = { confidence: "likely" | "uncertain"; signals: string[] } | null

/**
 * How well an OpenAlex record fits the reference. A matching title alone is not enough:
 *   - the title must match both ways (no extra or missing words), or, when the reference's
 *     title could not be isolated, every candidate title word must be in the reference;
 *   - plus at least one more signal: an author surname, the year (±1) or the venue.
 * "likely" needs a strong title and a second signal; a strong title alone, or a near title
 * with a signal, is only "uncertain" (shown for the user to confirm, never used on its own).
 * Impossible candidates are rejected outright (wrong record type, published after the
 * reference was accessed, or a repository upload matched on the title alone).
 */
export function rateCandidate(raw: RawWork, ref: string): Rating {
  const title: string = raw.display_name ?? raw.title ?? ""
  if (!title || REJECTED_TYPES.has(raw.type)) return null
  const year: number | null = raw.publication_year ?? null
  const accessed = extractAccessedYear(ref)
  if (accessed && year && year > accessed) return null

  const { title: firstTitle, reliable, alternatives } = parseTitle(ref)
  const words = tokens(title).length
  const short = words < 4
  let titleLevel: 0 | 1 | 2
  // With two readings of an APA title, use the one that fits this candidate better.
  const refTitle = alternatives.reduce((a, b) => (titleSimilarity(title, b) > titleSimilarity(title, a) ? b : a), firstTitle)
  if (reliable) {
    const sim = titleSimilarity(title, refTitle)
    titleLevel = short ? (sim === 1 ? 2 : 0) : sim >= 0.9 ? 2 : sim >= 0.75 ? 1 : 0
  } else {
    // Only one direction can be checked, so short titles are never accepted this way.
    const cover = titleOverlap(title, refTitle)
    titleLevel = short ? 0 : cover >= 0.95 ? 2 : cover >= 0.85 ? 1 : 0
  }
  if (!titleLevel) return null

  // Signals are looked for outside the title, so title words cannot count twice.
  const rest = reliable ? ref.replace(refTitle, " ") : ref
  const restTokens = new Set(tokens(rest))
  const signals: string[] = []
  const surnames = (raw.authorships ?? []).map((a: any) => surname(a.author?.display_name ?? a.raw_author_name ?? "")).filter(Boolean)
  if (surnames.some((w: string) => restTokens.has(w))) signals.push("author")
  const refYear = extractYear(rest)
  const yearOff = !!(refYear && year && Math.abs(refYear - year) > 1)
  if (refYear && year && !yearOff) signals.push("year")
  const venue: string = raw.primary_location?.source?.display_name ?? ""
  if (venue && tokens(venue).length && titleOverlap(venue, rest) >= 0.8) signals.push("venue")

  const repository = raw.primary_location?.source?.type === "repository" || /zenodo|figshare|osf/i.test(venue)
  if (repository && !signals.includes("author")) return null

  let level = titleLevel === 2 && signals.length ? 2 : titleLevel === 2 || signals.length ? 1 : 0
  if (short && !signals.length) level = 0
  if (yearOff) level--
  if (level <= 0) return null
  return { confidence: level === 2 ? "likely" : "uncertain", signals }
}

/** Confidence only (kept for tests and callers that need no signals). */
export function matchConfidence(candidateTitle: string, candidateYear: number | null, reference: string, extra: Record<string, unknown> = {}): "likely" | "uncertain" | null {
  return rateCandidate({ display_name: candidateTitle, publication_year: candidateYear, type: "article", ...extra }, reference)?.confidence ?? null
}

// ── Mapping OpenAlex → app record ────────────────────────────────────────────

export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word
  const text = words.filter(Boolean).join(" ")
  return text.length > ABSTRACT_CHARS ? text.slice(0, ABSTRACT_CHARS - 1).trimEnd() + "…" : text || null
}

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
      origin: "openalex",
      match,
      abstract: rebuildAbstract(raw.abstract_inverted_index),
    },
  }
}

/**
 * OpenAlex often holds several records of one paper (arXiv preprint and published version).
 * Among the candidates with the best rating, prefer the one with the most signals, then the
 * one whose venue appears in the reference, then a non-preprint, then the most cited.
 */
export function pickCandidate(candidates: RawWork[], ref: string): { raw: RawWork; c: "likely" | "uncertain"; signals: string[] } | null {
  const rated = candidates
    .map((raw) => ({ raw, r: rateCandidate(raw, ref) }))
    .filter((x): x is { raw: RawWork; r: NonNullable<Rating> } => x.r !== null)
  if (!rated.length) return null
  const level = rated.some((x) => x.r.confidence === "likely") ? "likely" : "uncertain"
  const score = ({ raw, r }: { raw: RawWork; r: NonNullable<Rating> }) => {
    const venue = raw.primary_location?.source?.display_name ?? ""
    const preprint = raw.type === "preprint" || raw.primary_location?.source?.type === "repository"
    return r.signals.length * 3 + (venue ? titleOverlap(venue, ref) * 2 : 0) + (preprint ? 0 : 0.5) + Math.log10(1 + (raw.cited_by_count ?? 0)) / 100
  }
  const best = rated.filter((x) => x.r.confidence === level).sort((a, b) => score(b) - score(a))[0]
  return { raw: best.raw, c: best.r.confidence, signals: best.r.signals }
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

  // 2. Web and grey sources are not searched: a title search mostly finds unrelated papers.
  references.forEach((ref, i) => {
    if (!found[i] && isWebSource(ref)) found[i] = { reference: ref, index: i, reason: "web_source", web: describeWebSource(ref) }
  })

  // 3. Title search for the rest. Only a "likely" match is used; an "uncertain" one is
  //    returned as a possible match for the user to confirm.
  const rest = references.map((_, i) => i).filter((i) => !found[i])
  await pool(rest, concurrency(), async (i) => {
    const ref = references[i]
    try {
      const q = encodeURIComponent(extractTitle(ref))
      const res: any = await get(`${BASE}/works?search=${q}&per_page=8&select=${WORK_FIELDS}`)
      const candidates: RawWork[] = res.results ?? []
      if (!candidates.length) return void (found[i] = { reference: ref, index: i, reason: "not_found" })
      const best = pickCandidate(candidates, ref)
      if (!best) return void (found[i] = { reference: ref, index: i, reason: "no_confident_match" })
      const work = toWork(best.raw, ref, { method: "title_search", confidence: best.c, signals: best.signals })
      found[i] = best.c === "likely" ? work : { reference: ref, index: i, reason: "possible_match", candidate: work }
    } catch (e) {
      found[i] = { reference: ref, index: i, reason: failReason(e) }
    }
  })

  // De-duplicate: two references pointing at the same record keep the first.
  const works: OpenAlexWork[] = []
  const unmatched: Unmatched[] = []
  const seen = new Set<string>()
  found.forEach((f, i) => { if (!("reason" in f)) f._sourcecheck.input_index = i })
  for (const f of found) {
    if ("reason" in f) unmatched.push(f)
    else if (!seen.has(f.id)) { seen.add(f.id); works.push(f) }
  }

  // 4. Authors, batched: h-index and institution (also for possible matches, in case they are confirmed)
  const enrich = [...works, ...unmatched.flatMap((u) => (u.candidate ? [u.candidate] : []))]
  const authorIds = [...new Set(enrich.flatMap((w) => w.authorships.slice(0, MAX_AUTHORS_PER_WORK).map((a) => a.author.id?.replace("https://openalex.org/", "")).filter((x): x is string => !!x)))]
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
  for (const w of enrich) {
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
