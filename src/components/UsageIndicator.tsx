// W4.1 — usage indicator. Presentational: renders one of three states from
// props; App owns the fetch (it owns the active credential + run lifecycle) and
// triggers it on key-activation and after each run — never on a timer.
//
// Wording is descriptive, never scarcity theatre: "you've used 18% of today's
// budget", not "⚠ only 82% left!".

import type { RateLimitUsage } from '../lib/rateLimit'
import { formatResetIn, usagePercent, usd } from '../lib/rateLimit'

// 1b (v1.3) — collapsed "?" explainer for the shared pool. Native <details>, no
// state and no dependency; expands one sentence inline.
function PoolHelp() {
  return (
    <details className="pool-help">
      <summary title="What is the shared pool?">?</summary>
      <span className="pool-help-text">
        This is a free daily budget shared by everyone using BibProfile. If it runs low, add your own
        free OpenAlex key to use your own budget.
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
    // "the shared pool has used …", never "your" usage.
    return (
      <p className="usage shared muted">
        Using the shared pool — its usage appears here after your first lookup.
        Or use your own key (above) for your own budget. <PoolHelp />
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
  const shared = state.scope === 'shared'
  const label = shared
    ? `${pct}% of the shared daily OpenAlex budget used`
    : `${pct}% of your daily OpenAlex budget used`
  return (
    <div className="usage ok">
      <div className="usage-bar" role="img" aria-label={label}>
        <span className={pct >= 90 ? 'over' : ''} style={{ width: `${pct}%` }} />
      </div>
      <p className="usage-text">
        {shared ? (
          <>The shared pool has used {usd(u.usedUsd)} of today’s {usd(u.budgetUsd)} budget ({pct}%).</>
        ) : (
          <>You’ve used {usd(u.usedUsd)} of your {usd(u.budgetUsd)} daily budget ({pct}%).</>
        )}
        {reset && <> Resets {reset}.</>}{' '}
        <button type="button" className="key-link" onClick={onRetry}>Refresh</button>
        {shared && <> <PoolHelp /></>}
      </p>
      {u.prepaidUsd != null && u.prepaidUsd > 0 && (
        <p className="usage-prepaid muted">Plus a prepaid balance of {usd(u.prepaidUsd)}.</p>
      )}
    </div>
  )
}
