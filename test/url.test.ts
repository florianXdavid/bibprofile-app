import { describe, it, expect } from 'vitest'
import { buildWorksSearchUrl, buildDoiUrl } from '../src/lib/openalex'
import { cleanTitleForSearch } from '../src/lib/titleClean'

// Fix 1: these are the regression tests for the reported 400s. Every query
// metacharacter must go out percent-encoded, via the `search` param, never
// the deprecated `filter=title.search:` syntax.
describe('buildWorksSearchUrl', () => {
  it('uses ?search= and never filter=title.search', () => {
    const url = buildWorksSearchUrl('grid cells')
    expect(url).toContain('search=')
    expect(url).not.toContain('filter=title.search')
  })
  it('percent-encodes a pipe (no bare | reaches the query)', () => {
    const url = buildWorksSearchUrl('Efficient computation of optimal actions | PNAS')
    expect(url).toContain('%7C')
    expect(url).not.toContain('|')
  })
  it('percent-encodes a trailing question mark (adds no second ?)', () => {
    const url = buildWorksSearchUrl('Is the cerebellum a smith predictor?')
    const parts = url.split('?')
    expect(parts.length).toBe(2) // exactly one query separator
    expect(parts[1]).toContain('%3F')
  })
  it('neutralises LaTeX math $ and ^', () => {
    const url = buildWorksSearchUrl('A neural network solves $L^2$ PDEs')
    expect(url).toContain('%24') // $
    expect(url).toContain('%5E') // ^
    expect(url).not.toContain('$')
    expect(url).not.toContain('^')
  })
})

describe('buildDoiUrl', () => {
  it('builds a singleton path and keeps DOI slashes', () => {
    const url = buildDoiUrl('10.1038/nature03721')
    expect(url).toContain('/works/doi:10.1038/nature03721')
  })
  it('encodes angle brackets in a legacy Wiley DOI', () => {
    const url = buildDoiUrl('10.1002/(sici)1097-0258(19990615)18:11<1387::aid-sim126>3.0.co;2-v')
    expect(url).toContain('%3C') // <
    expect(url).toContain('%3E') // >
    expect(url).not.toContain('<')
    expect(url).not.toContain('>')
  })
})

describe('clean + encode together (Fix A1 end to end)', () => {
  it('a multi-word-site pipe title cleans to the longest segment and encodes cleanly', () => {
    const url = buildWorksSearchUrl(cleanTitleForSearch('Temporal coding of X | ScienceDirect Topics'))
    expect(url).toContain('search=')
    expect(url).not.toContain('|')
    expect(url).not.toContain('%7C')          // pipe removed by cleaning, not just encoded
    expect(url.toLowerCase()).not.toContain('sciencedirect')
  })
})
