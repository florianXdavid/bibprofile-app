import { describe, it, expect } from 'vitest'
import {
  buildCohort, subset, withYear, describeBasis, uniqueWorkCount,
} from '../../src/lib/stats/denominator'
import { mkRow, matchedRow } from './fixtures'

describe('buildCohort — the four denominator rules', () => {
  it('rule 1: duplicates count once (excluded from works, counted separately)', () => {
    const rows = [
      matchedRow({ publicationYear: 2020 }, { citeKey: 'a' }),
      mkRow({ citeKey: 'a2', status: 'matched-by-doi', duplicateOf: 'a', openalex: null }),
    ]
    const c = buildCohort(rows)
    expect(c.works).toHaveLength(1)
    expect(c.excluded.duplicates).toBe(1)
    expect(c.uniqueEntries).toBe(1)
    expect(c.totalEntries).toBe(2)
  })

  it('rule 2: suspicious is included but flagged', () => {
    const rows = [
      matchedRow({ publicationYear: 2020 }, { status: 'matched-by-doi' }),
      matchedRow({ publicationYear: 2019 }, { status: 'suspicious' }),
    ]
    const c = buildCohort(rows)
    expect(c.works).toHaveLength(2)
    expect(c.flagged).toBe(1)
  })

  it('rule 3: not-indexable is excluded from works and reported separately', () => {
    const rows = [
      matchedRow({ publicationYear: 2020 }),
      mkRow({ status: 'not-indexable', openalex: null }),
    ]
    const c = buildCohort(rows)
    expect(c.works).toHaveLength(1)
    expect(c.excluded.notIndexable).toBe(1)
  })

  it('not-found / error / unparseable are excluded and tallied', () => {
    const rows = [
      matchedRow({ publicationYear: 2020 }),
      mkRow({ status: 'not-found', openalex: null }),
      mkRow({ status: 'error', openalex: null }),
      mkRow({ status: 'unparseable', openalex: null }),
    ]
    const c = buildCohort(rows)
    expect(c.works).toHaveLength(1)
    expect(c.excluded).toMatchObject({ notFound: 1, errored: 1, unparseable: 1 })
  })

  it('a matched status with no OpenAlex data is not silently counted', () => {
    const rows = [mkRow({ status: 'matched-by-title', openalex: null })]
    const c = buildCohort(rows)
    expect(c.works).toHaveLength(0)
    expect(c.excluded.matchedNoData).toBe(1)
  })
})

describe('subset — rule 4: each card its own n', () => {
  it('drops works lacking the field and records the reason', () => {
    const c = buildCohort([
      matchedRow({ hostVenue: 'NeuroImage' }),
      matchedRow({ hostVenue: null }),
      matchedRow({ hostVenue: 'Cell', }, { status: 'suspicious' }),
    ])
    const s = subset(c, w => !!w.work.hostVenue, 'no venue')
    expect(s.n).toBe(2)
    expect(s.flagged).toBe(1) // the suspicious one has a venue
    expect(s.excluded).toEqual({ 'no venue': 1 })
  })

  it('withYear keeps only works with a publication year', () => {
    const c = buildCohort([
      matchedRow({ publicationYear: 2020 }),
      matchedRow({ publicationYear: null }),
    ])
    expect(withYear(c).n).toBe(1)
  })
})

describe('describeBasis + uniqueWorkCount', () => {
  it('describes n, flagged, and exclusions in plain language', () => {
    const s = { n: 478, flagged: 3, excluded: { 'no venue': 12 } }
    const text = describeBasis(s)
    expect(text).toContain('478 works')
    expect(text).toContain('3 flagged as uncertain')
    expect(text).toContain('12 excluded (no venue)')
  })

  it('uniqueWorkCount = total − duplicates − unparseable', () => {
    const c = buildCohort([
      matchedRow({ publicationYear: 2020 }, { citeKey: 'a' }),
      mkRow({ citeKey: 'a2', duplicateOf: 'a', openalex: null }),
      mkRow({ status: 'unparseable', openalex: null }),
    ])
    // total 3, 1 duplicate, 1 unparseable -> 1 unique work
    expect(uniqueWorkCount(c)).toBe(1)
  })
})
