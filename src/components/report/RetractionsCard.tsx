// Retractions & corrections (v1.4.2 — multi-signal). Presentational: the Crossref
// result is owned by App (fetched automatically after matching) and passed in.
// Neutral wording: a flagged reference is for the user to VERIFY — people cite
// retracted work deliberately.

import type { ResultRow } from '../../types'
import type { CrossrefRunState, CrossrefUpdate } from '../../lib/crossref'
import { computeRetractions, type RetractionSignal, type UpdateFinding } from '../../lib/stats/retractions'
import CardShell from './CardShell'
import { plural } from './format'

const SIGNAL_LABEL: Record<RetractionSignal, string> = {
  'openalex': 'OpenAlex',
  'openalex-duplicate': 'OpenAlex (duplicate record)',
  'title': 'title says retracted',
  'crossref': 'Crossref',
  'retraction-watch': 'Retraction Watch',
}
const KIND_LABEL: Record<CrossrefUpdate['kind'], string> = {
  retraction: 'retraction', concern: 'expression of concern', correction: 'correction',
}

function Notices({ updates }: { updates: CrossrefUpdate[] }) {
  if (updates.length === 0) return null
  return (
    <div className="dup-keys">
      {updates.map((u, i) => (
        <span key={i} className="chip">
          <span>{KIND_LABEL[u.kind]}{u.date ? ` ${u.date}` : ''}</span>
          {u.noticeDoi && <> · <a href={`https://doi.org/${u.noticeDoi}`} target="_blank" rel="noreferrer">notice ↗</a></>}
        </span>
      ))}
    </div>
  )
}

function FindingList({ items, showSignals }: { items: UpdateFinding[]; showSignals: boolean }) {
  return (
    <ul className="dup-list">
      {items.map(f => (
        <li key={f.rowId}>
          <span className="dup-title" title={f.bibTitle}>{f.bibTitle}</span>
          <div className="dup-keys">
            <span className="mono chip">{f.citeKey}</span>
            {showSignals && f.signals.map(s => <span key={s} className="chip">{SIGNAL_LABEL[s]}</span>)}
            {f.openalexId && <a href={f.openalexId} target="_blank" rel="noreferrer" className="chip">OpenAlex ↗</a>}
          </div>
          <Notices updates={f.updates} />
        </li>
      ))}
    </ul>
  )
}

export default function RetractionsCard({ rows, crossref }: { rows: ResultRow[]; crossref: CrossrefRunState }) {
  const result = crossref.status === 'done' ? crossref.result : null
  const r = computeRetractions(rows, result)
  const clean = r.retracted.length + r.concerns.length + r.corrections.length === 0

  return (
    <CardShell
      id="retractions"
      title="Retractions & corrections"
      intro="Retraction flags from OpenAlex (on any of its records for the work) and title prefixes, plus retraction, expression-of-concern and correction notices from Crossref, which includes Retraction Watch."
    >
      {crossref.status === 'running' && <p className="muted">Checking Crossref for retractions and corrections…</p>}

      {clean ? (
        <p className="muted">
          <span>No retractions, expressions of concern or corrections found among the {r.checked} checked {plural(r.checked, 'reference')}.</span>
        </p>
      ) : (
        <>
          {r.retracted.length > 0 && (
            <>
              <p className="card-note warn">
                <strong>{r.retracted.length}</strong> <span>{plural(r.retracted.length, 'reference')} retracted — verify each, as you may be citing it deliberately.</span>
              </p>
              <FindingList items={r.retracted} showSignals />
            </>
          )}
          {r.concerns.length > 0 && (
            <>
              <p className="card-note">
                <strong>{r.concerns.length}</strong> <span>{plural(r.concerns.length, 'reference')} with an expression of concern (not retracted).</span>
              </p>
              <FindingList items={r.concerns} showSignals={false} />
            </>
          )}
          {r.corrections.length > 0 && (
            <details className="oa-help">
              <summary><span>{r.corrections.length} {plural(r.corrections.length, 'reference')} with a published correction</span></summary>
              <FindingList items={r.corrections} showSignals={false} />
            </details>
          )}
        </>
      )}

      <p className="card-basis">
        <span>Checked {r.checked} {plural(r.checked, 'reference')}.</span>{' '}
        {result && <span>Crossref answered for {result.checked} {plural(result.checked, 'DOI')}{result.failed > 0 ? `; ${result.failed} could not be checked (Crossref unavailable)` : ''}.</span>}{' '}
        {r.unchecked > 0 && <span>{r.unchecked} had no retraction data at all (no OpenAlex flag, no DOI).</span>}
      </p>
    </CardShell>
  )
}
