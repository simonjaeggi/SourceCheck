import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileText, Loader2, ScanSearch, Sparkles, ListChecks, GitCompareArrows, SlidersHorizontal, Info, Search, X, ArrowRight } from "lucide-react"
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
import { SAMPLE_CONTEXT, SAMPLE_REFERENCES } from "@/data/example"
import type { OpenAlexWork } from "@/data/types"
import { contextProblem, requestAssessment, type AssessState } from "@/lib/assessClient"
import { scoreWork, type ScoredWork, type Signal } from "@/lib/scoring"
import { LOOKUP_ERROR_MESSAGES, LOOKUP_LIMITS, UNMATCHED_LABELS, type LookupResult, type Unmatched } from "@/lib/lookup"
import { SourceList } from "@/components/app/SourceList"
import type { AdvancedViews } from "@/components/app/AdvancedView"
import { TrafficLight } from "@/components/app/TrafficLight"
import { ThemePicker } from "@/components/app/ThemePicker"

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
  const [references, setReferences] = useState("")
  const [context, setContext] = useState("")
  const [loading, setLoading] = useState(false)
  /** null until the first successful lookup */
  const [works, setWorks] = useState<OpenAlexWork[] | null>(null)
  /** AI assessment per work id; a source without an entry has not been assessed */
  const [assess, setAssess] = useState<Record<string, AssessState>>({})
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  /** bumped on every new lookup, so late answers for the old list are dropped */
  const generation = useRef(0)
  const [unmatched, setUnmatched] = useState<Unmatched[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [tab, setTab] = useState("sources")
  const [sort, setSort] = useState<SortKey>("score")
  const [filter, setFilter] = useState<Signal | "all" | "pending">("all")
  const [views, setViews] = useState<AdvancedViews>({ timeline: true, apiFields: false })
  const [cmdOpen, setCmdOpen] = useState(false)
  // Lazy overlays stay mounted after first use so their close animations still run.
  const [sheetUsed, setSheetUsed] = useState(false)
  const [cmdUsed, setCmdUsed] = useState(false)
  useEffect(() => { if (openId) setSheetUsed(true) }, [openId])

  const results = useMemo(
    () => works?.map((w) => { const a = assess[w.id]; return scoreWork(w, a?.status === "done" ? a.assessment : null) }) ?? null,
    [works, assess]
  )
  const open = results?.find((r) => r.work.id === openId) ?? null
  const assessProblem = contextProblem(context)

  async function runAssess(id: string) {
    const work = works?.find((w) => w.id === id)
    if (!work || contextProblem(context) || assess[id]?.status === "loading") return
    const gen = generation.current
    setAssess((m) => ({ ...m, [id]: { status: "loading" } }))
    const result = await requestAssessment(work, context)
    if (gen === generation.current) setAssess((m) => ({ ...m, [id]: result }))
    return result
  }

  /** One after the other: free models are slow, and parallel calls would hit the rate limits. */
  async function assessAll() {
    const todo = (works ?? []).filter((w) => !assess[w.id] || assess[w.id].status === "error").map((w) => w.id)
    if (!todo.length || batch) return
    const gen = generation.current
    setBatch({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      if (gen !== generation.current) break
      const r = await runAssess(todo[i])
      setBatch({ done: i + 1, total: todo.length })
      if (r?.status === "error" && (r.code === "rate_limited" || r.code === "not_configured")) {
        toast.error("Stopped assessing", { description: r.message })
        break
      }
    }
    setBatch(null)
  }
  useEffect(() => { if (cmdOpen) setCmdUsed(true) }, [cmdOpen])

  // Warm the split chunks once the page is idle, so later interactions feel instant.
  useEffect(() => {
    const prefetch = () => { loadSheet(); loadCompare(); loadAdvanced(); loadCommand() }
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(prefetch)
    else setTimeout(prefetch, 2000)
  }, [])

  const refLines = references.split("\n").map((l) => l.trim()).filter(Boolean)
  const refCount = refLines.length

  async function analyze() {
    if (refCount > LOOKUP_LIMITS.references) {
      toast.error(`At most ${LOOKUP_LIMITS.references} references per check`, { description: `You pasted ${refCount}. Split the list and check it in parts.` })
      return
    }
    const tooLong = refLines.findIndex((l) => l.length > LOOKUP_LIMITS.reference)
    if (tooLong >= 0) {
      toast.error(`Reference ${tooLong + 1} is longer than ${LOOKUP_LIMITS.reference} characters`, { description: "Put one reference per line." })
      return
    }
    const previous = works
    setLoading(true)
    setWorks(null)
    setSelected([])
    let body: LookupResult | null = null
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ references: refLines }) })
      body = await res.json()
    } catch {
      body = null
    }
    setLoading(false)
    if (!body?.ok) {
      setWorks(previous)
      toast.error("The sources could not be checked", { description: body?.error.message ?? LOOKUP_ERROR_MESSAGES.upstream_error })
      return
    }
    generation.current++
    setAssess({})
    setBatch(null)
    setWorks(body.works)
    setUnmatched(body.unmatched)
    setTab("sources")
    const throttled = body.unmatched.filter((u) => u.reason === "openalex_rate_limited" || u.reason === "openalex_error").length
    const missing = body.unmatched.length - throttled
    const notify = throttled ? toast.warning : toast.success
    notify(`${body.works.length} of ${refCount} sources found in OpenAlex`, {
      description: [
        missing ? `${missing} not found.` : "",
        throttled ? `${throttled} could not be looked up because OpenAlex limited the requests; try again later.` : "",
        "Assess them with AI to get ratings.",
      ].filter(Boolean).join(" "),
    })
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
    const list = filter === "all" ? [...results] : filter === "pending" ? results.filter((r) => !r.signal) : results.filter((r) => r.signal === filter)
    // Not assessed sources go last when sorting by score.
    if (sort === "score") list.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
    if (sort === "year") list.sort((a, b) => b.work.publication_year - a.work.publication_year)
    if (sort === "citations") list.sort((a, b) => b.work.cited_by_count - a.work.cited_by_count)
    return list
  }, [results, sort, filter])

  const compareItems = useMemo(
    () => selected.map((id) => results?.find((r) => r.work.id === id)).filter(Boolean) as ScoredWork[],
    [selected, results]
  )

  const counts = useMemo(() => {
    const c = { green: 0, amber: 0, red: 0, pending: 0 }
    results?.forEach((r) => c[r.signal ?? "pending"]++)
    return c
  }, [results])
  const assessedCount = results ? results.length - counts.pending : 0

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
          <div className="absolute inset-0 [background-image:radial-gradient(var(--faint)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_100%_at_30%_0%,black_30%,transparent_75%)] opacity-70" />
          <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="var(--chart-1)" />
        </div>

        <header className="bg-card/70 sticky top-0 z-40 border-b backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
            <img src="https://design.jaeggisimon.ch/api/icons/icon.svg?letter=s&preset=indigo" alt="" className="size-8" />
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
            <ThemePicker />
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
              "Analyze sources" looks each reference up in OpenAlex (citations, retractions, venue, author h-index). Ratings come only from the AI assessment, which judges every source against the context above.
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

              {!loading && !results && <EmptyState onExample={loadExample} />}

              {!loading && results && (
                <>
                  <TabsContent value="sources" className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { label: "Sources found", value: results.length },
                        { label: "Assessed by AI", value: assessedCount, suffix: `/${results.length}` },
                        { label: "Suitable", value: counts.green, signal: "green" as Signal },
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

                    {results.length > 0 && (
                      <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xs">
                        <Sparkles className="text-muted-foreground size-4" />
                        <div className="min-w-0 flex-1">
                          {counts.pending === 0 ? (
                            <p>All sources are assessed.</p>
                          ) : (
                            <p>
                              {counts.pending} source{counts.pending === 1 ? "" : "s"} not assessed yet. Ratings appear once the AI has judged them against your thesis context.
                            </p>
                          )}
                          {assessProblem && <p className="text-muted-foreground text-xs">{assessProblem}</p>}
                        </div>
                        {counts.pending > 0 && (
                          <Button onClick={assessAll} disabled={!!batch || !!assessProblem}>
                            {batch ? <Loader2 className="animate-spin" /> : <Sparkles />}
                            {batch ? `Assessing ${Math.min(batch.done + 1, batch.total)} of ${batch.total}…` : `Assess all (${counts.pending})`}
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Show</span>
                      {(["all", "green", "amber", "red", "pending"] as const).map((f) => (
                        <Chip key={f} group="filter" active={filter === f} onClick={() => setFilter(f)}>
                          {f !== "all" && f !== "pending" && <span className={cn("size-2 rounded-full", f === "green" ? "bg-signal-green" : f === "amber" ? "bg-signal-amber" : "bg-signal-red")} />}
                          {f === "all" ? `All (${results.length})` : f === "pending" ? `Not assessed (${counts.pending})` : `${counts[f]}`}
                        </Chip>
                      ))}
                      <span className="text-muted-foreground ml-auto">Sort by</span>
                      {(["score", "year", "citations", "input"] as const).map((s) => (
                        <Chip key={s} group="sort" active={sort === s} onClick={() => setSort(s)}>
                          {s === "input" ? "Input order" : s[0].toUpperCase() + s.slice(1)}
                        </Chip>
                      ))}
                    </div>

                    <SourceList
                      items={sorted}
                      selected={selected}
                      onToggle={toggle}
                      onOpen={(it) => setOpenId(it.work.id)}
                      maxCompare={MAX_COMPARE}
                      assess={assess}
                      onAssess={runAssess}
                      assessProblem={assessProblem}
                    />
                    {unmatched.length > 0 && <UnmatchedList items={unmatched} />}
                    <p className="text-muted-foreground text-xs">Click a source for details. Tick boxes to compare up to {MAX_COMPARE}.</p>

                    {/* Floating compare bar */}
                    <AnimatePresence>
                      {selected.length > 0 && (
                        <motion.div
                          initial={{ y: 24, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: 24, opacity: 0 }}
                          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                          className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-2 rounded-full border bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-lg"
                        >
                          <span className="tabular-nums">
                            <NumberFlow locales="en-US" value={selected.length} /> of {MAX_COMPARE} selected
                          </span>
                          <Button size="sm" variant="ghost" className="h-7 rounded-full text-background/70 hover:bg-background/10 hover:text-background" onClick={() => setSelected([])}>
                            <X />Clear
                          </Button>
                          <Button size="sm" className="h-7 rounded-full bg-background text-foreground hover:bg-background/90" disabled={selected.length < 2} onClick={() => setTab("compare")}>
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
          {sheetUsed && (
            <PaperDetailSheet
              item={open}
              context={context}
              onOpenChange={(o) => !o && setOpenId(null)}
              assessState={openId ? assess[openId] : undefined}
              problem={assessProblem}
              onAssess={runAssess}
            />
          )}
          {cmdUsed && (
        <CommandMenu
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          results={results}
          loading={loading}
          canAnalyze={!!refCount}
          onOpenSource={(r) => setOpenId(r.work.id)}
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

function EmptyState({ onExample }: { onExample: () => void }) {
  return (
    <div className="bg-card flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <ScanSearch className="text-muted-foreground size-8" />
      <div>
        <p className="font-medium">No sources checked yet</p>
        <p className="text-muted-foreground mt-1 max-w-md text-sm">
          Paste your reference list and your thesis topic and research question on the left, then click "Analyze sources". Each reference is looked up in OpenAlex, and you can then have the AI assess it.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onExample}>
        <Sparkles />Load example
      </Button>
    </div>
  )
}

function UnmatchedList({ items }: { items: Unmatched[] }) {
  return (
    <Card className="gap-2 border-dashed px-4 py-3 shadow-none">
      <p className="text-sm font-medium">Not matched ({items.length})</p>
      <p className="text-muted-foreground text-xs">These references could not be matched to an OpenAlex record. Check them by hand; a source that no index knows is a warning sign in itself.</p>
      <ul className="flex flex-col gap-2 text-xs">
        {items.map((u, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span className="font-mono">{u.reference}</span>
            <span className="text-muted-foreground">{UNMATCHED_LABELS[u.reason]}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function LoadingState({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
        <AnimatedShinyText className="mx-0 max-w-none">Looking up {n} references in OpenAlex…</AnimatedShinyText>
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
