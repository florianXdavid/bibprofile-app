// W4.1 — usage indicator. Presentational: renders one of three states from
// props; App owns the fetch (it owns the active credential + run lifecycle) and
// triggers it on key-activation and after each run — never on a timer.
//
// Wording is descriptive, never scarcity theatre: "780 of 1,000 left", not
// "⚠ only 22% left!". Counted in credits (v1.5.4), never in dollars.

import type { RateLimitUsage } from '../lib/rateLimit'
import { credits, formatResetIn, toCredits, usagePercent } from '../lib/rateLimit'

// v1.5.4 — "What are credits?" explainer (was a bare "?", v1.3). Native <details>,
// no state and no dependency. Credits, never dollars: the first question a visitor
// must not have to ask is "am I paying for this?".
function PoolHelp({ total }: { total?: number }) {
  return (
    <details className="pool-help">
      <summary>What are credits?</summary>
      <span className="pool-help-text">
        BibProfile is free — you never pay anything. Lookups by DOI or another identifier are free, and
        so are title searches through Crossref; a title search on OpenAlex uses 1 credit. Everyone shares{' '}
        {total ? `a free pool of ${credits(total)} a day` : 'a free daily pool of credits provided by OpenAlex'}. If it runs
        out, use your own free OpenAlex key (just below) or wait for the reset.
      </span>
    </details>
  )
}

export type UsageState =
  | { status: 'shared' } // shared pool active but usage not (yet) available — deferral line
  | { status: 'loading' }
  | { status: 'ok'; usage: RateLimitUsage; scope: 'shared' | 'user' }
  | { status: 'unavailable' } // read failed / unexpected shape — never a guessed bar

export default function UsageIndicator({ state, onRetry }: { state: UsageState; onRetry: () => void }) {
  if (state.status === 'shared') {
    // Deferral line — shown before the first lookup, or when the shared path is
    // running direct-to-OpenAlex (local/rollback) where we can't read pooled usage.
    // The live shared bar (below) is a POOLED number across everyone, so it's worded
    // "free shared credits today", never "your" usage.
    return (
      // A <div>, not a <p>: <details> may not sit inside a paragraph.
      <div className="usage shared muted">
        Using the free shared pool — today’s credits appear here after your first lookup.{' '}
        <PoolHelp />
      </div>
    )
  }

  if (state.status === 'loading') {
    return <p className="usage muted">Checking today’s credits…</p>
  }

  if (state.status === 'unavailable') {
    return (
      <p className="usage muted">
        Usage unavailable right now.{' '}
        <button type="button" className="key-link" onClick={onRetry}>Retry</button>
      </p>
    )
  }

  const u = state.usage
  const leftPct = 100 - usagePercent(u)
  const total = toCredits(u.budgetUsd)
  const left = Math.min(total, toCredits(u.remainingUsd))
  const reset = formatResetIn(u.resetsAt)
  const shared = state.scope === 'shared'
  const label = `${left.toLocaleString('en-US')} of ${credits(total)} left today`
  return (
    <div className="usage ok">
      {/* The bar shows what's LEFT (v1.5.4), not what's used. */}
      <div className="usage-bar" role="img" aria-label={label}>
        <span className={leftPct <= 10 ? 'over' : ''} style={{ width: `${leftPct}%` }} />
      </div>
      <div className="usage-text">
        {shared ? 'Free shared credits today' : 'Your OpenAlex key’s credits today'}:
        {' '}<strong>{left.toLocaleString('en-US')}</strong> of {total.toLocaleString('en-US')} left
        {reset && <> · resets {reset}</>}.{' '}
        <button type="button" className="key-link" onClick={onRetry}>Refresh</button>
        {shared && <> · <PoolHelp total={total} /></>}
      </div>
      {u.prepaidUsd != null && u.prepaidUsd > 0 && (
        <p className="usage-prepaid muted">Plus {credits(toCredits(u.prepaidUsd))} prepaid.</p>
      )}
    </div>
  )
}
