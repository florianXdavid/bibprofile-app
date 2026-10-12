// v1.5.1 — the headline card above the tabs: "X of Y references verified to exist".
// Presentational; the counts come from lib/stats/verification.ts (pure, tested) and the
// retraction list from the Crossref check owned by App.

import { useMemo } from 'react'
import type { ResultRow } from '../types'
import type { CrossrefRunState } from '../lib/crossref'
import { computeRetractions } from '../lib/stats/retractions'
import { computeVerification, scholarUrl } from '../lib/stats/verification'

const s = (n: number, one: string, many: string) => (n === 1 ? one : many)

function RefList({ rows, scholar, note }: { rows: ResultRow[]; scholar?: boolean; note?: (r: ResultRow) => string | null }) {
  return (
    <ul className="verify-refs">
      {rows.map(r => (
        <li key={r.rowId}>
          <span className="mono chip">{r.citeKey}</span>{' '}
          <span className="title-cell" title={r.title}>{r.title}</span>
          {note?.(r) && <span className="muted"> — {note(r)}</span>}
          {scholar && <> · <a href={scholarUrl(r)} target="_blank" rel="noreferrer">search Google Scholar ↗</a></>}
        </li>
      ))}
    </ul>
  )
}

export default function VerificationCard({ rows, crossref }: { rows: ResultRow[]; crossref: CrossrefRunState }) {
  const v = useMemo(() => {
    const done = crossref.status === 'done'
    const retractedIds = done ? computeRetractions(rows, crossref.result).retracted.map(f => f.rowId) : null
    return computeVerification(rows, retractedIds)
  }, [rows, crossref])

  const all = v.verified === v.total && v.total > 0
  return (
    <section id="verify" className="verify-card" aria-label="Reference check">
      <p className="verify-headline">
        {all
          ? <>All <strong>{v.total}</strong> references verified to exist ✓</>
          : <><strong>{v.verified}</strong> of <strong>{v.total}</strong> {s(v.total, 'reference', 'references')} verified to exist</>}
      </p>
      <ul className="verify-lines">
        {v.couldNotVerify.length > 0 && (
          <li className="verify-bad">
            <details>
              <summary><strong>{v.couldNotVerify.length}</strong> could not be verified — check {s(v.couldNotVerify.length, 'this reference exists', 'these references exist')}</summary>
              <RefList rows={v.couldNotVerify} scholar note={r => (r.status === 'uncertain' ? 'unsure match' : null)} />
            </details>
          </li>
        )}
        {v.wrongDoi.length > 0 && (
          <li className="verify-bad">
            <details>
              <summary><strong>{v.wrongDoi.length}</strong> {s(v.wrongDoi.length, 'DOI points', 'DOIs point')} to another work — check the DOI</summary>
              <RefList rows={v.wrongDoi} note={r => (r.openalex ? `the DOI leads to “${r.openalex.displayName}”` : null)} />
            </details>
          </li>
        )}
        {v.retracted == null
          ? <li className="muted">checking retractions…</li>
          : v.retracted.length > 0
            ? (
              <li className="verify-bad">
                <details>
                  <summary><strong>{v.retracted.length}</strong> retracted — see the Report for the notices</summary>
                  <RefList rows={v.retracted} />
                </details>
              </li>
            )
            : <li className="muted">no retracted papers found</li>}
        {v.errored > 0 && <li><strong>{v.errored}</strong> couldn’t be checked (network error) — use “Retry” below</li>}
        {v.pending > 0 && <li><strong>{v.pending}</strong> not checked yet (the shared pool ran out)</li>}
        {v.notCheckable > 0 && <li className="muted">{v.notCheckable} not checkable — web pages, software, datasets</li>}
        {v.unparseable > 0 && <li className="muted">{v.unparseable} {s(v.unparseable, 'entry', 'entries')} couldn’t be read</li>}
      </ul>
      <p className="verify-foot muted">
        Verified = found in OpenAlex by its DOI or another identifier, or by a confident title match.
        “Could not be verified” isn’t proof that a reference is fabricated: some real works are
        missing from OpenAlex.
      </p>
    </section>
  )
}
