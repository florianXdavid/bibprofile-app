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

import { useMemo, useState } from 'react'
import type { ResultRow } from '../../types'
import { computeCleanedBib, serializeCleanedBib } from '../../lib/stats/cleanBib'
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

export default function CleanedExport({ rows, sourceText, fileName }: Props) {
  // Per-field accepted corrections — keys "sourceOffset::field". In-memory only
  // (component state); no persistence. Accepting recomputes that entry's newRaw.
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [showRaw, setShowRaw] = useState(false) // 1e (v1.3) — in-page raw view of the cleaned .bib
  const toggleAccept = (key: string) =>
    setAccepted(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const cleaned = useMemo(() => computeCleanedBib(rows, undefined, accepted), [rows, accepted])

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
        applied confidently; title matches are applied but flagged; suspicious matches are shown as
        suggestions only and are <em>not</em> written to the file. Where a field you wrote <em>differs</em> from OpenAlex, it's
        shown as a review-only suggestion you can accept per field — OpenAlex may differ for legitimate
        reasons (online-first vs print year, venue normalisation, LaTeX in titles), so accept only real fixes.
      </div>

      <div className="cleaned-counts">
        <span><strong>{cleaned.counts.applied}</strong> {plural(cleaned.counts.applied, 'entry', 'entries')} filled</span>
        <span><strong>{cleaned.counts.fieldsAdded}</strong> {plural(cleaned.counts.fieldsAdded, 'field')} added</span>
        <span><strong>{cleaned.counts.mismatches}</strong> {plural(cleaned.counts.mismatches, 'field')} differ (review)</span>
        <span><strong>{cleaned.counts.suggested}</strong> with suggestions</span>
        <span><strong>{cleaned.counts.passed}</strong> passed through</span>
        <span><strong>{cleaned.counts.unchanged}</strong> left unchanged</span>
      </div>

      <p className="cleaned-hint muted">Accepting a change updates the cleaned .bib — download it when you're done reviewing.</p>

      <div className="cleaned-toolbar">
        <button className="primary" onClick={downloadSuggestions}>Download cleaned .bib</button>
        <button type="button" onClick={() => setShowRaw(s => !s)}>{showRaw ? 'Hide raw' : 'View raw'}</button>
      </div>
      {showRaw && (
        <pre className="cleaned-raw" aria-label="Raw cleaned .bib text">{serializeCleanedBib(sourceText, cleaned)}</pre>
      )}

      {/* The diff */}
      <h3 className="cleaned-diff-title">Changes ({changed.length})</h3>
      {changed.length > 0 && (
        <div className="diff-legend">
          <span><span className="diff-tag ok">applied</span> written into the downloaded file</span>
          <span><span className="diff-tag review">review</span> your value differs from OpenAlex — accept per field to write it</span>
          <span><span className="diff-tag warn">suggested</span> shown to review — not written (suspicious matches)</span>
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
              {(e.applied.length > 0 || e.suggested.length > 0 || e.mismatches.length > 0) && (
                <ul className="diff-fields">
                  {e.applied.map(f => <li key={'a' + f.field}><span className="add">+ {f.field}</span> = {'{'}{f.value}{'}'}</li>)}
                  {e.mismatches.map(m => {
                    const key = `${e.sourceOffset}::${m.field}`
                    const isAccepted = accepted.has(key)
                    return (
                      <li key={'m' + m.field} className={isAccepted ? 'diff-accepted' : 'diff-review'}>
                        <span className="field">{m.field}</span>:{' '}
                        <span className="yours">{'{'}{m.yours}{'}'}</span>{' → '}
                        <span className="oa">{'{'}{m.openalex}{'}'}</span>{' '}
                        {isAccepted ? (
                          <>
                            <span className="diff-tag ok">accepted — will be written</span>{' '}
                            <button type="button" className="key-link" onClick={() => toggleAccept(key)}>Undo</button>
                          </>
                        ) : (
                          <>
                            <span className="diff-tag review">review</span>{' '}
                            <button type="button" className="key-link" onClick={() => toggleAccept(key)}>Accept</button>
                          </>
                        )}
                      </li>
                    )
                  })}
                  {e.suggested.map(f => <li key={'s' + f.field} className="muted">? {f.field} = {'{'}{f.value}{'}'} <span className="diff-tag warn">not written</span></li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
