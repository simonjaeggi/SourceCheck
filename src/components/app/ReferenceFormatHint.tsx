import { useEffect, useState } from "react"
import { Check, ChevronDown, Copy, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { CONVERT_PROMPT } from "@/lib/referenceInput"

/**
 * "Reference list not in the right format?": a prompt for any LLM that turns the list into
 * BibTeX, with the user's current input already filled in. Opens on its own when the
 * input has problems.
 */
export function ReferenceFormatHint({ emphasize, references }: { emphasize: boolean; references: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (emphasize) setOpen(true) }, [emphasize])

  const list = references.trim()
  const prompt = CONVERT_PROMPT + (list || "(paste your reference list here)")
  const copy = () =>
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-md text-xs", emphasize && "border border-amber-300 bg-amber-50 px-2.5 py-2 dark:border-amber-800 dark:bg-amber-950")}>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left [&[data-state=open]>svg:last-child]:rotate-180">
        <Info className="size-3.5 shrink-0" />
        <span className={cn(emphasize && "text-foreground font-medium")}>Reference list not in the right format?</span>
        <ChevronDown className="ml-auto size-3.5 transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <p className="text-muted-foreground leading-relaxed">
          {list
            ? "Copy the prompt below (your list is already in it), paste it into your LLM (ChatGPT, Claude, …), then paste the output here. It comes back as BibTeX, which SourceCheck reads reliably."
            : "Paste your list above first: it is added to the prompt below. Then copy the prompt into your LLM (ChatGPT, Claude, …) and paste the output here. It comes back as BibTeX, which SourceCheck reads reliably."}
        </p>
        <div className="bg-muted relative rounded-md">
          <pre className="max-h-40 overflow-auto p-2 pr-28 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{CONVERT_PROMPT}<span className={list ? undefined : "text-muted-foreground"}>{list || "(paste your reference list here)"}</span></pre>
          <Button size="sm" variant="ghost" className="bg-muted/90 absolute top-1 right-1 h-6 px-2 text-[11px]" onClick={copy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : list ? "Copy with list" : "Copy"}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
