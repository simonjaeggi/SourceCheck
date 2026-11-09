import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { METRICS, SERIES_COLORS, type ScoredWork } from "@/lib/scoring"

export function PaperRadar({ items, height = 280, showLegend = false }: { items: ScoredWork[]; height?: number; showLegend?: boolean }) {
  const data = METRICS.map((m) => {
    const row: Record<string, string | number> = { metric: m.label }
    items.forEach((it, i) => (row[`s${i}`] = it.metrics[m.key]))
    return row
  })
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
        <PolarRadiusAxis angle={90} domain={[0, 10]} tickCount={6} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} axisLine={false} />
        {items.map((it, i) => (
          <Radar
            key={it.work.id}
            name={shortTitle(it.work.display_name)}
            dataKey={`s${i}`}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            fillOpacity={items.length > 1 ? 0.12 : 0.3}
            strokeWidth={2}
            dot={{ r: 2.5 }}
          />
        ))}
        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
      </RadarChart>
    </ResponsiveContainer>
  )
}

export function shortTitle(t: string, n = 38) {
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t
}
