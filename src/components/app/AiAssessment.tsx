import { AlertTriangle, Loader2, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { ScoredWork } from "@/lib/scoring"
import type { AssessState } from "@/lib/assessClient"
import { CRITERIA, RATING_LABELS, VERDICT_LABELS, type AssessmentResponse, type Rating, type Verdict } from "@/lib/assessment"
import { DevPanel } from "./DevPanel"
import { PaperRadar } from "./PaperRadar"

const RATING_TONE: Record<Rating, string> = {
  very_good: "text-emerald-700 dark:text-emerald-400",
  good: "text-emerald-700 dark:text-emerald-400",
  rather_good: "text-amber-700 dark:text-amber-400",
  rather_weak: "text-amber-700 dark:text-amber-400",
  weak: "text-red-700 dark:text-red-400",
  very_weak: "text-red-700 dark:text-red-400",
  no_rating: "text-muted-foreground",
}

export const VERDICT_TONE: Record<Verdict, string> = {
  suitable: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  usable_with_reservations: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  not_usable: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
}

/**
 * The AI assessment of one source, judged against the overall thesis context.
 * Before it runs there is no rating at all, only the trigger.
 */
export function AiAssessment({
  item,
  state,
  context,
  problem,
  onAssess,
}: {
  item: ScoredWork
  state: AssessState | undefined
  context: string
  /** why the assessment cannot run yet (no or too long context), else null */
  problem: string | null
  onAssess: () => void
}) {
  const loading = state?.status === "loading"
  const stale = state?.status === "done" && state.context !== context.trim()
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">AI assessment</h3>
        {state?.status === "done" && (
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={onAssess} disabled={!!problem}>
            <RotateCcw /> Assess again
          </Button>
        )}
      </div>

      {!state && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed px-3 py-3 text-sm">
          <p className="text-muted-foreground">
            Not assessed yet. The AI rates the eight criteria against your thesis context, using the facts from OpenAlex, and gives an overall verdict.
          </p>
          <Button onClick={onAssess} disabled={!!problem}>
            <Sparkles /> Assess with AI
          </Button>
          {problem && <p className="text-muted-foreground text-xs">{problem}</p>}
        </div>
      )}

      {loading && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Assessing… free models take about half a minute.
        </p>
      )}

      {state?.status === "error" && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">The assessment was not successful.</p>
            <p>{state.message}</p>
          </div>
          {state.code !== "not_configured" && state.code !== "invalid_request" && (
            <Button variant="ghost" size="sm" onClick={onAssess} disabled={!!problem} className="-my-1 shrink-0">
              <RotateCcw /> Retry
            </Button>
          )}
        </div>
      )}

      {state?.status === "done" && (
        <>
          {stale && <p className="text-muted-foreground text-xs">Assessed with an earlier version of your thesis context. Assess again to update it.</p>}
          <AssessmentView item={item} assessment={state.assessment} />
        </>
      )}

      {(state?.status === "done" || state?.status === "error") && state.debug && <DevPanel debug={state.debug} />}
    </section>
  )
}

function AssessmentView({ item, assessment: a }: { item: ScoredWork; assessment: AssessmentResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("rounded-md border px-3 py-2 text-sm", VERDICT_TONE[a.overall])}>
        <p className="font-semibold">{VERDICT_LABELS[a.overall]}</p>
        <ul className="mt-1 list-disc pl-5">
          {a.decisive_reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <PaperRadar items={[item]} height={260} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Criterion</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CRITERIA.map((c) => {
            const r = a.criteria[c.key]
            return (
              <TableRow key={c.key}>
                <TableCell className="align-top font-medium whitespace-normal">
                  {c.label}
                  <div className="text-muted-foreground mt-0.5 text-[10px] font-normal">{item.facts[c.key]}</div>
                </TableCell>
                <TableCell className={cn("align-top font-medium whitespace-nowrap", RATING_TONE[r.rating])}>{RATING_LABELS[r.rating]}</TableCell>
                <TableCell className="text-muted-foreground align-top text-xs whitespace-normal">{r.reason}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="text-sm">
        <p className="mb-1 font-semibold">What to do</p>
        <ul className="list-disc pl-5">
          {a.advice.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
