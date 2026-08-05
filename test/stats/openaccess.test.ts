import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import { computeOpenAccess } from '../../src/lib/stats/openaccess'
import { matchedRow } from './fixtures'

describe('computeOpenAccess', () => {
  const cohort = buildCohort([
    matchedRow({ isOa: true, oaStatus: 'gold' }),
    matchedRow({ isOa: true, oaStatus: 'green' }),
    matchedRow({ isOa: false, oaStatus: 'closed' }),
    matchedRow({ isOa: null, oaStatus: null }), // OA status unknown
  ])
  const oa = computeOpenAccess(cohort)

  it('computes the share over works with a KNOWN is_oa only', () => {
    expect(oa.n).toBe(3)
    expect(oa.openCount).toBe(2)
    expect(oa.shareOpen).toBeCloseTo(2 / 3)
  })

  it('reports unknown OA explicitly and never as closed', () => {
    expect(oa.unknownOa).toBe(1)
    const closed = oa.breakdown.find(b => b.status === 'closed')
    expect(closed?.count).toBe(1) // only the genuinely-closed work
    expect(oa.statusUnknown).toBe(1) // the null-status work is unknown, not closed
  })

  it('breaks OA status into the canonical buckets', () => {
    const gold = oa.breakdown.find(b => b.status === 'gold')
    const green = oa.breakdown.find(b => b.status === 'green')
    expect(gold?.count).toBe(1)
    expect(green?.count).toBe(1)
  })
})
