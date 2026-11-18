import { Cpu } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ModelOption } from "@/lib/assessClient"

/** "" = the server's default list (first model, falling back to the next). */
export const DEFAULT_MODEL = ""

export function modelLabel(id: string, models: ModelOption[], defaults: string[]) {
  if (!id) return `Default (${defaults.map((d) => models.find((m) => m.id === d)?.name ?? d).join(" → ") || "server setting"})`
  return models.find((m) => m.id === id)?.name ?? id
}

/** Native select of the free models with structured outputs. */
export function ModelPicker({
  value, onChange, models, defaults, allowDefault = true, className, disabled,
}: {
  value: string
  onChange: (id: string) => void
  models: ModelOption[]
  defaults: string[]
  allowDefault?: boolean
  className?: string
  disabled?: boolean
}) {
  const known = models.some((m) => m.id === value)
  return (
    <label className={cn("bg-background focus-within:ring-ring/50 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs shadow-xs focus-within:ring-[3px]", className)}>
      <Cpu className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Model</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="min-w-0 flex-1 cursor-pointer truncate bg-transparent outline-none disabled:cursor-not-allowed">
        {allowDefault && <option value={DEFAULT_MODEL}>{modelLabel(DEFAULT_MODEL, models, defaults)}</option>}
        {value && !known && <option value={value}>{value}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.router ? " — picks a random free model per call" : ""}
          </option>
        ))}
      </select>
    </label>
  )
}
