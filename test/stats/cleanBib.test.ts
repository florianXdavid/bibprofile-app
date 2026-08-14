import { describe, it, expect } from 'vitest'
import { parse } from '@retorquere/bibtex-parser'
import { parseBib } from '../../src/lib/parseBib'
import { buildRows } from '../../src/lib/match'
import {
  computeCleanedBib,
  serializeCleanedBib,
  type ResolvedPreprint,
} from '../../src/lib/stats/cleanBib'
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
    target.openalex = mkWork({ publicationYear: 1999, hostVenue: 'Wrong Venue', doi: 'https://doi.org/10.1234/xyz' })
    const entry = computeCleanedBib(rs).entries.find(e => e.citeKey === 'muller2020')!
    expect(entry.applied.map(f => f.field)).toEqual(['doi']) // year & journal already present -> not touched
    expect(entry.newRaw).not.toContain('1999')
  })

  it('suspicious matches are suggested only, never written', () => {
    const rs = rows()
    const target = rs.find(r => r.citeKey === 'smith2019')!
    target.status = 'suspicious'
    target.openalex = mkWork({ doi: 'https://doi.org/10.1234/abc', publicationYear: 2019 })
    const entry = computeCleanedBib(rs).entries.find(e => e.citeKey === 'smith2019')!
    expect(entry.action).toBe('suggested')
    expect(entry.applied).toEqual([])
    expect(entry.suggested.length).toBeGreaterThan(0)
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
  year = {2019},
  volume = {5},
  doi = {10.1234/wrong},
}
`
  function jonesRows(): ResultRow[] {
    const rs = buildRows(parseBib(SRC))
    const t = rs.find(r => r.citeKey === 'jones2020')!
    t.status = 'matched-by-doi'
    t.openalex = mkWork({
      displayName: 'Deep learning for cats', // same title -> NOT a mismatch
      publicationYear: 2021, // differs from 2019
      hostVenue: 'Journal of Felines', // differs from Journal of Cats
      doi: 'https://doi.org/10.5555/right', // differs from 10.1234/wrong
      biblio: { volume: '6', issue: null, firstPage: null, lastPage: null }, // differs from 5
    })
    return rs
  }

  it('detects differing fields as suggestions and does NOT auto-apply them', () => {
    const e = computeCleanedBib(jonesRows()).entries.find(x => x.citeKey === 'jones2020')!
    expect(e.mismatches.map(m => m.field).sort()).toEqual(['doi', 'journal', 'volume', 'year'])
    expect(e.applied).toEqual([]) // those fields already exist -> no additive fill
    expect(e.newRaw).toBe(e.originalRaw) // nothing written until accepted
  })

  it('accepting ONE field changes only that field; the rest stay byte-identical', () => {
    const rs = jonesRows()
    const e0 = computeCleanedBib(rs).entries.find(x => x.citeKey === 'jones2020')!
    const accepted = new Set([`${e0.sourceOffset}::year`])
    const e = computeCleanedBib(rs, undefined, accepted).entries.find(x => x.citeKey === 'jones2020')!
    // exactly the original with year swapped — every other byte identical
    expect(e.newRaw).toBe(e0.originalRaw.replace('year = {2019}', 'year = {2021}'))
    expect(e.newRaw).toContain('journal = {Journal of Cats}') // declined -> untouched
    expect(e.newRaw).toContain('doi = {10.1234/wrong}')
    expect(e.newRaw).toContain('volume = {5}')
  })

  it('cite keys + entry count stay invariant after accepting every correction', () => {
    const rs = jonesRows()
    const off = computeCleanedBib(rs).entries.find(x => x.citeKey === 'jones2020')!.sourceOffset
    const accepted = new Set([`${off}::year`, `${off}::journal`, `${off}::doi`, `${off}::volume`])
    const cleaned = computeCleanedBib(rs, undefined, accepted)
    const out = serializeCleanedBib(SRC, cleaned)
    expect(keysAndCount(out)).toEqual(keysAndCount(SRC))
    expect(out).toContain('year = {2021}')
    expect(out).toContain('journal = {Journal of Felines}')
    expect(out).toContain('doi = {10.5555/right}')
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
