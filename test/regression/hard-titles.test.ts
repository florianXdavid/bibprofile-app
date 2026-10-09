// v1.4.1 — title-matching REGRESSION over ~100 hard entries (hard-titles.bib),
// replayed OFFLINE from recorded OpenAlex responses (hard-titles.fixture.json —
// see record.test.ts). Runs on every `npm test`; no network.
//
// The hard rule: a confident `matched-by-title` is never the wrong record.
// `uncertain` / `not-found` on a hard entry is allowed; it's counted as recall,
// and recall may not drop below MIN_CORRECT.
//
// Detailed per-entry report:  BIBPROFILE_REGRESSION_REPORT=1 npx vitest run hard-titles

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBib } from '../../src/lib/parseBib'
import { readField } from '../../src/lib/bibWriter'
import { toOpenAlexWork } from '../../src/lib/openalex'
import { chooseTitleMatch, titleSimilarity } from '../../src/lib/matchScore'
import { computeDuplicates } from '../../src/lib/match'

const BIB = fileURLToPath(new URL('./hard-titles.bib', import.meta.url))
const FIX = fileURLToPath(new URL('./hard-titles.fixture.json', import.meta.url))

// Recall floor: confident-and-correct matches out of the entries with a known
// correct record. Set from the first recorded run; raise it when matching
// improves, never lower it to make a change pass.
const MIN_CORRECT = 90 // first recording, 2026-10-09: 90 of 101 entries with a known correct record

const fixture = existsSync(FIX) ? JSON.parse(readFileSync(FIX, 'utf8')) : null
const fx: Record<string, any> = fixture?.entries ?? {}
const bare = (id: string | null | undefined) => (id ?? '').replace(/^https?:\/\/openalex\.org\//i, '')

type Outcome = 'correct' | 'WRONG' | 'uncertain-right' | 'uncertain-other' | 'miss' | 'ok-negative' | 'review'

describe.skipIf(!fixture)('title-matching regression (hard-titles.bib, offline)', () => {
  const parsed = parseBib(readFileSync(BIB, 'utf8'))

  // Mirror the app's pipeline: the REAL duplicate step runs first, and a
  // duplicate copies its canonical entry's decision (as runMatching does). The
  // v1.4.1 hotfix bug — distinct works merged by title — lived exactly here.
  const dupOf = computeDuplicates(parsed.entries) // rowId -> canonical cite key
  const decide = (e: (typeof parsed.entries)[number]) =>
    chooseTitleMatch(e, (fx[e.citeKey]?.candidates ?? []).map(toOpenAlexWork))
  const byKey = new Map(parsed.entries.map(e => [e.citeKey, e]))

  const results = parsed.entries.map(e => {
    const rec = fx[e.citeKey]
    const canonicalKey = dupOf.get(e.rowId)
    const d = decide(canonicalKey ? byKey.get(canonicalKey)! : e)
    // `expectid = {W1 | W2}`: OpenAlex holds the same work twice — either is right.
    const expectIds = (readField(e.raw, 'expectid') ?? (readField(e.raw, 'expectdoi') ? rec?.expectDoi?.id : '') ?? '').split('|').map(s => bare(s.trim())).filter(Boolean)
    const expectId = expectIds.join(' | ')
    const notId = readField(e.raw, 'expectnot') ? bare(rec?.expectNot?.id) : ''
    const expectNone = readField(e.raw, 'expect') === 'none'
    const review = readField(e.raw, 'expect') === 'review'
    const got = bare(d.work?.id)
    const confident = d.status === 'matched-by-title'
    let outcome: Outcome
    const right = expectIds.includes(got)
    if (confident && ((expectIds.length && !right) || (notId && got === notId) || expectNone)) outcome = 'WRONG'
    else if (expectIds.length) outcome = confident ? 'correct' : d.status === 'uncertain' ? (right ? 'uncertain-right' : 'uncertain-other') : 'miss'
    else if (expectNone || notId) outcome = 'ok-negative'
    else outcome = 'review'
    return { e, rec, d, expectId, notId, outcome, got, case: readField(e.raw, 'hardcase') ?? '' }
  })

  if (process.env.BIBPROFILE_REGRESSION_REPORT) {
    for (const r of results) {
      const w = r.d.work
      console.log([
        r.outcome.padEnd(15), r.case.padEnd(20), r.e.citeKey.padEnd(20), r.d.status.padEnd(16),
        (r.d.signals?.score ?? 0).toFixed(3), r.d.ambiguous ? 'TIE' : '   ',
        w ? `${bare(w.id)} ${w.publicationYear} ${w.type} | ${w.displayName.slice(0, 60)} | ${w.hostVenue ?? ''}` : '-',
      ].join('  '))
    }
    const tally: Record<string, number> = {}
    for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1
    console.log(tally)
  }

  it('no two entries are merged as duplicates (every entry here is a distinct work)', () => {
    expect(parsed.entries.filter(e => dupOf.has(e.rowId)).map(e => `${e.citeKey} -> ${dupOf.get(e.rowId)}`)).toEqual([])
  })

  it('every entry was recorded with the query the app sends today (else re-record)', () => {
    const doi = (d: string | null) => (d ? d.trim().toLowerCase() : null)
    const stale = parsed.entries.filter(e => {
      const r = fx[e.citeKey]
      return r?.query !== (e.titleForSearch || e.title)
        || (readField(e.raw, 'expectdoi') && doi(r.expectDoi?.doi) !== doi(readField(e.raw, 'expectdoi')))
        || (readField(e.raw, 'expectnot') && doi(r.expectNot?.doi) !== doi(readField(e.raw, 'expectnot')))
    }).map(e => e.citeKey)
    expect(stale).toEqual([])
  })

  it('every ground-truth DOI resolved to an OpenAlex record', () => {
    const broken = results.filter(r => (r.rec?.expectDoi && !r.rec.expectDoi.id) || (r.rec?.expectNot && !r.rec.expectNot.id)).map(r => r.e.citeKey)
    expect(broken).toEqual([])
  })

  it('no entry is left awaiting manual review', () => {
    expect(results.filter(r => r.outcome === 'review').map(r => r.e.citeKey)).toEqual([])
  })

  it('NEVER confidently attaches the wrong record', () => {
    const wrong = results.filter(r => r.outcome === 'WRONG')
      .map(r => `${r.e.citeKey}: got ${r.got}, expected ${r.expectId || `not ${r.notId}` || 'none'}`)
    expect(wrong).toEqual([])
  })

  it(`keeps recall at or above the recorded floor (${MIN_CORRECT} confident-correct)`, () => {
    expect(results.filter(r => r.outcome === 'correct').length).toBeGreaterThanOrEqual(MIN_CORRECT)
  })

  it('ground truth looks like the entry (sanity check on the expected records)', () => {
    // Expected record title vs .bib title; the only exceptions are entries whose
    // `note` says the .bib title is a translation.
    const off = results
      .filter(r => readField(r.e.raw, 'expectdoi') && r.rec?.expectDoi?.title && !/translation/i.test(readField(r.e.raw, 'note') ?? ''))
      .filter(r => titleSimilarity(r.e.title, r.rec.expectDoi.title) < 0.8)
      .map(r => `${r.e.citeKey}: "${r.rec.expectDoi.title}"`)
    expect(off).toEqual([])
  })
})
