import { ChevronRight } from "lucide-react"
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
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {items.map((it) => {
        const w = it.work
        const idx = selected.indexOf(w.id)
        const isSel = idx >= 0
        const disabled = !isSel && selected.length >= maxCompare
        return (
          <li key={w.id} className={cn("group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40", isSel && "bg-muted/30")}>
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

            <button type="button" onClick={() => onOpen(it)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
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
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
