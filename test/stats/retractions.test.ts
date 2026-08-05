import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import { computeRetractions } from '../../src/lib/stats/retractions'
import { matchedRow } from './fixtures'

describe('computeRetractions', () => {
  it('flags only works OpenAlex marks retracted, with cite key and title', () => {
    const cohort = buildCohort([
      matchedRow({ isRetracted: true, displayName: 'A withdrawn study' }, { citeKey: 'bad2015', title: 'A withdrawn study' }),
      matchedRow({ isRetracted: false }, { citeKey: 'ok2019' }),
      matchedRow({ isRetracted: false }, { citeKey: 'ok2020' }),
    ])
    const r = computeRetractions(cohort)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]).toMatchObject({ citeKey: 'bad2015', bibTitle: 'A withdrawn study' })
    expect(r.checked).toBe(3)
  })

  it('counts unknown retraction status separately (never assumed clean)', () => {
    const cohort = buildCohort([
      matchedRow({ isRetracted: true }, { citeKey: 'bad' }),
      matchedRow({ isRetracted: null }, { citeKey: 'unknown' }),
    ])
    const r = computeRetractions(cohort)
    expect(r.hits).toHaveLength(1)
    expect(r.checked).toBe(1)
    expect(r.unknown).toBe(1)
  })

  it('is empty on a clean list', () => {
    const cohort = buildCohort([
      matchedRow({ isRetracted: false }, { citeKey: 'a' }),
      matchedRow({ isRetracted: false }, { citeKey: 'b' }),
    ])
    expect(computeRetractions(cohort).hits).toEqual([])
  })
})
