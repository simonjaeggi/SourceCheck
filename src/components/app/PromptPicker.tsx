import { ScrollText } from "lucide-react"
import { PROMPTS } from "@/lib/prompts"
import { cn } from "@/lib/utils"

/** Which assessment prompt to use. Only picks from the prompts defined on the server; nothing is editable here. */
export function PromptPicker({ value, onChange, className, disabled }: { value: string; onChange: (id: string) => void; className?: string; disabled?: boolean }) {
  const current = PROMPTS.find((p) => p.id === value)
  return (
    <label
      className={cn("bg-background focus-within:ring-ring/50 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs shadow-xs focus-within:ring-[3px]", className)}
      title={current?.description}
    >
      <ScrollText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Prompt</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="min-w-0 flex-1 cursor-pointer truncate bg-transparent outline-none disabled:cursor-not-allowed">
        {PROMPTS.map((p) => (
          <option key={p.id} value={p.id}>
            Prompt {p.label}
          </option>
        ))}
      </select>
    </label>
  )
}
