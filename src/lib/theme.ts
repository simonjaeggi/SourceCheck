/**
 * Colours come from the shared palettes at design.jaeggisimon.ch (/api/palettes.css,
 * loaded in index.html). A palette applies through data-palette and data-mode on <html>;
 * the boot script in index.html sets both before first paint. This module lets the UI
 * read and change the choice, stored per browser under the same key the design site uses.
 * The list of palettes is whatever the stylesheet contains.
 */
import { useEffect, useState } from "react"

export type Mode = "system" | "light" | "dark"
export interface Theme {
  mode: Mode
  palette: string
}

declare global {
  interface Window {
    __getTheme?: () => Theme
    __setTheme?: (next: Partial<Theme>) => void
    __palettes?: string[]
  }
}

/** Title-cased palette id ("rose-pine" → "Rose Pine"). */
export const paletteName = (id: string) => id.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? " " : "") + c.toUpperCase())

/** The palette ids the boot script in index.html read from the imported stylesheet. */
const palettesInSheet = (): string[] => window.__palettes ?? []

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => window.__getTheme?.() ?? { mode: "system", palette: "" })
  const [palettes] = useState(palettesInSheet)
  const [dark, setDark] = useState(() => document.documentElement.dataset.mode === "dark")

  useEffect(() => {
    // data-mode also changes when the system switches while mode is "system".
    const obs = new MutationObserver(() => setDark(document.documentElement.dataset.mode === "dark"))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] })
    return () => obs.disconnect()
  }, [])

  const update = (next: Partial<Theme>) => {
    window.__setTheme?.(next)
    setTheme((t) => ({ ...t, ...next }))
  }
  return { theme, palettes, dark, update }
}
