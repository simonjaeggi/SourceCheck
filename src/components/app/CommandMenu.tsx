import { Eraser, GitCompareArrows, ListChecks, ScanSearch, SlidersHorizontal, Sparkles, Trash2, CircleDot } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { formatAuthors, type ScoredWork, type Signal } from "@/lib/scoring"
import { TrafficLight, signalLabel } from "./TrafficLight"

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  results: ScoredWork[] | null
  loading: boolean
  canAnalyze: boolean
  hasSelection: boolean
  onOpenSource: (item: ScoredWork) => void
  onAnalyze: () => void
  onLoadExample: () => void
  onClear: () => void
  onTab: (tab: string) => void
  onFilter: (f: Signal | "all") => void
  onClearSelection: () => void
}

/** ⌘K command palette (cmdk via shadcn/ui): jump to a source, switch views, filter, run actions. */
export function CommandMenu(p: Props) {
  const run = (fn: () => void) => () => {
    p.onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={p.open} onOpenChange={p.onOpenChange} title="Command menu" description="Search sources and actions">
      <CommandInput placeholder="Search sources, authors, actions…" />
      <CommandList className="max-h-[min(420px,60vh)]">
        <CommandEmpty>Nothing found.</CommandEmpty>

        {p.results && p.results.length > 0 && (
          <CommandGroup heading="Sources">
            {p.results.map((r) => (
              <CommandItem
                key={r.work.id}
                value={`${r.work.display_name} ${formatAuthors(r.work, 10)} ${r.work.publication_year} ${r.work.primary_location.source?.display_name ?? ""}`}
                onSelect={run(() => {
                  p.onTab("sources")
                  p.onOpenSource(r)
                })}
              >
                <TrafficLight signal={r.signal} className="scale-[0.6]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{r.work.display_name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {formatAuthors(r.work, 2)} ({r.work.publication_year})
                  </p>
                </div>
                <span className="text-muted-foreground text-xs tabular-nums">{r.overall.toFixed(1)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem disabled={p.loading || !p.canAnalyze} onSelect={run(p.onAnalyze)}>
            <ScanSearch />Analyze sources<CommandShortcut>⌘↵</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(p.onLoadExample)}>
            <Sparkles />Load example input
          </CommandItem>
          <CommandItem onSelect={run(p.onClear)}>
            <Eraser />Clear input
          </CommandItem>
          {p.hasSelection && (
            <CommandItem onSelect={run(p.onClearSelection)}>
              <Trash2 />Clear comparison selection
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem onSelect={run(() => p.onTab("sources"))}><ListChecks />Sources</CommandItem>
          <CommandItem onSelect={run(() => p.onTab("compare"))}><GitCompareArrows />Compare</CommandItem>
          <CommandItem onSelect={run(() => p.onTab("advanced"))}><SlidersHorizontal />Advanced views</CommandItem>
        </CommandGroup>

        {p.results && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Filter sources">
              <CommandItem onSelect={run(() => { p.onTab("sources"); p.onFilter("all") })}>
                <CircleDot />Show all
              </CommandItem>
              {(["green", "amber", "red"] as const).map((s) => (
                <CommandItem key={s} value={`filter ${s} ${signalLabel(s)}`} onSelect={run(() => { p.onTab("sources"); p.onFilter(s) })}>
                  <span className={s === "green" ? "bg-signal-green size-2.5 rounded-full" : s === "amber" ? "bg-signal-amber size-2.5 rounded-full" : "bg-signal-red size-2.5 rounded-full"} />
                  Only “{signalLabel(s)}”
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
