import { GitCompareArrows, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { METRICS, SERIES_COLORS, formatAuthors, type ScoredWork } from "@/lib/scoring"
import { PaperRadar, shortTitle } from "./PaperRadar"
import { ScoreBadge, TrafficLight } from "./TrafficLight"

export function CompareView({ items, onRemove, onClear }: { items: ScoredWork[]; onRemove: (id: string) => void; onClear: () => void }) {
  if (items.length < 2) {
    return (
      <Card className="items-center py-16 text-center">
        <GitCompareArrows className="text-muted-foreground size-10" />
        <div>
          <p className="font-medium">Select at least two papers to compare</p>
          <p className="text-muted-foreground text-sm">Tick the checkboxes in the Sources tab (up to 5).</p>
        </div>
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <AnimatePresence mode="popLayout">
        {items.map((it, i) => (
          <motion.span
            key={it.work.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-card inline-flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-sm shadow-xs"
          >
            <span className="size-2.5 rounded-full" style={{ background: SERIES_COLORS[i] }} />
            {shortTitle(it.work.display_name, 30)}
            <button onClick={() => onRemove(it.work.id)} className="hover:bg-muted rounded-full p-0.5" aria-label={`Remove ${it.work.display_name} from comparison`}>
              <X className="size-3.5" />
            </button>
          </motion.span>
        ))}
        </AnimatePresence>
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
      </div>

      <Tabs defaultValue="overlay">
        <TabsList>
          <TabsTrigger value="overlay">Aggregated (overlay)</TabsTrigger>
          <TabsTrigger value="side">Side by side</TabsTrigger>
        </TabsList>

        <TabsContent value="overlay" className="mt-2">
          <Card>
            <CardHeader>
              <CardTitle>Overlaid quality profiles</CardTitle>
              <CardDescription>Same metrics for every paper, plotted on top of each other.</CardDescription>
            </CardHeader>
            <CardContent>
              <PaperRadar items={items} height={380} showLegend />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="side" className="mt-2">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((it, i) => (
              <Card key={it.work.id} className="gap-2 py-4">
                <CardHeader className="px-4">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: SERIES_COLORS[i] }} />
                    <div className="min-w-0">
                      <CardTitle className="text-sm leading-snug">{shortTitle(it.work.display_name, 60)}</CardTitle>
                      <CardDescription className="text-xs">{formatAuthors(it.work, 2)} ({it.work.publication_year})</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-2">
                  <PaperRadar items={[it]} height={200} />
                  <div className="flex items-center justify-center gap-3">
                    <TrafficLight signal={it.signal} />
                    <ScoreBadge score={it.overall} signal={it.signal} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Card className="py-4">
        <CardContent className="px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                {items.map((it, i) => (
                  <TableHead key={it.work.id} className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[i] }} />
                      {shortTitle(it.work.display_name, 18)}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICS.map((m) => {
                const vals = items.map((it) => it.metrics[m.key])
                const best = Math.max(...vals)
                return (
                  <TableRow key={m.key}>
                    <TableCell className="font-medium">{m.label}</TableCell>
                    {vals.map((v, i) => (
                      <TableCell key={i} className={`text-right tabular-nums ${v === best ? "font-semibold" : "text-muted-foreground"}`}>
                        {v.toFixed(1)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold">Overall</TableCell>
                {items.map((it) => (
                  <TableCell key={it.work.id} className="text-right font-semibold tabular-nums">{it.overall.toFixed(1)}</TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
