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
import { buildRequest } from "../src/lib/assessClient"
import { cleanDetails, guessTitle, manualWork, toUnmatched } from "../src/lib/details"
import { paperRecord, stats, testRunCsv, testRunExport, testRunSummaryCsv, type RunResult } from "../src/lib/exportData"

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
  ["exports: paper JSON, test-run JSON and CSV", async () => {
    const s = stub({ search: () => [raw({ id: "W-j", display_name: 'Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts, "quoted"' })] })
    const [w] = (await lookupReferences([APA], s.fn)).works
    const rating = (r: string) => ({ reason: "r", rating: r })
    const assessment = {
      criteria: { relevance: rating("good"), currency: rating("good"), authority: rating("no_rating"), venue: rating("very_good"), evidence: rating("rather_good"), objectivity: rating("good"), reception: rating("very_good"), retrievability: rating("good") },
      overall: "suitable", decisive_reasons: ["x"], advice: [],
    } as any
    const meta = { model: "vendor/m:free", requested_model: "vendor/m:free", prompt_version: "v2.1", at: "2026-11-18T10:00:00.000Z", duration_ms: 30000 }
    const results: RunResult[] = [
      { model: "vendor/m:free", run: 1, input_index: 0, work_id: w.id, title: w.display_name, doi: null, waits: 0, state: { status: "done", assessment, attempts: 1, context: "ctx", meta } },
      { model: "vendor/m:free", run: 2, input_index: 0, work_id: w.id, title: w.display_name, doi: null, waits: 2, state: { status: "error", code: "model_output_invalid", message: "bad", meta } },
    ]
    const rec = paperRecord(w, results[0].state, "ctx")
    assert.equal(rec.assessment.status, "done")
    assert.equal((rec.assessment as any).model, "vendor/m:free")
    assert.equal(rec.ai_request?.thesis_context, "ctx")
    const exp = testRunExport({ models: ["vendor/m:free"], prompt: "v2.1", runs: 2, thesis_context: "ctx", started_at: meta.at, status: "done" }, [w], results)
    assert.equal(exp.results.length, 2)
    assert.deepEqual(exp.prompt_versions, ["v2.1"])
    assert.equal((exp.results[1] as any).error.code, "model_output_invalid")
    const csv = testRunCsv(results, [w]).trim().split("\n")
    assert.equal(csv.length, 3)
    assert.ok(csv[0].startsWith("model,run,input_index,work_id,title,doi,requested_model,answered_model,prompt_version,status"))
    assert.ok(csv[1].startsWith("vendor/m:free,1,0,"))
    assert.ok(csv[1].includes('"Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts, ""quoted"""'), "quotes and commas are escaped")
    assert.ok(csv[1].endsWith(",suitable,2,8.3,good,good,no_rating,very_good,rather_good,good,very_good,good,8,8,,10,6,8,10,8"), csv[1])
    assert.ok(csv[2].includes(",error,model_output_invalid,"))

    // Run comparison: run 1 ok, run 2 failed, run 3 ok with lower ratings
    const worse = structuredClone(assessment)
    worse.overall = "usable_with_reservations"
    worse.criteria.relevance.rating = "rather_weak"
    results.push({ model: "vendor/m:free", run: 3, input_index: 0, work_id: w.id, title: w.display_name, doi: null, waits: 0, state: { status: "done", assessment: worse, attempts: 2, context: "ctx", meta } })
    const tables = testRunSummaryCsv(results, [w], 3).trim().split("\n\n").map((t) => t.split("\n"))
    assert.equal(tables.length, 6)
    assert.match(tables[0][0], /^Scale/)
    assert.match(tables[1][0], /\(model vendor\/m:free\)$/, "one model: no comparison tables, titles name the model")
    // score: run 1 = 58/7 = 8.29 → 8.3; run 3 = 54/7 = 7.71 → 7.7; mean 8, sd 0.42
    assert.ok(tables[1][2].endsWith(",8.3,,7.7,2,8,0.42,7.7,8.3,0.6"), tables[1][2])
    assert.ok(tables[1][3].startsWith(",Mean over papers,8.3,,7.7,2,8,"), "a mean row per run")
    // verdict 2, –, 1 → most common is a tie, agreement 0.5
    assert.ok(tables[2][2].includes(",2,,1,2,1.5,0.71,1,2,1,"), tables[2][2])
    // relevance over runs: 8, –, 4
    const relevance = tables[3].find((r) => r.startsWith("relevance,"))!
    assert.ok(relevance.includes(",8,,4,2,6,2.83,4,8,4"), relevance)
    // authority was "no rating" in every run: empty, not 0
    const authority = tables[4].find((r) => r.includes(",authority,"))!
    assert.ok(authority.includes(",authority,,,,0,,,,,,no_rating,1"), authority)
    assert.deepEqual(tables[5].slice(2), ["1,1,0,1,1,30,0", "2,0,1,0,,30,2", "3,1,0,1,2,30,0"])
    assert.deepEqual(stats([1, null, 3]), { n: 2, mean: 2, sd: 1.41, min: 1, max: 3, range: 2 })

    // Two models: comparison tables first, then each model's own tables
    const other = structuredClone(assessment)
    other.criteria.relevance.rating = "very_weak"
    other.overall = "not_usable"
    const meta2 = { ...meta, model: "other/x:free", requested_model: "other/x:free" }
    const both: RunResult[] = [
      ...results,
      { model: "other/x:free", run: 1, input_index: 0, work_id: w.id, title: w.display_name, doi: null, waits: 0, state: { status: "done", assessment: other, attempts: 1, context: "ctx", meta: meta2 } },
      { model: "other/x:free", run: 2, input_index: 0, work_id: w.id, title: w.display_name, doi: null, waits: 0, state: { status: "done", assessment: other, attempts: 1, context: "ctx", meta: meta2 } },
      { model: "other/x:free", run: 3, input_index: 0, work_id: w.id, title: w.display_name, doi: null, waits: 0, state: { status: "done", assessment: other, attempts: 1, context: "ctx", meta: meta2 } },
    ]
    const multi = testRunSummaryCsv(both, [w], 3, ["vendor/m:free", "other/x:free"]).trim().split("\n\n").map((t) => t.split("\n"))
    assert.equal(multi.length, 1 + 3 + 5 * 2)
    assert.match(multi[1][0], /^"?Models compared/)
    // vendor: scores 8.3, 7.7 (one failed) → mean 8, spread 0.42; other: 58-8+0=50/7 = 7.1 three times → spread 0
    assert.ok(multi[1][2].startsWith("vendor/m:free,2,1,8,0.42,0.5,"), multi[1][2])
    assert.ok(multi[1][3].startsWith("other/x:free,3,0,7.1,0,1,"), multi[1][3])
    assert.ok(multi[2][1].includes("vendor/m:free mean,vendor/m:free sd,other/x:free mean,other/x:free sd"), multi[2][1])
    // most common verdict per model (vendor: a tie between suitable and reservations), and whether the models agree
    assert.ok(multi[3][2].endsWith(",not_usable,1,no"), multi[3][2])
    assert.match(multi[4][0], /\(model vendor\/m:free\)$/)
    assert.match(multi[9][0], /\(model other\/x:free\)$/)
  }],
  ["details: they replace OpenAlex facts one by one; empty fields keep OpenAlex", async () => {
    const s = stub({ search: () => [raw({ id: "W-j", display_name: "Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts" })] })
    const [w] = (await lookupReferences([APA], s.fn)).works
    const before = buildRequest(w, "ctx").facts
    assert.equal(before.venue_metric, undefined, "OpenAlex has no venue metric")
    const edited = { ...w, _sourcecheck: { ...w._sourcecheck, details: cleanDetails({ venue_metric: "SJR 2025: 0.43", citations: "14 (OpenAlex, 10 Nov 2026)", venue: "  " })! } }
    const after = buildRequest(edited, "ctx").facts
    assert.equal(after.venue_metric, "SJR 2025: 0.43")
    assert.equal(after.citations, "14 (OpenAlex, 10 Nov 2026)")
    assert.equal(after.venue, before.venue, "an empty field keeps OpenAlex's value")
    assert.equal(after.authors, before.authors)
    assert.equal(scoreWork(edited).flags.some((f) => f.label === "Details edited"), true)
    assert.equal(cleanDetails({ venue: " ", year: "" }), null)
    // "How the source is used" goes to the AI as use_of_source, not as a fact
    assert.equal(buildRequest(w, "ctx").use_of_source, undefined)
    const withUse = { ...w, _sourcecheck: { ...w._sourcecheck, details: { use: "Cited for the claim that non-experts write poor prompts (p. 4)." } } }
    const req = buildRequest(withUse, "ctx")
    assert.equal(req.use_of_source, "Cited for the claim that non-experts write poor prompts (p. 4).")
    assert.equal("use" in req.facts, false)
    assert.match(scoreWork(withUse).facts.relevance, /your note on how it is used/)
  }],
  ["details: a source OpenAlex does not have becomes a manual source and back", () => {
    const u = { reference: "Swiss Banking Association and The Boston Consulting Group. (2011). Banking im Wandel – Zukunftsperspektiven für Banken in der Schweiz. Basel.", index: 6, reason: "no_confident_match" as const }
    assert.equal(guessTitle(u), "Banking im Wandel – Zukunftsperspektiven für Banken in der Schweiz")
    const w = manualWork(u, { title: guessTitle(u), source_type: "Study by an industry association and a consultancy (79 pages)", year: "2011", peer_review: "no" })
    assert.equal(w.id, "manual:6")
    assert.equal(w._sourcecheck.input_index, 6)
    assert.equal(w.publication_year, 2011)
    const req = buildRequest(w, "ctx")
    assert.deepEqual(req.facts, { citations: "not indexed in OpenAlex", source_type: "Study by an industry association and a consultancy (79 pages)", year: "2011", peer_review: "no" }, "only your facts, nothing from OpenAlex")
    assert.equal(req.reference, u.reference)
    const scored = scoreWork(w)
    assert.deepEqual(scored.flags.map((f) => f.label), ["Added by you", "No link"])
    assert.equal(scored.facts.reception, "not indexed in OpenAlex")
    assert.deepEqual(toUnmatched(w), u)
    const rec = paperRecord(w, undefined, "ctx")
    assert.equal(rec.origin, "manual")
    assert.equal(rec.openalex, null)
    assert.equal(rec.details?.peer_review, "no")
  }],
  ["details: titles are suggested from IEEE, APA and n.d. references", () => {
    assert.equal(guessTitle({ reference: '[8] "Docker image pull," Docker Documentation.', index: 0, reason: "web_source" }), "Docker image pull")
    assert.equal(guessTitle({ reference: "O*NET. (n.d.). O*NET Resource Center. Retrieved 04 2025, from About O*NET: https://www.onetcenter.org/overview.html", index: 0, reason: "web_source" }), "O*NET Resource Center")
    assert.equal(guessTitle({ reference: "Alimi, A., Grace, C., Oladele, S., & Mia, J. (2024). Data-Driven Decision-Making: Challenges and Opportunities in Business Analytic.", index: 0, reason: "not_found" }), "Data-Driven Decision-Making: Challenges and Opportunities in Business Analytic")
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
