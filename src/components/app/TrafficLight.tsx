import NumberFlow from "@number-flow/react"
import { cn } from "@/lib/utils"
import type { Signal } from "@/lib/scoring"

const LABEL: Record<Signal, string> = { green: "Trustworthy", amber: "Use with care", red: "Problematic" }

export function TrafficLight({ signal, className }: { signal: Signal; className?: string }) {
  const on = (s: Signal) => signal === s
  return (
    <div
      className={cn("flex flex-col items-center gap-[3px] rounded-full bg-neutral-800 px-[5px] py-[6px] shadow-inner", className)}
      aria-label={LABEL[signal]}
      title={LABEL[signal]}
    >
      <span className={cn("size-2.5 rounded-full transition", on("red") ? "bg-signal-red shadow-[0_0_6px_var(--signal-red)]" : "bg-neutral-600")} />
      <span className={cn("size-2.5 rounded-full transition", on("amber") ? "bg-signal-amber shadow-[0_0_6px_var(--signal-amber)]" : "bg-neutral-600")} />
      <span className={cn("size-2.5 rounded-full transition", on("green") ? "bg-signal-green shadow-[0_0_6px_var(--signal-green)]" : "bg-neutral-600")} />
    </div>
  )
}

export function signalLabel(s: Signal) {
  return LABEL[s]
}

export function ScoreBadge({ score, signal, size = "md" }: { score: number; signal: Signal; size?: "md" | "lg" }) {
  const ring = signal === "green" ? "ring-signal-green/50" : signal === "amber" ? "ring-signal-amber/60" : "ring-signal-red/50"
  return (
    <div className={cn("flex items-baseline justify-center rounded-lg bg-card shadow-xs ring-2 tabular-nums", ring, size === "lg" ? "px-3 py-1.5" : "w-16 px-2 py-1")}>
      <NumberFlow
        locales="en-US"
        value={score}
        format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
        className={cn("font-semibold", size === "lg" ? "text-2xl" : "text-lg")}
      />
      <span className="text-muted-foreground ml-0.5 text-xs">/10</span>
    </div>
  )
}
