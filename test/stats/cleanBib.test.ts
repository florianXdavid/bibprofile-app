import { describe, it, expect } from 'vitest'
import { parse } from '@retorquere/bibtex-parser'
import { parseBib } from '../../src/lib/parseBib'
import { buildRows } from '../../src/lib/match'
import {
  computeCleanedBib,
  serializeCleanedBib,
  type ResolvedPreprint,
} from '../../src/lib/stats/cleanBib'
import { insertFields } from '../../src/lib/bibWriter'
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
