import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ScoredWork } from "@/lib/scoring"

const TONE = {
  good: "border-signal-green/40 bg-signal-green/10 text-emerald-800",
  warn: "border-signal-amber/60 bg-signal-amber/15 text-amber-800",
  bad: "border-signal-red/40 bg-signal-red/10 text-red-700",
  neutral: "",
}

export function FlagBadges({ flags, className }: { flags: ScoredWork["flags"]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {flags.map((f) => (
        <Badge key={f.label} variant="outline" className={TONE[f.tone]}>
          {f.label}
        </Badge>
      ))}
    </div>
  )
}
