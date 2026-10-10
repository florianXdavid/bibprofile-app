import { describe, it, expect } from 'vitest'
import { parse } from '@retorquere/bibtex-parser'
import { parseBib } from '../../src/lib/parseBib'
import { buildRows } from '../../src/lib/match'
import {
  computeCleanedBib,
  DUP_KEY_COMMENT,
  pagesOf,
  serializeCleanedBib,
  texEscape,
  type ResolvedPreprint,
} from '../../src/lib/stats/cleanBib'
import { cleanVenue } from '../../src/lib/stats/venues'
import { insertFields, replaceFieldValue } from '../../src/lib/bibWriter'
import { mkWork } from './fixtures'
import type { ResultRow } from '../../src/types'

function resolvedPreprint(over: Partial<ResolvedPreprint> = {}): ResolvedPreprint {
  return {
    server: 'arXiv',
    publishedTitle: 'Published version',
    publishedDoi: '10.1234/pub',
    publishedVenue: 'Real Journal',
    publishedYear: 2020,
    openalexId: 'https://openalex.org/W1',
    ...over,
  }
}

// A deliberately awkward .bib: accents, brace-protected caps, a custom Zotero
// field, an @string macro + comment, and a malformed (unparseable) block.
const AWKWARD = `@string{jml = {Journal of Machine Learning}}

% a comment line that must survive
@article{muller2020,
  title = {A study of {DNA} r\\"{o}le},
  author = {M\\"{u}ller, Hans},
  journal = jml,
  year = {2020},
  keywords = {zotero, path/to/file},
}

@article{brokenmid,
  title {no equals sign}
}

@article{smith2019,
  title = {Minimal entry},
  author = {Smith, Jane},
}
`

function rows(): ResultRow[] {
  return buildRows(parseBib(AWKWARD))
}

function keysAndCount(bib: string): { keys: string[]; count: number } {
  const lib = parse(bib, { unsupported: 'ignore' })
  const keys = lib.entries.map(e => e.key).sort()
  return { keys, count: lib.entries.length }
}

describe('non-negotiable guards', () => {
  it('a pure pass-through run reproduces the input byte-for-byte', () => {
    // buildRows marks everything `pending` -> cleaner passes all through.
    const cleaned = computeCleanedBib(rows())
    const out = serializeCleanedBib(AWKWARD, cleaned)
    expect(out).toBe(AWKWARD)
  })

  it('preserves entry count and the exact cite-key set', () => {
    const cleaned = computeCleanedBib(rows())
    const out = serializeCleanedBib(AWKWARD, cleaned)
    expect(keysAndCount(out)).toEqual(keysAndCount(AWKWARD))
  })

  it('LaTeX escapes, brace caps and custom fields round-trip intact on pass-through', () => {
    const cleaned = computeCleanedBib(rows())
    const muller = cleaned.entries.find(e => e.citeKey === 'muller2020')!
    expect(muller.newRaw).toBe(muller.originalRaw) // untouched
    const out = serializeCleanedBib(AWKWARD, cleaned)
    expect(out).toContain('{DNA}')
    expect(out).toContain('M\\"{u}ller')
    expect(out).toContain('keywords = {zotero, path/to/file}')
  })
})

describe('additive fills (never overwrite, never rekey)', () => {
  it('fills missing doi/year/journal/volume/pages on a confident DOI match', () => {
    const rs = rows()
    const target = rs.find(r => r.citeKey === 'smith2019')!
    target.status = 'matched-by-doi'
    target.openalex = mkWork({
      doi: 'https://doi.org/10.1234/abc',
      publicationYear: 2019,
      hostVenue: 'Journal of Testing',
      biblio: { volume: '7', issue: '2', firstPage: '10', lastPage: '20' },
    })
    const cleaned = computeCleanedBib(rs)
    const entry = cleaned.entries.find(e => e.citeKey === 'smith2019')!
    expect(entry.action).toBe('applied')
    expect(entry.confidence).toBe('confident')
    const fields = entry.applied.map(f => f.field).sort()
    expect(fields).toEqual(['doi', 'journal', 'number', 'pages', 'volume', 'year'])
    // new content present, original title untouched, cite key unchanged
    expect(entry.newRaw).toContain('doi = {10.1234/abc}')
    expect(entry.newRaw).toContain('pages = {10--20}')
    expect(entry.newRaw).toContain('title = {Minimal entry}')
    expect(entry.newRaw).toContain('@article{smith2019,')
    // and it re-parses to exactly one entry with the same key
    expect(keysAndCount(entry.newRaw)).toEqual({ keys: ['smith2019'], count: 1 })
  })

  it('never overwrites a field the entry already has', () => {
    const rs = rows()
    const target = rs.find(r => r.citeKey === 'muller2020')! // already has year + journal
    target.status = 'matched-by-doi'
    target.openalex = mkWork({ publicationYear: 2021, hostVenue: 'Wrong Venue', doi: 'https://doi.org/10.1234/xyz' })
    const entry = computeCleanedBib(rs).entries.find(e => e.citeKey === 'muller2020')!
    expect(entry.applied.map(f => f.field)).toEqual(['doi']) // year & journal already present -> not touched
    expect(entry.newRaw).not.toContain('2021')
  })

  it('suspicious matches get nothing — the DOI points to another work (v1.4.5, C3)', () => {
    const rs = rows()
    const target = rs.find(r => r.citeKey === 'smith2019')!
    target.status = 'suspicious'
    target.openalex = mkWork({ doi: 'https://doi.org/10.1234/abc', publicationYear: 2019, biblio: { volume: '134', issue: '5', firstPage: '843', lastPage: '853' } })
    const entry = computeCleanedBib(rs).entries.find(e => e.citeKey === 'smith2019')!
    expect(entry.action).toBe('suggested')
    expect(entry.applied).toEqual([])
    expect(entry.suggested).toEqual([])
    expect(entry.mismatches).toEqual([])
    expect(entry.note).toMatch(/points to another work/)
    expect(entry.newRaw).toBe(entry.originalRaw) // not written
  })
})

describe('insertFields', () => {
  it('adds a trailing comma to the previous field and keeps the closer', () => {
    const raw = '@article{k,\n  title = {T}\n}'
    const out = insertFields(raw, [{ field: 'doi', value: '10.1/x' }])
    expect(out).toContain('title = {T},')
    expect(out).toContain('doi = {10.1/x},')
    expect(keysAndCount(out)).toEqual({ keys: ['k'], count: 1 })
  })
})

// A resolved preprint is a SUGGESTION only — the cleaned .bib never writes it
// (the user applies the swap manually). This guards that invariant.
describe('preprint resolutions are suggested, never written', () => {
  it('shows the preprint suggestion but leaves the entry byte-identical', () => {
    const rs = rows()
    const target = rs.find(r => r.citeKey === 'smith2019')!
    const resolved = new Map<string, ResolvedPreprint>([[target.rowId, resolvedPreprint()]])
    const cleaned = computeCleanedBib(rs, resolved)
    const entry = cleaned.entries.find(e => e.citeKey === 'smith2019')!
    expect(entry.preprint).not.toBeNull() // surfaced as a suggestion
    expect(entry.action).toBe('suggested')
    expect(entry.newRaw).toBe(entry.originalRaw) // but nothing written to the file
    expect(serializeCleanedBib(AWKWARD, cleaned)).not.toContain('10.1234/pub')
  })
})

// v1.1 — field MISMATCHES (user has a value that differs from OpenAlex). These are
// REVIEW-ONLY suggestions: never auto-applied, accepted one field at a time, and the
// cite-key/entry-count/verbatim invariants must hold before and after accepting.
describe('field mismatches — review-only, per-field accept', () => {
  const SRC = `@article{jones2020,
  title = {Deep learning for cats},
  author = {Jones, Amy},
  journal = {Journal of Cats},
  year = {2020},
  volume = {5},
  doi = {10.5555/right},
}
`
  function jonesRows(): ResultRow[] {
    const rs = buildRows(parseBib(SRC))
    const t = rs.find(r => r.citeKey === 'jones2020')!
    t.status = 'matched-by-doi'
    t.openalex = mkWork({
      displayName: 'Deep learning for cats', // same title -> NOT a mismatch
      publicationYear: 2021, // differs from 2020 by one year (online-first vs print)
      hostVenue: 'Journal of Felines', // differs from Journal of Cats — never proposed (v1.4.5)
      doi: 'https://doi.org/10.5555/right',
      biblio: { volume: '6', issue: null, firstPage: null, lastPage: null }, // differs from 5
    })
    return rs
  }

  it('detects differing fields as suggestions and does NOT auto-apply them', () => {
    const e = computeCleanedBib(jonesRows()).entries.find(x => x.citeKey === 'jones2020')!
    expect(e.mismatches.map(m => m.field).sort()).toEqual(['volume', 'year'])
    expect(e.applied).toEqual([]) // those fields already exist -> no additive fill
    expect(e.newRaw).toBe(e.originalRaw) // nothing written until accepted
  })

  it('accepting ONE field changes only that field; the rest stay byte-identical', () => {
    const rs = jonesRows()
    const e0 = computeCleanedBib(rs).entries.find(x => x.citeKey === 'jones2020')!
    const accepted = new Set([`${e0.sourceOffset}::year`])
    const e = computeCleanedBib(rs, undefined, accepted).entries.find(x => x.citeKey === 'jones2020')!
    // exactly the original with year swapped — every other byte identical
    expect(e.newRaw).toBe(e0.originalRaw.replace('year = {2020}', 'year = {2021}'))
    expect(e.newRaw).toContain('journal = {Journal of Cats}') // never proposed -> untouched
    expect(e.newRaw).toContain('volume = {5}') // declined -> untouched
  })

  it('cite keys + entry count stay invariant after accepting every correction', () => {
    const rs = jonesRows()
    const off = computeCleanedBib(rs).entries.find(x => x.citeKey === 'jones2020')!.sourceOffset
    const accepted = new Set([`${off}::year`, `${off}::journal`, `${off}::doi`, `${off}::volume`])
    const cleaned = computeCleanedBib(rs, undefined, accepted)
    const out = serializeCleanedBib(SRC, cleaned)
    expect(keysAndCount(out)).toEqual(keysAndCount(SRC))
    expect(out).toContain('year = {2021}')
    expect(out).toContain('journal = {Journal of Cats}')
    expect(out).toContain('volume = {6}')
  })

  it('declining (accept nothing) leaves the source byte-identical', () => {
    const cleaned = computeCleanedBib(jonesRows())
    expect(serializeCleanedBib(SRC, cleaned)).toBe(SRC)
  })
})

describe('replaceFieldValue', () => {
  it('replaces a braced value, leaving nested braces elsewhere intact', () => {
    const raw = '@article{k,\n  title = {A {DNA} study},\n  year = {2019},\n}'
    const out = replaceFieldValue(raw, 'year', '2020')
    expect(out).toContain('year = {2020}')
    expect(out).toContain('title = {A {DNA} study}')
  })
  it('preserves quote delimiters when the original used them', () => {
    const raw = '@article{k,\n  year = "2019",\n}'
    expect(replaceFieldValue(raw, 'year', '2020')).toContain('year = "2020"')
  })
  it('returns the source unchanged when the field is absent', () => {
    const raw = '@article{k,\n  title = {T},\n}'
    expect(replaceFieldValue(raw, 'year', '2020')).toBe(raw)
  })
})

// v1.4.3 — never write an unverified DOI: automatic vs review fills.
describe('automatic vs review fills (v1.4.3)', () => {
  const work = () => mkWork({
    doi: 'https://doi.org/10.1234/abc', publicationYear: 2019, hostVenue: 'Journal of Testing',
    biblio: { volume: '7', issue: null, firstPage: '10', lastPage: '20' },
  })
  const titleRow = (signals: Partial<NonNullable<ResultRow['matchSignals']>>, status: ResultRow['status'] = 'matched-by-title') => {
    const rs = rows()
    const t = rs.find(r => r.citeKey === 'smith2019')!
    t.status = status
    t.openalex = work()
    t.matchSignals = { title: 1, author: 1, year: 1, venue: null, type: null, biblio: null, score: 1, ...signals }
    return rs
  }
  const smith = (rs: ResultRow[], accepted?: Set<string>) => computeCleanedBib(rs, undefined, accepted).entries.find(e => e.citeKey === 'smith2019')!

  it('high-confidence title match: ONLY the DOI is written automatically; the rest is review', () => {
    const e = smith(titleRow({}))
    expect(e.applied.map(f => [f.field, f.basis])).toEqual([['doi', 'title-high-confidence']])
    expect(e.suggested.map(f => f.field).sort()).toEqual(['journal', 'pages', 'volume', 'year'])
    expect(e.newRaw).toContain('doi = {10.1234/abc}')
    expect(e.newRaw).not.toContain('Journal of Testing')
  })
  it('a title match without a CONFIRMED first author or year writes nothing', () => {
    for (const s of [{ author: null }, { year: null }, { author: 0.7 }, { title: 0.94 }, { type: 0.5 } /* arXiv entry vs proceedings record */]) {
      const e = smith(titleRow(s))
      expect(e.applied).toEqual([])
      expect(e.newRaw).toBe(e.originalRaw)
    }
  })
  it('uncertain matches write nothing; all fills are review', () => {
    const e = smith(titleRow({}, 'uncertain'))
    expect(e.applied).toEqual([])
    expect(e.suggested.map(f => f.field)).toContain('doi')
    expect(e.newRaw).toBe(e.originalRaw)
  })
  it('accepting one review fill writes exactly that field; keys and count stay invariant', () => {
    const rs = titleRow({}, 'uncertain')
    const off = smith(rs).sourceOffset
    const e = smith(rs, new Set([`${off}::add:doi`]))
    expect(e.acceptedFills).toEqual(['doi'])
    expect(e.newRaw).toContain('doi = {10.1234/abc}')
    expect(e.newRaw).not.toContain('volume')
    const out = serializeCleanedBib(AWKWARD, computeCleanedBib(rs, undefined, new Set([`${off}::add:doi`])))
    expect(keysAndCount(out)).toEqual(keysAndCount(AWKWARD))
  })
  it('counts state how many fields were written automatically, and on what basis', () => {
    const c = computeCleanedBib(titleRow({})).counts
    expect(c).toMatchObject({ fieldsAdded: 1, autoTitleDois: 1, autoFromDoiMatch: 0, reviewFills: 4, acceptedFills: 0 })
  })
})

// v1.4.5 — audit fixes (C1, H5, M2, M5, H3, H4).
describe('v1.4.5 cleaned .bib safety', () => {
  const one = (src: string, status: ResultRow['status'], work: Parameters<typeof mkWork>[0], over: Partial<ResultRow> = {}) => {
    const rs = buildRows(parseBib(src))
    Object.assign(rs[0], { status, openalex: mkWork(work), ...over })
    return computeCleanedBib(rs).entries[0]
  }
  it('escapes LaTeX specials in every written or proposed value (C1)', () => {
    expect(texEscape('journal', 'Computing in Science & Engineering')).toBe('Computing in Science \\& Engineering')
    expect(texEscape('journal', 'A \\& B 50% $x$ #1 a_b')).toBe('A \\& B 50\\% \\$x\\$ \\#1 a\\_b')
    expect(texEscape('doi', '10.1000/a_b')).toBe('10.1000/a_b') // identifiers are verbatim
    const e = one('@article{h,\n  title = {Matplotlib},\n  year = {2007},\n  doi = {10.1109/MCSE.2007.55},\n}', 'matched-by-doi',
      { doi: 'https://doi.org/10.1109/mcse.2007.55', hostVenue: 'Computing in Science & Engineering' })
    expect(e.newRaw).toContain('journal = {Computing in Science \\& Engineering}')
  })
  it('writes an article number as N, never N--N (H5)', () => {
    expect(pagesOf({ volume: null, issue: null, firstPage: '133', lastPage: '133' })).toBe('133')
    expect(pagesOf({ volume: null, issue: null, firstPage: 'e18554', lastPage: null })).toBe('e18554')
    expect(pagesOf({ volume: null, issue: null, firstPage: '10', lastPage: '20' })).toBe('10--20')
  })
  it('never proposes another journal or a preprint server; a year only when 1 off (H5, M2)', () => {
    const src = '@article{c,\n  title = {Some title},\n  journal = {Physics and Astronomy Reports},\n  year = {1989},\n  doi = {10.48550/arXiv.2504.21075},\n}'
    const e = one(src, 'matched-by-doi', { doi: 'https://doi.org/10.48550/arxiv.2504.21075', hostVenue: 'arXiv (Cornell University)', publicationYear: 2008, displayName: 'T' })
    expect(e.mismatches).toEqual([])
    expect(e.note).toMatch(/arXiv preprint's/)
    expect(e.note).toMatch(/dates this record 2008/)
  })
  it('cleans OpenAlex venue names before filling (M2)', () => {
    expect(cleanVenue('IEEE Computer Society Conference on Computer Vision and Pattern Recognition/Proceedings - IEEE Computer Society Conference on Computer Vision and Pattern Recognition/Proceedings'))
      .toBe('IEEE Computer Society Conference on Computer Vision and Pattern Recognition')
    expect(cleanVenue('Alzheimer s Research & Therapy')).toBe("Alzheimer's Research & Therapy")
    for (const junk of ['PubMed', 'Springer eBooks', 'Medical Entomology and Zoology']) expect(cleanVenue(junk)).toBeNull()
    const e = one('@misc{i,\n  title = {Some title},\n  year = {2017},\n}', 'matched-by-title', { hostVenue: 'arXiv (Cornell University)' })
    expect([...e.applied, ...e.suggested].map(f => f.field)).not.toContain('journal')
  })
  it('a DOI resolved to a merged record of another version: fills are review only (M5)', () => {
    const e = one('@misc{i,\n  title = {Some title},\n  doi = {10.48550/arXiv.1611.07004},\n}', 'matched-by-doi',
      { doi: 'https://doi.org/10.1109/cvpr.2017.632', publicationYear: 2017, displayName: 'T' })
    expect(e.applied).toEqual([])
    expect(e.suggested.map(f => f.field)).toContain('year')
    expect(e.note).toMatch(/merged record 10\.1109\/cvpr\.2017\.632/)
  })
  it('found through an identifier outside the doi field: every fill is review (H4, v1.4.6 F3)', () => {
    const e = one('@article{h,\n  title = {Some title},\n  url = {https://doi.org/10.1038/382420a0},\n}', 'matched-by-doi',
      { doi: 'https://doi.org/10.1038/382420a0', publicationYear: 1996 }, { idSource: 'url' })
    expect(e.applied).toEqual([])
    expect(e.suggested.map(f => f.field).sort()).toEqual(['doi', 'year'])
  })
  it('a record dated 2+ years off your year: every fill is review (v1.4.6, F3)', () => {
    const e = one('@article{v,\n  title = {Attention},\n  year = {2017},\n  doi = {10.1/x},\n}', 'matched-by-doi',
      { doi: 'https://doi.org/10.1/x', publicationYear: 2025, biblio: { volume: '30', issue: null, firstPage: '5998', lastPage: '6008' } })
    expect(e.applied).toEqual([])
    expect(e.suggested.map(f => f.field).sort()).toEqual(['pages', 'volume'])
  })
  it('never writes or proposes a placeholder / self-assigned DOI (v1.4.6, F3)', () => {
    for (const doi of ['https://doi.org/10.5555/1953048.2078195', 'https://doi.org/10.13140/rg.2.1.4647.1122']) {
      const e = one('@article{p,\n  title = {Scikit-learn},\n  author = {Pedregosa, F.},\n  year = {2011},\n}', 'matched-by-title',
        { doi, publicationYear: 2011 }, { matchSignals: { title: 1, author: 1, year: 1, venue: null, type: null, biblio: null, score: 1 } })
      expect([...e.applied, ...e.suggested].map(f => f.field)).not.toContain('doi')
    }
  })
  it('never proposes a title "correction" (v1.4.6, F18)', () => {
    const e = one('@article{w,\n  title = {Ileal-lymphoid-nodular hyperplasia},\n  year = {1998},\n  doi = {10.1/w},\n}', 'matched-by-doi',
      { doi: 'https://doi.org/10.1/w', displayName: 'RETRACTED: Ileal-lymphoid-nodular hyperplasia', publicationYear: 1998 })
    expect(e.mismatches.map(m => m.field)).not.toContain('title')
  })
  it('marks the second copy of a cite key with a comment, keys and count unchanged (H3)', () => {
    const src = '@article{d,\n  title = {Some title},\n}\n\n@article{d,\n  title = {Some title},\n}\n'
    const rs = buildRows(parseBib(src))
    expect(rs.map(r => r.entry?.dupKeyIndex)).toEqual([1, 2])
    const out = serializeCleanedBib(src, computeCleanedBib(rs))
    expect(out).toBe('@article{d,\n  title = {Some title},\n}\n\n' + DUP_KEY_COMMENT + '@article{d,\n  title = {Some title},\n}\n')
  })
})
