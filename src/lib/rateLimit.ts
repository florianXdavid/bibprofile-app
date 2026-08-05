// W4.1 — usage readout for the USER-KEY path. Pure mapping + format helpers for
// the OpenAlex `/rate-limit` response. (The fetch itself lives in openalex.ts.)
//
// OpenAlex moved to usage-based, dollar-denominated pricing and the response
// shape has changed before, so this parser is DEFENSIVE: it scans for `_usd`
// figures and a reset field by meaning, not by one hard-coded field name, and
// returns null (-> "usage unavailable") when it can't find enough to render an
// honest bar. Do NOT hard-code a "$1/day" figure or a midnight/local-time reset
// assumption — read both from the payload.

export interface RateLimitUsage {
  usedUsd: number
  budgetUsd: number
  remainingUsd: number
  prepaidUsd: number | null
  resetsAt: string | null // ISO string, or null if the payload didn't carry one
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Flatten one level so nested shapes (e.g. { daily: { used_usd: … } }) are
// reachable; keys lowercased for matching.
function flatten(raw: unknown): [string, unknown][] {
  const out: [string, unknown][] = []
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out.push([k.toLowerCase(), v])
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out.push([`${k}.${k2}`.toLowerCase(), v2])
      }
    }
  }
  return out
}

// A dollar figure whose (flattened) key contains one of `needles` and looks
// USD-denominated. Explicit intent, tolerant of renames.
function findUsd(entries: [string, unknown][], needles: string[]): number | null {
  for (const needle of needles) {
    for (const [k, v] of entries) {
      if (isNum(v) && k.includes(needle) && (k.includes('usd') || k.includes('dollar'))) return v
    }
  }
  return null
}

function findReset(entries: [string, unknown][], nowMs: number): string | null {
  for (const [k, v] of entries) {
    if (typeof v === 'string' && k.includes('reset') && /\d{4}-\d\d-\d\d/.test(v)) return v
  }
  for (const [k, v] of entries) {
    if (isNum(v) && k.includes('reset') && (k.includes('second') || k.includes('_in'))) {
      return new Date(nowMs + v * 1000).toISOString()
    }
  }
  return null
}

// Map a raw `/rate-limit` payload to our usage shape, or null if it doesn't carry
// enough (-> the UI shows "unavailable", never a guessed 0 bar).
export function parseRateLimit(raw: unknown, nowMs: number = Date.now()): RateLimitUsage | null {
  const entries = flatten(raw)
  if (entries.length === 0) return null

  let budget = findUsd(entries, ['budget', 'limit', 'allowance'])
  let used = findUsd(entries, ['used', 'usage', 'spent', 'consumed'])
  let remaining = findUsd(entries, ['remaining', 'left'])
  const prepaid = findUsd(entries, ['prepaid', 'balance', 'credit'])

  // Fill in a missing member of budget/used/remaining from the other two.
  if (budget == null && used != null && remaining != null) budget = used + remaining
  if (used == null && budget != null && remaining != null) used = Math.max(budget - remaining, 0)
  if (remaining == null && budget != null && used != null) remaining = Math.max(budget - used, 0)

  if (budget == null || used == null) return null // not enough to render a bar
  if (remaining == null) remaining = Math.max(budget - used, 0)

  return { usedUsd: used, budgetUsd: budget, remainingUsd: remaining, prepaidUsd: prepaid, resetsAt: findReset(entries, nowMs) }
}

// Whole-number percent of the daily budget used, clamped to 0..100.
export function usagePercent(u: RateLimitUsage): number {
  if (u.budgetUsd <= 0) return u.usedUsd > 0 ? 100 : 0
  return Math.min(100, Math.max(0, Math.round((u.usedUsd / u.budgetUsd) * 100)))
}

export function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

// "in 6h", "in 6h 30m", "in 45m", "soon", or '' if unknown — for the live bar.
export function formatResetIn(resetsAt: string | null, nowMs: number = Date.now()): string {
  if (!resetsAt) return ''
  const t = Date.parse(resetsAt)
  if (Number.isNaN(t)) return ''
  const mins = Math.round((t - nowMs) / 60000)
  if (mins <= 0) return 'soon'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h >= 1) return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
  return `in ${m}m`
}

// "18:00 UTC" — used in the exhaustion message (the reset is UTC, not local
// midnight). '' if unknown, so the caller can fall back to "tomorrow".
export function formatResetClockUtc(resetsAt: string | null): string {
  if (!resetsAt) return ''
  const d = new Date(resetsAt)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} UTC`
}
