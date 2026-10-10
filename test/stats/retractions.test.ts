import { describe, it, expect } from 'vitest'
import { computeRetractions, retractionDois } from '../../src/lib/stats/retractions'
import { parseCrossrefItems, type CrossrefResult } from '../../src/lib/crossref'
import { matchedRow, mkRow } from './fixtures'
import type { BibEntry } from '../../src/types'

// v1.4.2: computeRetractions takes rows (+ optional Crossref result) instead of a
// cohort, and merges several signals. These replace the W3 OpenAlex-only tests.

const entry = (over: Partial<BibEntry> = {}): BibEntry => ({
  rowId: 'x', sourceOffset: 0, citeKey: 'x', entryType: 'article', title: 'T', titleForSearch: 'T',
  authors: '', year: null, venue: '', doiRaw: null, doi: null, firstAuthor: '', volume: '', pages: '',
  titleRetracted: false, altId: null, dupKeyIndex: null, raw: '', likelyNotIndexable: false, ...over,
})
const xr = (updates: CrossrefResult['updates'], checked = 1): CrossrefResult => ({ updates, checked, failed: 0 })

describe('computeRetractions — OpenAlex signals', () => {
  it('flags works OpenAlex marks retracted, with cite key and title', () => {
    const r = computeRetractions([
      matchedRow({ isRetracted: true, displayName: 'A withdrawn study' }, { citeKey: 'bad2015', title: 'A withdrawn study' }),
      matchedRow({ isRetracted: false }, { citeKey: 'ok2019' }),
    ])
    expect(r.retracted.map(f => f.citeKey)).toEqual(['bad2015'])
    expect(r.retracted[0].signals).toEqual(['openalex'])
    expect(r.checked).toBe(2)
  })
  it('the Wakefield case: the matched record is an unflagged duplicate, but a same-work twin is flagged', () => {
    const r = computeRetractions([
      matchedRow({ isRetracted: false }, { citeKey: 'wakefield1998', twins: [{ id: 'W2117847125', doi: '10.1016/s0140-6736(97)11096-0', isRetracted: true }] }),
    ])
    expect(r.retracted[0].signals).toEqual(['openalex-duplicate'])
  })
  it('flags a retraction prefix in the .bib title, even when nothing matched', () => {
    const r = computeRetractions([mkRow({ status: 'not-found', openalex: null, citeKey: 'x', entry: entry({ titleRetracted: true }) })])
    expect(r.retracted[0].signals).toEqual(['title'])
  })
  it('counts references it could not check at all separately (never assumed clean)', () => {
    const r = computeRetractions([
      matchedRow({ isRetracted: true }, { citeKey: 'bad' }),
      matchedRow({ isRetracted: null }, { citeKey: 'unknown' }),
    ])
    expect(r.retracted).toHaveLength(1)
    expect(r.unchecked).toBe(1)
  })
  it('is empty on a clean list', () => {
    expect(computeRetractions([matchedRow({ isRetracted: false }), matchedRow({ isRetracted: false })]).retracted).toEqual([])
  })
})

describe('computeRetractions — Crossref signals', () => {
  const doi = '10.1000/abc'
  const row = () => matchedRow({ isRetracted: false, doi: `https://doi.org/${doi}` }, { citeKey: 'k' })
  const upd = (kind: 'retraction' | 'concern' | 'correction', source = 'publisher') =>
    ({ target: doi, kind, type: kind, noticeDoi: '10.1000/notice', source, date: null })

  it('Retraction Watch and publisher retractions are named as separate signals', () => {
    const r = computeRetractions([row()], xr(new Map([[doi, [upd('retraction', 'retraction-watch'), upd('retraction')]]])))
    expect(r.retracted[0].signals).toEqual(['crossref', 'retraction-watch'])
  })
  it('expressions of concern and corrections are listed separately; most serious status wins', () => {
    const concern = computeRetractions([row()], xr(new Map([[doi, [upd('concern'), upd('correction')]]])))
    expect(concern.concerns.map(f => f.citeKey)).toEqual(['k'])
    expect(concern.corrections).toEqual([])
    const corr = computeRetractions([row()], xr(new Map([[doi, [upd('correction')]]])))
    expect(corr.corrections.map(f => f.citeKey)).toEqual(['k'])
    const both = computeRetractions([row()], xr(new Map([[doi, [upd('retraction'), upd('concern')]]])))
    expect(both.retracted).toHaveLength(1)
    expect(both.concerns).toEqual([])
    expect(both.retracted[0].updates).toHaveLength(2) // the concern is still shown on it
  })
  it('collects the .bib DOI, the matched DOI and twin DOIs, once each', () => {
    const rows = [matchedRow({ doi: 'https://doi.org/10.1000/A' }, { entry: entry({ doi: '10.1000/a' }), twins: [{ id: 'W1', doi: 'https://doi.org/10.1000/b', isRetracted: null }] })]
    expect(retractionDois(rows).sort()).toEqual(['10.1000/a', '10.1000/b'])
  })
})

describe('parseCrossrefItems', () => {
  it('reads update-to on notices, groups types, keeps only wanted DOIs', () => {
    const items = [
      { DOI: '10.1/notice', 'update-to': [
        { DOI: '10.1/Orig', type: 'retraction', source: 'retraction-watch', updated: { 'date-parts': [[2010, 2, 2]] } },
        { DOI: '10.1/other', type: 'retraction', source: 'publisher' },
      ] },
      { DOI: '10.1/eoc', 'update-to': [{ DOI: '10.1/orig', type: 'expression-of-concern', source: 'publisher' }] },
      { DOI: '10.1/x', 'update-to': [{ DOI: '10.1/orig', type: 'new_version' }] }, // ignored type
    ]
    const u = parseCrossrefItems(items, new Set(['10.1/orig']))
    expect(u).toEqual([
      { target: '10.1/orig', kind: 'retraction', type: 'retraction', noticeDoi: '10.1/notice', source: 'retraction-watch', date: '2010-02-02' },
      { target: '10.1/orig', kind: 'concern', type: 'expression_of_concern', noticeDoi: '10.1/eoc', source: 'publisher', date: null },
    ])
  })
})
