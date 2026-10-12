import { describe, it, expect } from 'vitest'
import {
  credits,
  formatResetClockUtc,
  formatResetIn,
  parseRateLimit,
  toCredits,
  usagePercent,
  usd,
} from '../src/lib/rateLimit'

const now = Date.parse('2026-01-01T12:00:00Z')

describe('parseRateLimit — defensive over _usd + reset fields', () => {
  it('reads a usage-based payload; percent + reset derived from it (not hard-coded)', () => {
    const u = parseRateLimit({
      daily_budget_usd: 1.0,
      daily_used_usd: 0.18,
      daily_remaining_usd: 0.82,
      prepaid_balance_usd: 5.0,
      resets_at: '2026-01-01T18:00:00Z',
    }, now)!
    expect(u.budgetUsd).toBe(1)
    expect(u.usedUsd).toBeCloseTo(0.18)
    expect(u.remainingUsd).toBeCloseTo(0.82)
    expect(u.prepaidUsd).toBe(5)
    expect(u.resetsAt).toBe('2026-01-01T18:00:00Z')
    expect(usagePercent(u)).toBe(18)
    expect(formatResetIn(u.resetsAt, now)).toBe('in 6h')
    expect(formatResetClockUtc(u.resetsAt)).toBe('18:00 UTC') // UTC, not local
  })

  it('tolerates renamed / nested fields and resets_in_seconds', () => {
    const u = parseRateLimit({ daily: { budget_usd: 2, spent_usd: 0.5 }, rate_limit_resets_in_seconds: 3600 }, now)!
    expect(u.budgetUsd).toBe(2)
    expect(u.usedUsd).toBe(0.5)
    expect(u.remainingUsd).toBe(1.5) // derived
    expect(u.resetsAt).toBe(new Date(now + 3600 * 1000).toISOString())
    expect(usagePercent(u)).toBe(25)
  })

  it('derives a missing budget from used + remaining', () => {
    expect(parseRateLimit({ used_usd: 0.3, remaining_usd: 0.7 }, now)!.budgetUsd).toBeCloseTo(1.0)
  })

  it('returns null (→ "unavailable") when the fields are absent — never a guessed 0 bar', () => {
    expect(parseRateLimit({ some: 'thing', count: 5 }, now)).toBeNull()
    expect(parseRateLimit(null, now)).toBeNull()
    expect(parseRateLimit({ daily_used_usd: 0.2 }, now)).toBeNull() // used alone, no budget/remaining
  })
})

describe('formatting helpers', () => {
  it('clamps percent and formats dollars', () => {
    expect(usagePercent({ usedUsd: 2, budgetUsd: 1, remainingUsd: 0, prepaidUsd: null, resetsAt: null })).toBe(100)
    expect(usd(0.1)).toBe('$0.10')
  })

  it('formats reset windows and blanks unknowns', () => {
    expect(formatResetIn('2026-01-01T12:45:00Z', now)).toBe('in 45m')
    expect(formatResetIn('2026-01-01T18:30:00Z', now)).toBe('in 6h 30m')
    expect(formatResetIn(null, now)).toBe('')
    expect(formatResetClockUtc(null)).toBe('')
  })
})

// v1.5.4 — the UI shows credits, never dollars.
describe('credits (v1.5.4)', () => {
  it('converts the USD payload to credits (1 credit = one billable call)', () => {
    expect(toCredits(1)).toBe(1000)
    expect(toCredits(0.22)).toBe(220)
    expect(toCredits(0.0004)).toBe(0)
  })
  it('formats with a thousands separator and singular/plural', () => {
    expect(credits(1)).toBe('1 credit')
    expect(credits(780)).toBe('780 credits')
    expect(credits(1000)).toBe('1,000 credits')
  })
})
