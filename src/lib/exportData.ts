/**
 * Exports for analysis: the assessment of every paper (JSON), and repeated test runs
 * (JSON with everything, CSV with one row per run and paper). Plain data, no UI.
 */
import type { OpenAlexWork } from "@/data/types"
import { RATING_SCORE, VERDICTS, type AssessmentResponse, type Rating, type Verdict } from "@/lib/assessment"
import { buildRequest, type AssessState } from "@/lib/assessClient"
import { METRICS, scoreWork } from "@/lib/scoring"
import type { Unmatched } from "@/lib/lookup"

export const EXPORT_VERSION = 1

/** Saves text as a file in the browser. */
export function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = Object.assign(document.createElement("a"), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/[:T]/g, "-")
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "paper"

// ── One paper ────────────────────────────────────────────────────────────────

/** Everything about one paper: the reference, the OpenAlex record, what the AI got, and its answer. */
export function paperRecord(work: OpenAlexWork, state: AssessState | undefined, context: string) {
  const assessment = state?.status === "done" ? state.assessment : null
  const scored = scoreWork(work, assessment)
  return {
    input_index: work._sourcecheck.input_index ?? null,
    reference: work._sourcecheck.raw_reference,
    /** "openalex", or "manual" for a source described only by your details */
    origin: work._sourcecheck.origin,
    match: work._sourcecheck.match ?? null,
    /** facts you entered; they replace OpenAlex's value in ai_request */
    details: work._sourcecheck.details ?? null,
    openalex: work._sourcecheck.origin === "manual" ? null : work,
    /** the request the AI receives for this paper (facts + thesis context) */
    ai_request: context.trim() ? buildRequest(work, context) : null,
    assessment:
      state?.status === "done"
        ? { status: "done", ...state.meta, attempts: state.attempts, thesis_context: state.context, result: state.assessment }
        : state?.status === "error"
          ? { status: "error", ...state.meta, code: state.code, message: state.message }
          : { status: state?.status ?? "not_assessed" },
    score: { overall: scored.overall, signal: scored.signal, per_criterion: scored.metrics },
  }
}

export function allPapersExport(works: OpenAlexWork[], assess: Record<string, AssessState>, context: string, web: Unmatched[]) {
  return {
    app: "SourceCheck",
    export_version: EXPORT_VERSION,
    kind: "papers",
    exported_at: new Date().toISOString(),
    thesis_context: context.trim(),
    papers: [...works]
      .sort((a, b) => (a._sourcecheck.input_index ?? 1e9) - (b._sourcecheck.input_index ?? 1e9))
      .map((w) => paperRecord(w, assess[w.id], context)),
    web_sources: web.map((u) => ({ input_index: u.index, reference: u.reference, ...u.web })),
  }
}

// ── Test runs ────────────────────────────────────────────────────────────────

export type RunResult = {
  /** the model this call asked for */
  model: string
  run: number
  input_index: number | null
  work_id: string
  title: string
  doi: string | null
  state: Exclude<AssessState, { status: "loading" }>
  /** how often this job waited for a rate limit before its answer */
  waits: number
}

export type TestRunConfig = {
  /** every model is run `runs` times over all papers */
  models: string[]
  /** prompt id (see src/lib/prompts.ts) */
  prompt: string
  runs: number
  thesis_context: string
  started_at: string
  finished_at?: string
  status: "running" | "done" | "cancelled" | "stopped"
  stop_reason?: string
}

export function testRunExport(config: TestRunConfig, works: OpenAlexWork[], results: RunResult[]) {
  return {
    app: "SourceCheck",
    export_version: EXPORT_VERSION,
    kind: "test_runs",
    exported_at: new Date().toISOString(),
    config,
    prompt_versions: [...new Set(results.map((r) => r.state.meta?.prompt_version).filter(Boolean))],
    papers: works.map((w) => ({
      input_index: w._sourcecheck.input_index ?? null,
      work_id: w.id,
      title: w.display_name,
      doi: w.doi,
      reference: w._sourcecheck.raw_reference,
      origin: w._sourcecheck.origin,
      details: w._sourcecheck.details ?? null,
      ai_request: buildRequest(w, config.thesis_context),
    })),
    results: results.map((r) => ({
      requested_model: r.model,
      run: r.run,
      input_index: r.input_index,
      work_id: r.work_id,
      title: r.title,
      status: r.state.status,
      ...r.state.meta,
      rate_limit_waits: r.waits,
      ...(r.state.status === "done"
        ? { attempts: r.state.attempts, result: r.state.assessment }
        : { error: { code: r.state.code, message: r.state.message } }),
    })),
  }
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per run and paper: the ratings per criterion, the verdict and the score. */
export function testRunCsv(results: RunResult[], works: OpenAlexWork[]): string {
  const byId = new Map(works.map((w) => [w.id, w]))
  const head = [
    "model", "run", "input_index", "work_id", "title", "doi", "requested_model", "answered_model", "prompt_version",
    "status", "error_code", "attempts", "duration_ms", "assessed_at", "rate_limit_waits", "overall_verdict", "verdict_value", "score",
    ...METRICS.map((m) => `${m.key}_rating`),
    ...METRICS.map((m) => `${m.key}_value`),
  ]
  const rows = results.map((r) => {
    const a: AssessmentResponse | null = r.state.status === "done" ? r.state.assessment : null
    const w = byId.get(r.work_id)
    const score = a && w ? scoreWork(w, a).overall : null
    return [
      r.model, r.run, r.input_index, r.work_id, r.title, r.doi, r.state.meta?.requested_model, r.state.meta?.model, r.state.meta?.prompt_version,
      r.state.status, r.state.status === "error" ? r.state.code : "", r.state.status === "done" ? r.state.attempts : "",
      r.state.meta?.duration_ms, r.state.meta?.at, r.waits, a?.overall ?? "", a ? VERDICT_VALUE[a.overall] : "", score ?? "",
      ...METRICS.map((m) => a?.criteria[m.key].rating ?? ""),
      ...METRICS.map((m) => (a ? ratingValue(a.criteria[m.key].rating) ?? "" : "")),
    ]
  })
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
}

// ── Run comparison ───────────────────────────────────────────────────────────

/** Verdict as a number: higher is better. */
export const VERDICT_VALUE: Record<Verdict, number> = { suitable: 2, usable_with_reservations: 1, not_usable: 0 }
/** Rating as a number (0..10), or null for "no rating", which is left out of every average. */
export const ratingValue = (r: Rating): number | null => (r === "no_rating" ? null : RATING_SCORE[r])

const round = (n: number | null, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d)
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null)
export function stats(xs: (number | null)[]) {
  const v = nums(xs)
  if (!v.length) return { n: 0, mean: null, sd: null, min: null, max: null, range: null }
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  // sample standard deviation; needs two values
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : null
  const min = Math.min(...v), max = Math.max(...v)
  return { n: v.length, mean: round(mean), sd: round(sd), min, max, range: round(max - min) }
}
/** Most frequent value and the share of runs that gave it (1 = all runs agree). */
function agreement<T>(xs: (T | null)[]): { mode: T | null; share: number | null } {
  const v = xs.filter((x): x is T => x != null)
  if (!v.length) return { mode: null, share: null }
  const counts = new Map<T, number>()
  v.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1))
  const [mode, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return { mode, share: round(c / v.length) }
}

/**
 * The runs side by side, as a report in one CSV with several tables (blank line between
 * them, a title row on top of each). Ratings use the number mapping in the first table;
 * "no rating" and failed calls are empty cells and left out of every mean.
 *   1. scale             the mapping
 *   with several models:
 *   2. models compared   one row per model: calls, mean score, run-to-run spread, agreement, criteria
 *   3. score by model    paper × model (mean and sd over the runs), with row stats and a mean row
 *   4. verdict by model  paper × model: most common verdict and its agreement
 *   then for each model:
 *   - overall score    paper × run, with row stats and a mean row per run
 *   - verdict          paper × run as numbers, with the most common verdict and agreement
 *   - criteria         criterion × run (mean over papers), with row stats and a mean row
 *   - detail           paper × criterion × run, with stats, most common rating, agreement
 *   - calls            per run: assessed, failed, no-rating count, mean attempts and time
 */
export function testRunSummaryCsv(results: RunResult[], works: OpenAlexWork[], runCount?: number, modelList?: string[]): string {
  const runs = Array.from({ length: runCount ?? Math.max(0, ...results.map((r) => r.run)) }, (_, i) => i + 1)
  const models = modelList?.length ? modelList : [...new Set(results.map((r) => r.model))]
  const papers = [...works].sort((a, b) => (a._sourcecheck.input_index ?? 1e9) - (b._sourcecheck.input_index ?? 1e9))
  const label = (w: OpenAlexWork) => `${(w._sourcecheck.input_index ?? -1) + 1 || ""}`
  const statCols = ["n", "mean", "sd", "min", "max", "range"]
  const statCells = (xs: (number | null)[]) => {
    const s = stats(xs)
    return [s.n, s.mean, s.sd, s.min, s.max, s.range]
  }
  const assessmentOf = (model: string, workId: string, run: number) => {
    const r = results.find((x) => x.model === model && x.work_id === workId && x.run === run)
    return r?.state.status === "done" ? r.state.assessment : null
  }
  const scoreOf = (model: string, w: OpenAlexWork, run: number) => {
    const a = assessmentOf(model, w.id, run)
    return a ? scoreWork(w, a).overall : null
  }
  const verdictOf = (model: string, w: OpenAlexWork, run: number) => assessmentOf(model, w.id, run)?.overall ?? null
  const critOf = (model: string, w: OpenAlexWork, run: number, key: keyof AssessmentResponse["criteria"]) => {
    const a = assessmentOf(model, w.id, run)
    return a ? ratingValue(a.criteria[key].rating) : null
  }
  const tables: unknown[][][] = []

  tables.push([
    ["Scale: how ratings and verdicts are turned into numbers"],
    ["kind", "label", "value"],
    ...Object.entries(RATING_SCORE).map(([k, v]) => ["rating", k, v]),
    ["rating", "no_rating", "(empty, not averaged)"],
    ...VERDICTS.map((v) => ["verdict", v, VERDICT_VALUE[v]]),
    ["score", "mean of the rated criteria per assessment", "0..10"],
  ])

  if (models.length > 1) {
    tables.push([
      ["Models compared (spread = sd of a paper's score over the runs, averaged over papers; agreement = share of runs with the paper's most common verdict, averaged)"],
      ["model", "assessed", "failed", "mean_score", "score_spread", "verdict_agreement", "no_rating_share", "mean_attempts", "mean_duration_s", ...METRICS.map((m) => `${m.key}_mean`)],
      ...models.map((model) => {
        const rs = results.filter((r) => r.model === model)
        const ok = rs.filter((r) => r.state.status === "done")
        const allScores = papers.flatMap((w) => runs.map((n) => scoreOf(model, w, n)))
        const ratings = ok.flatMap((r) => (r.state.status === "done" ? Object.values(r.state.assessment.criteria).map((c) => c.rating) : []))
        return [
          model, ok.length, rs.length - ok.length,
          stats(allScores).mean,
          stats(papers.map((w) => stats(runs.map((n) => scoreOf(model, w, n))).sd)).mean,
          stats(papers.map((w) => agreement(runs.map((n) => verdictOf(model, w, n))).share)).mean,
          ratings.length ? round(ratings.filter((x) => x === "no_rating").length / ratings.length) : null,
          stats(ok.map((r) => (r.state.status === "done" ? r.state.attempts : null))).mean,
          round((stats(rs.map((r) => r.state.meta?.duration_ms ?? null)).mean ?? 0) / 1000, 1),
          ...METRICS.map((m) => stats(papers.flatMap((w) => runs.map((n) => critOf(model, w, n, m.key)))).mean),
        ]
      }),
    ])
    const meanOver = (model: string, w: OpenAlexWork) => stats(runs.map((n) => scoreOf(model, w, n)))
    tables.push([
      ["Overall score per paper and model (mean and sd over the runs); the row stats compare the models' means"],
      ["paper", "title", ...models.flatMap((m) => [`${m} mean`, `${m} sd`]), ...statCols],
      ...papers.map((w) => {
        const per = models.map((m) => meanOver(m, w))
        return [label(w), w.display_name, ...per.flatMap((x) => [x.mean, x.sd]), ...statCells(per.map((x) => x.mean))]
      }),
      ["", "Mean over papers", ...models.flatMap((m) => [stats(papers.map((w) => meanOver(m, w).mean)).mean, ""]), ...statCells(models.map((m) => stats(papers.map((w) => meanOver(m, w).mean)).mean))],
    ])
    tables.push([
      ["Verdict per paper and model (most common verdict over the runs, and the share of runs that gave it)"],
      ["paper", "title", ...models.flatMap((m) => [`${m} verdict`, `${m} agreement`]), "models_agree"],
      ...papers.map((w) => {
        const per = models.map((m) => agreement(runs.map((n) => verdictOf(m, w, n))))
        const modes = per.map((x) => x.mode).filter(Boolean)
        return [label(w), w.display_name, ...per.flatMap((x) => [x.mode, x.share]), modes.length === models.length ? (new Set(modes).size === 1 ? "yes" : "no") : ""]
      }),
    ])
  }

  for (const model of models) tables.push(...modelTables(model))
  return tables.map((t) => t.map((row) => row.map(csvCell).join(",")).join("\n")).join("\n\n") + "\n"

  /** The per-run tables for one model. */
  function modelTables(model: string): unknown[][][] {
    const out: unknown[][][] = []
    const runCols = runs.map((n) => `run_${n}`)
    const t = (title: string) => [`${title} (model ${model})`]

    const perRunScore = runs.map((n) => stats(papers.map((w) => scoreOf(model, w, n))).mean)
    out.push([
      t("Overall score (0..10) per paper and run"),
      ["paper", "title", ...runCols, ...statCols],
      ...papers.map((w) => {
        const xs = runs.map((n) => scoreOf(model, w, n))
        return [label(w), w.display_name, ...xs, ...statCells(xs)]
      }),
      ["", "Mean over papers", ...perRunScore, ...statCells(perRunScore)],
    ])

    const vnum = (v: Verdict | null) => (v ? VERDICT_VALUE[v] : null)
    const perRunVerdict = runs.map((n) => stats(papers.map((w) => vnum(verdictOf(model, w, n)))).mean)
    out.push([
      t("Verdict per paper and run (suitable 2, usable with reservations 1, not usable 0)"),
      ["paper", "title", ...runCols, ...statCols, "most_common", "agreement"],
      ...papers.map((w) => {
        const vs = runs.map((n) => verdictOf(model, w, n))
        const ag = agreement(vs)
        return [label(w), w.display_name, ...vs.map(vnum), ...statCells(vs.map(vnum)), ag.mode, ag.share]
      }),
      ["", "Mean over papers", ...perRunVerdict, ...statCells(perRunVerdict), "", ""],
    ])

    const critRun = (key: keyof AssessmentResponse["criteria"], run: number) => stats(papers.map((w) => critOf(model, w, run, key))).mean
    const perRunCrit = runs.map((n) => stats(METRICS.map((m) => critRun(m.key, n))).mean)
    out.push([
      t("Criteria: mean rating over all papers per run"),
      ["criterion", "label", ...runCols, ...statCols],
      ...METRICS.map((m) => {
        const xs = runs.map((n) => critRun(m.key, n))
        return [m.key, m.label, ...xs, ...statCells(xs)]
      }),
      ["", "Mean over criteria", ...perRunCrit, ...statCells(perRunCrit)],
    ])

    const detail: unknown[][] = []
    for (const w of papers)
      for (const m of METRICS) {
        const rs = runs.map((n) => assessmentOf(model, w.id, n)?.criteria[m.key].rating ?? null)
        const xs = rs.map((r) => (r ? ratingValue(r) : null))
        const ag = agreement(rs)
        detail.push([label(w), w.display_name, m.key, ...xs, ...statCells(xs), ag.mode, ag.share])
      }
    out.push([
      t("Detail: rating per paper, criterion and run (empty = no rating or failed call)"),
      ["paper", "title", "criterion", ...runCols, ...statCols, "most_common", "agreement"],
      ...detail,
    ])

    out.push([
      t("Calls per run"),
      ["run", "assessed", "failed", "no_rating_count", "mean_attempts", "mean_duration_s", "rate_limit_waits"],
      ...runs.map((n) => {
        const rs = results.filter((r) => r.model === model && r.run === n)
        const ok = rs.filter((r) => r.state.status === "done")
        const noRating = ok.reduce((c, r) => c + (r.state.status === "done" ? Object.values(r.state.assessment.criteria).filter((x) => x.rating === "no_rating").length : 0), 0)
        return [
          n, ok.length, rs.length - ok.length, noRating,
          stats(ok.map((r) => (r.state.status === "done" ? r.state.attempts : null))).mean,
          round((stats(rs.map((r) => r.state.meta?.duration_ms ?? null)).mean ?? 0) / 1000, 1),
          rs.reduce((c, r) => c + r.waits, 0),
        ]
      }),
    ])
    return out
  }
}
