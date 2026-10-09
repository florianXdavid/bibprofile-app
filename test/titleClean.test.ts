import { describe, it, expect } from 'vitest'
import { cleanTitleForSearch, isUrlLike, looksNotIndexable } from '../src/lib/titleClean'

describe('cleanTitleForSearch — pipe handling (Fix A1)', () => {
  it('keeps the longest segment for a single-pipe site tag', () => {
    expect(cleanTitleForSearch('Efficient computation of optimal actions | PNAS'))
      .toBe('Efficient computation of optimal actions')
  })
  it('handles a leading site tag', () => {
    expect(cleanTitleForSearch('Frontiers | Mechanosensory encoding in the fly'))
      .toBe('Mechanosensory encoding in the fly')
  })
  it('handles multiple pipes (MuJoCo case)', () => {
    expect(cleanTitleForSearch('MuJoCo advanced physics simulation | Robotics | IEEE Xplore'))
      .toBe('MuJoCo advanced physics simulation')
  })
  it('handles a multi-word site name', () => {
    expect(cleanTitleForSearch('Temporal difference learning in the brain | ScienceDirect Topics'))
      .toBe('Temporal difference learning in the brain')
  })
})

describe('cleanTitleForSearch — dash/prefix rules (kept)', () => {
  it('strips a trailing " - Site" for known sites', () => {
    expect(cleanTitleForSearch('Decoding a locomotor pattern - ScienceDirect'))
      .toBe('Decoding a locomotor pattern')
  })
  it('strips a junk leading tag', () => {
    expect(cleanTitleForSearch('PEER REVIEW - Decoding of intuitive motor imagery'))
      .toBe('Decoding of intuitive motor imagery')
  })
  it('does NOT truncate a legitimate subtitle after a dash', () => {
    expect(cleanTitleForSearch('Grid cells - a review of the evidence'))
      .toBe('Grid cells - a review of the evidence')
  })
  // v1.4.1: the colon subtitle is still kept, but the trailing `?` is now dropped
  // from the QUERY (OpenAlex returned no results for queries containing `?`).
  it('leaves a colon subtitle alone (trailing ? dropped from the query since v1.4.1)', () => {
    expect(cleanTitleForSearch('The free-energy principle: a unified brain theory?'))
      .toBe('The free-energy principle: a unified brain theory')
  })
  it('maps guillemet ligatures back to ascii', () => {
    expect(cleanTitleForSearch('http:« archive')).toBe('http:<< archive')
  })
})

describe('isUrlLike', () => {
  it('detects urls and hostnames', () => {
    expect(isUrlLike('https://pybullet.org')).toBe(true)
    expect(isUrlLike('www.kaggle.com/c/foo')).toBe(true)
    expect(isUrlLike('archive.ics.uci.edu/ml')).toBe(true)
  })
  it('rejects prose', () => {
    expect(isUrlLike('A study of grid cells')).toBe(false)
  })
})

describe('looksNotIndexable (Fix A4)', () => {
  const base = { entryType: 'misc', title: 'X', venue: '', doi: null as string | null, year: null as number | null }
  it('flags a bare-URL venue regardless of year', () => {
    expect(looksNotIndexable({ ...base, venue: 'https://pybullet.org', year: 2019 })).toBe(true)
  })
  it('flags @misc with no year and no DOI', () => {
    expect(looksNotIndexable({ ...base, entryType: 'misc', venue: 'Some Repo', year: null })).toBe(true)
  })
  it('flags a URL used as a title', () => {
    expect(looksNotIndexable({ ...base, title: 'https://archive.ics.uci.edu/ml' })).toBe(true)
  })
  it('does NOT flag @misc that has a year and a normal venue', () => {
    expect(looksNotIndexable({ ...base, venue: 'NeurIPS', year: 2019 })).toBe(false)
  })
  it('never flags anything with a DOI', () => {
    expect(looksNotIndexable({ ...base, venue: 'https://x.org', doi: '10.1/x' })).toBe(false)
  })
  it('does not flag a normal article', () => {
    expect(looksNotIndexable({ entryType: 'article', title: 'Grid cells', venue: 'Nature', doi: null, year: 2005 })).toBe(false)
  })
})
