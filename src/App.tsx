import { useMemo, useState } from "react"
import { BookCheck, FileText, Loader2, ScanSearch, Sparkles, ListChecks, GitCompareArrows, SlidersHorizontal, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { mockWorks, SAMPLE_CONTEXT, SAMPLE_REFERENCES } from "@/data/mockWorks"
import { scoreWork, type ScoredWork, type Signal } from "@/lib/scoring"
import { SourceList } from "@/components/app/SourceList"
import { PaperDetailSheet } from "@/components/app/PaperDetailSheet"
import { CompareView } from "@/components/app/CompareView"
import { AdvancedView, type AdvancedViews } from "@/components/app/AdvancedView"
import { TrafficLight } from "@/components/app/TrafficLight"

const MAX_COMPARE = 5
type SortKey = "score" | "year" | "citations" | "input"

export default function App() {
  const [references, setReferences] = useState(SAMPLE_REFERENCES)
  const [context, setContext] = useState(SAMPLE_CONTEXT)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ScoredWork[] | null>(() => mockWorks.map((w) => scoreWork(w)))
  const [open, setOpen] = useState<ScoredWork | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [tab, setTab] = useState("sources")
  const [sort, setSort] = useState<SortKey>("score")
  const [filter, setFilter] = useState<Signal | "all">("all")
  const [views, setViews] = useState<AdvancedViews>({ webster: true, timeline: false, apiFields: false })

  const refCount = references.split("\n").filter((l) => l.trim()).length

  function analyze() {
    // Prototype: no parsing or API calls yet. Simulates latency and returns the mock set.
    setLoading(true)
    setResults(null)
    setSelected([])
    setTimeout(() => {
      setResults(mockWorks.map((w) => scoreWork(w)))
      setLoading(false)
      setTab("sources")
    }, 1100)
  }

  const sorted = useMemo(() => {
    if (!results) return []
    const list = filter === "all" ? [...results] : results.filter((r) => r.signal === filter)
    if (sort === "score") list.sort((a, b) => b.overall - a.overall)
    if (sort === "year") list.sort((a, b) => b.work.publication_year - a.work.publication_year)
    if (sort === "citations") list.sort((a, b) => b.work.cited_by_count - a.work.cited_by_count)
    return list
  }, [results, sort, filter])

  const compareItems = useMemo(
    () => selected.map((id) => results?.find((r) => r.work.id === id)).filter(Boolean) as ScoredWork[],
    [selected, results]
  )

  const counts = useMemo(() => {
    const c = { green: 0, amber: 0, red: 0 }
    results?.forEach((r) => c[r.signal]++)
    return c
  }, [results])
  const avg = results?.length ? results.reduce((s, r) => s + r.overall, 0) / results.length : 0

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_COMPARE ? [...s, id] : s))

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <header className="bg-card/80 sticky top-0 z-40 border-b backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
            <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
              <BookCheck className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="font-semibold">SourceCheck</p>
              <p className="text-muted-foreground text-xs">Evaluate the references in your paper</p>
            </div>
            <Badge variant="outline" className="ml-auto border-amber-300 bg-amber-50 text-amber-800">
              Prototype with mock data
            </Badge>
          </div>
        </header>

        <main className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* ---------- INPUT ---------- */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileText className="size-4" />Your input</CardTitle>
                <CardDescription>Paste your reference list and some context about your paper.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="refs">References</Label>
                    <span className="text-muted-foreground text-xs">{refCount} detected</span>
                  </div>
                  <Textarea
                    id="refs"
                    value={references}
                    onChange={(e) => setReferences(e.target.value)}
                    placeholder="Paste your bibliography (APA, IEEE, BibTeX, one per line)…"
                    className="field-sizing-fixed h-56 resize-y font-mono text-xs leading-relaxed"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ctx">Context <span className="text-muted-foreground font-normal">(abstract, research question)</span></Label>
                  <Textarea
                    id="ctx"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Paste your abstract so relevance can be judged…"
                    className="field-sizing-fixed h-36 resize-y text-sm"
                  />
                </div>
                <Button onClick={analyze} disabled={loading || !refCount} size="lg">
                  {loading ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                  {loading ? "Checking sources…" : "Analyze sources"}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => { setReferences(SAMPLE_REFERENCES); setContext(SAMPLE_CONTEXT) }}>
                    <Sparkles />Load example
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setReferences(""); setContext("") }}>
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
            <p className="text-muted-foreground flex gap-2 px-1 text-xs leading-relaxed">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Planned data sources: OpenAlex (citations, FWCI, retractions, venue), Semantic Scholar (influential citations, TL;DR), Crossref (publisher metadata). Scores are provisional.
            </p>
          </aside>

          {/* ---------- OUTPUT ---------- */}
          <section className="min-w-0">
            <Tabs value={tab} onValueChange={setTab} className="gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <TabsList>
                  <TabsTrigger value="sources"><ListChecks />Sources</TabsTrigger>
                  <TabsTrigger value="compare">
                    <GitCompareArrows />Compare
                    {selected.length > 0 && <Badge className="h-4 min-w-4 rounded-full px-1 text-[10px]">{selected.length}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="advanced"><SlidersHorizontal />Advanced</TabsTrigger>
                </TabsList>
                {selected.length >= 2 && tab === "sources" && (
                  <Button size="sm" variant="secondary" onClick={() => setTab("compare")}>
                    Compare {selected.length} papers
                  </Button>
                )}
              </div>

              {loading && <LoadingState n={refCount} />}

              {!loading && results && (
                <>
                  <TabsContent value="sources" className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Sources checked" value={results.length.toString()} />
                      <Stat label="Average score" value={avg.toFixed(1)} suffix="/10" />
                      <Stat label="Trustworthy" value={counts.green.toString()} signal="green" />
                      <Stat label="Need attention" value={(counts.amber + counts.red).toString()} signal={counts.red ? "red" : "amber"} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Show</span>
                      {(["all", "green", "amber", "red"] as const).map((f) => (
                        <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                          {f !== "all" && <span className={cn("size-2 rounded-full", f === "green" ? "bg-signal-green" : f === "amber" ? "bg-signal-amber" : "bg-signal-red")} />}
                          {f === "all" ? `All (${results.length})` : `${counts[f]}`}
                        </Chip>
                      ))}
                      <span className="text-muted-foreground ml-auto">Sort by</span>
                      {(["score", "year", "citations", "input"] as const).map((s) => (
                        <Chip key={s} active={sort === s} onClick={() => setSort(s)}>
                          {s === "input" ? "Input order" : s[0].toUpperCase() + s.slice(1)}
                        </Chip>
                      ))}
                    </div>

                    <SourceList items={sorted} selected={selected} onToggle={toggle} onOpen={setOpen} maxCompare={MAX_COMPARE} />
                    <p className="text-muted-foreground text-xs">Click a source for details. Tick boxes to compare up to {MAX_COMPARE}.</p>
                  </TabsContent>

                  <TabsContent value="compare">
                    <CompareView items={compareItems} onRemove={toggle} onClear={() => setSelected([])} />
                  </TabsContent>

                  <TabsContent value="advanced">
                    <AdvancedView items={results} compareItems={compareItems} views={views} onChange={setViews} />
                  </TabsContent>
                </>
              )}
            </Tabs>
          </section>
        </main>

        <PaperDetailSheet item={open} onOpenChange={(o) => !o && setOpen(null)} />
      </div>
    </TooltipProvider>
  )
}

function Stat({ label, value, suffix, signal }: { label: string; value: string; suffix?: string; signal?: Signal }) {
  return (
    <Card className="gap-1 px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="flex items-center justify-between">
        <p className="text-2xl font-semibold tabular-nums">
          {value}
          {suffix && <span className="text-muted-foreground text-sm font-normal">{suffix}</span>}
        </p>
        {signal && <TrafficLight signal={signal} className="scale-75" />}
      </div>
    </Card>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

function LoadingState({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Parsing {n} references, querying OpenAlex and Semantic Scholar…
      </p>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-card flex h-20 animate-pulse items-center gap-3 rounded-xl border px-4">
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-3 w-2/3 rounded" />
            <div className="bg-muted h-3 w-1/3 rounded" />
          </div>
          <div className="bg-muted h-10 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  )
}
