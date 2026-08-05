import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import { computeShape, largestYearGap } from '../../src/lib/stats/shape'
import { matchedRow } from './fixtures'
import type { ResultRow } from '../../src/types'

// Build a cohort from a list of years (+ optional shared venue).
function cohortOfYears(years: number[], venue?: { name: string; id: string }): ReturnType<typeof buildCohort> {
  const rows: ResultRow[] = years.map((y, i) =>
    matchedRow(
      venue
        ? { publicationYear: y, hostVenue: venue.name, sourceId: venue.id, sourceType: 'journal' }
        : { publicationYear: y },
      { citeKey: `k${i}` },
    ),
  )
  return buildCohort(rows)
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('largestYearGap', () => {
  it('finds the biggest interior gap and its bracket years', () => {
    expect(largestYearGap([2000, 2001, 2018, 2019])).toEqual({ gap: 17, before: 2001, after: 2018 })
    expect(largestYearGap([2020])).toBeNull()
  })
})

describe('computeShape — min-n floor', () => {
  it('surfaces nothing below the floor', () => {
    const s = computeShape(cohortOfYears(range(2010, 2019)), 2026) // 10 works
    expect(s.belowFloor).toBe(true)
    expect(s.patterns).toEqual([])
  })
})

describe('computeShape — patterns (n above floor)', () => {
  it('flags a stale tail as a date fact, not a criticism', () => {
    // 20 works spread 2001..2020 (span 19, not narrow), newest 2020, ref 2026
    const years = [...range(2001, 2020)]
    const s = computeShape(cohortOfYears(years), 2026)
    expect(s.belowFloor).toBe(false)
    const stale = s.patterns.find(p => p.kind === 'stale-tail')
    expect(stale).toBeTruthy()
    expect(stale!.text).toContain('2020')
    expect(s.patterns.find(p => p.kind === 'narrow-window')).toBeFalsy()
  })

  it('flags a narrow window when everything is within a few years', () => {
    // 20 works within 2019..2024 (span 5), ref 2024 -> not stale
    const years = [...range(2019, 2024), ...range(2019, 2024), ...range(2019, 2024), 2020, 2021]
    const s = computeShape(cohortOfYears(years), 2024)
    expect(s.patterns.find(p => p.kind === 'narrow-window')).toBeTruthy()
    expect(s.patterns.find(p => p.kind === 'stale-tail')).toBeFalsy()
  })

  it('flags a visible gap between an old and a recent cluster', () => {
    const years = [...range(2000, 2004), ...range(2000, 2004), ...range(2018, 2022), ...range(2018, 2022)]
    const s = computeShape(cohortOfYears(years), 2024)
    const gap = s.patterns.find(p => p.kind === 'gap')
    expect(gap).toBeTruthy()
    expect(gap!.text).toContain('2004')
    expect(gap!.text).toContain('2018')
  })

  it('reports venue concentration by reusing the venues computation', () => {
    const s = computeShape(cohortOfYears(range(2005, 2024), { name: 'NeuroImage', id: 'S1' }), 2026)
    const conc = s.patterns.find(p => p.kind === 'concentration')
    expect(conc).toBeTruthy()
    expect(conc!.text).toContain('NeuroImage')
  })
})
