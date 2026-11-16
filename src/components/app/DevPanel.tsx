import { useState } from "react"
import { Check, ChevronDown, Copy, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { AssessDebug } from "@/lib/assessment"

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Pretty-prints JSON when the text parses, otherwise shows it unchanged. */
function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px]"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) })}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
    </Button>
  )
}

function Block({ title, text, tone, defaultOpen = false }: { title: string; text: string; tone?: "bad"; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] font-medium [&[data-state=open]>svg]:rotate-180">
          <ChevronDown className="size-3 transition-transform" />
          {title}
          <span className="font-normal opacity-70">({text.length.toLocaleString("en-US")} chars)</span>
        </CollapsibleTrigger>
        <CopyText text={text} />
      </div>
      <CollapsibleContent>
        <pre
          className={cn(
            "mt-1 max-h-80 overflow-auto rounded-md p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words",
            tone === "bad" ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "bg-muted"
          )}
        >
          {text || "(empty)"}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Developer view of one assessment: the message sent, and for every attempt the raw
 * model output, reasoning, zod issues and the repair prompt. Only rendered when the
 * server sends debug data (development, or ASSESS_DEBUG=1).
 */
export function DevPanel({ debug }: { debug: AssessDebug }) {
  const models = [...new Set(debug.attempts.map((a) => a.model).filter(Boolean))]
  return (
    <Collapsible defaultOpen className="rounded-md border border-dashed">
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left text-xs font-semibold [&[data-state=open]>svg:last-child]:rotate-180">
          <Terminal className="size-3.5" />
          Dev panel: LLM responses
          <span className="text-muted-foreground font-normal">
            {debug.attempts.length} attempt{debug.attempts.length === 1 ? "" : "s"} · {secs(debug.total_ms)} · prompt {debug.prompt_version}
          </span>
          <ChevronDown className="ml-auto size-3.5 transition-transform" />
        </CollapsibleTrigger>
        <CopyText text={JSON.stringify(debug, null, 2)} label="Copy all" />
      </div>
      <CollapsibleContent className="flex flex-col gap-3 border-t px-3 py-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-muted-foreground">Requested</dt>
          <dd className="font-mono break-all">{debug.models_requested.join(" → ")}</dd>
          <dt className="text-muted-foreground">Answered by</dt>
          <dd className="font-mono break-all">{models.length ? models.join(", ") : "–"}</dd>
        </dl>

        {debug.error && <Block title="Call failed" text={debug.error} tone="bad" defaultOpen />}

        <Block title="User message sent (the <case>)" text={debug.user_message} />

        {debug.attempts.map((a) => (
          <div key={a.n} className="flex flex-col gap-1.5 rounded-md border px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <span className="font-semibold">Attempt {a.n}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-px font-medium",
                  a.valid ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                )}
              >
                {a.valid ? "valid" : a.refusal ? "refused" : "invalid"}
              </span>
              <span className="text-muted-foreground">finish: {a.finish_reason ?? "–"}</span>
              <span className="text-muted-foreground">{secs(a.duration_ms)}</span>
              {a.tokens && (
                <span className="text-muted-foreground">
                  tokens in {a.tokens.prompt ?? "?"} / out {a.tokens.completion ?? "?"}
                  {a.tokens.reasoning ? ` (reasoning ${a.tokens.reasoning})` : ""}
                </span>
              )}
              {a.model && <span className="text-muted-foreground font-mono">{a.model}</span>}
            </div>
            <Block title="Raw output" text={pretty(a.raw)} defaultOpen />
            {a.reasoning && <Block title="Reasoning" text={a.reasoning} />}
            {a.refusal && <Block title="Refusal" text={a.refusal} tone="bad" defaultOpen />}
            {a.issues && <Block title="Validation issues (zod)" text={a.issues} tone="bad" defaultOpen />}
            {a.repair_message && <Block title="Repair prompt sent back" text={a.repair_message} />}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
