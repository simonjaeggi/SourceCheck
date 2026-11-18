import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Globe, PencilLine, Upload, FileText, Loader2, ScanSearch, Sparkles, ListChecks, GitCompareArrows, SlidersHorizontal, Info, Search, X, ArrowRight } from "lucide-react"
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
import { EXAMPLES, type Example } from "@/data/example"
import type { OpenAlexWork } from "@/data/types"
import { contextProblem, fetchModels, requestAssessment, type AssessState, type ModelOption } from "@/lib/assessClient"
import { useTestRuns } from "@/lib/useTestRuns"
import { ModelPicker } from "@/components/app/ModelPicker"
import { PromptPicker } from "@/components/app/PromptPicker"
import { DEFAULT_PROMPT, PROMPTS } from "@/lib/prompts"
import { DetailsDialog, type DetailsTarget } from "@/components/app/DetailsDialog"
import { manualWork, toUnmatched } from "@/lib/details"
import type { SourceDetails } from "@/data/types"
import { looksLikeBib, prepareInput, type InputMode } from "@/lib/referenceInput"
import { ReferenceFormatHint } from "@/components/app/ReferenceFormatHint"
import { scoreWork, type ScoredWork, type Signal } from "@/lib/scoring"
import { LOOKUP_ERROR_MESSAGES, LOOKUP_LIMITS, UNMATCHED_LABELS, type LookupResult, type Unmatched } from "@/lib/lookup"
import { SourceList, type Row } from "@/components/app/SourceList"
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
  const [inputMode, setInputMode] = useState<InputMode>("text")
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
  /** web sources are listed (not assessed); this hides them */
  const [showWeb, setShowWeb] = useState(true)
  const [views, setViews] = useState<AdvancedViews>({ exports: true, testRuns: true, timeline: false, apiFields: false })
  /** "" = the server's default models; otherwise one free model, remembered in this browser */
  const [model, setModelState] = useState<string>(() => { try { return localStorage.getItem("sourcecheck-model") ?? "" } catch { return "" } })
  const setModel = (id: string) => { setModelState(id); try { localStorage.setItem("sourcecheck-model", id) } catch { /* private mode */ } }
  /** prompt id, remembered in this browser; unknown ids (a removed prompt) fall back to the default */
  const [prompt, setPromptState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("sourcecheck-prompt")
      return saved && PROMPTS.some((p) => p.id === saved) ? saved : DEFAULT_PROMPT
    } catch {
      return DEFAULT_PROMPT
    }
  })
  const setPrompt = (id: string) => { setPromptState(id); try { localStorage.setItem("sourcecheck-prompt", id) } catch { /* private mode */ } }
  const [modelList, setModelList] = useState<{ models: ModelOption[]; default: string[] }>({ models: [], default: [] })
  useEffect(() => { fetchModels().then((m) => m && setModelList(m)) }, [])
  const testRuns = useTestRuns()
  /** the source whose "Add details" dialog is open */
  const [detailsTarget, setDetailsTarget] = useState<DetailsTarget | null>(null)
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
    const result = await requestAssessment(work, context, model || undefined, prompt)
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

  const prepared = useMemo(() => prepareInput(references, inputMode), [references, inputMode])
  // BibTeX is turned into reference lines here, so long entries are cut to the lookup limit.
  const refLines = inputMode === "bib" ? prepared.lines.map((l) => l.slice(0, LOOKUP_LIMITS.reference)) : prepared.lines
  const refCount = refLines.length
  const bibErrors = prepared.errors.filter((e) => !e.warning)
  const formatProblem = bibErrors.length > 0 || prepared.suspicious.length > 0

  /** Typing or pasting BibTeX into the text field switches to BibTeX once. */
  function onReferencesChange(text: string) {
    setReferences(text)
    if (inputMode === "text" && looksLikeBib(text)) {
      setInputMode("bib")
      toast("Switched to BibTeX", { description: "Your input starts with an @entry, so it is read as BibTeX." })
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > 1_000_000) {
      toast.error("That file is too large", { description: "Upload a .bib or .txt file under 1 MB." })
      return
    }
    const text = await file.text()
    setReferences(text)
    setInputMode(/\.(bib|bibtex)$/i.test(file.name) || looksLikeBib(text) ? "bib" : "text")
    toast(`Loaded ${file.name}`)
  }

  async function analyze() {
    if (bibErrors.length) {
      toast.error("Fix the BibTeX errors first", { description: `${bibErrors.length} problem${bibErrors.length === 1 ? "" : "s"}, listed under the references.` })
      return
    }
    if (refCount > LOOKUP_LIMITS.references) {
      toast.error(`At most ${LOOKUP_LIMITS.references} references per check`, { description: `You pasted ${refCount}. Split the list and check it in parts.` })
      return
    }
    const tooLong = refLines.findIndex((l) => l.length > LOOKUP_LIMITS.reference)
    if (tooLong >= 0) {
      toast.error(`Reference ${tooLong + 1} is longer than ${LOOKUP_LIMITS.reference} characters`, { description: "Put one reference per line, or use BibTeX." })
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
    const count = (r: Unmatched["reason"]) => body.unmatched.filter((u) => u.reason === r).length
    const throttled = count("openalex_rate_limited") + count("openalex_error")
    const web = count("web_source")
    const possible = count("possible_match")
    const missing = body.unmatched.length - throttled - web - possible
    const notify = throttled ? toast.warning : toast.success
    notify(`${body.works.length} of ${refCount} sources found in OpenAlex`, {
      description: [
        web ? `${web} web source${web === 1 ? "" : "s"} listed, not assessed.` : "",
        possible ? `${possible} possible match${possible === 1 ? "" : "es"} to check.` : "",
        missing ? `${missing} not found.` : "",
        throttled ? `${throttled} could not be looked up because OpenAlex limited the requests; try again later.` : "",
        "Assess them with AI to get ratings.",
      ].filter(Boolean).join(" "),
    })
  }

  /** The user accepts a possible match: it joins the sources, marked as confirmed. */
  function confirmMatch(u: Unmatched) {
    const c = u.candidate
    if (!c) return
    const work: OpenAlexWork = { ...c, _sourcecheck: { ...c._sourcecheck, input_index: u.index, match: { ...c._sourcecheck.match!, confidence: "confirmed" } } }
    setWorks((ws) => (ws?.some((w) => w.id === work.id) ? ws : [...(ws ?? []), work]))
    setUnmatched((us) => us.filter((x) => x !== u))
    toast.success("Match confirmed", { description: work.display_name })
  }

  /** Changed facts make an earlier assessment stale: drop it, so the source is assessed again. */
  function forgetAssessment(id: string) {
    setAssess((m) => {
      if (!(id in m)) return m
      const { [id]: _, ...rest } = m
      return rest
    })
  }

  function saveDetails(target: DetailsTarget, details: SourceDetails) {
    if (target.kind === "unmatched") {
      const work = manualWork(target.source, details)
      setWorks((ws) => [...(ws ?? []).filter((w) => w.id !== work.id), work])
      setUnmatched((us) => us.filter((u) => u.index !== target.source.index))
      toast.success("Source added", { description: "It is in the list now and can be assessed." })
    } else {
      const w = target.work
      const next = w._sourcecheck.origin === "manual" ? manualWork(toUnmatched(w), details) : { ...w, _sourcecheck: { ...w._sourcecheck, details } }
      setWorks((ws) => ws?.map((x) => (x.id === w.id ? next : x)) ?? ws)
      if (assess[w.id]) toast("Details saved", { description: "The earlier assessment was cleared, because the AI now gets different facts." })
      else toast.success("Details saved")
      forgetAssessment(w.id)
    }
    setDetailsTarget(null)
  }

  function removeDetails(target: DetailsTarget) {
    if (target.kind === "work") {
      const w = target.work
      if (w._sourcecheck.origin === "manual") {
        setWorks((ws) => ws?.filter((x) => x.id !== w.id) ?? ws)
        setUnmatched((us) => [...us, toUnmatched(w)].sort((a, b) => a.index - b.index))
        setSelected((s) => s.filter((id) => id !== w.id))
        if (openId === w.id) setOpenId(null)
      } else {
        const { details: _, ...rest } = w._sourcecheck
        setWorks((ws) => ws?.map((x) => (x.id === w.id ? { ...w, _sourcecheck: rest } : x)) ?? ws)
      }
      forgetAssessment(w.id)
      toast("Details removed")
    }
    setDetailsTarget(null)
  }

  /** A DOI entered for an unmatched reference was found in OpenAlex. */
  function addFromDoi(u: Unmatched, found: OpenAlexWork) {
    const work: OpenAlexWork = { ...found, _sourcecheck: { ...found._sourcecheck, raw_reference: u.reference, input_index: u.index, match: { method: "doi", confidence: "confirmed" } } }
    const duplicate = works?.some((w) => w.id === work.id)
    if (!duplicate) setWorks((ws) => [...(ws ?? []), work])
    setUnmatched((us) => us.filter((x) => x.index !== u.index))
    setDetailsTarget(null)
    if (duplicate) toast("Already in the list", { description: `Another reference already points to ${work.display_name}.` })
    else toast.success("Found in OpenAlex", { description: work.display_name })
  }

  function loadExample(ex: Example = EXAMPLES[0]) {
    setReferences(ex.references)
    setInputMode("text")
    setContext(ex.context)
    toast(`${ex.label} loaded`, { description: ex.description })
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
    if (sort === "input") list.sort((a, b) => (a.work._sourcecheck.input_index ?? 1e9) - (b.work._sourcecheck.input_index ?? 1e9))
    return list
  }, [results, sort, filter])

  const webSources = useMemo(() => unmatched.filter((u) => u.reason === "web_source"), [unmatched])
  const otherUnmatched = useMemo(() => unmatched.filter((u) => u.reason !== "web_source"), [unmatched])

  /** Works plus web sources: in "Input order" they sit where they were pasted, otherwise after the works. */
  const rows = useMemo<Row[]>(() => {
    const workRows: Row[] = sorted.map((item) => ({ kind: "work", item }))
    if (!showWeb || filter !== "all" || !webSources.length) return workRows
    const webRows: Row[] = webSources.map((source) => ({ kind: "web", source }))
    if (sort !== "input") return [...workRows, ...webRows]
    const pos = (r: Row) => (r.kind === "web" ? r.source.index : r.item.work._sourcecheck.input_index ?? 1e9)
    return [...workRows, ...webRows].sort((a, b) => pos(a) - pos(b))
  }, [sorted, webSources, showWeb, filter, sort])

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
                  <div className="flex items-center gap-2">
                    <Label htmlFor="refs">References</Label>
                    <div role="radiogroup" aria-label="Reference format" className="bg-muted inline-flex rounded-md p-0.5 text-xs">
                      {(["text", "bib"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={inputMode === m}
                          onClick={() => setInputMode(m)}
                          className={cn("rounded px-2 py-0.5 font-medium transition-colors", inputMode === m ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
                        >
                          {m === "text" ? "Text" : "BibTeX"}
                        </button>
                      ))}
                    </div>
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums"><NumberFlow locales="en-US" value={refCount} /> {inputMode === "bib" ? (refCount === 1 ? "entry" : "entries") : "detected"}</span>
                  </div>
                  <Textarea
                    id="refs"
                    value={references}
                    onChange={(e) => onReferencesChange(e.target.value)}
                    onKeyDown={submitOnModEnter}
                    placeholder={inputMode === "bib" ? "Paste your .bib file (BibTeX or BibLaTeX): @article{key, author = {…}, title = {…}, …}" : "Paste your bibliography (APA, IEEE, …), one reference per line…"}
                    aria-invalid={bibErrors.length > 0}
                    className="field-sizing-fixed h-56 resize-y font-mono text-xs leading-relaxed"
                  />
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                      <label className="cursor-pointer">
                        <Upload />Upload .bib or .txt
                        <input type="file" accept=".bib,.bibtex,.txt,text/plain,application/x-bibtex" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = "" }} />
                      </label>
                    </Button>
                  </div>
                  {prepared.errors.length > 0 && (
                    <ul role="alert" className="flex max-h-40 flex-col gap-0.5 overflow-auto rounded-md border border-red-300 bg-red-50 px-2.5 py-2 font-mono text-[11px] text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                      {prepared.errors.slice(0, 8).map((e, i) => (
                        <li key={i} className={e.warning ? "opacity-70" : undefined}>
                          {e.warning ? "Warning, line" : "Line"} {e.line}: {e.message}
                        </li>
                      ))}
                      {prepared.errors.length > 8 && <li>…and {prepared.errors.length - 8} more</li>}
                    </ul>
                  )}
                  {prepared.suspicious.length > 0 && (
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      {prepared.suspicious.length === 1 ? "Line" : "Lines"} {prepared.suspicious.slice(0, 6).join(", ")}
                      {prepared.suspicious.length > 6 ? "…" : ""} {prepared.suspicious.length === 1 ? "does" : "do"} not look like a whole reference. Each reference must be on one line.
                    </p>
                  )}
                  <ReferenceFormatHint emphasize={formatProblem} references={references} />
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
                <Button onClick={analyze} disabled={loading || !refCount || bibErrors.length > 0} size="lg" className="group relative">
                  {loading ? <Loader2 className="animate-spin" /> : <ScanSearch className="transition-transform group-hover:scale-110" />}
                  {loading ? "Checking sources…" : "Analyze sources"}
                  {!loading && <Kbd className="bg-primary-foreground/15 text-primary-foreground/80 absolute right-3 hidden sm:inline-flex">⌘↵</Kbd>}
                </Button>
                <div className="flex gap-2">
                  <ExamplePicker onPick={loadExample} className="flex-1" />
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
                        { label: "Sources found", value: results.length, suffix: webSources.length ? ` +${webSources.length} web` : undefined },
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
                        {/* own row under the text, so the explanation keeps its width */}
                        <div className="order-last flex w-full flex-wrap items-center gap-2 pl-7">
                          <span className="text-muted-foreground text-xs">Assess with</span>
                          <ModelPicker value={model} onChange={setModel} models={modelList.models} defaults={modelList.default} disabled={!!batch} className="max-w-64" />
                          <PromptPicker value={prompt} onChange={setPrompt} disabled={!!batch} className="max-w-52" />
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
                      {webSources.length > 0 && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={showWeb}
                          onClick={() => setShowWeb((v) => !v)}
                          disabled={filter !== "all"}
                          title={filter !== "all" ? "Web sources are not assessed, so they only show under All" : showWeb ? "Hide web sources" : "Show web sources"}
                          className={cn(
                            "focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50",
                            showWeb && filter === "all" ? "border-primary text-primary bg-primary/10" : "bg-card text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <Globe className="size-3.5" />
                          Web sources ({webSources.length})
                        </button>
                      )}
                      <span className="text-muted-foreground ml-auto">Sort by</span>
                      {(["score", "year", "citations", "input"] as const).map((s) => (
                        <Chip key={s} group="sort" active={sort === s} onClick={() => setSort(s)}>
                          {s === "input" ? "Input order" : s[0].toUpperCase() + s.slice(1)}
                        </Chip>
                      ))}
                    </div>

                    <SourceList
                      rows={rows}
                      selected={selected}
                      onToggle={toggle}
                      onOpen={(it) => setOpenId(it.work.id)}
                      maxCompare={MAX_COMPARE}
                      assess={assess}
                      onAssess={runAssess}
                      assessProblem={assessProblem}
                      onAddDetails={(source) => setDetailsTarget({ kind: "unmatched", source })}
                    />
                    {otherUnmatched.length > 0 && <UnmatchedList items={otherUnmatched} onConfirm={confirmMatch} onAddDetails={(source) => setDetailsTarget({ kind: "unmatched", source })} />}
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
                      <AdvancedView
                        items={results}
                        compareItems={compareItems}
                        views={views}
                        onChange={setViews}
                        research={{
                          works: works ?? [],
                          selectedWorks: compareItems.map((c) => c.work),
                          assess,
                          context,
                          contextProblem: assessProblem,
                          web: webSources,
                          models: modelList.models,
                          defaults: modelList.default,
                          model,
                          prompt,
                          runner: testRuns,
                        }}
                      />
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
              onEditDetails={(it) => setDetailsTarget({ kind: "work", work: it.work })}
            />
          )}
          <DetailsDialog target={detailsTarget} onClose={() => setDetailsTarget(null)} onSave={saveDetails} onRemove={removeDetails} onDoiFound={addFromDoi} />
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
          examples={EXAMPLES}
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

function EmptyState({ onExample }: { onExample: (ex: Example) => void }) {
  return (
    <div className="bg-card flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <ScanSearch className="text-muted-foreground size-8" />
      <div>
        <p className="font-medium">No sources checked yet</p>
        <p className="text-muted-foreground mt-1 max-w-md text-sm">
          Paste your reference list and your thesis topic and research question on the left, then click "Analyze sources". Each reference is looked up in OpenAlex, and you can then have the AI assess it.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <Button key={ex.id} variant="outline" size="sm" onClick={() => onExample(ex)} title={ex.description}>
            <Sparkles />{ex.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** "Load example" as a native select: the gold-standard theses and the demo list. */
function ExamplePicker({ onPick, className }: { onPick: (ex: Example) => void; className?: string }) {
  return (
    <label className={cn("bg-background hover:bg-muted focus-within:ring-ring/50 relative inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium shadow-xs focus-within:ring-[3px]", className)}>
      <Sparkles className="size-4" />
      Load example
      <select
        aria-label="Load example"
        value=""
        onChange={(e) => {
          const ex = EXAMPLES.find((x) => x.id === e.target.value)
          if (ex) onPick(ex)
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>Load example…</option>
        {EXAMPLES.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.label} ({ex.description})
          </option>
        ))}
      </select>
    </label>
  )
}

const UNMATCHED_GROUPS: { title: string; note: string; reasons: Unmatched["reason"][] }[] = [
  {
    title: "Possible matches",
    note: "OpenAlex has a record with a similar title, but too little else agrees to use it automatically. Confirm it only if it is the work you cite.",
    reasons: ["possible_match"],
  },
  {
    title: "Not found",
    note: "No reliable OpenAlex record. Check these by hand; a scholarly source that no index knows is a warning sign in itself. Add details (or a DOI) to assess one.",
    reasons: ["not_found", "no_confident_match", "openalex_rate_limited", "openalex_error"],
  },
]

function UnmatchedList({ items, onConfirm, onAddDetails }: { items: Unmatched[]; onConfirm: (u: Unmatched) => void; onAddDetails: (u: Unmatched) => void }) {
  return (
    <Card className="gap-4 border-dashed px-4 py-3 shadow-none">
      {UNMATCHED_GROUPS.map((g) => {
        const group = items.filter((u) => g.reasons.includes(u.reason))
        if (!group.length) return null
        return (
          <section key={g.title} className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium">
                {g.title} ({group.length})
              </p>
              <p className="text-muted-foreground text-xs">{g.note}</p>
            </div>
            <ul className="flex flex-col gap-2 text-xs">
              {group.map((u, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-mono break-words">{u.reference}</span>
                    <Button size="sm" variant="ghost" className="-mt-1 h-7 shrink-0 text-xs" onClick={() => onAddDetails(u)} title="Enter its details (or a DOI) so it can be assessed">
                      <PencilLine />Add details
                    </Button>
                  </div>
                  {u.candidate ? (
                    <div className="bg-muted flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{u.candidate.display_name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {u.candidate.publication_year}
                          {u.candidate.primary_location.source ? ` · ${u.candidate.primary_location.source.display_name}` : ""}
                          {u.candidate.authorships.length ? ` · ${u.candidate.authorships.slice(0, 2).map((a) => a.author.display_name).join(", ")}${u.candidate.authorships.length > 2 ? " et al." : ""}` : ""}
                        </span>
                      </span>
                      <span className="flex gap-1">
                        {(u.candidate.doi ?? u.candidate.id) && (
                          <Button asChild size="sm" variant="ghost" className="h-7">
                            <a href={u.candidate.doi ?? u.candidate.id} target="_blank" rel="noreferrer">Open</a>
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7" onClick={() => onConfirm(u)}>
                          Use this match
                        </Button>
                      </span>
                    </div>
                  ) : (
                    g.reasons.length > 1 && <span className="text-muted-foreground">{UNMATCHED_LABELS[u.reason]}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
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
