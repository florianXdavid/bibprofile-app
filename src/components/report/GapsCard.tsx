// Feature 3 — Missing-citation recommendations. PRESENTATIONAL (W3.1): the
// billable results live in App state above the view toggle, so a tab switch no
// longer discards them. This component only renders those results and calls the
// parent-owned handlers; it holds no result state of its own. The loading /
// cost-preview UI is unchanged — it now just reflects parent state.

import { useMemo } from 'react'
import type { ResultRow } from '../../types'
import {
  forwardCostEstimate,
  type CoCiteResult,
  type ForwardResult,
  type GapCandidate,
  type GapsRunState,
} from '../../lib/gaps'
import CardShell from './CardShell'
import { plural } from './format'

interface Props {
  rows: ResultRow[]
  co: GapsRunState<CoCiteResult>
  fw: GapsRunState<ForwardResult>
  onRunCoCitation: () => void
  onRunForward: () => void
}

// v1.4.5 (M7): co-citation candidates are CITED BY your references; forward-citation
// candidates CITE them — the wording says which.
function CandidateList({ candidates, denom, unit, verb }: { candidates: GapCandidate[]; denom: number; unit: string; verb: 'cited by' | 'cites' }) {
  if (candidates.length === 0) return <p className="muted">No candidates cleared the threshold.</p>
  return (
    <ul className="gap-list">
      {candidates.map(c => (
        <li key={c.id}>
          <span className="gap-title" title={c.work?.displayName ?? c.id}>
            {c.work?.displayName ?? c.id}
            {c.work?.publicationYear ? <span className="muted"> ({c.work.publicationYear})</span> : null}
          </span>
          <div className="gap-meta">
            {verb} <strong>{c.count}</strong> of your {denom} {plural(denom, unit)}
            {c.work?.id && <> · <a href={c.work.id} target="_blank" rel="noreferrer">OpenAlex ↗</a></>}
            <div className="gap-keys">{c.citedByKeys.map(k => <span key={k} className="mono chip">{k}</span>)}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function GapsCard({ rows, co, fw, onRunCoCitation, onRunForward }: Props) {
  const estimate = useMemo(() => forwardCostEstimate(rows), [rows])
  const busy = co.status === 'running' || fw.status === 'running'

  return (
    <CardShell
      title="Missing citations"
      intro="Works your references point to (or that point to them) but that aren't in your list. Nothing runs until you press a button."
    >
      {/* Co-citation — the safe default */}
      <div className="gap-section">
        <p className="gap-section-title">Missing foundations <span className="muted">— co-citation, ~1 billable call</span></p>
        <p className="card-note">
          Co-citation only finds work your references <em>could already</em> cite, so it surfaces
          missing <strong>foundations</strong>, never recent work.
        </p>
        {co.status === 'idle' && (
          <button className="primary" onClick={onRunCoCitation} disabled={busy}>Find missing foundations</button>
        )}
        {co.status === 'running' && <p className="muted">{co.progress.label} ({co.progress.done}/{co.progress.total})…</p>}
        {co.status === 'error' && <p className="err-text">Couldn’t complete: {co.error}</p>}
        {co.status === 'done' && (
          <>
            <p className="cost">
              Pooled {co.result.matchedWorks} matched {plural(co.result.matchedWorks, 'work')} ·
              {' '}{co.result.billableCalls} billable call (~${co.result.costUsd.toFixed(3)}).
            </p>
            <CandidateList candidates={co.result.candidates} denom={co.result.matchedWorks} unit="reference" verb="cited by" />
          </>
        )}
      </div>

      {/* Forward-citation — gated, cost shown up front */}
      <div className="gap-section">
        <p className="gap-section-title">Adjacent work <span className="muted">— forward-citation, {estimate.calls} billable {plural(estimate.calls, 'call')}</span></p>
        <p className="card-note">
          Papers that cite several of the references you already have (any year; their year is shown) —
          useful for catching later work adjacent to your list.
        </p>
        {fw.status === 'idle' && (
          <button className="primary" onClick={onRunForward} disabled={busy}>Find adjacent work</button>
        )}
        {fw.status === 'running' && <p className="muted">{fw.progress.label} ({fw.progress.done}/{fw.progress.total})…</p>}
        {fw.status === 'error' && <p className="err-text">Couldn’t complete: {fw.error}</p>}
        {fw.status === 'done' && (
          <>
            <p className="cost">{fw.result.billableCalls} billable {plural(fw.result.billableCalls, 'call')} (~${fw.result.costUsd.toFixed(3)}).</p>
            <CandidateList candidates={fw.result.candidates} denom={fw.result.seedCount} unit="reference" verb="cites" />
          </>
        )}
      </div>
    </CardShell>
  )
}
