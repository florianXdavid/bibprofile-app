// W4.1 — usage indicator. Presentational: renders one of three states from
// props; App owns the fetch (it owns the active credential + run lifecycle) and
// triggers it on key-activation and after each run — never on a timer.
//
// Wording is descriptive, never scarcity theatre: "you've used 18% of today's
// budget", not "⚠ only 82% left!".

import type { RateLimitUsage } from '../lib/rateLimit'
import { formatResetIn, usagePercent, usd } from '../lib/rateLimit'

export type UsageState =
  | { status: 'shared' } // shared pool active — no bar, honest deferral line
  | { status: 'loading' }
  | { status: 'ok'; usage: RateLimitUsage }
  | { status: 'unavailable' } // read failed / unexpected shape — never a guessed bar

export default function UsageIndicator({ state, onRetry }: { state: UsageState; onRetry: () => void }) {
  if (state.status === 'shared') {
    // NOTE for the Worker patch: when the shared figure eventually lands it will
    // be a POOLED number across everyone using the site that day — word it as
    // "the shared pool is 60% used today", never as "your" usage.
    return (
      <p className="usage shared muted">
        Shared-pool usage isn’t shown yet — it arrives when BibProfile moves to its hosted version.
        Use your own key (above) to see a live budget.
      </p>
    )
  }

  if (state.status === 'loading') {
    return <p className="usage muted">Checking your OpenAlex usage…</p>
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
  const pct = usagePercent(u)
  const reset = formatResetIn(u.resetsAt)
  return (
    <div className="usage ok">
      <div className="usage-bar" role="img" aria-label={`${pct}% of your daily OpenAlex budget used`}>
        <span className={pct >= 90 ? 'over' : ''} style={{ width: `${pct}%` }} />
      </div>
      <p className="usage-text">
        You’ve used {usd(u.usedUsd)} of your {usd(u.budgetUsd)} daily budget ({pct}%).
        {reset && <> Resets {reset}.</>}{' '}
        <button type="button" className="key-link" onClick={onRetry}>Refresh</button>
      </p>
      {u.prepaidUsd != null && u.prepaidUsd > 0 && (
        <p className="usage-prepaid muted">Plus a prepaid balance of {usd(u.prepaidUsd)}.</p>
      )}
    </div>
  )
}
