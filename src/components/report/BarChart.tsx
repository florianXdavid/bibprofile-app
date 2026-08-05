// Hand-rolled SVG horizontal bar chart — no chart library. Each row is a
// truncated label, a track, a value bar, and the count. Full label text is in a
// <title> so hovering recovers anything the truncation dropped.

export interface BarItem {
  label: string
  value: number
  emphasis?: boolean // e.g. the single most-cited venue
}

interface Props {
  items: BarItem[]
  max?: number // defaults to the largest value present
  valueSuffix?: string
}

const W = 640
const ROW_H = 28
const LABEL_W = 210
const VALUE_W = 46
const BAR_H = 16

function truncate(s: string, max = 30): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}

export default function BarChart({ items, max, valueSuffix = '' }: Props) {
  if (items.length === 0) return null
  const top = max ?? Math.max(...items.map(i => i.value), 1)
  const barArea = W - LABEL_W - VALUE_W
  const H = items.length * ROW_H

  return (
    <svg className="barchart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Bar chart of ${items.length} items`}>
      {items.map((it, i) => {
        const cy = i * ROW_H + ROW_H / 2
        const barW = Math.max((it.value / top) * barArea, 1)
        return (
          <g key={it.label + i}>
            <text x={0} y={cy} dominantBaseline="middle" className="bar-label">
              {truncate(it.label)}
              <title>{it.label}</title>
            </text>
            <rect x={LABEL_W} y={cy - BAR_H / 2} width={barArea} height={BAR_H}
              rx={3} className="bar-track" />
            <rect x={LABEL_W} y={cy - BAR_H / 2} width={barW} height={BAR_H} rx={3}
              className={it.emphasis ? 'bar-fill emphasis' : 'bar-fill'}>
              <title>{`${it.label}: ${it.value}`}</title>
            </rect>
            <text x={W} y={cy} dominantBaseline="middle" textAnchor="end" className="bar-value">
              {it.value}{valueSuffix}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
