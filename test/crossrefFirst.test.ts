import { describe, it, expect, vi } from 'vitest'
import { resolveByTitle, usesCrossref, type TitleSources } from '../src/lib/match'
import { buildCrossrefSearchUrl, buildCrossrefUrl, crossrefToWork } from '../src/lib/crossref'
import type { BibEntry, OpenAlexWork } from '../src/types'

// v1.4.4 — Crossref first (free), OpenAlex record by DOI (free), OpenAlex search
// only as the billable fallback.

const entry = (over: Partial<BibEntry> = {}): BibEntry => ({
  rowId: 'e', sourceOffset: 0, citeKey: 'he2016', entryType: 'inproceedings',
  title: 'Deep residual learning for image recognition', titleForSearch: 'Deep residual learning for image recognition',
  authors: '', year: 2016, venue: 'CVPR', doiRaw: null, doi: null, firstAuthor: 'He', volume: '', pages: '',
  titleRetracted: false, altId: null, dupKeyIndex: null, raw: '', likelyNotIndexable: false, ...over,
})
const cr = crossrefToWork({
  DOI: '10.1109/CVPR.2016.90', title: ['Deep Residual Learning for Image Recognition'], type: 'proceedings-article',
  author: [{ given: 'Kaiming', family: 'He' }], issued: { 'date-parts': [[2016, 6]] },
  'container-title': ['2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)'], page: '770-778',
})
const oa: OpenAlexWork = { ...cr, id: 'https://openalex.org/W2194775991', isRetracted: false }

function sources(over: Partial<TitleSources> = {}) {
  return {
    crossref: vi.fn(async () => [cr]),
    openalexByDoi: vi.fn(async () => oa),
    openalexSearch: vi.fn(async () => ({ kind: 'ok' as const, candidates: [] })),
    ...over,
  }
}

describe('crossrefToWork', () => {
  it('maps a Crossref item to the scorer shape (unique id, DOI, type, authors, pages)', () => {
    expect(cr).toMatchObject({
      id: 'crossref:10.1109/cvpr.2016.90', doi: 'https://doi.org/10.1109/cvpr.2016.90', publicationYear: 2016,
      type: 'conference-paper', authorships: [{ authorName: 'Kaiming He', orcid: null }],
      biblio: { volume: null, issue: null, firstPage: '770', lastPage: '778' },
    })
  })
})

describe('Crossref mapping keeps the title without the subtitle', () => {
  it('Tversky 1974: Crossref stores a subtitle OpenAlex titles do not carry', () => {
    const w = crossrefToWork({ DOI: '10.1126/science.185.4157.1124', title: ['Judgment under Uncertainty: Heuristics and Biases'], subtitle: ['Biases in judgments reveal some heuristics of thinking under uncertainty'] })
    expect(w.displayName).toBe('Judgment under Uncertainty: Heuristics and Biases')
  })
})

describe('Crossref URLs use the public pool (no shared mailto)', () => {
  it('search and update lookups carry no mailto', () => {
    expect(buildCrossrefSearchUrl(entry())).not.toContain('mailto')
    expect(buildCrossrefSearchUrl(entry())).toContain('query.bibliographic=')
    expect(buildCrossrefUrl(['10.1000/x'])).not.toContain('mailto')
  })
})

describe('resolveByTitle', () => {
  it('a confident Crossref match is confirmed by the OpenAlex record by DOI — no billable search', async () => {
    const s = sources()
    const r = await resolveByTitle(entry(), s)
    expect(r).toMatchObject({ via: 'crossref', billable: false, error: null })
    expect(r.decision?.status).toBe('matched-by-title')
    expect(r.decision?.work?.id).toBe(oa.id) // the OpenAlex record, not the Crossref item
    expect(s.openalexByDoi).toHaveBeenCalledWith('10.1109/cvpr.2016.90')
    expect(s.openalexSearch).not.toHaveBeenCalled()
  })
  it('falls back to OpenAlex search when Crossref is unavailable', async () => {
    const s = sources({ crossref: vi.fn(async () => null) })
    const r = await resolveByTitle(entry(), s)
    expect(r).toMatchObject({ via: 'openalex-search', billable: true })
    expect(s.openalexSearch).toHaveBeenCalledOnce()
  })
  it('falls back when Crossref finds nothing confident', async () => {
    const other = crossrefToWork({ DOI: '10.1/other', title: ['Something else entirely'], type: 'journal-article' })
    const s = sources({ crossref: vi.fn(async () => [other]) })
    expect((await resolveByTitle(entry(), s)).via).toBe('openalex-search')
    expect(s.openalexByDoi).not.toHaveBeenCalled()
  })
  it('falls back when OpenAlex has no record for the DOI, or its record no longer scores confidently', async () => {
    expect((await resolveByTitle(entry(), sources({ openalexByDoi: vi.fn(async () => null) }))).via).toBe('openalex-search')
    const wrong = { ...oa, displayName: 'A different paper about something else' }
    expect((await resolveByTitle(entry(), sources({ openalexByDoi: vi.fn(async () => wrong) }))).via).toBe('openalex-search')
  })
  it('skips Crossref for arXiv / CoRR entries (DataCite DOIs are not in Crossref)', async () => {
    expect(usesCrossref(entry({ venue: 'arXiv preprint arXiv:1512.03385' }))).toBe(false)
    expect(usesCrossref(entry({ venue: 'CoRR' }))).toBe(false)
    const s = sources()
    await resolveByTitle(entry({ venue: 'arXiv preprint arXiv:1512.03385' }), s)
    expect(s.crossref).not.toHaveBeenCalled()
  })
})
