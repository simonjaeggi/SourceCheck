import { Check } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CONCEPTS } from "@/data/mockWorks"
import { SERIES_COLORS, type ScoredWork } from "@/lib/scoring"
import { shortTitle } from "./PaperRadar"
import { TrafficLight } from "./TrafficLight"

export type AdvancedViews = { webster: boolean; timeline: boolean; apiFields: boolean }

const VIEWS: { key: keyof AdvancedViews; label: string; desc: string }[] = [
  { key: "webster", label: "Webster & Watson concept matrix", desc: "Concept-centric literature review grid (Webster & Watson, 2002)" },
  { key: "timeline", label: "Citation trajectory", desc: "Citations per year, from OpenAlex counts_by_year" },
  { key: "apiFields", label: "Raw indicator table", desc: "Unscored API fields for all sources (for power users)" },
]

export function AdvancedView({
  items, compareItems, views, onChange,
}: { items: ScoredWork[]; compareItems: ScoredWork[]; views: AdvancedViews; onChange: (v: AdvancedViews) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle>Researcher views</CardTitle>
          <CardDescription>Enable additional views for more specific workflows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-4 sm:grid-cols-3">
          {VIEWS.map((v) => (
            <Label key={v.key} className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary/40">
              <Switch checked={views[v.key]} onCheckedChange={(c) => onChange({ ...views, [v.key]: c })} className="mt-0.5" />
              <span>
                <span className="block font-medium">{v.label}</span>
                <span className="text-muted-foreground text-xs leading-snug">{v.desc}</span>
              </span>
            </Label>
          ))}
        </CardContent>
      </Card>

      {views.webster && <WebsterWatson items={items} />}
      {views.timeline && <Timeline items={compareItems.length ? compareItems : items.slice(0, 4)} usingSelection={compareItems.length > 0} />}
      {views.apiFields && <ApiFields items={items} />}
      {!views.webster && !views.timeline && !views.apiFields && (
        <p className="text-muted-foreground py-10 text-center text-sm">No advanced views enabled.</p>
      )}
    </div>
  )
}

function WebsterWatson({ items }: { items: ScoredWork[] }) {
  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle>Concept matrix</CardTitle>
        <CardDescription>Concepts derived from your context (mock). A tick means the source addresses the concept.</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Source</TableHead>
              {CONCEPTS.map((c) => (
                <TableHead key={c} className="text-center text-xs whitespace-normal">{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.work.id}>
                <TableCell className="whitespace-normal">
                  <div className="flex items-center gap-2">
                    <TrafficLight signal={it.signal} className="scale-75" />
                    <span className="text-sm">
                      {it.work.authorships[0].author.display_name.split(" ").slice(-1)[0]} et al. ({it.work.publication_year})
                    </span>
                  </div>
                </TableCell>
                {CONCEPTS.map((c) => (
                  <TableCell key={c} className="text-center">
                    {it.work._sourcecheck.concepts.includes(c) ? <Check className="mx-auto size-4" /> : <span className="text-muted-foreground/40">–</span>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow className="bg-muted/40">
              <TableCell className="font-medium">Coverage</TableCell>
              {CONCEPTS.map((c) => {
                const n = items.filter((it) => it.work._sourcecheck.concepts.includes(c)).length
                return <TableCell key={c} className={`text-center tabular-nums ${n <= 1 ? "text-signal-red font-semibold" : ""}`}>{n}</TableCell>
              })}
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-xs">Concepts covered by one source or fewer are highlighted as gaps in your literature base.</p>
      </CardContent>
    </Card>
  )
}

function Timeline({ items, usingSelection }: { items: ScoredWork[]; usingSelection: boolean }) {
  const yearsSet = new Set<number>()
  items.forEach((it) => it.work.counts_by_year.forEach((c) => yearsSet.add(c.year)))
  const data = [...yearsSet].sort().map((y) => {
    const row: Record<string, number> = { year: y }
    items.forEach((it, i) => (row[`s${i}`] = it.work.counts_by_year.find((c) => c.year === y)?.cited_by_count ?? 0))
    return row
  })
  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle>Citation trajectory</CardTitle>
        <CardDescription>{usingSelection ? "Showing your comparison selection." : "Showing the first four sources. Select papers to compare them here."}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ left: 0, right: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis scale="log" domain={[1, "auto"]} allowDataOverflow tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {items.map((it, i) => (
              <Line key={it.work.id} dataKey={`s${i}`} name={shortTitle(it.work.display_name, 28)} stroke={SERIES_COLORS[i % 5]} strokeWidth={2} dot={{ r: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="text-muted-foreground text-xs">Log scale.</p>
      </CardContent>
    </Card>
  )
}

function ApiFields({ items }: { items: ScoredWork[] }) {
  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle>Raw indicators</CardTitle>
        <CardDescription>Fields as returned by OpenAlex and Semantic Scholar (mock).</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>type</TableHead>
              <TableHead>source.type</TableHead>
              <TableHead className="text-right">cited_by_count</TableHead>
              <TableHead className="text-right">fwci</TableHead>
              <TableHead className="text-right">influential</TableHead>
              <TableHead>is_core</TableHead>
              <TableHead>is_retracted</TableHead>
              <TableHead>oa_status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-xs">
            {items.map((it) => {
              const w = it.work
              return (
                <TableRow key={w.id}>
                  <TableCell>{shortTitle(w.display_name, 32)}</TableCell>
                  <TableCell>{w.type}</TableCell>
                  <TableCell>{w.primary_location.source?.type ?? "null"}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.cited_by_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.fwci ?? "null"}</TableCell>
                  <TableCell className="text-right tabular-nums">{w._semantic_scholar.influentialCitationCount}</TableCell>
                  <TableCell>{String(w.primary_location.source?.is_core ?? false)}</TableCell>
                  <TableCell className={w.is_retracted ? "text-signal-red font-semibold" : ""}>{String(w.is_retracted)}</TableCell>
                  <TableCell>{w.open_access.oa_status}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
