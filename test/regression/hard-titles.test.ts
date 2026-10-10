// v1.4.1 — title-matching REGRESSION over ~100 hard entries (hard-titles.bib),
// replayed OFFLINE from recorded responses (hard-titles.fixture.json — see
// record.test.ts). Runs on every `npm test`; no network. v1.4.4: replays the full
// title pipeline (resolveByTitle): Crossref search -> OpenAlex by DOI -> OpenAlex
// search fallback.
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
import { findTwins, titleSimilarity, type TitleDecision } from '../../src/lib/matchScore'
import { buildCrossrefSearchUrl, crossrefToWork, parseCrossrefItems, type CrossrefResult, type CrossrefUpdate } from '../../src/lib/crossref'
import { computeRetractions } from '../../src/lib/stats/retractions'
import { computeCleanedBib } from '../../src/lib/stats/cleanBib'
import type { ResultRow } from '../../src/types'
import { computeDuplicates, resolveByTitle, usesCrossref, type TitleResolution, type TitleSources } from '../../src/lib/match'

const BIB = fileURLToPath(new URL('./hard-titles.bib', import.meta.url))
const FIX = fileURLToPath(new URL('./hard-titles.fixture.json', import.meta.url))

// Recall floor: confident-and-correct matches out of the entries with a known
// correct record. Set from the first recorded run; raise it when matching
// improves, never lower it to make a change pass.
const MIN_CORRECT = 105 // 2026-10-10 (v1.4.4, Crossref first): 105 of 111 entries with a known correct record
// v1.4.4 capacity floor: title matches found through free Crossref (no OpenAlex
// search spent). Set from the first Crossref recording; raise, never lower.
const MIN_VIA_CROSSREF = 87 // 2026-10-10: 87 of 126 entries placed by Crossref (39 needed a billable search)

const fixture = existsSync(FIX) ? JSON.parse(readFileSync(FIX, 'utf8')) : null
const fx: Record<string, any> = fixture?.entries ?? {}
const bare = (id: string | null | undefined) => (id ?? '').replace(/^https?:\/\/openalex\.org\//i, '')

type Outcome = 'correct' | 'WRONG' | 'uncertain-right' | 'uncertain-other' | 'miss' | 'ok-negative' | 'review'

// v1.4.4 — replay the app's title pipeline from recorded responses.
const parsed = parseBib(readFileSync(BIB, 'utf8'))
const oaByDoi: Record<string, any> = fixture?.oaByDoi ?? {}
const replay = (key: string): TitleSources => ({
  crossref: async () => (Array.isArray(fx[key]?.crossrefItems) ? fx[key].crossrefItems.map(crossrefToWork) : null),
  openalexByDoi: async doi => (oaByDoi[doi] ? toOpenAlexWork(oaByDoi[doi]) : null),
  openalexSearch: async () => ({ kind: 'ok' as const, candidates: (fx[key]?.candidates ?? []).map(toOpenAlexWork) }),
})
const NOT_FOUND: TitleDecision = { status: 'not-found', work: null, signals: null, ambiguous: false, twins: [] }
const resolutions = new Map<string, TitleResolution>()
if (fixture) for (const e of parsed.entries) resolutions.set(e.citeKey, await resolveByTitle(e, replay(e.citeKey)))

describe.skipIf(!fixture)('title-matching regression (hard-titles.bib, offline)', () => {

  // Mirror the app's pipeline: the REAL duplicate step runs first, and a
  // duplicate copies its canonical entry's decision (as runMatching does). The
  // v1.4.1 hotfix bug — distinct works merged by title — lived exactly here.
  const dupOf = computeDuplicates(parsed.entries) // rowId -> canonical cite key
  const decide = (e: (typeof parsed.entries)[number]) => resolutions.get(e.citeKey)?.decision ?? NOT_FOUND
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
    const via: Record<string, number> = {}
    for (const r of resolutions.values()) via[`${r.via}${r.billable ? ' (billable)' : ''}`] = (via[`${r.via}${r.billable ? ' (billable)' : ''}`] ?? 0) + 1
    console.log('via:', via)
    console.log(tally)
  }

  // ---- v1.4.2 retraction check, replayed on the recorded OpenAlex + Crossref data ----
  const crossref: CrossrefResult = (() => {
    const checked: string[] = fixture?.crossref?.checked ?? []
    const updates = new Map<string, CrossrefUpdate[]>()
    for (const u of parseCrossrefItems(fixture?.crossref?.items ?? [], new Set(checked))) {
      updates.set(u.target, [...(updates.get(u.target) ?? []), u])
    }
    return { updates, checked: checked.length, failed: 0 }
  })()
  const asRow = (r: (typeof results)[number]): ResultRow => ({
    rowId: r.e.rowId, sourceOffset: r.e.sourceOffset, citeKey: r.e.citeKey, title: r.e.title, bibYear: r.e.year,
    status: r.d.status, openalex: r.d.work, matchScore: r.d.signals?.score ?? null, matchSignals: r.d.signals, yearState: 'unverified',
    duplicateOf: dupOf.get(r.e.rowId) ?? null, error: null, raw: r.e.raw, entry: r.e,
    twins: r.d.twins.map(t => ({ id: t.id, doi: t.doi, isRetracted: t.isRetracted })),
  })
  const report = computeRetractions(results.map(asRow), crossref)
  const retractedKeys = new Set(report.retracted.map(f => f.citeKey))

  if (process.env.BIBPROFILE_REGRESSION_REPORT) {
    for (const f of report.retracted) console.log('RETRACTED ', f.citeKey.padEnd(20), f.signals.join(','), f.updates.map(u => `${u.kind}/${u.source}`).join(' '))
    for (const f of report.concerns) console.log('CONCERN   ', f.citeKey.padEnd(20), f.updates.map(u => `${u.kind}/${u.source}`).join(' '))
    for (const f of report.corrections) console.log('CORRECTION', f.citeKey.padEnd(20), f.updates.map(u => `${u.kind}/${u.source}`).join(' '))
  }

  // ---- v1.4.3: no unverified DOI is written into the cleaned .bib ----
  it('every DOI written automatically into the cleaned .bib is the known-correct record', () => {
    const cleaned = computeCleanedBib(results.map(asRow))
    const auto = cleaned.entries.filter(e => e.applied.some(f => f.field === 'doi'))
    const bad = auto.filter(e => results.find(r => r.e.citeKey === e.citeKey)?.outcome !== 'correct').map(e => e.citeKey)
    expect(bad).toEqual([])
    if (process.env.BIBPROFILE_REGRESSION_REPORT) console.log(`auto-written DOIs: ${auto.length}; review fills: ${cleaned.counts.reviewFills}`)
  })

  it('Crossref notices were recorded for the candidate DOIs', () => {
    expect(crossref.checked).toBeGreaterThan(0)
  })

  it('reports every known retraction as retracted', () => {
    const missed = parsed.entries.filter(e => readField(e.raw, 'retraction') === 'retracted' && !retractedKeys.has(e.citeKey)).map(e => e.citeKey)
    expect(missed).toEqual([])
  })

  it('reports nothing else as retracted (no false alarms)', () => {
    const extra = parsed.entries.filter(e => readField(e.raw, 'retraction') !== 'retracted' && retractedKeys.has(e.citeKey)).map(e => e.citeKey)
    expect(extra).toEqual([])
  })

  it('the Wakefield case: matched to an UNFLAGGED duplicate record, still reported retracted', () => {
    // OpenAlex holds Wakefield 1998 several times; only one record is flagged. Force
    // the match onto the unflagged UCL repository copy and check the twin catches it.
    const e = byKey.get('wakefield1998')!
    const cands = (fx.wakefield1998?.candidates ?? []).map(toOpenAlexWork)
    const unflagged = cands.find(c => bare(c.id) === 'W2730456447')!
    expect(unflagged.isRetracted).toBe(false)
    const row: ResultRow = { ...asRow(results.find(r => r.e.citeKey === 'wakefield1998')!), openalex: unflagged,
      twins: findTwins(e, unflagged, cands).map(t => ({ id: t.id, doi: t.doi, isRetracted: t.isRetracted })) }
    const r = computeRetractions([{ ...row, entry: { ...e, titleRetracted: false } }], null) // no title prefix, no Crossref: twins only
    expect(r.retracted[0]?.signals).toEqual(['openalex-duplicate'])
  })

  it('no two entries are merged as duplicates (every entry here is a distinct work)', () => {
    expect(parsed.entries.filter(e => dupOf.has(e.rowId)).map(e => `${e.citeKey} -> ${dupOf.get(e.rowId)}`)).toEqual([])
  })

  it(`finds at least ${MIN_VIA_CROSSREF} title matches through free Crossref (capacity floor)`, () => {
    const n = [...resolutions.values()].filter(r => r.via === 'crossref').length
    expect(n).toBeGreaterThanOrEqual(MIN_VIA_CROSSREF)
  })

  it('every entry was recorded with the query the app sends today (else re-record)', () => {
    const doi = (d: string | null) => (d ? d.trim().toLowerCase() : null)
    const stale = parsed.entries.filter(e => {
      const r = fx[e.citeKey]
      return r?.query !== (e.titleForSearch || e.title)
        || (usesCrossref(e) && r?.crossrefUrl !== buildCrossrefSearchUrl(e))
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
