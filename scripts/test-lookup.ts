/**
 * Offline tests for /api/lookup with a stubbed OpenAlex (no network).
 * Run: npx tsx scripts/test-lookup.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { handleLookup } from "../server/lookup"
import { OpenAlexError, extractAccessedYear, extractDoi, extractTitle, extractYear, isWebSource, lookupReferences, matchConfidence, pickCandidate, rateCandidate, rebuildAbstract, titleSimilarity, type Fetcher } from "../server/openalex"
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
    const JOHNNY = "Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts"
    const byZamfirescu = { authorships: [{ author: { display_name: "J.D. Zamfirescu-Pereira" } }] }
    assert.equal(matchConfidence(JOHNNY, 2023, APA), "likely")
    assert.equal(matchConfidence("Prompting is programming: a query language for large language models", 2023, APA), null)
    // wrong year: with an author match one step lower, without one rejected
    assert.equal(matchConfidence(JOHNNY, 2015, APA, byZamfirescu), "uncertain")
    assert.equal(matchConfidence(JOHNNY, 2015, APA), null)
  }],
  ["title similarity is two-way and keeps non-Latin words", () => {
    assert.equal(titleSimilarity("Cloudflare Tunnel", "Cloudflare Tunnel"), 1)
    assert.ok(titleSimilarity("Cloudflare Tunnel 入門ガイド", "Cloudflare Tunnel") < 1)
    assert.ok(titleSimilarity("Epidemiology and impact of dementia: chapter 2 of a clinical handbook", "The Epidemiology and Impact of Dementia") < 0.75)
  }],
  ["a matching title alone is not enough", () => {
    const ref = '[9] A. Writer, "Federated learning for wearable sensors in elderly care," 2021.'
    const title = "Federated learning for wearable sensors in elderly care"
    // title + year → likely; title only (no year in record, different author) → uncertain
    assert.equal(rateCandidate({ display_name: title, publication_year: 2021, type: "article" }, ref)?.confidence, "likely")
    assert.equal(rateCandidate({ display_name: title, publication_year: null, type: "article", authorships: [{ author: { display_name: "Someone Else" } }] }, ref)?.confidence, "uncertain")
    // a short title needs an exact title and a second signal
    assert.equal(rateCandidate({ display_name: "Cloudflare Tunnel", publication_year: null, type: "article" }, '[4] "Cloudflare Tunnel," Cloudflare Docs.'), null)
  }],
  ["surnames are read in both name orders", () => {
    const ref = "Brown, T. B., et al. (2020). Language models are few-shot learners. NeurIPS 33."
    const cand = (name: string) => ({ display_name: "Language Models are Few-Shot Learners", publication_year: null, type: "article", authorships: [{ author: { display_name: name } }] })
    assert.deepEqual(rateCandidate(cand("Brown, Tom B."), ref)?.signals, ["author"])
    assert.deepEqual(rateCandidate(cand("Tom B. Brown"), ref)?.signals, ["author"])
  }],
  ["impossible candidates are rejected", () => {
    const ref = '[30] A. Writer, "Federated learning for wearable sensors in elderly care," 2021. Accessed: Apr. 27, 2023.'
    const base = { display_name: "Federated learning for wearable sensors in elderly care", publication_year: 2021, type: "article" }
    assert.ok(rateCandidate(base, ref))
    assert.equal(rateCandidate({ ...base, type: "paratext" }, ref), null, "table of contents and similar")
    assert.equal(rateCandidate({ ...base, publication_year: 2024 }, ref), null, "published after it was accessed")
    const zenodo = { ...base, primary_location: { source: { display_name: "Zenodo", type: "repository" } } }
    assert.equal(rateCandidate(zenodo, ref), null, "repository upload without an author match")
    assert.ok(rateCandidate({ ...zenodo, authorships: [{ author: { display_name: "Ann Writer" } }] }, ref), "repository upload with the author")
  }],
  ["access dates are not publication years", () => {
    const ref = '"Firebase Cloud Messaging," Firebase, Accessed: Apr. 26, 2026. [Online]. Available: https://firebase.google.com/docs/cloud-messaging.'
    assert.equal(extractYear(ref), null)
    assert.equal(extractAccessedYear(ref), 2026)
    assert.equal(extractYear("Ecoplan AG, “Alzheimer Schweiz Demenzkostenstudie 2019,” Bern, Oct. 2019. Accessed: May 1, 2024."), 2019)
  }],
  ["web sources: 39 of the 56 references in a real thesis, none of the scholarly ones", () => {
    const refs = readFileSync(new URL("./fixtures/web-heavy-references.txt", import.meta.url), "utf8").split("\n").filter((l) => l.trim())
    assert.equal(refs.length, 56)
    const web = refs.map((r, i) => (isWebSource(r) ? i + 1 : null)).filter((n) => n !== null)
    // Not web: DOI references, plus [17] [18] [23] [32] [55] (no link) — they are searched.
    const searched = [10, 13, 15, 17, 18, 23, 26, 32, 34, 35, 36, 38, 39, 49, 51, 55, 56]
    assert.deepEqual(web, Array.from({ length: 56 }, (_, i) => i + 1).filter((n) => !searched.includes(n)))
    // The four references that used to be matched to unrelated records are all web sources now.
    for (const n of [4, 16, 30, 50]) assert.ok(web.includes(n), `[${n}] is a web source`)
  }],
  ["scholarly links and details keep a reference out of the web group", () => {
    assert.equal(isWebSource("A. Author, “Some study,” IEEE Access, vol. 8, pp. 1–9, 2020. Available: https://ieeexplore.ieee.org/document/1"), false)
    assert.equal(isWebSource("A. Author, “Some study,” Journal of Things, vol. 8, 2020. Available: https://example.org/paper.pdf"), false)
    assert.equal(isWebSource("Author, A. (2021). Some study. https://arxiv.org/abs/2101.00001"), false)
    assert.equal(isWebSource("“Docker image pull,” Docker Documentation, Accessed: May 18, 2026. [Online]. Available: https://docs.docker.com/x"), true)
  }],
  ["web sources are not searched; uncertain matches come back as possible matches", async () => {
    const WEB = '[4] "Cloudflare Tunnel," Cloudflare Docs, Accessed: Apr. 27, 2026. [Online]. Available: https://developers.cloudflare.com/x.'
    const NEAR = '[9] A. Writer, "Federated learning for wearable sensors in elderly care," in Proc. of Something.'
    const s = stub({ search: () => [raw({ id: "W-near", display_name: "Federated learning for wearable sensors in elderly care", publication_year: null })] })
    const r = await lookupReferences([WEB, NEAR], s.fn)
    assert.equal(s.urls.filter((u) => u.includes("search=")).length, 1, "only the scholarly reference is searched")
    assert.deepEqual(r.unmatched.map((u) => u.reason), ["web_source", "possible_match"])
    assert.deepEqual(r.unmatched[0].web, { title: "Cloudflare Tunnel", url: "https://developers.cloudflare.com/x", site: "developers.cloudflare.com", year: null, accessed: 2026 })
    assert.equal(r.works.length, 0)
    assert.equal(r.unmatched[1].candidate?.id, "W-near")
    assert.equal(r.unmatched[1].candidate?._sourcecheck.max_author_h_index, null)
    assert.ok(r.unmatched[1].candidate?._sourcecheck.author_details, "possible matches get author details too")
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
    assert.deepEqual(r.works.map((w) => w._sourcecheck.input_index), [0, 1], "input position kept for Input order")
    assert.equal(r.works[0]._sourcecheck.match?.method, "doi")
    assert.equal(r.works[1]._sourcecheck.match?.method, "title_search")
    assert.deepEqual(r.unmatched, [{ reference: FAKE, index: 2, reason: "no_confident_match" }])
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
    assert.deepEqual(body.unmatched, [{ reference: FAKE, index: 0, reason: "not_found" }])
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
