import { ChevronRight, SearchX } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatAuthors, SERIES_COLORS, type ScoredWork } from "@/lib/scoring"
import { ScoreBadge, TrafficLight } from "./TrafficLight"
import { FlagBadges } from "./FlagBadges"

interface Props {
  items: ScoredWork[]
  selected: string[]
  onToggle: (id: string) => void
  onOpen: (item: ScoredWork) => void
  maxCompare: number
}

export function SourceList({ items, selected, onToggle, onOpen, maxCompare }: Props) {
  if (items.length === 0) {
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
      {items.map((it, i) => {
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
              <TrafficLight signal={it.signal} />
              <ScoreBadge score={it.overall} signal={it.signal} />
              <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          </motion.li>
        )
      })}
      </AnimatePresence>
    </ul>
  )
}
