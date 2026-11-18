import { AlertTriangle, ChevronRight, Globe, Loader2, SearchX, Sparkles, SquareArrowOutUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AssessState } from "@/lib/assessClient"
import { AnimatePresence, motion } from "motion/react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatAuthors, SERIES_COLORS, type ScoredWork } from "@/lib/scoring"
import { ScoreBadge, TrafficLight } from "./TrafficLight"
import { FlagBadges } from "./FlagBadges"
import type { Unmatched } from "@/lib/lookup"

/** A list row: an OpenAlex work, or a web source that is listed but not assessed. */
export type Row = { kind: "work"; item: ScoredWork } | { kind: "web"; source: Unmatched }

interface Props {
  rows: Row[]
  selected: string[]
  onToggle: (id: string) => void
  onOpen: (item: ScoredWork) => void
  maxCompare: number
  assess: Record<string, AssessState>
  onAssess: (id: string) => void
  /** why assessing is not possible yet (e.g. no thesis context), else null */
  assessProblem: string | null
}

export function SourceList({ rows, selected, onToggle, onOpen, maxCompare, assess, onAssess, assessProblem }: Props) {
  if (rows.length === 0) {
    return (
      <div className="bg-card flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
        <SearchX className="text-muted-foreground size-8" />
        <p className="text-sm font-medium">No sources match this filter</p>
        <p className="text-muted-foreground text-xs">Pick another signal above to see more sources.</p>
      </div>
    )
  }
  return (
    <ul className="bg-card divide-y overflow-hidden rounded-xl border shadow-xs">
      <AnimatePresence initial={true} mode="popLayout">
      {rows.map((row, i) => {
        if (row.kind === "web") return <WebRow key={`web-${row.source.index}`} source={row.source} i={i} />
        const it = row.item
        const w = it.work
        const idx = selected.indexOf(w.id)
        const isSel = idx >= 0
        const disabled = !isSel && selected.length >= maxCompare
        return (
          <motion.li
            key={w.id}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.3, delay: Math.min(i, 10) * 0.035, ease: "easeOut", layout: { type: "spring", bounce: 0.15, duration: 0.45 } }}
            className={cn("group relative flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40", isSel && "bg-muted/30")}
          >
            {isSel && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }} />}
            <div className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={isSel}
                disabled={disabled}
                onCheckedChange={() => onToggle(w.id)}
                aria-label="Select for comparison"
                title={disabled ? `Compare up to ${maxCompare} papers` : "Select for comparison"}
              />
              {isSel && <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }} />}
            </div>

            <button type="button" onClick={() => onOpen(it)} className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium group-hover:underline">{w.display_name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {formatAuthors(w)} ({w.publication_year})
                </p>
                <p className="text-muted-foreground truncate text-xs italic">
                  {w.primary_location.source?.display_name ?? "Unknown venue"}
                  {w.primary_location.source?.host_organization_name ? `, ${w.primary_location.source.host_organization_name}` : ""}
                </p>
                <FlagBadges flags={it.flags} className="mt-1.5" />
              </div>
              <div className="hidden text-right text-xs sm:block">
                <div className="font-medium tabular-nums">{w.cited_by_count.toLocaleString("en-US")}</div>
                <div className="text-muted-foreground">citations</div>
              </div>
            </button>
            <AssessCell item={it} state={assess[w.id]} onAssess={() => onAssess(w.id)} problem={assessProblem} />
            <button type="button" onClick={() => onOpen(it)} aria-label="Open details" className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px]">
              <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          </motion.li>
        )
      })}
      </AnimatePresence>
    </ul>
  )
}

/** A web source: listed with its link, but not looked up in OpenAlex and not assessed for now. */
function WebRow({ source, i }: { source: Unmatched; i: number }) {
  const web = source.web
  const title = web?.title ?? source.reference
  const when = web?.year ? String(web.year) : web?.accessed ? `accessed ${web.accessed}` : null
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.3, delay: Math.min(i, 10) * 0.035, ease: "easeOut", layout: { type: "spring", bounce: 0.15, duration: 0.45 } }}
      className="group relative flex items-center gap-3 px-3 py-3"
    >
      <Globe className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {web?.url ? (
          <a href={web.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">
            {title}
          </a>
        ) : (
          <p className="truncate font-medium">{title}</p>
        )}
        <p className="text-muted-foreground truncate text-sm">
          {web?.site ?? "No link"}
          {when ? ` (${when})` : ""}
        </p>
        <p className="text-muted-foreground truncate font-mono text-[11px]" title={source.reference}>
          {source.reference}
        </p>
        <FlagBadges flags={[{ label: "Web source", tone: "neutral" }]} className="mt-1.5" />
      </div>
      <span className="text-muted-foreground w-[7.5rem] text-center text-xs" title="OpenAlex only indexes scholarly works, so web sources are not looked up or assessed for now.">
        Not assessed
      </span>
      {web?.url ? (
        <a href={web.url} target="_blank" rel="noreferrer" aria-label="Open link" className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px]">
          <SquareArrowOutUpRight className="text-muted-foreground size-4 shrink-0" />
        </a>
      ) : (
        <span className="size-4 shrink-0" />
      )}
    </motion.li>
  )
}

/** Right side of a row: the AI's light and score once assessed, otherwise the trigger. */
function AssessCell({ item, state, onAssess, problem }: { item: ScoredWork; state: AssessState | undefined; onAssess: () => void; problem: string | null }) {
  if (state?.status === "done" && item.signal)
    return (
      <div className="flex items-center gap-3">
        <TrafficLight signal={item.signal} />
        {item.overall != null && <ScoreBadge score={item.overall} signal={item.signal} />}
      </div>
    )
  if (state?.status === "loading")
    return (
      <span className="text-muted-foreground flex w-[7.5rem] items-center justify-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Assessing…
      </span>
    )
  if (state?.status === "error")
    return (
      <Button variant="outline" size="sm" className="w-[7.5rem] border-red-300 text-red-700" onClick={onAssess} disabled={!!problem} title={state.message}>
        <AlertTriangle /> Failed, retry
      </Button>
    )
  return (
    <Button variant="outline" size="sm" className="w-[7.5rem]" onClick={onAssess} disabled={!!problem} title={problem ?? "Rate this source with AI against your thesis context"}>
      <Sparkles /> Assess
    </Button>
  )
}
