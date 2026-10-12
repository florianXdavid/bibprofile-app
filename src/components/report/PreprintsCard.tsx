// v1.3 — Preprint → published, relocated from the Cleaned .bib tab into the Report
// (it's analysis, and is never written to the cleaned file). Suggestions only.
//
// Cost honesty: DETECTION is free (pure, offline). RESOLUTION looks up each detected
// preprint's published version via the EXISTING billable title search (type:!preprint)
// — one search per preprint. It runs ONLY when the user presses the button, so it can
// never silently spend the shared budget.

import type { ResultRow } from '../../types'
import { preprintCostEstimate, type PreprintRunState } from '../../lib/preprintResolve'
import { plural } from './format'

interface Props {
  rows: ResultRow[]
  preprints: PreprintRunState
  onResolve: () => void
}

export default function PreprintsCard({ rows, preprints, onResolve }: Props) {
  const estimate = preprintCostEstimate(rows)
  const resolvedList = preprints.status === 'done'
    ? preprints.result.detected.filter(d => preprints.result.resolved.has(d.rowId))
    : []

  return (
    <details className="card" open>
      <summary className="card-title">Preprint → published</summary>
      <p className="card-intro">
        Preprints in your list (arXiv, bioRxiv, medRxiv, SSRN, …) and their published versions.
        Detecting them is free; looking up a published version uses <strong>1 credit per preprint</strong>,
        so it runs only when you press the button — it never spends credits on its own. Matches are suggestions only; a preprint is often cited on purpose.
      </p>

      {estimate.calls === 0 ? (
        <p className="muted">No preprints detected in this list.</p>
      ) : (
        <>
          <p className="card-note">
            {estimate.calls} {plural(estimate.calls, 'entry', 'entries')} look like preprints — checking for
            published versions uses <strong>{estimate.calls}</strong> {plural(estimate.calls, 'credit')}.
          </p>
          {preprints.status === 'idle' && (
            <button onClick={onResolve}>Check preprints ({estimate.calls} {plural(estimate.calls, 'credit')})</button>
          )}
          {preprints.status === 'running' && (
            <p className="muted">{preprints.progress.label} ({preprints.progress.done}/{preprints.progress.total})…</p>
          )}
          {preprints.status === 'error' && <p className="err-text">Couldn’t complete: {preprints.error}</p>}
          {preprints.status === 'done' && (
            <>
              <p className="cost">
                Found published versions for <strong>{preprints.result.resolvedCount}</strong> of {estimate.calls}
                {' '}· used {preprints.result.billableCalls} {plural(preprints.result.billableCalls, 'credit')}.
              </p>
              {resolvedList.length > 0 && (
                <ul className="gap-list">
                  {resolvedList.map(d => {
                    const p = preprints.result.resolved.get(d.rowId)!
                    return (
                      <li key={d.rowId}>
                        <span className="mono chip">{d.citeKey}</span> {d.server} preprint → published:{' '}
                        <strong>{p.publishedTitle}</strong>
                        {p.publishedYear ? ` (${p.publishedYear})` : ''}
                        {p.publishedDoi ? `, doi ${p.publishedDoi}` : ''}
                        {' '}<span className="diff-tag warn">suggestion</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </details>
  )
}
