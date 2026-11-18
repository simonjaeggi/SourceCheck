import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useState } from "react"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { METRICS, formatAuthors, type ScoredWork } from "@/lib/scoring"
import type { AssessState } from "@/lib/assessClient"
import { ScoreBadge, TrafficLight, signalLabel } from "./TrafficLight"
import { FlagBadges } from "./FlagBadges"
import { AiAssessment } from "./AiAssessment"

/**
 * Paper details: a Radix side sheet on desktop, a Vaul bottom drawer (swipe to dismiss) on small screens.
 */
export function PaperDetailSheet({
  item,
  context,
  onOpenChange,
  assessState,
  problem,
  onAssess,
}: {
  item: ScoredWork | null
  context: string
  onOpenChange: (o: boolean) => void
  assessState: AssessState | undefined
  problem: string | null
  onAssess: (id: string) => void
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)")

  if (!isDesktop) {
    return (
      <Drawer open={!!item} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh]">
          {item && (
            <div className="overflow-y-auto">
              <DetailHeader item={item} Title={DrawerTitle} Description={DrawerDescription} Wrapper={DrawerHeader} />
              <Detail key={item.work.id} item={item} context={context} state={assessState} problem={problem} onAssess={() => onAssess(item.work.id)} />
            </div>
          )}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <DetailHeader item={item} Title={SheetTitle} Description={SheetDescription} Wrapper={SheetHeader} />
            <Detail key={item.work.id} item={item} context={context} state={assessState} problem={problem} onAssess={() => onAssess(item.work.id)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

type Slot = React.ComponentType<{ className?: string; children?: React.ReactNode }>

function DetailHeader({ item, Title, Description, Wrapper }: { item: ScoredWork; Title: Slot; Description: Slot; Wrapper: Slot }) {
  const w = item.work
  return (
    <Wrapper className="pr-10 text-left">
      <div className="flex items-start gap-3">
        <TrafficLight signal={item.signal} className="mt-1" />
        <div className="min-w-0 flex-1">
          <Title className="text-lg leading-snug">{w.display_name}</Title>
          <Description className="mt-1">
            {formatAuthors(w, 5)} ({w.publication_year})
          </Description>
          <p className="text-muted-foreground mt-0.5 text-sm italic">{w.primary_location.source?.display_name ?? "Unknown venue"}</p>
        </div>
      </div>
    </Wrapper>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
            toast.success(`${label} copied to clipboard`)
            setTimeout(() => setCopied(false), 1500)
          },
          () => toast.error("Could not access the clipboard")
        )
      }}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  )
}

const SIGNAL_LABEL: Record<string, string> = { author: "an author", year: "the year", venue: "the venue" }
function signalText(signals: string[] = []) {
  const parts = signals.map((x) => SIGNAL_LABEL[x] ?? x)
  return parts.length ? (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]) : "other details"
}

function MatchNote({ item }: { item: ScoredWork }) {
  const w = item.work
  const m = w._sourcecheck.match!
  const authors = w._sourcecheck.author_details ?? []
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className={m.confidence === "uncertain" ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" : "text-muted-foreground text-xs"}>
        {m.method === "doi"
          ? "Found in OpenAlex by the DOI in your reference."
          : m.confidence === "likely"
            ? `Found in OpenAlex by title search; the title and ${signalText(m.signals)} match your reference.`
            : m.confidence === "confirmed"
              ? `Found by title search and confirmed by you${m.signals?.length ? `; ${signalText(m.signals)} also match` : ""}.`
              : "Found by title search, but the match is uncertain. Check that this is the paper you cite."}
      </p>
      {authors.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {authors.map((a, i) => (
            <span key={i}>
              {i > 0 && "; "}
              <span className="text-foreground">{a.name}</span>
              {a.institution && `, ${a.institution}`}
              {a.h_index != null && ` (h-index ${a.h_index})`}
            </span>
          ))}
        </p>
      )}
      {w._sourcecheck.abstract && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2 h-7">
              Abstract <ChevronDown />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="bg-muted/60 rounded-md px-3 py-2 text-xs leading-relaxed">{w._sourcecheck.abstract}</p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

type AssessProps = { state: AssessState | undefined; problem: string | null; onAssess: () => void }

function Detail({ item, context, state, problem, onAssess }: { item: ScoredWork; context: string } & AssessProps) {
  const w = item.work
  const timeline = [...w.counts_by_year].sort((a, b) => a.year - b.year)
  return (
    <>

      <div className="flex flex-col gap-5 px-4 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          {item.overall != null && item.signal && (
            <>
              <ScoreBadge score={item.overall} signal={item.signal} size="lg" />
              <span className="text-sm font-medium">{signalLabel(item.signal)}</span>
            </>
          )}
          <FlagBadges flags={item.flags} />
        </div>

        {w._sourcecheck.match && <MatchNote item={item} />}

        <AiAssessment item={item} state={state} context={context} problem={problem} onAssess={onAssess} />

        {!item.assessment && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">What the AI will get <span className="text-muted-foreground font-normal">(per criterion)</span></h3>
            <Table>
              <TableBody>
                {METRICS.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell className="align-top font-medium whitespace-normal">{m.label}</TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-normal">
                      {item.facts[m.key]}
                      <div className="text-[10px] opacity-70">{m.fact}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Citations per year</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={timeline} margin={{ left: -16, right: 4 }}>
              <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--hover)" }} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }} />
              <Bar dataKey="cited_by_count" name="Citations" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <Separator />

        <div className="flex flex-wrap gap-2">
          <CopyButton text={w._sourcecheck.raw_reference} label="Copy reference" />
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
              Raw OpenAlex record <ChevronDown />
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
