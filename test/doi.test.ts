import { describe, it, expect } from 'vitest'
import { normalizeDoi } from '../src/lib/doi'

describe('normalizeDoi', () => {
  it('preserves interior angle brackets in legacy Wiley DOIs', () => {
    const raw = '10.1002/(SICI)1097-0258(19990615)18:11<1387::AID-SIM126>3.0.CO;2-V'
    expect(normalizeDoi(raw)).toBe(
      '10.1002/(sici)1097-0258(19990615)18:11<1387::aid-sim126>3.0.co;2-v',
    )
  })
  it('strips https/doi: prefixes and lowercases', () => {
    expect(normalizeDoi('https://doi.org/10.1038/NATURE03721')).toBe('10.1038/nature03721')
    expect(normalizeDoi('doi:10.1113/jphysiol.1973.sp010273')).toBe('10.1113/jphysiol.1973.sp010273')
    expect(normalizeDoi('  10.1038/NN1525  ')).toBe('10.1038/nn1525')
  })
  it('un-escapes a stray \\_ inside a DOI', () => {
    expect(normalizeDoi('10.1000/foo\\_bar')).toBe('10.1000/foo_bar')
  })
  it('returns null for non-DOIs', () => {
    expect(normalizeDoi('')).toBeNull()
    expect(normalizeDoi('see reference list')).toBeNull()
  })
})
