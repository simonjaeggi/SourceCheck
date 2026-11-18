import { useEffect, useMemo, useState } from "react"
import { Download, FileJson, FlaskConical, Loader2, Play, Square, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { OpenAlexWork } from "@/data/types"
import type { AssessState, ModelOption } from "@/lib/assessClient"
import { allPapersExport, download, paperRecord, slug, stamp, testRunCsv, testRunExport, testRunSummaryCsv } from "@/lib/exportData"
import type { Unmatched } from "@/lib/lookup"
import type { useTestRuns } from "@/lib/useTestRuns"
import { Checkbox } from "@/components/ui/checkbox"
import { PromptPicker } from "./PromptPicker"
import { promptLabel } from "@/lib/prompts"

const json = (x: unknown) => JSON.stringify(x, null, 2)

// ── Export ───────────────────────────────────────────────────────────────────

export function ExportPanel({ works, assess, context, web }: { works: OpenAlexWork[]; assess: Record<string, AssessState>; context: string; web: Unmatched[] }) {
  const ordered = [...works].sort((a, b) => (a._sourcecheck.input_index ?? 1e9) - (b._sourcecheck.input_index ?? 1e9))
  const assessed = ordered.filter((w) => assess[w.id]?.status === "done").length
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2"><FileJson className="size-4" />Export</CardTitle>
        <CardDescription>
          One JSON per paper: your reference, the OpenAlex record, the facts sent to the AI, its assessment (model, prompt version, attempts) and the score. {assessed} of {ordered.length} assessed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => download(`sourcecheck-papers-${stamp()}.json`, json(allPapersExport(ordered, assess, context, web)))}>
            <Download />All papers in one JSON
          </Button>
        </div>
        <div className="max-h-80 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Paper</TableHead>
                <TableHead className="w-28">Assessment</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((w) => {
                const st = assess[w.id]
                return (
                  <TableRow key={w.id}>
                    <TableCell className="text-muted-foreground tabular-nums">{(w._sourcecheck.input_index ?? -1) + 1 || "–"}</TableCell>
                    <TableCell className="max-w-0 truncate" title={w.display_name}>{w.display_name}</TableCell>
                    <TableCell className="text-xs">{st?.status === "done" ? "done" : st?.status === "error" ? "failed" : st?.status === "loading" ? "running…" : "not assessed"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => download(`sourcecheck-${String((w._sourcecheck.input_index ?? 0) + 1).padStart(2, "0")}-${slug(w.display_name)}.json`, json(paperRecord(w, st, context)))}
                      >
                        <Download />JSON
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Test runs ────────────────────────────────────────────────────────────────

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`
}

export function TestRunPanel({
  works, selected, context, contextProblem, models, defaults, model, prompt, runner,
}: {
  works: OpenAlexWork[]
  selected: OpenAlexWork[]
  context: string
  contextProblem: string | null
  models: ModelOption[]
  defaults: string[]
  model: string
  prompt: string
  runner: ReturnType<typeof useTestRuns>
}) {
  const { state, running } = runner
  // A test run always names one model: the picked one, else the first default.
  // The random router is left out: a test run must know which model answered.
  const choices = models.filter((m) => !m.router)
  const [runModels, setRunModels] = useState<string[]>(() => [model || defaults[0]].filter(Boolean))
  useEffect(() => { if (!runModels.length && (model || defaults[0])) setRunModels([model || defaults[0]]) }, [model, defaults]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleModel = (id: string) => setRunModels((ms) => (ms.includes(id) ? ms.filter((m) => m !== id) : [...ms, id]))
  const short = (id: string) => (models.find((m) => m.id === id)?.name ?? id).replace(/\s*\(free\)$/i, "")
  const [runs, setRuns] = useState(5)
  const [runPrompt, setRunPrompt] = useState(prompt)
  const [scope, setScope] = useState<"all" | "selected">("all")
  const papers = scope === "selected" && selected.length ? selected : works
  const calls = papers.length * runs * runModels.length
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])

  const done = state.results.length
  const ok = state.results.filter((r) => r.state.status === "done").length
  const failed = done - ok
  const elapsed = state.config ? (state.config.finished_at ? Date.parse(state.config.finished_at) : now) - Date.parse(state.config.started_at) : 0
  const avg = done ? elapsed / done : 0
  /** ok / failed per model, in the order the run uses them */
  const perModel = useMemo(() => {
    const m = new Map<string, { ok: number; failed: number }>()
    for (const id of state.config?.models ?? []) m.set(id, { ok: 0, failed: 0 })
    for (const r of state.results) {
      const e = m.get(r.model) ?? { ok: 0, failed: 0 }
      r.state.status === "done" ? e.ok++ : e.failed++
      m.set(r.model, e)
    }
    return [...m.entries()]
  }, [state.results, state.config?.models])

  const exportName = () => {
    const ms = state.config?.models ?? []
    return `sourcecheck-testrun-${slug(state.config?.prompt ?? "")}-${ms.length === 1 ? slug(ms[0]) : `${ms.length}-models`}-${state.config?.runs ?? 0}x-${stamp(new Date(state.config?.started_at ?? Date.now()))}`
  }
  const startBlocked = contextProblem ?? (!runModels.length ? "Pick at least one model." : !papers.length ? "No papers to assess." : null)

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4" />Test runs</CardTitle>
        <CardDescription>
          Assess the same papers several times with each chosen model, one call after another, and export every answer for analysis. Uses your current thesis context and any details you added.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <fieldset className="flex flex-col gap-1.5" disabled={running}>
          <legend className="text-muted-foreground mb-1.5 flex w-full items-center justify-between text-xs">
            <span>Models ({runModels.length} of {choices.length})</span>
            <span className="flex gap-2">
              <button type="button" className="hover:text-foreground underline-offset-2 hover:underline" onClick={() => setRunModels(choices.map((m) => m.id))}>All</button>
              <button type="button" className="hover:text-foreground underline-offset-2 hover:underline" onClick={() => setRunModels([])}>None</button>
            </span>
          </legend>
          <div className="grid gap-x-3 gap-y-1 rounded-md border px-2.5 py-2 sm:grid-cols-2">
            {choices.map((m) => (
              <label key={m.id} className="flex min-w-0 cursor-pointer items-center gap-2 py-0.5 text-sm" title={m.id}>
                <Checkbox checked={runModels.includes(m.id)} onCheckedChange={() => toggleModel(m.id)} />
                <span className="truncate">{short(m.id)}</span>
              </label>
            ))}
            {!choices.length && <span className="text-muted-foreground text-xs">Loading the model list…</span>}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Runs per model</span>
            <input
              type="number"
              min={1}
              max={50}
              value={runs}
              disabled={running}
              onChange={(e) => setRuns(Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))))}
              className="bg-background h-8 w-20 rounded-md border px-2 text-sm tabular-nums shadow-xs"
            />
          </label>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Prompt</span>
            <PromptPicker value={runPrompt} onChange={setRunPrompt} disabled={running} className="h-8 text-sm" />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Papers</span>
            <select value={scope} disabled={running} onChange={(e) => setScope(e.target.value as "all" | "selected")} className="bg-background h-8 rounded-md border px-2 text-sm shadow-xs">
              <option value="all">All found ({works.length})</option>
              <option value="selected" disabled={!selected.length}>Compare selection ({selected.length})</option>
            </select>
          </label>
        </div>

        <p className="text-muted-foreground text-xs">
          {calls} assessment{calls === 1 ? "" : "s"} ({runModels.length} model{runModels.length === 1 ? "" : "s"} × {runs} run{runs === 1 ? "" : "s"} × {papers.length} paper{papers.length === 1 ? "" : "s"}). Free models take about 20–60 s each, so expect roughly {fmt(calls * 35_000)}.
          Rate limits pause the run and it continues by itself; the app's own limits are RATE_LIMIT_PER_MINUTE and RATE_LIMIT_PER_DAY, and OpenRouter caps free models per day too.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={runner.cancel}>
              <Square />Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => runner.start(papers, context, choices.filter((m) => runModels.includes(m.id)).map((m) => m.id), runs, runPrompt)} disabled={!!startBlocked} title={startBlocked ?? undefined}>
              <Play />Start {calls} assessment{calls === 1 ? "" : "s"}
            </Button>
          )}
          {state.results.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => download(`${exportName()}.json`, json(testRunExport(state.config!, state.works, state.results)))}>
                <Download />JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(`${exportName()}.csv`, testRunCsv(state.results, state.works), "text/csv")} title="One row per run and paper, with ratings as words and as numbers">
                <Download />CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => download(`${exportName()}-comparison.csv`, testRunSummaryCsv(state.results, state.works, state.config?.runs, state.config?.models), "text/csv")}
                title="The runs side by side: scores, verdicts and every criterion as numbers, with means, standard deviations and agreement"
              >
                <Download />Run comparison
              </Button>
            </>
          )}
          {!running && state.config && (
            <Button size="sm" variant="ghost" onClick={runner.clear}>
              <Trash2 />Clear
            </Button>
          )}
          {startBlocked && !running && <span className="text-muted-foreground text-xs">{startBlocked}</span>}
        </div>

        {state.config && (
          <div className="flex flex-col gap-2 rounded-md border px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-medium">
                {state.config.status === "running" ? "Running" : state.config.status === "done" ? "Finished" : state.config.status === "cancelled" ? "Stopped by you" : "Stopped"}
                {" · "}
                <span className="tabular-nums">{done} of {state.total}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {ok} ok · {failed} failed · {fmt(elapsed)}
                {running && done > 0 ? ` · about ${fmt(avg * (state.total - done))} left` : ""}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={done}>
              <div className="bg-primary h-full transition-[width] duration-300" style={{ width: `${state.total ? (done / state.total) * 100 : 0}%` }} />
            </div>
            {running && state.current && (
              <p className="text-muted-foreground flex items-center gap-1.5 truncate">
                <Loader2 className="size-3 shrink-0 animate-spin" />
                {state.waitingUntil
                  ? `Rate limited; continuing in ${Math.max(0, Math.ceil((state.waitingUntil - now) / 1000))} s`
                  : `Run ${state.current.run} of ${state.config.runs} · ${short(state.current.model)}${state.config.models.length > 1 ? ` (model ${state.current.modelIndex} of ${state.config.models.length})` : ""} · paper ${state.current.paper} of ${state.works.length}: ${state.current.title}`}
              </p>
            )}
            {state.config.stop_reason && <p className="text-red-700 dark:text-red-300">{state.config.stop_reason}</p>}
            {perModel.length > 0 && (
              <div className="text-muted-foreground flex flex-col gap-0.5 tabular-nums">
                {perModel.map(([id, e]) => (
                  <span key={id} className="truncate" title={id}>
                    {short(id)}: {e.ok + e.failed} of {state.config!.runs * state.works.length}
                    {e.ok + e.failed ? ` (${e.ok} ok${e.failed ? `, ${e.failed} failed` : ""})` : ""}
                  </span>
                ))}
              </div>
            )}
            <p className="text-muted-foreground">Prompt {promptLabel(state.config.prompt)}. Results are kept only in this browser tab: export them before you reload the page.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
