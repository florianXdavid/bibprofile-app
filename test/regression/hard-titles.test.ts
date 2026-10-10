// v1.4.1 — title-matching REGRESSION over the hard entries of hard-titles.bib,
// replayed OFFLINE from recorded responses (hard-titles.fixture.json — see
// record.test.ts). Runs on every `npm test`; no network. v1.4.4: replays the full
// title pipeline (Crossref search -> OpenAlex by DOI -> OpenAlex search fallback).
// v1.4.5: replays the WHOLE matching run (runMatching: dedup, DOI / identifier
// lookups, title path, same-work duplicates) and the cleaned .bib, and checks the
// v1.5 ground-truth fields and the global invariants G1–G5 (see the .bib header).
//
// The hard rule: a confident match (matched-by-doi / matched-by-title) is never the
// wrong record. `uncertain` / `not-found` on a hard entry is allowed; it's counted
// as recall, and recall may not drop below MIN_CORRECT.
//
// Detailed per-entry report:  BIBPROFILE_REGRESSION_REPORT=1 npx vitest run hard-titles

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBib } from '../../src/lib/parseBib'
import { readField } from '../../src/lib/bibWriter'
import { normalizeDoi } from '../../src/lib/doi'
import { toOpenAlexWork, type DoiLookup } from '../../src/lib/openalex'
import { findTwins, titleSimilarity } from '../../src/lib/matchScore'
import { buildCrossrefSearchUrl, crossrefToWork, parseCrossrefItems, type CrossrefResult, type CrossrefUpdate } from '../../src/lib/crossref'
import { computeRetractions } from '../../src/lib/stats/retractions'
import { computeCleanedBib } from '../../src/lib/stats/cleanBib'
import { buildCohort, citedYear } from '../../src/lib/stats/denominator'
import { bestPublishedMatch } from '../../src/lib/stats/preprints'
import type { BibEntry, ResultRow } from '../../src/types'
import { runMatching, usesCrossref, type TitleSources } from '../../src/lib/match'

const BIB = fileURLToPath(new URL('./hard-titles.bib', import.meta.url))
const FIX = fileURLToPath(new URL('./hard-titles.fixture.json', import.meta.url))

// Recall floor: confident-and-correct matches out of the entries with a known
// correct record. Set from the first recorded run; raise it when matching
// improves, never lower it to make a change pass.
const MIN_CORRECT = 124 // 2026-10-10 (v1.4.5, whole run incl. DOI / identifier lookups): 124 of 130 entries with a known correct record
// v1.4.4 capacity floor: title matches found through free Crossref (no OpenAlex
// search spent). Set from the first Crossref recording; raise, never lower.
const MIN_VIA_CROSSREF = 87 // 2026-10-10: 87 of 126 entries placed by Crossref (39 needed a billable search)

const fixture = existsSync(FIX) ? JSON.parse(readFileSync(FIX, 'utf8')) : null
const fx: Record<string, any> = fixture?.entries ?? {}
const oaByDoi: Record<string, any> = fixture?.oaByDoi ?? {} // bare DOI, or "pmid:…" / "pmcid:…" -> work | null (404)
const bare = (id: string | null | undefined) => (id ?? '').replace(/^https?:\/\/openalex\.org\//i, '')
const lc = (s: string | null | undefined) => (s ?? '').toLowerCase()
// v1.4.5: a cite key may occur twice (H3) — fixture records are keyed by occurrence.
const fxKey = (e: BibEntry) => ((e.dupKeyIndex ?? 1) > 1 ? `${e.citeKey}#${e.dupKeyIndex}` : e.citeKey)
const lookupKey = (e: BibEntry) => (e.doi ? `doi:${e.doi}` : e.altId?.key ?? null)
const oaKey = (key: string) => key.replace(/^doi:/, '')

type Outcome = 'correct' | 'WRONG' | 'uncertain-right' | 'uncertain-other' | 'miss' | 'ok-negative' | 'checked' | 'unlabelled' | 'review'

// v1.5 ground-truth fields that make an entry "checked" without an expected record.
const V15 = ['expectstatus', 'expectmax', 'expectlookup', 'expectnotid', 'expectdup', 'expectnotdup', 'expectfill',
  'expectnosuggest', 'expectversion', 'expectrecencyyear', 'expectyear', 'expecttitle', 'expecttitlenot',
  'expectpublishednot', 'expecterror']

// ---- replay the app's whole matching run from recorded responses ----
const parsed = parseBib(readFileSync(BIB, 'utf8'))
const byQuery = new Map<string, any[]>()
for (const r of Object.values(fx)) if (r?.query) byQuery.set(lc(r.query), r.candidates ?? [])
const sources: Partial<TitleSources> = {
  crossref: async e => (Array.isArray(fx[fxKey(e)]?.crossrefItems) ? fx[fxKey(e)].crossrefItems.map(crossrefToWork) : null),
  openalexByDoi: async doi => (oaByDoi[doi] ? toOpenAlexWork(oaByDoi[doi]) : null),
  openalexSearch: async q => {
    const c = byQuery.get(lc(q))
    return c ? { kind: 'ok' as const, candidates: c.map(toOpenAlexWork) } : { kind: 'error' as const, error: `search not recorded: ${q}` }
  },
  lookup: async (key): Promise<DoiLookup> => {
    const k = oaKey(key)
    if (!(k in oaByDoi)) return { kind: 'error', error: `lookup not recorded: ${key}` }
    return oaByDoi[k] ? { kind: 'ok', work: toOpenAlexWork(oaByDoi[k]) } : { kind: 'not-found' }
  },
  pause: async () => {},
}
const run = fixture ? await runMatching(parsed, () => {}, undefined, sources) : null
const rows: ResultRow[] = run?.rows ?? []

describe.skipIf(!fixture)('matching regression (hard-titles.bib, offline)', () => {
  const rowOf = new Map(rows.map(r => [r.rowId, r]))
  const byKey = new Map(parsed.entries.map(e => [e.citeKey, e])) // first copy of a duplicated key
  const rowByKey = (k: string) => rowOf.get(byKey.get(k)?.rowId ?? '')
  const field = (e: BibEntry, f: string) => readField(e.raw, f)
  const isConfident = (r: ResultRow | undefined) => r?.status === 'matched-by-doi' || r?.status === 'matched-by-title'

  const results = parsed.entries.map(e => {
    const row = rowOf.get(e.rowId)!
    const rec = fx[fxKey(e)]
    // `expectid = {W1 | W2}`: OpenAlex holds the same work twice — either is right.
    const expectIds = (field(e, 'expectid') ?? (field(e, 'expectdoi') ? rec?.expectDoi?.id : '') ?? '').split('|').map(s => bare(s.trim())).filter(Boolean)
    const expectId = expectIds.join(' | ')
    const notIds = [field(e, 'expectnot') ? bare(rec?.expectNot?.id) : '', bare(field(e, 'expectnotid'))].filter(Boolean)
    const expectNone = field(e, 'expect') === 'none'
    const got = bare(row.openalex?.id)
    const confident = isConfident(row)
    let outcome: Outcome
    const right = expectIds.includes(got)
    if (confident && ((expectIds.length && !right) || notIds.includes(got) || expectNone)) outcome = 'WRONG'
    else if (expectIds.length) outcome = confident ? 'correct' : row.status === 'uncertain' ? (right ? 'uncertain-right' : 'uncertain-other') : 'miss'
    else if (expectNone || notIds.length) outcome = 'ok-negative'
    else if (V15.some(f => field(e, f) != null)) outcome = 'checked'
    else outcome = field(e, 'hardcase') ? 'review' : 'unlabelled'
    return { e, row, rec, expectId, notIds, outcome, got, case: field(e, 'hardcase') ?? '' }
  })
  const withField = (f: string) => results.filter(r => field(r.e, f) != null)

  if (process.env.BIBPROFILE_REGRESSION_REPORT) {
    for (const r of results) {
      const w = r.row.openalex
      console.log([
        r.outcome.padEnd(15), r.case.padEnd(20), fxKey(r.e).padEnd(24), r.row.status.padEnd(16),
        (r.row.matchScore ?? 0).toFixed(3), r.row.duplicateOf ? `dup:${r.row.duplicateOf}` : '',
        w ? `${bare(w.id)} ${w.publicationYear} ${w.type} | ${w.displayName.slice(0, 60)} | ${w.hostVenue ?? ''}` : '-',
        (r.row.notes ?? []).join(' | '),
      ].join('  '))
    }
    const tally: Record<string, number> = {}
    for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1
    const via: Record<string, number> = {}
    for (const r of rows) { const k = r.idSource ? `id:${r.idSource}` : r.matchedVia ?? '-'; via[k] = (via[k] ?? 0) + 1 }
    console.log('via:', via, '— billable searches:', run?.summary.searchCalls)
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
  const report = computeRetractions(rows, crossref)
  const retractedKeys = new Set(report.retracted.map(f => f.citeKey))
  const cleaned = computeCleanedBib(rows)
  const cleanedOf = new Map(cleaned.entries.map(c => [c.sourceOffset, c]))
  const cleanOf = (e: BibEntry) => cleanedOf.get(e.sourceOffset)!

  if (process.env.BIBPROFILE_REGRESSION_REPORT) {
    for (const f of report.retracted) console.log('RETRACTED ', f.citeKey.padEnd(20), f.signals.join(','), f.updates.map(u => `${u.kind}/${u.source}`).join(' '))
    for (const f of report.concerns) console.log('CONCERN   ', f.citeKey.padEnd(20), f.updates.map(u => `${u.kind}/${u.source}`).join(' '))
    for (const f of report.corrections) console.log('CORRECTION', f.citeKey.padEnd(20), f.updates.map(u => `${u.kind}/${u.source}`).join(' '))
  }

  // ---- v1.4.3: no unverified DOI is written into the cleaned .bib ----
  it('every DOI written automatically into the cleaned .bib is the known-correct record', () => {
    const auto = cleaned.entries.filter(c => c.applied.some(f => f.field === 'doi'))
    const bad = auto.filter(c => results.find(r => r.e.sourceOffset === c.sourceOffset)?.outcome !== 'correct').map(c => c.citeKey)
    expect(bad).toEqual([])
    if (process.env.BIBPROFILE_REGRESSION_REPORT) console.log(`auto-written DOIs: ${auto.length}; review fills: ${cleaned.counts.reviewFills}`)
  })

  it('Crossref notices were recorded for the candidate DOIs', () => {
    expect(crossref.checked).toBeGreaterThan(0)
  })

  it('reports every known retraction as retracted', () => {
    const missed = parsed.entries.filter(e => field(e, 'retraction') === 'retracted' && !retractedKeys.has(e.citeKey)).map(e => e.citeKey)
    expect(missed).toEqual([])
  })

  it('reports nothing else as retracted (no false alarms)', () => {
    const extra = parsed.entries.filter(e => field(e, 'retraction') !== 'retracted' && retractedKeys.has(e.citeKey)).map(e => e.citeKey)
    expect(extra).toEqual([])
  })

  it('the Wakefield case: matched to an UNFLAGGED duplicate record, still reported retracted', () => {
    // OpenAlex holds Wakefield 1998 several times; only one record is flagged. Force
    // the match onto the unflagged UCL repository copy and check the twin catches it.
    const e = byKey.get('wakefield1998')!
    const cands = (fx.wakefield1998?.candidates ?? []).map(toOpenAlexWork)
    const unflagged = cands.find(c => bare(c.id) === 'W2730456447')!
    expect(unflagged.isRetracted).toBe(false)
    const row: ResultRow = { ...rowByKey('wakefield1998')!, openalex: unflagged,
      twins: findTwins(e, unflagged, cands).map(t => ({ id: t.id, doi: t.doi, isRetracted: t.isRetracted })) }
    const r = computeRetractions([{ ...row, entry: { ...e, titleRetracted: false } }], null) // no title prefix, no Crossref: twins only
    expect(r.retracted[0]?.signals).toEqual(['openalex-duplicate'])
  })

  it('merges only the duplicates the ground truth expects (expectdup, a repeated cite key)', () => {
    const expected = (a: ResultRow, b: string) =>
      field(a.entry!, 'expectdup') === b || (byKey.get(b) && field(byKey.get(b)!, 'expectdup') === a.citeKey) || a.citeKey === b
    expect(rows.filter(r => r.duplicateOf && !expected(r, r.duplicateOf)).map(r => `${r.citeKey} -> ${r.duplicateOf}`)).toEqual([])
  })

  it(`finds at least ${MIN_VIA_CROSSREF} title matches through free Crossref (capacity floor)`, () => {
    expect(rows.filter(r => r.matchedVia === 'crossref').length).toBeGreaterThanOrEqual(MIN_VIA_CROSSREF)
  })

  it('every entry was recorded with the query and lookups the app sends today (else re-record)', () => {
    const doi = (d: string | null) => (d ? d.trim().toLowerCase() : null)
    const stale = parsed.entries.filter(e => {
      const r = fx[fxKey(e)]
      const k = lookupKey(e)
      return lc(r?.query) !== lc(e.titleForSearch || e.title)
        || (usesCrossref(e) && lc(r?.crossrefUrl) !== lc(buildCrossrefSearchUrl(e)))
        || (field(e, 'expectdoi') && doi(r.expectDoi?.doi) !== doi(field(e, 'expectdoi')))
        || (field(e, 'expectnot') && doi(r.expectNot?.doi) !== doi(field(e, 'expectnot')))
        || (k && !(oaKey(k) in oaByDoi))
        || (field(e, 'expectpublishednot') && !Array.isArray(r?.publishedCandidates))
    }).map(fxKey)
    expect(stale).toEqual([])
  })

  it('every ground-truth DOI resolved to an OpenAlex record', () => {
    const broken = results.filter(r => (r.rec?.expectDoi && !r.rec.expectDoi.id) || (r.rec?.expectNot && !r.rec.expectNot.id)).map(r => fxKey(r.e))
    expect(broken).toEqual([])
  })

  it('no entry is left awaiting manual review', () => {
    expect(results.filter(r => r.outcome === 'review').map(r => fxKey(r.e))).toEqual([])
  })

  it('NEVER confidently attaches the wrong record', () => {
    const wrong = results.filter(r => r.outcome === 'WRONG')
      .map(r => `${fxKey(r.e)}: got ${r.got}, expected ${r.expectId || (r.notIds.length ? `not ${r.notIds.join('/')}` : 'none')}`)
    expect(wrong).toEqual([])
  })

  it(`keeps recall at or above the recorded floor (${MIN_CORRECT} confident-correct)`, () => {
    expect(results.filter(r => r.outcome === 'correct').length).toBeGreaterThanOrEqual(MIN_CORRECT)
  })

  it('ground truth looks like the entry (sanity check on the expected records)', () => {
    // Expected record title vs .bib title; the only exceptions are entries whose
    // `note` says the .bib title is a translation.
    const off = results
      .filter(r => field(r.e, 'expectdoi') && r.rec?.expectDoi?.title && !/translation/i.test(field(r.e, 'note') ?? ''))
      .filter(r => titleSimilarity(r.e.title, r.rec.expectDoi.title) < 0.8)
      .map(r => `${fxKey(r.e)}: "${r.rec.expectDoi.title}"`)
    expect(off).toEqual([])
  })

  // ---- v1.4.5: the v1.5 ground-truth fields ----
  const fail = (rs: typeof results, bad: (r: (typeof results)[number]) => string | false) =>
    rs.map(r => bad(r)).filter((x): x is string => !!x)

  it('expectstatus / expectmax: the row status', () => {
    expect(fail(withField('expectstatus'), r => !field(r.e, 'expectstatus')!.split('|').map(s => s.trim()).includes(r.row.status) && `${fxKey(r.e)}: ${r.row.status}`)).toEqual([])
    expect(fail(withField('expectmax'), r => isConfident(r.row) && `${fxKey(r.e)}: ${r.row.status} ${r.got}`)).toEqual([])
  })

  it('expectlookup: the identifier outside the doi field is found, and identifies the record for free', () => {
    const want = (s: string) => {
      const [kind, ...rest] = s.split(':'); const v = rest.join(':').trim()
      return kind === 'arxiv' ? `doi:10.48550/arxiv.${v.toLowerCase()}` : kind === 'doi' ? `doi:${normalizeDoi(v)}` : `${kind}:${v}`
    }
    expect(fail(withField('expectlookup'), r => {
      const k = r.e.altId?.key ?? null
      if (k !== want(field(r.e, 'expectlookup')!)) return `${fxKey(r.e)}: extracted ${k}`
      return oaByDoi[oaKey(k)] && r.row.idSource !== r.e.altId!.field && !r.row.duplicateOf ? `${fxKey(r.e)}: not identified by it (${r.row.status})` : false
    })).toEqual([])
  })

  it('expectdup / expectnotdup: the same OpenAlex work is one reference; a shared DOI alone is not', () => {
    const linked = (a: BibEntry, k: string) => rowOf.get(a.rowId)?.duplicateOf === k || rowByKey(k)?.duplicateOf === a.citeKey
    expect(fail(withField('expectdup'), r => !linked(r.e, field(r.e, 'expectdup')!) && `${fxKey(r.e)} not a duplicate of ${field(r.e, 'expectdup')}`)).toEqual([])
    expect(fail(withField('expectnotdup'), r => linked(r.e, field(r.e, 'expectnotdup')!) && `${fxKey(r.e)} merged into ${field(r.e, 'expectnotdup')}`)).toEqual([])
  })

  it('expectfill / expectnosuggest: what the cleaned .bib writes and proposes', () => {
    expect(fail(withField('expectfill'), r => {
      const [f, ...v] = field(r.e, 'expectfill')!.split('=')
      const line = `${f.trim()} = {${v.join('=').trim()}}`
      return !cleanOf(r.e).newRaw.includes(line) && `${fxKey(r.e)}: no "${line}"`
    })).toEqual([])
    expect(fail(withField('expectnosuggest'), r => {
      const c = cleanOf(r.e)
      const offered = [...c.applied, ...c.suggested].map(f => f.field).concat(c.mismatches.map(m => m.field))
      const banned = field(r.e, 'expectnosuggest')!.trim()
      const hit = banned === '*' ? offered : offered.filter(f => banned.split(',').map(s => s.trim()).includes(f))
      return hit.length > 0 && `${fxKey(r.e)}: offers ${hit.join(',')}`
    })).toEqual([])
  })

  it('expectversion / expectrecencyyear / expectpublishednot', () => {
    expect(fail(withField('expectversion'), r => !r.row.preprintVersion && `${fxKey(r.e)}: not labelled preprint version`)).toEqual([])
    const cohort = buildCohort(rows)
    expect(fail(withField('expectrecencyyear'), r => {
      const w = cohort.works.find(x => x.rowId === r.e.rowId)
      const y = w ? citedYear(w, 2026) : null
      return String(y) !== field(r.e, 'expectrecencyyear') && `${fxKey(r.e)}: ${y}`
    })).toEqual([])
    expect(fail(withField('expectpublishednot'), r => {
      const best = bestPublishedMatch(r.e.title, r.e.year, (r.rec?.publishedCandidates ?? []).map(toOpenAlexWork), r.e.firstAuthor)
      return !!best && normalizeDoi(best.work.doi) === normalizeDoi(field(r.e, 'expectpublishednot')) && `${fxKey(r.e)}: suggests ${best.work.doi}`
    })).toEqual([])
  })

  it('expectyear / expecttitle / expecttitlenot / expecterror: what the parser reads', () => {
    expect(fail(withField('expectyear'), r => String(r.e.year) !== field(r.e, 'expectyear') && `${fxKey(r.e)}: ${r.e.year}`)).toEqual([])
    expect(fail(withField('expecttitle'), r => !r.row.title.includes(field(r.e, 'expecttitle')!) && `${fxKey(r.e)}: ${r.row.title}`)).toEqual([])
    expect(fail(withField('expecttitlenot'), r => r.row.title.includes(field(r.e, 'expecttitlenot')!) && `${fxKey(r.e)}: ${r.row.title}`)).toEqual([])
    expect(fail(withField('expecterror'), r => field(r.e, 'expecterror') === 'duplicate-key' && r.e.dupKeyIndex == null && `${fxKey(r.e)}: key not flagged`)).toEqual([])
    // Comment-documented cases (an empty entry can't carry fields; nayak2025eeg has a stray brace).
    expect(rows.find(r => r.citeKey === 'empty_entry')).toMatchObject({ status: 'unparseable', error: expect.stringMatching(/empty entry/) })
    expect(byKey.has('nayak2025eeg')).toBe(true)
  })

  // ---- v1.4.5: global invariants on the whole run (hard-titles.bib header) ----
  const offered = cleaned.entries.flatMap(c => [
    ...[...c.applied, ...c.suggested].map(f => ({ key: c.citeKey, field: f.field, value: f.value })),
    ...c.mismatches.map(m => ({ key: c.citeKey, field: m.field, value: m.openalex })),
  ])

  it('G1: every value written or proposed escapes LaTeX specials', () => {
    expect(offered.filter(o => !/^(doi|url|eprint)$/.test(o.field) && /(?<!\\)[&%$#_]/.test(o.value))).toEqual([])
  })
  it('G2: no written or proposed venue is an OpenAlex non-venue', () => {
    const BAD = /\/Proceedings - |^PubMed$| eBooks$|^Medical Entomology and Zoology$/
    expect(offered.filter(o => /^(journal|journaltitle|booktitle)$/.test(o.field) && BAD.test(o.value))).toEqual([])
  })
  it('G3: a suspicious entry receives no fills and no differs items', () => {
    const bad = rows.filter(r => r.status === 'suspicious').map(r => cleanedOf.get(r.sourceOffset)!)
      .filter(c => c.applied.length + c.suggested.length + c.mismatches.length > 0).map(c => c.citeKey)
    expect(bad).toEqual([])
  })
  it('G4: no two confident rows share an OpenAlex work unless marked duplicates', () => {
    const groups = new Map<string, ResultRow[]>()
    for (const r of rows) if (isConfident(r) && r.openalex) groups.set(bare(r.openalex.id), [...(groups.get(bare(r.openalex.id)) ?? []), r])
    const bad = [...groups.entries()].filter(([, g]) => g.length > 1
      && (g.filter(r => !r.duplicateOf).length > 1 || g.some(r => r.duplicateOf && !g.some(o => o.citeKey === r.duplicateOf))))
      .map(([id, g]) => `${id}: ${g.map(r => r.citeKey).join(', ')}`)
    expect(bad).toEqual([])
  })
  it('G5: pages are never written as N--N', () => {
    expect(offered.filter(o => o.field === 'pages' && /^(.+)--\1$/.test(o.value))).toEqual([])
  })
})
