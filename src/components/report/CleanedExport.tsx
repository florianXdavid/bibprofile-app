// Feature 5 — Cleaned .bib export view (its own tab). PRESENTATIONAL (W3.1): the
// billable preprint-resolution result is owned by App and passed in, so it
// survives tab switches and never re-runs the paid searches.
//
// Two downloads (W3.1):
//   1. "suggestions" — today's default: confident fills applied, suspicious /
//      preprint matches shown but NOT written.
//   2. "preprint updates applied" — the whole file, plus the CONFIDENTLY-resolved
//      preprint→published fields written in (via the same additive writer). Shown
//      only when >=1 preprint was confidently resolved; carries a verify header.

import { useMemo } from 'react'
import type { ResultRow } from '../../types'
import { computeCleanedBib, serializeCleanedBib } from '../../lib/stats/cleanBib'
import { preprintCostEstimate, type PreprintRunState } from '../../lib/preprintResolve'
import { plural } from './format'

const CONF_LABEL: Record<string, string> = {
  confident: 'high confidence · DOI match',
  tentative: 'suggested · title match',
  none: 'suggestion',
}

interface Props {
  rows: ResultRow[]
  sourceText: string
  fileName: string
  preprints: PreprintRunState
  onResolvePreprints: () => void
}

function saveBib(text: string, name: string) {
  const blob = new Blob([text], { type: 'application/x-bibtex;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function CleanedExport({ rows, sourceText, fileName, preprints, onResolvePreprints }: Props) {
  const resolved = preprints.status === 'done' ? preprints.result.resolved : undefined

  const cleaned = useMemo(() => computeCleanedBib(rows, resolved), [rows, resolved])
  const estimate = useMemo(() => preprintCostEstimate(rows), [rows])

  const changed = cleaned.entries.filter(e => e.action === 'applied' || e.action === 'suggested')
  const base = fileName.replace(/\.[^.]+$/, '') || 'references'

  function downloadSuggestions() {
    saveBib(serializeCleanedBib(sourceText, cleaned), `${base}-cleaned.bib`)
  }

  return (
    <div className="cleaned">
      <div className="card-note warn" style={{ marginTop: 4 }}>
        <strong>Suggested fixes — review before use.</strong> This adds missing fields from OpenAlex;
        it never changes cite keys, drops entries, or edits text you already wrote. DOI matches are
        applied confidently; title matches are applied but flagged; suspicious matches and preprint
        replacements are shown as suggestions only and are <em>not</em> written to the file — apply
        those yourself if you want them.
      </div>

      <div className="cleaned-counts">
        <span><strong>{cleaned.counts.applied}</strong> {plural(cleaned.counts.applied, 'entry', 'entries')} filled</span>
        <span><strong>{cleaned.counts.fieldsAdded}</strong> {plural(cleaned.counts.fieldsAdded, 'field')} added</span>
        <span><strong>{cleaned.counts.suggested}</strong> with suggestions</span>
        <span><strong>{cleaned.counts.passed}</strong> passed through</span>
        <span><strong>{cleaned.counts.unchanged}</strong> left unchanged</span>
      </div>

      <div className="cleaned-toolbar">
        <button className="primary" onClick={downloadSuggestions}>Download cleaned .bib</button>
      </div>

      {/* Gated preprint resolution (result owned by App) */}
      <div className="gap-section">
        <p className="gap-section-title">
          Preprint → published <span className="muted">— {estimate.calls} billable {plural(estimate.calls, 'search', 'searches')}</span>
        </p>
        {estimate.calls === 0 ? (
          <p className="muted">No preprints detected in this list.</p>
        ) : (
          <p className="card-note">
            {estimate.calls} {plural(estimate.calls, 'entry', 'entries')} look like preprints. Checking for a
            published version makes <strong>{estimate.calls}</strong> billable {plural(estimate.calls, 'search', 'searches')}
            {' '}(~${estimate.usd.toFixed(3)}). Matches are shown as suggestions in the diff below — a preprint is
            often cited on purpose, so apply any swap yourself.
          </p>
        )}
        {estimate.calls > 0 && preprints.status === 'idle' && (
          <button onClick={onResolvePreprints}>Check preprints (~${estimate.usd.toFixed(3)})</button>
        )}
        {preprints.status === 'running' && <p className="muted">{preprints.progress.label} ({preprints.progress.done}/{preprints.progress.total})…</p>}
        {preprints.status === 'error' && <p className="err-text">Couldn’t complete: {preprints.error}</p>}
        {preprints.status === 'done' && (
          <p className="cost">
            Found published versions for <strong>{preprints.result.resolvedCount}</strong> of {estimate.calls}
            {' '}· {preprints.result.billableCalls} billable
            {' '}{plural(preprints.result.billableCalls, 'search', 'searches')} (~${preprints.result.costUsd.toFixed(3)}).
          </p>
        )}
      </div>

      {/* The diff */}
      <h3 className="cleaned-diff-title">Changes ({changed.length})</h3>
      {changed.length > 0 && (
        <div className="diff-legend">
          <span><span className="diff-tag ok">applied</span> written into the downloaded file</span>
          <span><span className="diff-tag warn">suggested</span> shown to review — not written (suspicious matches &amp; resolved preprints)</span>
        </div>
      )}
      {changed.length === 0 ? (
        <p className="muted">Nothing to fill — every matched entry already had these fields.</p>
      ) : (
        <ul className="diff-list">
          {changed.map(e => (
            <li key={e.citeKey + e.sourceOffset} className={`diff-${e.action}`}>
              <div className="diff-head">
                <span className="mono chip">{e.citeKey}</span>
                <span className={`badge ${e.status}`}>{e.status}</span>
                {e.action === 'applied'
                  ? <span className="diff-tag ok">applied · {CONF_LABEL[e.confidence]}</span>
                  : <span className="diff-tag warn">suggested only</span>}
              </div>
              {(e.applied.length > 0 || e.suggested.length > 0) && (
                <ul className="diff-fields">
                  {e.applied.map(f => <li key={'a' + f.field}><span className="add">+ {f.field}</span> = {'{'}{f.value}{'}'}</li>)}
                  {e.suggested.map(f => <li key={'s' + f.field} className="muted">? {f.field} = {'{'}{f.value}{'}'} <span className="diff-tag warn">not written</span></li>)}
                </ul>
              )}
              {e.preprint && (
                <p className="diff-preprint">
                  {e.preprint.server} preprint — published version:{' '}
                  <strong>{e.preprint.publishedTitle}</strong>
                  {e.preprint.publishedYear ? ` (${e.preprint.publishedYear})` : ''}
                  {e.preprint.publishedDoi ? `, doi ${e.preprint.publishedDoi}` : ''}
                  {' '}<span className="diff-tag warn">suggestion — not written</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
