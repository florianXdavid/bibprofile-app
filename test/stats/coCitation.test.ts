import { describe, it, expect } from 'vitest'
import { bareId, computeCoCitation, computeForwardCitation } from '../../src/lib/stats/coCitation'
import { GAPS_COCITATION_FLOOR, GAPS_FORWARD_FLOOR, GAPS_TOP_CANDIDATES } from '../../src/config'

describe('bareId', () => {
  it('strips the OpenAlex URL prefix', () => {
    expect(bareId('https://openalex.org/W123')).toBe('W123')
    expect(bareId('W123')).toBe('W123')
  })
})

describe('computeCoCitation', () => {
  const userWorks = [
    { citeKey: 'a', id: 'W1', referencedWorks: ['W10', 'W11', 'W2', 'W99'] }, // W2 is in the set
    { citeKey: 'b', id: 'W2', referencedWorks: ['W10', 'W11'] },
    { citeKey: 'c', id: 'W3', referencedWorks: ['W10', 'W10'] }, // duplicate ref within one work
  ]

  it('ranks by how many user works cite each referenced work', () => {
    const out = computeCoCitation(userWorks, 2)
    expect(out[0]).toMatchObject({ id: 'W10', count: 3 })
    expect(out[1]).toMatchObject({ id: 'W11', count: 2 })
  })

  it('drops referenced works already in the user set', () => {
    const out = computeCoCitation(userWorks, 2)
    expect(out.find(c => c.id === 'W2')).toBeUndefined()
  })

  it('counts a within-work duplicate reference only once', () => {
    const out = computeCoCitation(userWorks, 2)
    expect(out.find(c => c.id === 'W10')!.count).toBe(3) // not 4, despite W3 listing it twice
  })

  it('applies the minimum-count floor and records transparent citedBy keys', () => {
    const out = computeCoCitation(userWorks, 2)
    expect(out.find(c => c.id === 'W99')).toBeUndefined() // count 1 < floor
    expect(out.find(c => c.id === 'W10')!.citedBy.sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('computeForwardCitation', () => {
  const seeds = ['W1', 'W2', 'W3']
  const citing = [
    { id: 'W100', referencedWorks: ['W1', 'W2', 'W9'] }, // cites 2 seeds
    { id: 'W101', referencedWorks: ['W1'] }, // cites 1 seed
    { id: 'W2', referencedWorks: ['W1'] }, // a seed itself — must be excluded
  ]

  it('ranks citing works by how many seeds they cite, excluding seeds themselves', () => {
    const out = computeForwardCitation(seeds, citing, 2)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'W100', count: 2 })
    expect(out[0].seeds.sort()).toEqual(['W1', 'W2'])
  })
})

// --- W3.1: the configured floors and the shared cap -----------------------
describe('W3.1 gap floors and cap', () => {
  it('co-citation floor (4): a 3-citer candidate is excluded, a 4-citer is included', () => {
    // WA cited by 4 works, WB by 3.
    const uw = [1, 2, 3, 4].map(i => ({
      citeKey: `k${i}`, id: `W${i}`,
      referencedWorks: i <= 3 ? ['WA', 'WB'] : ['WA'],
    }))
    const out = computeCoCitation(uw, GAPS_COCITATION_FLOOR)
    expect(out.find(c => c.id === 'WA')?.count).toBe(4) // included
    expect(out.find(c => c.id === 'WB')).toBeUndefined() // 3 < floor 4
  })

  it('forward floor (2): a 1-seed citer is excluded, a 2-seed citer is included', () => {
    const seeds = ['W1', 'W2', 'W3']
    const citing = [
      { id: 'A', referencedWorks: ['W1', 'W2'] }, // cites 2 -> in
      { id: 'B', referencedWorks: ['W1'] }, // cites 1 -> out
    ]
    const out = computeForwardCitation(seeds, citing, GAPS_FORWARD_FLOOR)
    expect(out.map(c => c.id)).toEqual(['A'])
  })

  it('shared cap (30): more than 30 qualifying results truncate to 30, ranked', () => {
    // 5 works each cite 35 candidates C0..C34; two extra works cite only C0.
    const many = [0, 1, 2, 3, 4].map(i => ({
      citeKey: `u${i}`, id: `U${i}`,
      referencedWorks: Array.from({ length: 35 }, (_, j) => `C${j}`),
    }))
    many.push({ citeKey: 'x1', id: 'X1', referencedWorks: ['C0'] })
    many.push({ citeKey: 'x2', id: 'X2', referencedWorks: ['C0'] })

    const ranked = computeCoCitation(many, GAPS_COCITATION_FLOOR)
    expect(ranked.length).toBe(35) // all clear the floor (each cited >= 5 times)
    expect(ranked[0].id).toBe('C0') // highest count (7) ranked first
    const capped = ranked.slice(0, GAPS_TOP_CANDIDATES)
    expect(capped.length).toBe(30)
    expect(capped[0].id).toBe('C0')
  })
})
