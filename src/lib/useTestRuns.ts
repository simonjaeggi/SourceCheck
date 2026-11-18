/**
 * Repeated assessments for analysis: every chosen paper, n times, with each chosen model.
 * Runs one call at a time (free models are slow and rate limited). On a rate limit
 * it waits the time the server names and tries the same job again; it stops when
 * the setup is broken (no key, model not allowed). Lives in App, so switching tabs
 * does not lose a run in progress.
 */
import { useRef, useState } from "react"
import type { OpenAlexWork } from "@/data/types"
import { requestAssessment } from "@/lib/assessClient"
import type { RunResult, TestRunConfig } from "@/lib/exportData"

/** Waits per job before giving up on it (each wait is what the server asked for, ~30–60 s). */
const MAX_WAITS = 20

export type TestRunState = {
  config: TestRunConfig | null
  works: OpenAlexWork[]
  results: RunResult[]
  total: number
  current: { model: string; modelIndex: number; run: number; paper: number; title: string } | null
  /** epoch ms until which the run waits for a rate limit */
  waitingUntil: number | null
}

const IDLE: TestRunState = { config: null, works: [], results: [], total: 0, current: null, waitingUntil: null }

export function useTestRuns() {
  const [state, setState] = useState<TestRunState>(IDLE)
  const cancelled = useRef(false)
  const running = state.config?.status === "running"

  /**
   * Every model `runs` times over all papers. Run-major order (run 1 of every model, then
   * run 2, …), so slow drift on OpenRouter's side does not end up in one model's numbers.
   */
  async function start(works: OpenAlexWork[], context: string, models: string[], runs: number, prompt: string) {
    if (running || !works.length || !models.length) return
    cancelled.current = false
    const config: TestRunConfig = { models, prompt, runs, thesis_context: context.trim(), started_at: new Date().toISOString(), status: "running" }
    const results: RunResult[] = []
    setState({ config, works, results: [], total: works.length * runs * models.length, current: null, waitingUntil: null })
    const finish = (status: TestRunConfig["status"], stop_reason?: string) =>
      setState((s) => ({ ...s, current: null, waitingUntil: null, config: { ...s.config!, status, finished_at: new Date().toISOString(), ...(stop_reason ? { stop_reason } : {}) } }))

    for (let run = 1; run <= runs; run++) {
      for (let m = 0; m < models.length; m++) {
        const model = models[m]
        for (let p = 0; p < works.length; p++) {
          const w = works[p]
          setState((s) => ({ ...s, current: { model, modelIndex: m + 1, run, paper: p + 1, title: w.display_name } }))
          let waits = 0
          for (;;) {
            if (cancelled.current) return finish("cancelled")
            const r = await requestAssessment(w, context, model, prompt)
            if (r.status === "error" && r.code === "rate_limited" && waits < MAX_WAITS) {
              waits++
              const until = Date.now() + (r.retryAfter ?? 30) * 1000
              setState((s) => ({ ...s, waitingUntil: until }))
              while (Date.now() < until && !cancelled.current) await new Promise((res) => setTimeout(res, 250))
              setState((s) => ({ ...s, waitingUntil: null }))
              continue
            }
            results.push({ model, run, input_index: w._sourcecheck.input_index ?? null, work_id: w.id, title: w.display_name, doi: w.doi, state: r, waits })
            setState((s) => ({ ...s, results: [...results] }))
            // A broken setup fails every job the same way: stop instead of filling the export with errors.
            if (r.status === "error" && (r.code === "not_configured" || r.code === "invalid_request" || r.code === "forbidden_origin")) return finish("stopped", `${model}: ${r.message}`)
            break
          }
        }
      }
    }
    finish("done")
  }

  return {
    state,
    running,
    start,
    cancel: () => { cancelled.current = true },
    clear: () => { if (!running) setState(IDLE) },
  }
}
