// Feature 1 — Reference-list shape. Neutral, descriptive observations that point
// back at the histogram. No scoring, no verdicts. Quiet when nothing stands out
// or the list is too small to say anything meaningful.

import type { Cohort } from '../../lib/stats/denominator'
import { computeShape } from '../../lib/stats/shape'
import CardShell from './CardShell'

const KIND_TAG: Record<string, string> = {
  'stale-tail': 'Freshness',
  'narrow-window': 'Range',
  gap: 'Gap',
  concentration: 'Concentration',
}

export default function ShapeCard({ cohort, referenceYear }: { cohort: Cohort; referenceYear: number }) {
  const shape = computeShape(cohort, referenceYear)

  return (
    <CardShell
      title="Reference-list shape"
      basis={shape.belowFloor ? undefined : shape}
      intro="Neutral observations about the overall shape — read alongside the year histogram above."
    >
      {shape.belowFloor ? (
        <p className="muted">
          Not enough matched references with a year (need at least {shape.minN}) to describe the
          overall shape without reading noise.
        </p>
      ) : shape.patterns.length === 0 ? (
        <p className="muted">
          Nothing stands out — the references span a range of years with no large gap, recent tail,
          or single dominant venue.
        </p>
      ) : (
        <ul className="shape-list">
          {shape.patterns.map(p => (
            <li key={p.kind}>
              <span className="tag">{KIND_TAG[p.kind] ?? p.kind}</span> {p.text}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}
