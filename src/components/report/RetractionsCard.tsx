// Feature 2 — Retraction check. Styled like the duplicates card: quiet when
// clean, a clear (but neutral) flag when not. OpenAlex's `is_retracted` only.

import type { Cohort } from '../../lib/stats/denominator'
import { computeRetractions } from '../../lib/stats/retractions'
import CardShell from './CardShell'
import { plural } from './format'

export default function RetractionsCard({ cohort }: { cohort: Cohort }) {
  const r = computeRetractions(cohort)

  return (
    <CardShell
      title="Retractions"
      basis={r.hits.length > 0 ? r : undefined}
      intro="References OpenAlex marks as retracted."
    >
      {r.hits.length === 0 ? (
        <p className="muted">
          None of the {r.checked} checked {plural(r.checked, 'reference')} is marked retracted by OpenAlex.
          {r.unknown > 0 && <> ({r.unknown} had no retraction data.)</>}
        </p>
      ) : (
        <>
          <p className="card-note warn">
            <strong>{r.hits.length}</strong> {plural(r.hits.length, 'reference')} marked retracted —
            verify each, as you may be citing it deliberately. This is OpenAlex's flag only, not a
            reason or date.
          </p>
          <ul className="dup-list">
            {r.hits.map(h => (
              <li key={h.citeKey}>
                <span className="dup-title" title={h.bibTitle}>{h.bibTitle}</span>
                <div className="dup-keys">
                  <span className="mono chip">{h.citeKey}</span>
                  {h.openalexId && (
                    <a href={h.openalexId} target="_blank" rel="noreferrer" className="chip">OpenAlex ↗</a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </CardShell>
  )
}
