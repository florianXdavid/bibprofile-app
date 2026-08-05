import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import {
  computeRecency, median, quantile, shareWithinLast,
} from '../../src/lib/stats/recency'
import { matchedRow } from './fixtures'

describe('median / quantile / window helpers', () => {
  it('median handles odd and even lengths', () => {
    expect(median([2010, 2016, 2022])).toBe(2016)
    expect(median([2010, 2020])).toBe(2015)
    expect(median([])).toBeNull()
  })

  it('quantile gives a clean IQR on a 7-point series', () => {
    const s = [2010, 2012, 2014, 2016, 2018, 2020, 2022]
    expect(quantile(s, 0.25)).toBe(2013)
    expect(quantile(s, 0.75)).toBe(2019)
  })

  it('shareWithinLast uses an inclusive N-year window', () => {
    // ref 2024, last 5 -> cutoff 2020; 3 of 4 qualify
    expect(shareWithinLast([2020, 2021, 2022, 2018], 5, 2024)).toBeCloseTo(0.75)
  })
})

describe('computeRecency', () => {
  const cohort = buildCohort([
    matchedRow({ publicationYear: 2016 }, { citeKey: 'mid', title: 'Middle paper' }),
    matchedRow({ publicationYear: 1990 }, { citeKey: 'old', title: 'Ancient paper' }),
    matchedRow({ publicationYear: 2022 }, { citeKey: 'new', title: 'Fresh paper' }),
    matchedRow({ publicationYear: null }, { citeKey: 'noyear' }), // excluded from n
  ])
  const r = computeRecency(cohort, 2024)

  it('excludes works with no year from its own n', () => {
    expect(r.n).toBe(3)
  })

  it('reports median and names the oldest / newest reference', () => {
    expect(r.medianYear).toBe(2016)
    expect(r.oldest).toMatchObject({ year: 1990, citeKey: 'old', title: 'Ancient paper' })
    expect(r.newest).toMatchObject({ year: 2022, citeKey: 'new', title: 'Fresh paper' })
  })

  it('switches to 2-year bins once the span exceeds 24 years', () => {
    // span 1990..2022 = 32 -> binSize 2
    expect(r.binSize).toBe(2)
    const total = r.bins.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(3)
  })

  it('uses 1-year bins for a tight span', () => {
    const tight = computeRecency(
      buildCohort([
        matchedRow({ publicationYear: 2018 }),
        matchedRow({ publicationYear: 2020 }),
      ]),
      2024,
    )
    expect(tight.binSize).toBe(1)
  })
})
