/**
 * Offline tests for /api/lookup with a stubbed OpenAlex (no network).
 * Run: npx tsx scripts/test-lookup.ts
 */
import assert from "node:assert/strict"
import { handleLookup } from "../server/lookup"
import { OpenAlexError, extractDoi, extractTitle, lookupReferences, matchConfidence, pickCandidate, rebuildAbstract, type Fetcher } from "../server/openalex"
import { checkRateLimit } from "../server/rateLimit"
import { scoreWork } from "../src/lib/scoring"

const APA = "Zamfirescu-Pereira, J. D., et al. (2023). Why Johnny can't prompt: How non-AI experts try (and fail) to design LLM prompts. CHI '23."
const APA_DOI = "Brown, T. B., et al. (2020). Language models are few-shot learners. NeurIPS 33. https://doi.org/10.48550/arXiv.2005.14165."
const FAKE = "Example, A. (2025). Ten prompt secrets that boost student productivity by 500%. Int. Journal of Everything, 1(1)."

const raw = (o: Record<string, unknown>) => ({
  id: "https://openalex.org/W1", doi: null, display_name: "x", publication_year: 2023, type: "article",
  authorships: [{ author_position: "first", author: { id: "https://openalex.org/A1", display_name: "Ann Author" }, institutions: [{ display_name: "UC Berkeley" }] }],
  primary_location: { version: "publishedVersion", source: { display_name: "CHI Conference on Human Factors in Computing Systems", type: "conference", host_organization_name: "ACM", is_core: false, is_in_doaj: false } },
  cited_by_count: 100, citation_normalized_percentile: { value: 0.99, is_in_top_1_percent: true, is_in_top_10_percent: true },
  counts_by_year: [], referenced_works_count: 40, is_retracted: false, open_access: { is_oa: true, oa_status: "green" },
  abstract_inverted_index: { Hello: [0], world: [1] },
  ...o,
})

/** Routes stubbed requests by URL; records every URL. */
function stub(routes: { doi?: unknown[]; search?: (q: string) => unknown[]; authors?: unknown[]; fail?: number }) {
  const urls: string[] = []
  const fn: Fetcher = async (url) => {
    urls.push(url)
    if (routes.fail) throw new OpenAlexError(routes.fail, "stub")
    if (url.includes("/works?filter=doi:")) return { results: routes.doi ?? [] }
    if (url.includes("/works?search=")) return { results: routes.search?.(decodeURIComponent(url.split("search=")[1].split("&")[0])) ?? [] }
    if (url.includes("/authors?filter=")) return { results: routes.authors ?? [] }
    throw new Error(`unexpected ${url}`)
  }
  return { fn, urls }
}

let ip = 0
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:5173/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:5173", "x-real-ip": `10.1.0.${++ip}`, ...headers },
    body: JSON.stringify(body),
  })
const allow = async () => ({ allowed: true as const })

const tests: [string, () => Promise<void> | void][] = [
  ["DOI is extracted and normalised", () => {
    assert.equal(extractDoi(APA_DOI), "10.48550/arxiv.2005.14165")
    assert.equal(extractDoi(APA), null)
  }],
  ["title is extracted from APA and IEEE styles", () => {
    assert.equal(extractTitle(APA), "Why Johnny can't prompt: How non-AI experts try (and fail) to design LLM prompts")
    assert.equal(extractTitle('[3] S. Yao et al., "ReAct: Synergizing reasoning and acting in language models," in ICLR, 2023.'), "ReAct: Synergizing reasoning and acting in language models")
  }],
  ["match confidence: exact title likely, other paper none, wrong year downgraded", () => {
    assert.equal(matchConfidence("Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts", 2023, APA), "likely")
    assert.equal(matchConfidence("Prompting is programming: a query language for large language models", 2023, APA), null)
    assert.equal(matchConfidence("Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts", 2015, APA), "uncertain")
  }],
  ["among equal title matches the published version whose venue is in the reference wins", () => {
    const title = "Language Models are Few-Shot Learners"
    const ref = "Brown, T. (2020). Language models are few-shot learners. Advances in Neural Information Processing Systems, 33."
    const arxiv = raw({ id: "W-arxiv", display_name: title, publication_year: 2020, type: "preprint", cited_by_count: 30000, primary_location: { source: { display_name: "arXiv (Cornell University)", type: "repository" } } })
    const neurips = raw({ id: "W-neurips", display_name: title, publication_year: 2020, cited_by_count: 5000, primary_location: { source: { display_name: "Advances in Neural Information Processing Systems", type: "conference" } } })
    assert.equal(pickCandidate([arxiv, neurips], ref)?.raw.id, "W-neurips")
  }],
  ["abstract is rebuilt from the inverted index", () => {
    assert.equal(rebuildAbstract({ world: [1], Hello: [0], again: [2] }), "Hello world again")
    assert.equal(rebuildAbstract(null), null)
  }],
  ["lookup: DOI batch, title search, fake reference unmatched, authors attached", async () => {
    const s = stub({
      doi: [raw({ id: "W-gpt3", doi: "https://doi.org/10.48550/arxiv.2005.14165", display_name: "Language Models are Few-Shot Learners", publication_year: 2020 })],
      search: (q) => (q.startsWith("Why Johnny") ? [raw({ id: "W-johnny", display_name: "Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts" })] : [raw({ id: "W-other", display_name: "Student productivity in higher education" })]),
      authors: [{ id: "https://openalex.org/A1", summary_stats: { h_index: 12 }, last_known_institutions: [{ display_name: "UC Berkeley" }] }],
    })
    const r = await lookupReferences([APA_DOI, APA, FAKE], s.fn)
    assert.deepEqual(r.works.map((w) => w.id), ["W-gpt3", "W-johnny"])
    assert.equal(r.works[0]._sourcecheck.match?.method, "doi")
    assert.equal(r.works[1]._sourcecheck.match?.method, "title_search")
    assert.deepEqual(r.unmatched, [{ reference: FAKE, reason: "no_confident_match" }])
    assert.equal(r.works[1]._sourcecheck.max_author_h_index, 12)
    assert.equal(r.works[1]._sourcecheck.author_details?.[0].institution, "UC Berkeley")
    assert.equal(r.works[1]._sourcecheck.abstract, "Hello world")
    assert.equal(s.urls.filter((u) => u.includes("/works?filter=doi:")).length, 1, "DOIs go in one batch")
    assert.equal(s.urls.filter((u) => u.includes("/authors?")).length, 1, "authors go in one batch")
  }],
  ["two references to the same record keep only the first", async () => {
    const s = stub({ search: () => [raw({ id: "W-johnny", display_name: "Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts" })] })
    const r = await lookupReferences([APA, APA + " (duplicate)"], s.fn)
    assert.equal(r.works.length, 1)
  }],
  ["no score before the AI assessment; afterwards score from ratings and light from the verdict", async () => {
    const s = stub({ search: () => [raw({ display_name: "Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts" })] })
    const [w] = (await lookupReferences([APA], s.fn)).works
    const before = scoreWork(w)
    assert.equal(before.overall, null)
    assert.equal(before.signal, null)
    assert.ok(Object.values(before.metrics).every((v) => v === null))
    const c = (rating: string) => ({ reason: "r", rating })
    const after = scoreWork(w, {
      criteria: {
        relevance: c("very_good"), currency: c("good"), authority: c("no_rating"), venue: c("very_good"),
        evidence: c("rather_good"), objectivity: c("very_good"), reception: c("very_good"), retrievability: c("rather_weak"),
      },
      overall: "usable_with_reservations", decisive_reasons: ["x"], advice: ["y"],
    } as any)
    assert.equal(after.metrics.authority, null, "no_rating is left out")
    assert.equal(after.overall, 8.3, "(10+8+10+6+10+10+4)/7 = 8.29")
    assert.equal(after.signal, "amber")
  }],
  ["handler: 200 with works and unmatched", async () => {
    const s = stub({ search: () => [] })
    const res = await handleLookup(post({ references: [FAKE] }), { fetcher: s.fn, rateLimit: allow })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body.unmatched, [{ reference: FAKE, reason: "not_found" }])
  }],
  ["handler: more than 60 references → 400, nothing fetched", async () => {
    const s = stub({})
    const res = await handleLookup(post({ references: Array.from({ length: 61 }, (_, i) => `Ref ${i}`) }), { fetcher: s.fn, rateLimit: allow })
    assert.equal(res.status, 400)
    assert.equal(s.urls.length, 0)
  }],
  ["handler: unknown key → 400, cross-site → 403", async () => {
    assert.equal((await handleLookup(post({ references: [APA], extra: 1 }), { fetcher: stub({}).fn, rateLimit: allow })).status, 400)
    assert.equal((await handleLookup(post({ references: [APA] }, { origin: "https://evil.example" }), { fetcher: stub({}).fn, rateLimit: allow })).status, 403)
  }],
  ["handler: OpenAlex throttling every request → 429", async () => {
    const res = await handleLookup(post({ references: [APA, FAKE] }), { fetcher: stub({ fail: 429 }).fn, rateLimit: allow })
    assert.equal(res.status, 429)
  }],
  ["handler: 7th lookup in a minute from one IP → 429", async () => {
    const s = stub({ search: () => [] })
    const h = { "x-real-ip": "192.0.2.99" }
    for (let i = 0; i < 6; i++) assert.equal((await handleLookup(post({ references: [FAKE] }, h), { fetcher: s.fn, rateLimit: checkRateLimit })).status, 200)
    assert.equal((await handleLookup(post({ references: [FAKE] }, h), { fetcher: s.fn, rateLimit: checkRateLimit })).status, 429)
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`✗ ${name}\n  ${(e as Error).message}`)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed ? 1 : 0)
