import { describe, it, expect } from 'vitest'
import {
  classifyDoiMatch, classifyTitleMatch, compareYears,
  dedupKey, computeDuplicates, buildRows,
} from '../src/lib/match'
import { parseBib } from '../src/lib/parseBib'
import type { BibEntry, OpenAlexWork } from '../src/types'

function entry(over: Partial<BibEntry>): BibEntry {
  return {
    rowId: 'e0', sourceOffset: 0, citeKey: 'k0', entryType: 'article',
    title: 'T', titleForSearch: 'T', authors: '', year: null, venue: '',
    doiRaw: null, doi: null, raw: '', likelyNotIndexable: false, ...over,
  }
}
function work(over: Partial<OpenAlexWork>): OpenAlexWork {
  return {
    id: 'https://openalex.org/W1', doi: null, displayName: 'X',
    publicationYear: null, hostVenue: null, citedByCount: null,
    isOa: null, type: null, primaryTopic: null,
    oaStatus: null, sourceId: null, sourceType: null, authorships: [],
    isRetracted: null, biblio: null, referencedWorks: null, ...over,
  }
}

describe('compareYears (Fix A3b)', () => {
  it('agree / disagree when both present', () => {
    expect(compareYears(2000, work({ publicationYear: 2000 }))).toBe('agree')
    expect(compareYears(2000, work({ publicationYear: 1998 }))).toBe('disagree')
  })
  it('is unverified when a year is missing on either side', () => {
    expect(compareYears(null, work({ publicationYear: 2000 }))).toBe('unverified')
    expect(compareYears(2000, work({ publicationYear: null }))).toBe('unverified')
    expect(compareYears(2000, null)).toBe('unverified')
  })
})

describe('classifyDoiMatch (Fix A2 + A3b)', () => {
  it('flags a 0.61 match as suspicious at the 0.65 cutoff', () => {
    expect(classifyDoiMatch(0.61, 'agree')).toBe('suspicious')
    expect(classifyDoiMatch(0.72, 'agree')).toBe('matched-by-doi')
  })
  it('holds disagree AND unverified to the stricter 0.75 cutoff (missing != agreement)', () => {
    expect(classifyDoiMatch(0.7, 'disagree')).toBe('suspicious')
    expect(classifyDoiMatch(0.7, 'unverified')).toBe('suspicious')
    expect(classifyDoiMatch(0.8, 'unverified')).toBe('matched-by-doi')
  })
  it('never rejects — worst case is the suspicious flag', () => {
    for (const s of [0, 0.1, 0.64]) expect(classifyDoiMatch(s, 'agree')).toBe('suspicious')
  })
})

describe('classifyTitleMatch (Fix A3a)', () => {
  it('flags an accepted-but-weak 0.83 title match as suspicious', () => {
    expect(classifyTitleMatch(0.83)).toBe('suspicious')
  })
  it('trusts a strong title match', () => {
    expect(classifyTitleMatch(0.85)).toBe('matched-by-title')
    expect(classifyTitleMatch(0.95)).toBe('matched-by-title')
  })
})

describe('dedup (Fix 6)', () => {
  it('keys by DOI, else normalised title', () => {
    expect(dedupKey(entry({ doi: '10.1038/nature03721' }))).toBe('doi:10.1038/nature03721')
    expect(dedupKey(entry({ doi: null, title: 'Grid Cells!', titleForSearch: 'Grid Cells!' }))).toBe('title:grid cells')
  })
  it('maps a duplicate DOI to its canonical cite key', () => {
    const a = entry({ rowId: 'e0', citeKey: 'hafting2005', doi: '10.1038/nature03721' })
    const b = entry({ rowId: 'e1', citeKey: 'hafting2005-1', doi: '10.1038/nature03721' })
    const dup = computeDuplicates([a, b])
    expect(dup.get('e1')).toBe('hafting2005')
    expect(dup.has('e0')).toBe(false)
  })
})

describe('buildRows preserves .bib file order (Fix A5)', () => {
  it('interleaves parsed and unparseable rows by source position', () => {
    const bib = [
      '@article{aaa, title={A}, doi={10.1/a}}',
      '',
      '@article{brokenmid,',
      '  title {no equals sign here}',
      '}',
      '',
      '@article{bbb, title={B}, doi={10.1/b}}',
    ].join('\n')
    const rows = buildRows(parseBib(bib))
    expect(rows.map(r => r.citeKey)).toEqual(['aaa', 'brokenmid', 'bbb'])
  })
})
