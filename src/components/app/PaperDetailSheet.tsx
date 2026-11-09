import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChevronDown, ExternalLink } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { METRICS, formatAuthors, type ScoredWork } from "@/lib/scoring"
import { PaperRadar } from "./PaperRadar"
import { ScoreBadge, TrafficLight, signalLabel } from "./TrafficLight"
import { FlagBadges } from "./FlagBadges"

export function PaperDetailSheet({ item, onOpenChange }: { item: ScoredWork | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && <Detail item={item} />}
      </SheetContent>
    </Sheet>
  )
}

function Detail({ item }: { item: ScoredWork }) {
  const w = item.work
  const timeline = [...w.counts_by_year].sort((a, b) => a.year - b.year)
  return (
    <>
      <SheetHeader className="pr-10">
        <div className="flex items-start gap-3">
          <TrafficLight signal={item.signal} className="mt-1" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg leading-snug">{w.display_name}</SheetTitle>
            <SheetDescription className="mt-1">
              {formatAuthors(w, 5)} ({w.publication_year})
            </SheetDescription>
            <p className="text-muted-foreground mt-0.5 text-sm italic">{w.primary_location.source?.display_name ?? "Unknown venue"}</p>
          </div>
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-5 px-4 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <ScoreBadge score={item.overall} signal={item.signal} size="lg" />
          <span className="text-sm font-medium">{signalLabel(item.signal)}</span>
          <FlagBadges flags={item.flags} />
        </div>

        {w._semantic_scholar.tldr && (
          <p className="bg-muted/60 rounded-md px-3 py-2 text-sm">
            <span className="text-muted-foreground mr-1 text-xs font-semibold uppercase">TL;DR</span>
            {w._semantic_scholar.tldr}
          </p>
        )}

        <section>
          <h3 className="mb-1 text-sm font-semibold">Quality profile</h3>
          <PaperRadar items={[item]} height={260} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Metrics <span className="text-muted-foreground font-normal">(provisional, pending interviews)</span></h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Underlying signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICS.map((m) => (
                <TableRow key={m.key}>
                  <TableCell className="font-medium">{m.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.metrics[m.key].toFixed(1)}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal text-xs">
                    {item.raw[m.key]}
                    <div className="text-[10px] opacity-70">{m.api}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Citations per year</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={timeline} margin={{ left: -16, right: 4 }}>
              <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="cited_by_count" name="Citations" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <Separator />

        <div className="flex flex-wrap gap-2">
          {w.doi && (
            <Button variant="outline" size="sm" asChild>
              <a href={w.doi} target="_blank" rel="noreferrer">DOI <ExternalLink /></a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={w.id} target="_blank" rel="noreferrer">OpenAlex <ExternalLink /></a>
          </Button>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              Raw API response (mock) <ChevronDown />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-[11px] leading-relaxed">{JSON.stringify(w, null, 2)}</pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  )
}
