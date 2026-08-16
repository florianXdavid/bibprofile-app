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
        Detecting them is free; looking up a published version is a <strong>billable title search</strong>
        {' '}(one per preprint), so it runs only when you press the button — it never spends the shared
        budget on its own. Matches are suggestions only; a preprint is often cited on purpose.
      </p>

      {estimate.calls === 0 ? (
        <p className="muted">No preprints detected in this list.</p>
      ) : (
        <>
          <p className="card-note">
            {estimate.calls} {plural(estimate.calls, 'entry', 'entries')} look like preprints — checking for
            published versions makes <strong>{estimate.calls}</strong> billable{' '}
            {plural(estimate.calls, 'search', 'searches')} (~${estimate.usd.toFixed(3)}).
          </p>
          {preprints.status === 'idle' && (
            <button onClick={onResolve}>Check preprints (~${estimate.usd.toFixed(3)})</button>
          )}
          {preprints.status === 'running' && (
            <p className="muted">{preprints.progress.label} ({preprints.progress.done}/{preprints.progress.total})…</p>
          )}
          {preprints.status === 'error' && <p className="err-text">Couldn’t complete: {preprints.error}</p>}
          {preprints.status === 'done' && (
            <>
              <p className="cost">
                Found published versions for <strong>{preprints.result.resolvedCount}</strong> of {estimate.calls}
                {' '}· {preprints.result.billableCalls} billable{' '}
                {plural(preprints.result.billableCalls, 'search', 'searches')} (~${preprints.result.costUsd.toFixed(3)}).
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
