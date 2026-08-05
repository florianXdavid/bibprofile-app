import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import { computeVenues, isPreprintVenue, normalizeVenueName } from '../../src/lib/stats/venues'
import { matchedRow } from './fixtures'

describe('venue helpers', () => {
  it('detects preprint servers by name or repository type', () => {
    expect(isPreprintVenue('arXiv', null)).toBe(true)
    expect(isPreprintVenue('bioRxiv', 'repository')).toBe(true)
    expect(isPreprintVenue('NeuroImage', 'journal')).toBe(false)
  })

  it('normalises variant venue names', () => {
    expect(normalizeVenueName('The Journal of Neuroscience')).toBe('journal of neuroscience')
  })
})

describe('computeVenues', () => {
  const cohort = buildCohort([
    // Same journal under two display names but one source id -> must collapse.
    matchedRow({ hostVenue: 'NeuroImage', sourceId: 'S_ni', sourceType: 'journal' }),
    matchedRow({ hostVenue: 'Neuroimage', sourceId: 'S_ni', sourceType: 'journal' }),
    matchedRow({ hostVenue: 'NeuroImage', sourceId: 'S_ni', sourceType: 'journal' }),
    matchedRow({ hostVenue: 'Journal of Neurophysiology', sourceId: 'S_jn', sourceType: 'journal' }),
    matchedRow({ hostVenue: 'Journal of Neurophysiology', sourceId: 'S_jn', sourceType: 'journal' }),
    matchedRow({ hostVenue: 'Nature', sourceId: 'S_nat', sourceType: 'journal' }),
    matchedRow({ hostVenue: 'arXiv', sourceId: 'S_arx', sourceType: 'repository' }),
    matchedRow({ hostVenue: null }), // excluded from n
  ])
  const v = computeVenues(cohort)

  it('excludes works with no venue from its own n', () => {
    expect(v.n).toBe(7) // 8 rows, 1 has no venue
  })

  it('collapses variant names sharing a source id', () => {
    expect(v.topVenue).toMatchObject({ name: 'NeuroImage', count: 3 })
    expect(v.distinctJournals).toBe(3) // NeuroImage, J Neurophys, Nature
  })

  it('separates preprint servers from journals', () => {
    expect(v.preprintWorks).toBe(1)
    expect(v.journalWorks).toBe(6)
    expect(v.journals.some(j => j.name === 'arXiv')).toBe(false)
  })

  it('computes the top-3 venue share over journal works', () => {
    // top 3 journals: 3 + 2 + 1 = 6 of 6 journal works
    expect(v.top3Share).toBeCloseTo(6 / 6)
  })
})
