// Card 1 — Recency profile (headline). Median year + IQR, share from the last
// 5/10 years, oldest and newest named reference, and a year histogram.
//
// Wording is descriptive only: "82% from the last 5 years", never "too recent".

import type { Cohort } from '../../lib/stats/denominator'
import { computeRecency } from '../../lib/stats/recency'
import { getBaseline } from '../../lib/baselines'
import CardShell from './CardShell'
import Histogram from './Histogram'
import { pct } from './format'

interface Props {
  cohort: Cohort
  referenceYear: number
  fieldId?: string | null // v1: always null-ish -> no baseline comparison
}

export default function RecencyCard({ cohort, referenceYear, fieldId }: Props) {
  const r = computeRecency(cohort, referenceYear)
  const baseline = getBaseline(fieldId ?? '')

  return (
    <CardShell
      title="Recency profile"
      basis={r}
      intro="When the cited work was published."
    >
      {r.medianYear == null ? (
        <p className="muted">No matched works carry a publication year.</p>
      ) : (
        <>
          <p className="stat-headline">
            Median publication year <strong>{r.medianYear}</strong>
            {r.q1 != null && r.q3 != null && (
              <span className="muted"> (middle half {Math.round(r.q1)}–{Math.round(r.q3)})</span>
            )}
          </p>

          <div className="stat-row">
            <div className="stat-cell">
              <span className="stat-big">{pct(r.shareLast5)}</span>
              <span className="stat-label">from the last 5 years</span>
            </div>
            <div className="stat-cell">
              <span className="stat-big">{pct(r.shareLast10)}</span>
              <span className="stat-label">from the last 10 years</span>
            </div>
          </div>

          {baseline && (
            <p className="baseline-line">
              Typical for this field: {pct(baseline.pctLast5y / 100)} from the last 5 years.
            </p>
          )}

          <Histogram bins={r.bins} markerYear={r.medianYear} markerLabel={`median ${r.medianYear}`} />

          <div className="extremes">
            {r.oldest && (
              <p><span className="tag">Oldest</span> <strong>{r.oldest.year}</strong> — <span title={r.oldest.title}>{r.oldest.title}</span> <span className="muted">({r.oldest.citeKey})</span></p>
            )}
            {r.newest && (
              <p><span className="tag">Newest</span> <strong>{r.newest.year}</strong> — <span title={r.newest.title}>{r.newest.title}</span> <span className="muted">({r.newest.citeKey})</span></p>
            )}
          </div>
        </>
      )}
    </CardShell>
  )
}
