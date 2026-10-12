// Feature 5 — Cleaned .bib export view (its own tab). PRESENTATIONAL (W3.1): the
// billable preprint-resolution result is owned by App and passed in, so it
// survives tab switches and never re-runs the paid searches.
//
// One download. v1.4.3: only verified fills are written automatically; every other
// fill and every differing value is a per-field REVIEW item (Accept / Undo), with
// DOIs shown as links to check. Accept state is in-memory component state.

import { useMemo, useState } from 'react'
import type { ResultRow } from '../../types'
import { addKey, computeCleanedBib, serializeCleanedBib, type FieldChange } from '../../lib/stats/cleanBib'
import { plural } from './format'
import { STATUS_LABEL } from '../../lib/stats/verification'

const CONF_LABEL: Record<string, string> = {
  confident: 'matched by identifier',
  tentative: 'title match',
  none: 'low-confidence match',
}

interface Props {
  rows: ResultRow[]
  sourceText: string
  fileName: string
}

// v1.4.3 — a DOI value rendered as a one-click link to check it.
function FieldValue({ f }: { f: FieldChange }) {
  return f.field === 'doi'
    ? <a href={`https://doi.org/${f.value}`} target="_blank" rel="noreferrer" title="Open this DOI to check it">{f.value} ↗</a>
    : <span>{f.value}</span>
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
        it never changes cite keys, drops entries, or edits text you already wrote. Only verified fills
        are written automatically (below); everything else is listed for <em>review</em> and written only
        if you accept it. Where a field you wrote <em>differs</em> from OpenAlex, it's also a review item —
        OpenAlex may differ for legitimate reasons (online-first vs print year, venue normalisation, LaTeX
        in titles), so accept only real fixes.
      </div>

      <p className="cleaned-basis">
        <span><strong>{cleaned.counts.fieldsAdded}</strong> {plural(cleaned.counts.fieldsAdded, 'field')} written automatically:</span>{' '}
        <span>{cleaned.counts.autoFromDoiMatch} on references identified by their own DOI, and {cleaned.counts.autoTitleDois} {plural(cleaned.counts.autoTitleDois, 'DOI')} from high-confidence title matches (title ≥ 0.95, first author and year confirmed, same version).</span>{' '}
        <span><strong>{cleaned.counts.reviewFills + cleaned.counts.mismatches}</strong> {plural(cleaned.counts.reviewFills + cleaned.counts.mismatches, 'field')} await your review — written only if you accept them{cleaned.counts.acceptedFills > 0 ? ` (${cleaned.counts.acceptedFills} accepted so far)` : ''}.</span>
      </p>

      <div className="cleaned-counts">
        <span><strong>{cleaned.counts.applied}</strong> {plural(cleaned.counts.applied, 'entry', 'entries')} changed</span>
        <span><strong>{cleaned.counts.reviewFills}</strong> {plural(cleaned.counts.reviewFills, 'fill')} to review</span>
        <span><strong>{cleaned.counts.mismatches}</strong> {plural(cleaned.counts.mismatches, 'field')} differ (review)</span>
        <span><strong>{cleaned.counts.suggested}</strong> with review items</span>
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
          <span><span className="diff-tag ok">applied</span> written automatically (verified: see above)</span>
          <span><span className="diff-tag review">review</span> a missing field or a differing value — accept per field to write it; DOIs link out so you can check them</span>
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
                <span className={`badge ${e.status}`}>{STATUS_LABEL[e.status]}</span>
                {e.applied.length > 0
                  ? <span className="diff-tag ok">applied · {CONF_LABEL[e.confidence]}</span>
                  : e.action === 'applied' && e.suggested.length + e.mismatches.length === 0
                    ? <span className="diff-tag ok">comment added</span>
                    : <span className="diff-tag review">review · {CONF_LABEL[e.confidence]}</span>}
              </div>
              {e.note && <p className="muted diff-note">{e.note}</p>}
              {(e.applied.length > 0 || e.suggested.length > 0 || e.mismatches.length > 0) && (
                <ul className="diff-fields">
                  {e.applied.map(f => (
                    <li key={'a' + f.field}>
                      <span className="add">+ {f.field}</span> = {'{'}<FieldValue f={f} />{'}'}{' '}
                      <span className="diff-tag ok">{f.basis === 'title-high-confidence' ? 'auto · high-confidence title match' : 'auto · your DOI'}</span>
                    </li>
                  ))}
                  {e.suggested.map(f => {
                    const key = addKey(e.sourceOffset, f.field)
                    const isAccepted = accepted.has(key)
                    return (
                      <li key={'s' + f.field} className={isAccepted ? 'diff-accepted' : 'diff-review'}>
                        <span className="add">+ {f.field}</span> = {'{'}<FieldValue f={f} />{'}'}{' '}
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
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
