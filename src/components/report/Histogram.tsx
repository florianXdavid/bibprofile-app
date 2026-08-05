// Hand-rolled SVG histogram — no chart library. Vertical bars, one per bin,
// with a sparse year axis (~6 labels max) and an optional median marker.

import type { HistogramBin } from '../../lib/stats/recency'

interface Props {
  bins: HistogramBin[]
  markerYear?: number | null // e.g. the median, drawn as a vertical guide
  markerLabel?: string
}

const W = 640
const H = 200
const PAD = { top: 12, right: 8, bottom: 26, left: 28 }

export default function Histogram({ bins, markerYear, markerLabel }: Props) {
  if (bins.length === 0) return null
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const maxCount = Math.max(...bins.map(b => b.count), 1)
  const bw = plotW / bins.length

  // Aim for ~6 axis labels regardless of how many bins there are.
  const labelStep = Math.max(1, Math.ceil(bins.length / 6))

  const x = (i: number) => PAD.left + i * bw
  const y = (count: number) => PAD.top + plotH - (count / maxCount) * plotH

  // Locate the marker (median year) along the axis.
  let markerX: number | null = null
  if (markerYear != null) {
    const idx = bins.findIndex(b => markerYear >= b.from && markerYear <= b.to)
    if (idx >= 0) markerX = x(idx) + bw / 2
  }

  return (
    <svg className="histogram" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Publication-year histogram, ${bins.length} bins, tallest ${maxCount}`}>
      {/* y baseline */}
      <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH}
        stroke="var(--line)" />
      {/* max-count gridline + label */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left + plotW} y2={PAD.top}
        stroke="var(--line)" strokeDasharray="2 3" />
      <text x={PAD.left - 5} y={PAD.top + 4} textAnchor="end" className="hist-axis">{maxCount}</text>
      <text x={PAD.left - 5} y={PAD.top + plotH} textAnchor="end" className="hist-axis">0</text>

      {markerX != null && (
        <g>
          <line x1={markerX} y1={PAD.top} x2={markerX} y2={PAD.top + plotH}
            stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 2" />
          <text x={markerX} y={PAD.top - 2} textAnchor="middle" className="hist-marker">
            {markerLabel ?? markerYear}
          </text>
        </g>
      )}

      {bins.map((b, i) => {
        const barH = (b.count / maxCount) * plotH
        return (
          <g key={b.from}>
            <rect x={x(i) + 1} y={y(b.count)} width={Math.max(bw - 2, 1)} height={barH}
              className="hist-bar">
              <title>{`${b.label}: ${b.count}`}</title>
            </rect>
            {i % labelStep === 0 && (
              <text x={x(i) + bw / 2} y={H - 8} textAnchor="middle" className="hist-axis">
                {b.from}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
