import { useEffect, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { OpenAlexWork, SourceDetails } from "@/data/types"
import { openAlexFacts } from "@/lib/assessClient"
import { DETAIL_FIELDS, DetailsSchema, cleanDetails, guessTitle, type DetailKey } from "@/lib/details"
import type { LookupResult, Unmatched } from "@/lib/lookup"
import { cn } from "@/lib/utils"

/** What the dialog edits: a source OpenAlex did not find, or a found / manual source. */
export type DetailsTarget = { kind: "unmatched"; source: Unmatched } | { kind: "work"; work: OpenAlexWork }

const INPUT = "border-input placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
const DOI_RE = /\b10\.\d{4,9}\/\S+/

export function DetailsDialog({
  target, onClose, onSave, onRemove, onDoiFound,
}: {
  target: DetailsTarget | null
  onClose: () => void
  /** details for the target; null removes them */
  onSave: (target: DetailsTarget, details: SourceDetails) => void
  onRemove: (target: DetailsTarget) => void
  /** the DOI you entered was found in OpenAlex */
  onDoiFound: (source: Unmatched, work: OpenAlexWork) => void
}) {
  const [values, setValues] = useState<SourceDetails>({})
  const [error, setError] = useState<string | null>(null)
  const [doi, setDoi] = useState("")
  const [doiState, setDoiState] = useState<{ status: "idle" | "loading" | "error"; message?: string }>({ status: "idle" })

  const work = target?.kind === "work" ? target.work : null
  const manual = target?.kind === "unmatched" || work?._sourcecheck.origin === "manual"
  const existing = work?._sourcecheck.details
  /** for an OpenAlex record: its own values, shown as placeholders ("leave empty to keep") */
  const fromOpenAlex = work && !manual ? openAlexFacts(work) : null
  const reference = target?.kind === "unmatched" ? target.source.reference : work?._sourcecheck.raw_reference ?? ""

  useEffect(() => {
    if (!target) return
    setError(null)
    setDoi("")
    setDoiState({ status: "idle" })
    if (target.kind === "work") setValues({ ...(target.work._sourcecheck.details ?? {}) })
    else setValues({ title: guessTitle(target.source), ...(target.source.web?.url ? { link: target.source.web.url } : {}), ...(target.source.web?.year ? { year: String(target.source.web.year) } : {}), citations: "not indexed in OpenAlex" })
  }, [target])

  if (!target) return null
  const set = (k: DetailKey, v: string) => setValues((x) => ({ ...x, [k]: v }))

  function save() {
    const parsed = DetailsSchema.safeParse(values)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setError(`${DETAIL_FIELDS.find((f) => f.key === issue.path[0])?.label ?? "A field"}: ${issue.message}`)
      return
    }
    const clean = cleanDetails(parsed.data)
    if (manual && !clean?.title) return setError("Give the source a title.")
    if (!clean) return onRemove(target!)
    onSave(target!, clean)
  }

  async function lookUpDoi() {
    const found = doi.match(DOI_RE)?.[0]
    if (!found || target?.kind !== "unmatched") return setDoiState({ status: "error", message: "That does not look like a DOI (10.xxxx/…)." })
    setDoiState({ status: "loading" })
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ references: [`https://doi.org/${found}`] }) })
      const body: LookupResult = await res.json()
      if (body.ok && body.works[0]?._sourcecheck.match?.method === "doi") return onDoiFound(target.source, body.works[0])
      setDoiState({ status: "error", message: body.ok ? "OpenAlex has no record with this DOI. Enter the details below instead." : body.error.message })
    } catch {
      setDoiState({ status: "error", message: "OpenAlex could not be reached. Try again, or enter the details below." })
    }
  }

  const fields = DETAIL_FIELDS.filter((f) => manual || !f.manualOnly)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit details" : "Add details"}</DialogTitle>
          <DialogDescription className="font-mono text-[11px] leading-relaxed break-words">{reference}</DialogDescription>
        </DialogHeader>

        {target.kind === "unmatched" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="doi" className="text-xs font-medium">Has a DOI? Look it up in OpenAlex</label>
            <div className="flex gap-2">
              <input id="doi" value={doi} onChange={(e) => setDoi(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookUpDoi()} placeholder="10.xxxx/…" className={INPUT} />
              <Button size="sm" variant="outline" className="h-8" onClick={lookUpDoi} disabled={!doi.trim() || doiState.status === "loading"}>
                {doiState.status === "loading" ? <Loader2 className="animate-spin" /> : <Search />}Look up
              </Button>
            </div>
            {doiState.status === "error" && <p className="text-xs text-red-700 dark:text-red-300">{doiState.message}</p>}
            <div className="text-muted-foreground mt-2 flex items-center gap-3 text-xs">
              <span className="bg-border h-px flex-1" />or describe it yourself<span className="bg-border h-px flex-1" />
            </div>
          </div>
        )}

        <p className="text-muted-foreground -mt-1 text-xs">
          {manual
            ? "The AI gets exactly these facts, as on the expert form. Leave a field empty if it is unknown."
            : "Fill in only what should replace OpenAlex's value (shown in grey). How the source is used and the venue metric are not in OpenAlex."}
        </p>

        <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
          {fields.map((f) => {
            // OpenAlex's own value for found sources; otherwise an example, marked as one
            const placeholder = fromOpenAlex?.[f.key as keyof typeof fromOpenAlex] ?? (f.key === "abstract" ? "Optional" : `e.g. ${f.placeholder}`)
            const hint = f.key === "use" ? "Optional. Where and for which statement the thesis cites it; relevance is then judged for this use." : null
            return (
              <label key={f.key} className={cn("flex min-w-0 flex-col gap-1", f.wide && "sm:col-span-2")}>
                <span className="text-xs font-medium">{f.label}{f.key === "title" && manual ? " *" : ""}</span>
                {hint && <span className="text-muted-foreground -mt-0.5 text-[11px]">{hint}</span>}
                {f.multiline ? (
                  <Textarea value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={String(placeholder).slice(0, 200)} rows={3} className="field-sizing-fixed min-h-0 text-sm" />
                ) : (
                  <input value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={String(placeholder)} className={INPUT} />
                )}
              </label>
            )
          })}
        </div>
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          {existing ? (
            <Button variant="ghost" size="sm" className="text-red-700 dark:text-red-300" onClick={() => onRemove(target)}>
              {manual ? "Remove source details" : "Reset to OpenAlex"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
