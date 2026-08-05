// Card 4 — Open access. Share of references that are OA, a breakdown by
// `oa_status`, and an EXPLICIT count of works whose OA status is unknown.
//
// Honesty rule: unknown is never silently folded into "closed". `closed` is a
// real OpenAlex status (the work is indexed and known to be paywalled); unknown
// means OpenAlex did not report a status. They are counted separately.

import { subset, type Cohort, type Stat } from './denominator'

// Canonical oa_status values, in the order we display them.
export const OA_STATUSES = ['gold', 'green', 'hybrid', 'bronze', 'closed'] as const
export type OaStatus = (typeof OA_STATUSES)[number]

export interface OaBreakdownRow {
  status: OaStatus | 'other'
  count: number
}

export interface OpenAccessStats extends Stat {
  openCount: number // isOa === true
  closedCount: number // isOa === false
  shareOpen: number | null // openCount / (works with a known is_oa) — 0..1
  unknownOa: number // works with is_oa null/missing
  breakdown: OaBreakdownRow[] // over works with a known oa_status
  statusKnown: number // works with a non-null oa_status
  statusUnknown: number // works with no oa_status
}

export function computeOpenAccess(cohort: Cohort): OpenAccessStats {
  // Denominator for the headline %: works where is_oa is known either way.
  const { used, n, flagged, excluded } = subset(
    cohort,
    w => typeof w.work.isOa === 'boolean',
    'no OA data',
  )

  const openCount = used.filter(w => w.work.isOa === true).length
  const closedCount = used.filter(w => w.work.isOa === false).length
  const unknownOa = cohort.works.length - used.length

  // Breakdown is over the (possibly different) set with a known oa_status.
  const counts = new Map<string, number>()
  let statusKnown = 0
  for (const w of cohort.works) {
    const s = w.work.oaStatus
    if (!s) continue
    statusKnown++
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }

  const breakdown: OaBreakdownRow[] = []
  for (const s of OA_STATUSES) {
    const c = counts.get(s) ?? 0
    if (c > 0) breakdown.push({ status: s, count: c })
  }
  // Anything OpenAlex reports outside the canonical five (rare) rolls into "other".
  let other = 0
  for (const [s, c] of counts) if (!OA_STATUSES.includes(s as OaStatus)) other += c
  if (other > 0) breakdown.push({ status: 'other', count: other })

  return {
    n, flagged, excluded,
    openCount,
    closedCount,
    shareOpen: n > 0 ? openCount / n : null,
    unknownOa,
    breakdown,
    statusKnown,
    statusUnknown: cohort.works.length - statusKnown,
  }
}
