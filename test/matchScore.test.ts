import { describe, it, expect } from 'vitest'
import {
  authorSignal, biblioSignal, chooseTitleMatch, isNoticeTitle, scoreCandidate,
  stripRetractedPrefix, titleSimilarity, typeSignal, venueSignal, yearSignal,
} from '../src/lib/matchScore'
import { parseBib } from '../src/lib/parseBib'
import { cleanTitleForSearch } from '../src/lib/titleClean'
import type { BibEntry, OpenAlexWork } from '../src/types'

function entry(over: Partial<BibEntry> = {}): BibEntry {
  return {
    rowId: 'e0', sourceOffset: 0, citeKey: 'k0', entryType: 'article',
    title: 'T', titleForSearch: 'T', authors: '', year: null, venue: '',
    doiRaw: null, doi: null, firstAuthor: '', volume: '', pages: '', titleRetracted: false,
    altId: null, dupKeyIndex: null, raw: '', likelyNotIndexable: false, ...over,
  }
}
let n = 0
function work(over: Partial<OpenAlexWork> = {}): OpenAlexWork {
  n++
  return {
    id: `https://openalex.org/W${n}`, doi: null, displayName: 'X',
    publicationYear: null, hostVenue: null, citedByCount: null,
    isOa: null, type: null, primaryTopic: null,
    oaStatus: null, sourceId: null, sourceType: null, authorships: [],
    isRetracted: null, biblio: null, referencedWorks: null, ...over,
  }
}
const au = (...names: string[]) => names.map(authorName => ({ authorName, orcid: null }))

describe('retraction prefixes', () => {
  it('strips RETRACTED: / Retracted article: / [Retracted] and keeps the flag', () => {
    expect(stripRetractedPrefix('RETRACTED: Ileal-lymphoid-nodular hyperplasia')).toEqual({ title: 'Ileal-lymphoid-nodular hyperplasia', retracted: true })
    expect(stripRetractedPrefix('Retracted article: Stimulus-triggered fate').retracted).toBe(true)
    expect(stripRetractedPrefix('RETRACTED ARTICLE: X').title).toBe('X')
    expect(stripRetractedPrefix('[Retracted] X').title).toBe('X')
    expect(stripRetractedPrefix('Retraction of a theory').retracted).toBe(false)
  })
  it('compares titles with the prefix removed on either side', () => {
    expect(titleSimilarity('RETRACTED: Long term toxicity of a Roundup herbicide', 'Long term toxicity of a Roundup herbicide')).toBe(1)
  })
  it('parseBib records the flag; the search query drops the prefix', () => {
    const p = parseBib('@article{a, title={RETRACTED: Some study of things}, author={Doe, Jane}, year={2010}}')
    expect(p.entries[0].titleRetracted).toBe(true)
    expect(p.entries[0].firstAuthor).toBe('Doe')
    expect(cleanTitleForSearch('Retracted article: Some study of things')).toBe('Some study of things')
  })
  it('search query folds accents and drops ? / * (OpenAlex returned nothing for them)', () => {
    expect(cleanTitleForSearch('Über formal unentscheidbare Sätze')).toBe('Uber formal unentscheidbare Satze')
    expect(cleanTitleForSearch('Can quantum-mechanical description of physical reality be considered complete?')).toBe('Can quantum-mechanical description of physical reality be considered complete')
  })
  it('recognises retraction/erratum NOTICES as separate records', () => {
    expect(isNoticeTitle('Retraction Note: Stimulus-triggered fate conversion')).toBe(true)
    expect(isNoticeTitle('Retraction notice to “X”')).toBe(true)
    expect(isNoticeTitle('Correction to: X')).toBe(true)
    expect(isNoticeTitle('Erratum: X')).toBe(true)
    expect(isNoticeTitle('Correction of errors in RNA')).toBe(false)
  })
})

describe('individual signals', () => {
  it('title: subtitle dropped on one side scores 0.9', () => {
    expect(titleSimilarity('Faster R-CNN', 'Faster R-CNN: Towards real-time object detection with region proposal networks')).toBe(0.9)
    expect(titleSimilarity('Deep learning', 'Deep learning')).toBe(1)
  })
  it('author: first author 1, later author 0.7, absent 0, unknown null', () => {
    expect(authorSignal('Maaten', work({ authorships: au('Laurens van der Maaten', 'Geoffrey Hinton') }))).toBe(1)
    expect(authorSignal('García-López', work({ authorships: au('José Garcia-Lopez') }))).toBe(1)
    expect(authorSignal('Hinton', work({ authorships: au('Yann LeCun', 'Yoshua Bengio', 'Geoffrey Hinton') }))).toBe(0.7)
    expect(authorSignal('Goodfellow', work({ authorships: au('Yann LeCun') }))).toBe(0)
    expect(authorSignal('', work({ authorships: au('Yann LeCun') }))).toBeNull()
    expect(authorSignal('Pedregosa', work({ authorships: au('PedregosaFabian') }))).toBe(1)
    expect(authorSignal('LeCun', work())).toBeNull()
  })
  it('year: within ±1 counts as agreement', () => {
    expect(yearSignal(2016, work({ publicationYear: 2017 }))).toBe(1)
    expect(yearSignal(2016, work({ publicationYear: 2018 }))).toBe(0)
    expect(yearSignal(null, work({ publicationYear: 2018 }))).toBeNull()
  })
  it('venue: abbreviations, acronyms and token overlap', () => {
    expect(venueSignal('Phys. Rev. Lett.', 'Physical Review Letters')).toBe(1)
    expect(venueSignal('PNAS', 'Proceedings of the National Academy of Sciences')).toBe(1)
    expect(venueSignal('CVPR', '2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)')).toBe(1)
    expect(venueSignal('Nature', 'Science')).toBe(0)
    expect(venueSignal('', 'Nature')).toBeNull()
  })
  it('type: article/book/proceedings/preprint compatibility', () => {
    expect(typeSignal('article', 'Nature', work({ type: 'article' }))).toBe(1)
    expect(typeSignal('book', 'MIT Press', work({ type: 'article' }))).toBe(0)
    expect(typeSignal('inproceedings', 'MICCAI', work({ type: 'book-chapter' }))).toBe(1)
    expect(typeSignal('article', 'arXiv preprint arXiv:1512.03385', work({ type: 'preprint' }))).toBe(1)
    expect(typeSignal('inproceedings', 'CVPR', work({ type: 'preprint' }))).toBe(0.5)
    expect(typeSignal('article', 'Nature', work({ type: 'erratum' }))).toBe(0)
    expect(typeSignal('misc', '', work({ type: 'article' }))).toBeNull()
    expect(typeSignal('inproceedings', 'CVPR', work({ type: 'conference-paper' }))).toBe(1)
    expect(typeSignal('book', 'MIT Press', work({ type: 'book-review' }))).toBe(0)
  })
  it('biblio: volume and first page', () => {
    const w = work({ biblio: { volume: '521', issue: '7553', firstPage: '436', lastPage: '444' } })
    expect(biblioSignal('521', '436--444', w)).toBe(1)
    expect(biblioSignal('521', '1--10', w)).toBe(0.5)
    expect(biblioSignal('', '', w)).toBeNull()
  })
})

describe('composite score', () => {
  it('is the weighted mean over the signals present (title-only entry = title score)', () => {
    const s = scoreCandidate(entry({ title: 'Deep learning', firstAuthor: '' }), work({ displayName: 'Deep learning' }))
    expect(s.score).toBe(1)
    expect(s.author).toBeNull()
  })
  it('is reproducible', () => {
    const e = entry({ title: 'Deep learning', firstAuthor: 'LeCun', year: 2015, venue: 'Nature', volume: '521', pages: '436--444' })
    const w = work({ displayName: 'Deep learning', authorships: au('Yann LeCun'), publicationYear: 2015, hostVenue: 'Nature', type: 'article', biblio: { volume: '521', issue: null, firstPage: '436', lastPage: '444' } })
    expect(scoreCandidate(e, w)).toEqual(scoreCandidate(e, w))
    expect(scoreCandidate(e, w).score).toBe(1)
  })
})

describe('chooseTitleMatch', () => {
  const lecun = () => work({ displayName: 'Deep learning', authorships: au('Yann LeCun', 'Yoshua Bengio', 'Geoffrey Hinton'), publicationYear: 2015, hostVenue: 'Nature', type: 'article' })
  it('book vs article with the same title: the article is not attached to the book entry', () => {
    const book = entry({ entryType: 'book', title: 'Deep Learning', firstAuthor: 'Goodfellow', year: 2016, venue: 'MIT Press' })
    const d = chooseTitleMatch(book, [lecun()])
    expect(d.status).not.toBe('matched-by-title')
  })
  it('the article entry matches the article confidently', () => {
    const art = entry({ title: 'Deep learning', firstAuthor: 'LeCun', year: 2015, venue: 'Nature' })
    const d = chooseTitleMatch(art, [lecun()])
    expect(d.status).toBe('matched-by-title')
    expect(d.signals!.score).toBeGreaterThanOrEqual(0.85)
  })
  it('picks the right one of two same-title versions using venue + year (proceedings vs journal)', () => {
    const iccv = work({ displayName: 'Mask R-CNN', authorships: au('Kaiming He'), publicationYear: 2017, hostVenue: '2017 IEEE International Conference on Computer Vision (ICCV)', type: 'article' })
    const tpami = work({ displayName: 'Mask R-CNN', authorships: au('Kaiming He'), publicationYear: 2020, hostVenue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence', type: 'article' })
    const e = entry({ entryType: 'article', title: 'Mask R-CNN', firstAuthor: 'He', year: 2020, venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence' })
    const d = chooseTitleMatch(e, [iccv, tpami])
    expect(d.status).toBe('matched-by-title')
    expect(d.work!.id).toBe(tpami.id)
  })
  it('a near-tie between two different works is uncertain', () => {
    const a = work({ displayName: 'Random forests', publicationYear: 2001, authorships: au('Leo Breiman') })
    const b = work({ displayName: 'Random forests', publicationYear: 2001, authorships: au('Adele Cutler') })
    const d = chooseTitleMatch(entry({ title: 'Random forests', year: 2001 }), [a, b])
    expect(d.status).toBe('uncertain')
    expect(d.ambiguous).toBe(true)
  })
  it('collapses OpenAlex duplicate records of the same work onto the most-cited one', () => {
    const dup = (cit: number) => work({ displayName: 'The Nature of the Firm', publicationYear: 1937, authorships: au('R. H. Coase'), hostVenue: 'Economica', type: 'article', citedByCount: cit })
    const minor = dup(833), main = dup(24082)
    const d = chooseTitleMatch(entry({ title: 'The nature of the firm', firstAuthor: 'Coase', year: 1937, venue: 'Economica' }), [minor, main])
    expect(d.status).toBe('matched-by-title')
    expect(d.work!.id).toBe(main.id)
  })
  it('prefers the version whose type matches the entry (proceedings over its arXiv twin)', () => {
    const conf = work({ displayName: 'Densely Connected Convolutional Networks', authorships: au('Gao Huang'), publicationYear: 2017, type: 'conference-paper', hostVenue: 'IEEE Conference on Computer Vision and Pattern Recognition' })
    const arxiv = work({ displayName: 'Densely Connected Convolutional Networks', authorships: au('Gao Huang'), publicationYear: 2016, type: 'preprint', hostVenue: 'arXiv (Cornell University)' })
    const e = entry({ entryType: 'inproceedings', title: 'Densely connected convolutional networks', firstAuthor: 'Huang', year: 2017, venue: 'Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)' })
    const d = chooseTitleMatch(e, [arxiv, conf])
    expect(d.status).toBe('matched-by-title')
    expect(d.work!.id).toBe(conf.id)
  })
  it('keeps a retracted paper that OpenAlex types `retraction` matchable', () => {
    const paper = work({ displayName: 'RETRACTED: Long term toxicity of a Roundup herbicide', type: 'retraction', authorships: au('Gilles-Éric Séralini'), publicationYear: 2012 })
    const d = chooseTitleMatch(entry({ title: 'Long term toxicity of a Roundup herbicide', firstAuthor: 'Séralini', year: 2012 }), [paper])
    expect(d.work!.id).toBe(paper.id)
  })
  it('drops retraction notices unless the entry is itself a notice', () => {
    const notice = work({ displayName: 'Retraction Note: Stimulus-triggered fate conversion of somatic cells into pluripotency', type: 'retraction' })
    const paper = work({ displayName: 'RETRACTED ARTICLE: Stimulus-triggered fate conversion of somatic cells into pluripotency', authorships: au('Haruko Obokata'), publicationYear: 2014, type: 'article' })
    const e = entry({ title: 'Stimulus-triggered fate conversion of somatic cells into pluripotency', firstAuthor: 'Obokata', year: 2014 })
    const d = chooseTitleMatch(e, [notice, paper])
    expect(d.work!.id).toBe(paper.id)
    expect(chooseTitleMatch(e, [notice]).status).toBe('not-found')
  })
  it('a year more than 3 years off is never confident (Kuhn 1962 vs its 1996 edition)', () => {
    const ed = work({ displayName: 'The Structure of Scientific Revolutions', authorships: au('Thomas S. Kuhn'), publicationYear: 1996, hostVenue: 'University of Chicago Press', type: 'book' })
    const e = entry({ entryType: 'book', title: 'The Structure of Scientific Revolutions', firstAuthor: 'Kuhn', year: 1962, venue: 'University of Chicago Press' })
    expect(chooseTitleMatch(e, [ed]).status).toBe('uncertain')
    // ...but a 2-year online-first gap is still fine
    expect(chooseTitleMatch({ ...e, year: 1994 }, [ed]).status).toBe('matched-by-title')
  })
  it('below the floor nothing is attached', () => {
    const e = entry({ title: 'Deep learning', firstAuthor: 'Zhang', year: 1990, venue: 'Journal of Imaginary Results' })
    const d = chooseTitleMatch(e, [lecun()])
    expect(d.status).toBe('not-found')
    expect(d.work).toBeNull()
  })
  it('a weak-but-plausible title-only match is uncertain (was `suspicious` before v1.4.1)', () => {
    // title similarity 0.783 (< 0.85) and nothing else to compare
    const d = chooseTitleMatch(entry({ title: 'Statistical mechanics of complex networks' }), [work({ displayName: 'Statistical mechanics of complex networks and their applications' })])
    expect(d.status).toBe('uncertain')
  })
})

describe('v1.4.5 confidence rules', () => {
  const T = 'High performance communication by people with paralysis using an intracortical brain-computer interface'
  it("accepts OpenAlex's A&A title truncated at the first '. ' (H1)", () => {
    expect(titleSimilarity('Gaia Data Release 2. Summary of the contents and survey properties', 'Gaia Data Release 2')).toBe(0.9)
    expect(titleSimilarity('Rotation velocities of white dwarfs. III. DA stars with convective atmospheres', 'Rotation velocities of white dwarfs')).toBe(0.9)
    expect(titleSimilarity('Dr. Who and the Daleks', 'Dr')).toBeLessThan(0.7) // a 1-word head never counts
  })
  it('a title-only match needs the author or the year to be confident (H6)', () => {
    const w = work({ displayName: T, authorships: au('Chethan Pandarinath'), publicationYear: 2017 })
    expect(chooseTitleMatch(entry({ title: T, titleForSearch: T }), [w]).status).toBe('uncertain')
    expect(chooseTitleMatch(entry({ title: T, titleForSearch: T, year: 2017 }), [w]).status).toBe('matched-by-title')
  })
  it('a saved peer-review page is never confident (H6)', () => {
    const t = 'PEER REVIEW - Decoding of intuitive motor imagery paradigm based on frequency-band double-branch network'
    const w = work({ displayName: 'Decoding of intuitive motor imagery paradigm based on frequency-band double-branch network', authorships: au('A. Author'), publicationYear: 2025 })
    const d = chooseTitleMatch(entry({ title: t, titleForSearch: cleanTitleForSearch(t), firstAuthor: 'Author', year: 2025 }), [w])
    expect(d.status).toBe('uncertain')
    expect(d.reasons).toContain('the title is a peer-review page, not the paper')
  })
  it('prefers a real record over a stub (no DOI, one author, junk venue); a stub alone is uncertain (H7)', () => {
    const t = 'ImageNet classification with deep convolutional neural networks'
    const e = entry({ title: t, titleForSearch: t, firstAuthor: 'Krizhevsky', authors: 'Krizhevsky, Alex; Sutskever, Ilya; Hinton, Geoffrey', year: 2012, entryType: 'inproceedings' })
    const stub = work({ displayName: t, authorships: au('Krizhevsky'), publicationYear: 2012, hostVenue: 'Medical Entomology and Zoology', citedByCount: 9999 })
    const real = work({ displayName: t, authorships: au('Alex Krizhevsky', 'Ilya Sutskever', 'Geoffrey E. Hinton'), publicationYear: 2012, doi: 'https://doi.org/10.1/nips' })
    expect(chooseTitleMatch(e, [stub, real]).work).toBe(real)
    expect(chooseTitleMatch(e, [stub]).status).toBe('uncertain')
  })
  it('a very short title needs the author and the venue (or year) too (H8)', () => {
    const e = entry({ title: 'somatomotor', titleForSearch: 'somatomotor', firstAuthor: 'Lin', year: 2025, venue: 'OpenNeuro [Data set]', entryType: 'misc' })
    const mirror = work({ displayName: 'somatomotor', authorships: au('Fa-Hsuan Lin'), publicationYear: 2026, hostVenue: 'UC San Diego' })
    expect(chooseTitleMatch(e, [mirror]).status).toBe('uncertain')
    const mask = entry({ title: 'Mask R-CNN', titleForSearch: 'Mask R-CNN', firstAuthor: 'He', year: 2020, venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence' })
    const tpami = work({ displayName: 'Mask R-CNN', authorships: au('Kaiming He'), publicationYear: 2018, hostVenue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence', type: 'article' })
    expect(chooseTitleMatch(mask, [tpami]).status).toBe('matched-by-title')
  })
  it('a cited DOI OpenAlex lacks: a record with ANOTHER DOI is not confident (H8)', () => {
    const t = 'A long enough dataset title about somatomotor mapping'
    const e = entry({ title: t, titleForSearch: t, firstAuthor: 'Lin', year: 2025 })
    const w = work({ displayName: t, authorships: au('Fa-Hsuan Lin'), publicationYear: 2025, doi: 'https://doi.org/10.82901/nemar.on006035.v1.0.0' })
    expect(chooseTitleMatch(e, [w]).status).toBe('matched-by-title')
    const d = chooseTitleMatch(e, [w], '10.18112/openneuro.ds006035.v1.0.0')
    expect(d.status).toBe('uncertain')
    expect(d.reasons).toContain('same title, different DOI')
  })
})
