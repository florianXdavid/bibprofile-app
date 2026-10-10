import { describe, it, expect } from 'vitest'
import {
  classifyDoiMatch, compareYears,
  dedupKey, computeDuplicates, buildRows,
} from '../src/lib/match'
import { parseBib } from '../src/lib/parseBib'
import type { BibEntry, OpenAlexWork } from '../src/types'

function entry(over: Partial<BibEntry>): BibEntry {
  return {
    rowId: 'e0', sourceOffset: 0, citeKey: 'k0', entryType: 'article',
    title: 'T', titleForSearch: 'T', authors: '', year: null, venue: '',
    doiRaw: null, doi: null, firstAuthor: '', volume: '', pages: '', titleRetracted: false,
    altId: null, dupKeyIndex: null, raw: '', likelyNotIndexable: false, ...over,
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

// v1.4.1: classifyTitleMatch (title-only, `suspicious` below 0.85) was replaced by
// the multi-signal chooseTitleMatch — see test/matchScore.test.ts.

describe('dedup (Fix 6)', () => {
  it('keys by DOI, else normalised title + year + first-author surname (v1.4.1 hotfix)', () => {
    expect(dedupKey(entry({ doi: '10.1038/nature03721' }))).toBe('doi:10.1038/nature03721')
    expect(dedupKey(entry({ doi: null, title: 'Grid Cells!', titleForSearch: 'Grid Cells!' }))).toBe('title:grid cells|year:|author:')
    expect(dedupKey(entry({ title: 'Grid cells', titleForSearch: 'Grid cells', year: 2005, firstAuthor: 'Hafting' }))).toBe('title:grid cells|year:2005|author:hafting')
  })
  it('does NOT merge different works that share a title (conference vs journal, book vs article)', () => {
    const conf = entry({ rowId: 'e0', citeKey: 'he2017mask', title: 'Mask R-CNN', titleForSearch: 'Mask R-CNN', year: 2017, firstAuthor: 'He' })
    const jour = entry({ rowId: 'e1', citeKey: 'he2020mask', title: 'Mask R-CNN', titleForSearch: 'Mask R-CNN', year: 2020, firstAuthor: 'He' })
    const art = entry({ rowId: 'e2', citeKey: 'lecun2015', title: 'Deep learning', titleForSearch: 'Deep learning', year: 2015, firstAuthor: 'LeCun' })
    const book = entry({ rowId: 'e3', citeKey: 'goodfellow2016', title: 'Deep Learning', titleForSearch: 'Deep Learning', year: 2016, firstAuthor: 'Goodfellow' })
    expect(computeDuplicates([conf, jour, art, book]).size).toBe(0)
  })
  it('still merges the same paper cited twice without a DOI', () => {
    const a = entry({ rowId: 'e0', citeKey: 'hafting2005', title: 'Microstructure of a spatial map', titleForSearch: 'Microstructure of a spatial map', year: 2005, firstAuthor: 'Hafting' })
    const b = entry({ rowId: 'e1', citeKey: 'Hafting2005b', title: 'Microstructure of a Spatial Map.', titleForSearch: 'Microstructure of a Spatial Map.', year: 2005, firstAuthor: 'Hafting' })
    expect(computeDuplicates([a, b]).get('e1')).toBe('hafting2005')
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

// v1.4.5 — the whole run with injected sources (no network).
describe('runMatching v1.4.5 (shared DOIs, identifiers, same-work duplicates)', () => {
  const W = (id: string, over: Partial<OpenAlexWork>) => work({ id: `https://openalex.org/${id}`, ...over })
  const zim = W('W1980793772', { doi: 'https://doi.org/10.1016/j.cell.2008.06.053', displayName: 'In vivo imaging of oskar mRNA transport reveals the mechanism of posterior localization', publicationYear: 2008, authorships: [{ authorName: 'V. L. Zimyanin', orcid: null }], biblio: { volume: '134', issue: '5', firstPage: '843', lastPage: '853' } })
  const pmidWork = W('W3180220247', { doi: 'https://doi.org/10.1056/nejmoa2027540', displayName: 'Neuroprosthesis for Decoding Speech in a Paralyzed Person with Anarthria', publicationYear: 2021, authorships: [{ authorName: 'David A. Moses', orcid: null }] })
  const clip = W('W3135367836', { displayName: 'Learning Transferable Visual Models From Natural Language Supervision', publicationYear: 2021, type: 'preprint', hostVenue: 'arXiv (Cornell University)', authorships: [{ authorName: 'Alec Radford', orcid: null }] })
  const lookups: Record<string, OpenAlexWork | null> = { 'doi:10.1016/j.cell.2008.06.053': zim, 'pmid:34260835': pmidWork, 'doi:10.1056/nejmoa2027540': pmidWork }
  const src = {
    lookup: async (k: string) => (lookups[k] ? { kind: 'ok' as const, work: lookups[k]! } : { kind: 'not-found' as const }),
    crossref: async () => null,
    openalexByDoi: async () => null,
    openalexSearch: async (q: string) => ({ kind: 'ok' as const, candidates: /transferable/i.test(q) ? [clip] : [] }),
    pause: async () => {},
  }
  const BIB = `@article{zimyanin2008, title={In vivo imaging of oskar mRNA transport reveals the mechanism of posterior localization}, author={Zimyanin, V. L.}, year={2008}, doi={10.1016/j.cell.2008.06.053}}
@article{goodwin2010, title={Patronin regulates the microtubule network by protecting microtubule minus ends}, author={Goodwin, Sarah S}, year={2010}, doi={https://doi.org/10.1016/j.cell.2008.06.053}}
@article{moses2021, title={Neuroprosthesis for Decoding Speech in a Paralyzed Person with Anarthria}, author={Moses, David A.}, year={2021}, doi={10.1056/NEJMoa2027540}}
@misc{moses2021_pubmed, title={Neuroprosthesis for {Decoding} {Speech} in a {Paralyzed} {Person} with {Anarthria} - {PubMed}}, url={https://pubmed.ncbi.nlm.nih.gov/34260835/}}
@inproceedings{radford2021clip, title={Learning Transferable Visual Models from Natural Language Supervision}, author={Radford, Alec}, booktitle={Proceedings of the 38th International Conference on Machine Learning}, year={2021}}`
  const run = async () => {
    const { runMatching } = await import('../src/lib/match')
    const { rows } = await runMatching(parseBib(BIB), () => {}, undefined, src)
    return Object.fromEntries(rows.map(r => [r.citeKey, r]))
  }

  it('a DOI pasted onto another entry is not hidden as a duplicate: suspicious, with its owner named (C2)', async () => {
    const r = await run()
    expect(r.zimyanin2008.status).toBe('matched-by-doi')
    expect(r.goodwin2010.status).toBe('suspicious')
    expect(r.goodwin2010.duplicateOf).toBeNull()
    expect(r.goodwin2010.notes?.join(' ')).toMatch(/belongs to zimyanin2008/)
  })
  it('an identifier outside the doi field identifies the record for free; the same work twice is one reference (H4, H2)', async () => {
    const r = await run()
    expect(r.moses2021_pubmed).toMatchObject({ status: 'matched-by-doi', idSource: 'url', duplicateOf: 'moses2021' })
  })
  it('a proceedings paper matched to its preprint record is labelled (H9)', async () => {
    const r = await run()
    expect(r.radford2021clip.status).toBe('matched-by-title')
    expect(r.radford2021clip.preprintVersion).toBe(true)
  })
  it('entries sharing a DOI merge only when their titles agree (C2)', () => {
    const a = entry({ rowId: 'a', citeKey: 'a', title: 'Alpha beta gamma', titleForSearch: 'Alpha beta gamma', doi: '10.1/x' })
    const b = entry({ rowId: 'b', citeKey: 'b', title: 'Alpha beta gamma', titleForSearch: 'Alpha beta gamma', doi: '10.1/x' })
    const c = entry({ rowId: 'c', citeKey: 'c', title: 'Something else entirely', titleForSearch: 'Something else entirely', doi: '10.1/x' })
    const d = computeDuplicates([a, b, c])
    expect(d.get('b')).toBe('a')
    expect(d.has('c')).toBe(false)
  })
})
