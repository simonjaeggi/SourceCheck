import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react"
import { BookCheck, FileText, Loader2, ScanSearch, Sparkles, ListChecks, GitCompareArrows, SlidersHorizontal, Info, Search, X, ArrowRight } from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"
import NumberFlow from "@number-flow/react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { Kbd } from "@/components/ui/kbd"
import { BorderBeam } from "@/components/ui/border-beam"
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text"
import { Spotlight } from "@/components/ui/spotlight"
import { cn } from "@/lib/utils"
import { mockWorks, SAMPLE_CONTEXT, SAMPLE_REFERENCES } from "@/data/mockWorks"
import { scoreWork, type ScoredWork, type Signal } from "@/lib/scoring"
import { SourceList } from "@/components/app/SourceList"
import type { AdvancedViews } from "@/components/app/AdvancedView"
import { TrafficLight } from "@/components/app/TrafficLight"

// Heavy, below-the-fold UI (Recharts, cmdk, vaul) is code-split so the first paint only ships the source list.
const loadSheet = () => import("@/components/app/PaperDetailSheet")
const loadCompare = () => import("@/components/app/CompareView")
const loadAdvanced = () => import("@/components/app/AdvancedView")
const loadCommand = () => import("@/components/app/CommandMenu")
const PaperDetailSheet = lazy(() => loadSheet().then((m) => ({ default: m.PaperDetailSheet })))
const CompareView = lazy(() => loadCompare().then((m) => ({ default: m.CompareView })))
const AdvancedView = lazy(() => loadAdvanced().then((m) => ({ default: m.AdvancedView })))
const CommandMenu = lazy(() => loadCommand().then((m) => ({ default: m.CommandMenu })))

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
  const [cmdOpen, setCmdOpen] = useState(false)
  // Lazy overlays stay mounted after first use so their close animations still run.
  const [sheetUsed, setSheetUsed] = useState(false)
  const [cmdUsed, setCmdUsed] = useState(false)
  useEffect(() => { if (open) setSheetUsed(true) }, [open])
  useEffect(() => { if (cmdOpen) setCmdUsed(true) }, [cmdOpen])

  // Warm the split chunks once the page is idle, so later interactions feel instant.
  useEffect(() => {
    const prefetch = () => { loadSheet(); loadCompare(); loadAdvanced(); loadCommand() }
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(prefetch)
    else setTimeout(prefetch, 2000)
  }, [])

  const refCount = references.split("\n").filter((l) => l.trim()).length

  function analyze() {
    // Prototype: no parsing or API calls yet. Simulates latency and returns the mock set.
    setLoading(true)
    setResults(null)
    setSelected([])
    setTimeout(() => {
      const next = mockWorks.map((w) => scoreWork(w))
      setResults(next)
      setLoading(false)
      setTab("sources")
      const flagged = next.filter((r) => r.signal !== "green").length
      toast.success(`${next.length} sources checked`, {
        description: flagged ? `${flagged} need${flagged === 1 ? "s" : ""} a closer look.` : "All sources look trustworthy.",
      })
    }, 1100)
  }

  function loadExample() {
    setReferences(SAMPLE_REFERENCES)
    setContext(SAMPLE_CONTEXT)
    toast("Example input loaded")
  }

  function clearInput() {
    const prev = { references, context }
    if (!prev.references && !prev.context) return
    setReferences("")
    setContext("")
    toast("Input cleared", {
      action: { label: "Undo", onClick: () => { setReferences(prev.references); setContext(prev.context) } },
    })
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

  const toggle = (id: string) => {
    if (!selected.includes(id) && selected.length >= MAX_COMPARE) {
      toast.warning(`You can compare up to ${MAX_COMPARE} papers`, { description: "Deselect one to add another." })
      return
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_COMPARE ? [...s, id] : s))
  }

  // ⌘K / Ctrl+K opens the command menu
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      setCmdOpen((o) => !o)
    }
  }, [])
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onKey])

  // ⌘Enter / Ctrl+Enter inside a textarea runs the analysis
  const submitOnModEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !loading && refCount) {
      e.preventDefault()
      analyze()
    }
  }

  return (
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <div className="relative min-h-screen overflow-x-clip">
        {/* Decorative backdrop: Magic UI dot pattern + Aceternity spotlight */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
          {/* Dot grid (Magic UI DotPattern look) as a single CSS background instead of ~1,500 SVG nodes */}
          <div className="absolute inset-0 [background-image:radial-gradient(var(--color-neutral-300)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_100%_at_30%_0%,black_30%,transparent_75%)] opacity-70" />
          <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="var(--chart-1)" />
        </div>

        <header className="bg-card/70 sticky top-0 z-40 border-b backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
            <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg shadow-sm">
              <BookCheck className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="font-semibold tracking-tight">SourceCheck</p>
              <p className="text-muted-foreground hidden text-xs sm:block">Evaluate the references in your paper</p>
            </div>
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 ml-auto inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 text-sm whitespace-nowrap shadow-xs transition-colors outline-none focus-visible:ring-[3px] md:w-64"
            >
              <Search className="size-4" />
              <span className="hidden flex-1 truncate text-left whitespace-nowrap md:inline">Search sources & actions…</span>
              <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
            </button>
            <Badge variant="outline" className="hidden border-amber-300 bg-amber-50 text-amber-800 sm:inline-flex">
              Prototype with mock data
            </Badge>
          </div>
        </header>

        <main className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* ---------- INPUT ---------- */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <Card className="relative gap-4 overflow-hidden shadow-sm">
              {loading && <BorderBeam size={120} duration={4} colorFrom="var(--chart-1)" colorTo="var(--chart-2)" borderWidth={2} />}
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileText className="size-4" />Your input</CardTitle>
                <CardDescription>Paste your reference list and some context about your paper.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="refs">References</Label>
                    <span className="text-muted-foreground text-xs tabular-nums"><NumberFlow locales="en-US" value={refCount} /> detected</span>
                  </div>
                  <Textarea
                    id="refs"
                    value={references}
                    onChange={(e) => setReferences(e.target.value)}
                    onKeyDown={submitOnModEnter}
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
                    onKeyDown={submitOnModEnter}
                    placeholder="Paste your abstract so relevance can be judged…"
                    className="field-sizing-fixed h-36 resize-y text-sm"
                  />
                </div>
                <Button onClick={analyze} disabled={loading || !refCount} size="lg" className="group relative">
                  {loading ? <Loader2 className="animate-spin" /> : <ScanSearch className="transition-transform group-hover:scale-110" />}
                  {loading ? "Checking sources…" : "Analyze sources"}
                  {!loading && <Kbd className="bg-primary-foreground/15 text-primary-foreground/80 absolute right-3 hidden sm:inline-flex">⌘↵</Kbd>}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={loadExample}>
                    <Sparkles />Load example
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={clearInput}>
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
                    <AnimatePresence>
                      {selected.length > 0 && (
                        <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}>
                          <Badge className="h-4 min-w-4 rounded-full px-1 text-[10px] tabular-nums"><NumberFlow locales="en-US" value={selected.length} /></Badge>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </TabsTrigger>
                  <TabsTrigger value="advanced"><SlidersHorizontal />Advanced</TabsTrigger>
                </TabsList>
                <span className="text-muted-foreground ml-auto hidden items-center gap-1.5 text-xs lg:flex">
                  Press <Kbd>⌘K</Kbd> to jump to any source
                </span>
              </div>

              {loading && <LoadingState n={refCount} />}

              {!loading && results && (
                <>
                  <TabsContent value="sources" className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { label: "Sources checked", value: results.length },
                        { label: "Average score", value: avg, suffix: "/10", decimals: 1 },
                        { label: "Trustworthy", value: counts.green, signal: "green" as Signal },
                        { label: "Need attention", value: counts.amber + counts.red, signal: (counts.red ? "red" : "amber") as Signal },
                      ].map((st, i) => (
                        <motion.div
                          key={st.label}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, delay: i * 0.06, ease: "easeOut" }}
                        >
                          <Stat {...st} />
                        </motion.div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Show</span>
                      {(["all", "green", "amber", "red"] as const).map((f) => (
                        <Chip key={f} group="filter" active={filter === f} onClick={() => setFilter(f)}>
                          {f !== "all" && <span className={cn("size-2 rounded-full", f === "green" ? "bg-signal-green" : f === "amber" ? "bg-signal-amber" : "bg-signal-red")} />}
                          {f === "all" ? `All (${results.length})` : `${counts[f]}`}
                        </Chip>
                      ))}
                      <span className="text-muted-foreground ml-auto">Sort by</span>
                      {(["score", "year", "citations", "input"] as const).map((s) => (
                        <Chip key={s} group="sort" active={sort === s} onClick={() => setSort(s)}>
                          {s === "input" ? "Input order" : s[0].toUpperCase() + s.slice(1)}
                        </Chip>
                      ))}
                    </div>

                    <SourceList items={sorted} selected={selected} onToggle={toggle} onOpen={setOpen} maxCompare={MAX_COMPARE} />
                    <p className="text-muted-foreground text-xs">Click a source for details. Tick boxes to compare up to {MAX_COMPARE}.</p>

                    {/* Floating compare bar */}
                    <AnimatePresence>
                      {selected.length > 0 && (
                        <motion.div
                          initial={{ y: 24, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: 24, opacity: 0 }}
                          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                          className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-2 rounded-full border bg-neutral-900 py-1.5 pr-1.5 pl-4 text-sm text-white shadow-lg"
                        >
                          <span className="tabular-nums">
                            <NumberFlow locales="en-US" value={selected.length} /> of {MAX_COMPARE} selected
                          </span>
                          <Button size="sm" variant="ghost" className="h-7 rounded-full text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setSelected([])}>
                            <X />Clear
                          </Button>
                          <Button size="sm" className="h-7 rounded-full bg-white text-neutral-900 hover:bg-white/90" disabled={selected.length < 2} onClick={() => setTab("compare")}>
                            Compare<ArrowRight />
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </TabsContent>

                  <TabsContent value="compare">
                    <Suspense fallback={<ViewFallback />}>
                      <CompareView items={compareItems} onRemove={toggle} onClear={() => setSelected([])} />
                    </Suspense>
                  </TabsContent>

                  <TabsContent value="advanced">
                    <Suspense fallback={<ViewFallback />}>
                      <AdvancedView items={results} compareItems={compareItems} views={views} onChange={setViews} />
                    </Suspense>
                  </TabsContent>
                </>
              )}
            </Tabs>
          </section>
        </main>

        <Suspense fallback={null}>
          {sheetUsed && <PaperDetailSheet item={open} onOpenChange={(o) => !o && setOpen(null)} />}
          {cmdUsed && (
        <CommandMenu
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          results={results}
          loading={loading}
          canAnalyze={!!refCount}
          onOpenSource={setOpen}
          onAnalyze={analyze}
          onLoadExample={loadExample}
          onClear={clearInput}
          onTab={setTab}
          onFilter={setFilter}
          onClearSelection={() => setSelected([])}
          hasSelection={selected.length > 0}
        />
          )}
        </Suspense>
        <Toaster position="bottom-right" richColors={false} closeButton />
      </div>
    </TooltipProvider>
    </MotionConfig>
  )
}

function ViewFallback() {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
      <Loader2 className="size-4 animate-spin" /> Loading view…
    </div>
  )
}

function Stat({ label, value, suffix, signal, decimals = 0 }: { label: string; value: number; suffix?: string; signal?: Signal; decimals?: number }) {
  return (
    <Card className="hover:border-foreground/15 relative h-full gap-1 px-4 py-3 shadow-xs transition-[border-color,box-shadow] hover:shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="flex h-8 items-baseline text-2xl leading-8 font-semibold tabular-nums">
        <NumberFlow locales="en-US" value={value} format={{ minimumFractionDigits: decimals, maximumFractionDigits: decimals }} />
        {suffix && <span className="text-muted-foreground ml-0.5 text-sm font-normal">{suffix}</span>}
      </p>
      {/* Absolutely positioned so the light never changes the row height: label + number line up across all cards */}
      {signal && <TrafficLight signal={signal} className="absolute top-1/2 right-4 -translate-y-1/2 scale-75" />}
    </Card>
  )
}

function Chip({ active, onClick, children, group }: { active: boolean; onClick: () => void; children: React.ReactNode; group: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-ring/50 relative isolate inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px]",
        active ? "border-primary text-primary-foreground" : "bg-card hover:bg-muted"
      )}
    >
      {active && (
        <motion.span layoutId={`chip-${group}`} className="bg-primary absolute inset-0 -z-0 rounded-full" transition={{ type: "spring", bounce: 0.2, duration: 0.35 }} />
      )}
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
    </button>
  )
}

function LoadingState({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
        <AnimatedShinyText className="mx-0 max-w-none">Parsing {n} references, querying OpenAlex and Semantic Scholar…</AnimatedShinyText>
      </p>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-card flex h-20 animate-pulse items-center gap-3 rounded-xl border px-4" style={{ animationDelay: `${i * 120}ms` }}>
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
