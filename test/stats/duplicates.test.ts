import { describe, it, expect } from 'vitest'
import { citeKeyStyle, computeDuplicateReport } from '../../src/lib/stats/duplicates'
import { matchedRow, mkRow } from './fixtures'

describe('citeKeyStyle', () => {
  it('distinguishes snake_case from camelCase keys', () => {
    expect(citeKeyStyle('todorov_optimality_2004')).not.toBe(citeKeyStyle('todorov2004Optimality'))
  })
})

describe('computeDuplicateReport', () => {
  it('groups every cite key onto its canonical work and flags mixed key styles', () => {
    const rows = [
      matchedRow({}, { citeKey: 'todorov_optimality_2004', title: 'Optimality principles' }),
      mkRow({ citeKey: 'todorov2004Optimality', duplicateOf: 'todorov_optimality_2004', openalex: null }),
    ]
    const rep = computeDuplicateReport(rows)
    expect(rep.duplicatedWorks).toBe(1)
    expect(rep.totalCollapsed).toBe(1)
    const g = rep.groups[0]
    expect(g.citeKeys).toEqual(['todorov_optimality_2004', 'todorov2004Optimality'])
    expect(g.count).toBe(2)
    expect(g.mixedKeyStyles).toBe(true)
    expect(rep.mixedStyleGroups).toBe(1)
  })

  it('does not flag mixed styles when the keys share a convention', () => {
    const rows = [
      matchedRow({}, { citeKey: 'smith_2020_a' }),
      mkRow({ citeKey: 'smith_2020_b', duplicateOf: 'smith_2020_a', openalex: null }),
    ]
    const g = computeDuplicateReport(rows).groups[0]
    expect(g.mixedKeyStyles).toBe(false)
  })

  it('is quiet on a clean bibliography', () => {
    const rows = [matchedRow({}, { citeKey: 'a' }), matchedRow({}, { citeKey: 'b' })]
    const rep = computeDuplicateReport(rows)
    expect(rep.duplicatedWorks).toBe(0)
    expect(rep.totalCollapsed).toBe(0)
    expect(rep.groups).toEqual([])
  })
})
