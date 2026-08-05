import { describe, it, expect } from 'vitest'
import { bestPublishedMatch, detectPreprint } from '../../src/lib/stats/preprints'
import { mkWork } from './fixtures'

describe('detectPreprint', () => {
  it('detects by preprint DOI prefix', () => {
    expect(detectPreprint({ doi: '10.48550/arxiv.2001.00001', doiRaw: null, venue: '', raw: '' })?.server).toBe('arXiv')
    expect(detectPreprint({ doi: '10.1101/2020.01.01.900001', doiRaw: null, venue: '', raw: '' })?.server).toBe('bioRxiv/medRxiv')
    expect(detectPreprint({ doi: '10.2139/ssrn.123', doiRaw: null, venue: '', raw: '' })?.server).toBe('SSRN')
  })

  it('detects arXiv by eprint/archivePrefix fields in the raw source', () => {
    const raw = '@misc{x, title={T}, archivePrefix = {arXiv}, eprint = {2001.00001}, primaryClass = {cs.LG}}'
    expect(detectPreprint({ doi: null, doiRaw: null, venue: '', raw })?.via).toBe('eprint')
  })

  it('detects by the Google-Scholar journal tell', () => {
    expect(detectPreprint({ doi: null, doiRaw: null, venue: 'arXiv preprint arXiv:2001.00001', raw: '' })?.server).toBe('arXiv')
  })

  it('returns null for an ordinary journal article', () => {
    expect(detectPreprint({ doi: '10.1038/nature12373', doiRaw: null, venue: 'Nature', raw: '' })).toBeNull()
  })
})

describe('bestPublishedMatch', () => {
  const title = 'Deep residual learning for image recognition'
  it('accepts a high-similarity non-preprint published no earlier than the preprint', () => {
    const cands = [
      mkWork({ displayName: title, type: 'article', publicationYear: 2016 }),
      mkWork({ displayName: 'Something unrelated', type: 'article', publicationYear: 2016 }),
    ]
    const best = bestPublishedMatch(title, 2015, cands)
    expect(best).toBeTruthy()
    expect(best!.work.publicationYear).toBe(2016)
  })

  it('rejects a candidate that is itself a preprint', () => {
    const cands = [mkWork({ displayName: title, type: 'preprint', publicationYear: 2016 })]
    expect(bestPublishedMatch(title, 2015, cands)).toBeNull()
  })

  it('rejects a candidate published before the preprint', () => {
    const cands = [mkWork({ displayName: title, type: 'article', publicationYear: 2013 })]
    expect(bestPublishedMatch(title, 2015, cands)).toBeNull()
  })

  it('rejects a low-similarity title', () => {
    const cands = [mkWork({ displayName: 'A totally different paper', type: 'article', publicationYear: 2016 })]
    expect(bestPublishedMatch(title, 2015, cands)).toBeNull()
  })
})
