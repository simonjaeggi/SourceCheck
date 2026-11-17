import { Monitor, Moon, Palette, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { paletteName, useTheme, type Mode } from "@/lib/theme"

const MODES: { mode: Mode; label: string; Icon: typeof Sun }[] = [
  { mode: "system", label: "System", Icon: Monitor },
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
]

/** Palette (from design.jaeggisimon.ch) and light/dark mode, remembered in this browser. */
export function ThemePicker() {
  const { theme, palettes, update } = useTheme()
  const i = MODES.findIndex((m) => m.mode === theme.mode)
  const current = MODES[i < 0 ? 0 : i]
  const next = MODES[(Math.max(i, 0) + 1) % MODES.length]

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* A transparent select over the chip, so it opens the native list on every screen size. */}
      <label className="bg-background/80 text-muted-foreground hover:text-foreground focus-within:ring-ring/50 relative inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm shadow-xs focus-within:ring-[3px]">
        <Palette className="size-4" />
        <span className="hidden sm:inline">{paletteName(theme.palette)}</span>
        <select
          value={theme.palette}
          onChange={(e) => update({ palette: e.target.value })}
          aria-label="Colour palette"
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {(palettes.includes(theme.palette) ? palettes : [theme.palette, ...palettes]).map((id) => (
            <option key={id} value={id}>
              {paletteName(id)}
            </option>
          ))}
        </select>
      </label>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" onClick={() => update({ mode: next.mode })} aria-label={`Mode: ${current.label}. Switch to ${next.label}`}>
            <current.Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {current.label} mode · click for {next.label.toLowerCase()}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
