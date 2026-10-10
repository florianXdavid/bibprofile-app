// Orchestrates parse-result -> OpenAlex matching.
//
// Per-entry decision flow:
//   1. De-duplicate (Fix 6): entries sharing a normalised DOI (or, lacking a
//      DOI, the same normalised title AND year AND first-author surname — v1.4.1
//      hotfix) are queried once; duplicates mirror the result and are tagged
//      `duplicateOf`. Every original row is kept, in file order.
//   2. Has a DOI -> FREE singleton /works/doi:. The returned title is scored
//      against the .bib title; a low score becomes `suspicious` (never an
//      auto-reject). A DOI that resolves to nothing falls through to (3).
//   3. No usable DOI match -> v1.4.4: FIRST a free Crossref search; a confident
//      Crossref match is confirmed by fetching its OpenAlex record BY DOI (free) and
//      re-scoring it. Only when that fails does it fall back to the
//      BILLABLE OpenAlex ?search= on the CLEANED title (resolveByTitle). The top
//      SEARCH_PER_PAGE candidates are scored on several signals (title, first
//      author, year ±1, venue, type, volume/pages — lib/matchScore.ts, v1.4.1):
//      confident -> `matched-by-title`; weak or a near-tie -> `uncertain`;
//      below the floor -> `not-found` (nothing attached).
//   4. A genuine miss on something that isn't a scholarly work is reclassified
//      `not-indexable` (A4).
//   v1.4.5: (2) also runs for a free identifier found OUTSIDE the doi field (url,
//      note, eprint/arXiv, PMID…; parseBib's altId). Such an identifier is a hint:
//      if its record disagrees with the entry it is ignored and (3) runs instead.
//      Entries sharing a DOI are merged only if their titles agree (C2). After the
//      loop, confident rows that landed on the SAME OpenAlex work are marked
//      duplicates too (H2), and each row gets plain-language notes.
// Year comparison is tri-state (agree/disagree/unverified); a missing year is
// never treated as agreement (Fix A3b). Requests are strictly sequential.

import {
  DOI_SUSPICIOUS_THRESHOLD,
  DOI_SUSPICIOUS_THRESHOLD_ON_YEAR_MISMATCH,
  MATCH_SCORE_FLOOR,
  REQUEST_DELAY_MS,
  SEARCH_CALL_COST_USD,
  TITLE_MATCH_THRESHOLD,
} from '../config'
import { lookupByDoi, lookupWork, OpenAlexBudgetError, searchByTitle, type DoiLookup, type TitleSearch } from './openalex'
import { searchCrossref } from './crossref'
import { normalizeDoi } from './doi'
import { sharedCredential, type Credential } from './credential'
import { normalizeTitle } from './similarity'
import { chooseTitleMatch, scoreCandidate, titleSimilarity, type TitleDecision } from './matchScore'
import { isPreprintVenue } from './stats/venues'
import type {
  BibEntry,
  MatchStatus,
  MatchSummary,
  OpenAlexWork,
  ParseResult,
  Progress,
  ResultRow,
  YearState,
} from '../types'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// --- Pure helpers (unit-tested) -------------------------------------------

// Tri-state year check (Fix A3b). A missing year on either side is `unverified`
// and must never be treated as agreement.
export function compareYears(bibYear: number | null, work: OpenAlexWork | null): YearState {
  const oaYear = work?.publicationYear ?? null
  if (bibYear == null || oaYear == null) return 'unverified'
  return bibYear === oaYear ? 'agree' : 'disagree'
}

// Without a DOI, a title alone is NOT enough to call two entries the same work:
// a conference paper and its journal version, a book and an article, or an
// original and its reprint often share a title (v1.4.1 hotfix — title-only keys
// merged them and copied one record onto the other). Year and first-author
// surname must agree too; a missing value only matches another missing value.
export function dedupKey(entry: BibEntry): string {
  const doi = entry.doi ?? entry.altId?.doi // v1.4.5: a DOI found in url / note … counts too
  if (doi) return `doi:${doi}`
  const t = normalizeTitle(entry.titleForSearch || entry.title)
  if (!t) return ''
  const surname = normalizeTitle(entry.firstAuthor ?? '').split(' ').pop() ?? ''
  return `title:${t}|year:${entry.year ?? ''}|author:${surname}`
}

// v1.4.6 (F4) — which copy of a duplicated work is kept as the main one: the most
// complete entry (an identifier, then an author, a year, a venue), file order as the
// tie-break — never a bare web snapshot ahead of the full entry.
export function completeness(e: BibEntry | null | undefined): number {
  if (!e) return 0
  return (e.doi || e.altId ? 8 : 0) + (e.firstAuthor ? 4 : 0) + (e.year != null ? 2 : 0) + (e.venue ? 1 : 0)
}

// rowId -> its canonical entry. v1.4.5 (C2): entries sharing a DOI are the same work
// only if their titles agree too — a DOI pasted onto the wrong entry must not hide
// behind the entry that owns it (each is then looked up on its own).
export function duplicateCanon(entries: BibEntry[]): Map<string, BibEntry> {
  const groupsByKey = new Map<string, BibEntry[][]>()
  const titled = (e: BibEntry) => e.title !== '(no title)'
  for (const e of entries) {
    const k = dedupKey(e)
    if (!k) continue
    const groups = groupsByKey.get(k) ?? []
    const g = groups.find(([c]) => !k.startsWith('doi:') || !titled(c) || !titled(e)
      || titleSimilarity(c.titleForSearch || c.title, e.titleForSearch || e.title) >= TITLE_MATCH_THRESHOLD)
    if (g) g.push(e)
    else groupsByKey.set(k, [...groups, [e]])
  }
  const dup = new Map<string, BibEntry>()
  for (const groups of groupsByKey.values()) {
    for (const g of groups) {
      if (g.length < 2) continue
      const canon = g.reduce((best, e) => (completeness(e) > completeness(best) ? e : best), g[0])
      for (const e of g) if (e !== canon) dup.set(e.rowId, canon)
    }
  }
  return dup
}

export function computeDuplicates(entries: BibEntry[]): Map<string, string> {
  return new Map([...duplicateCanon(entries)].map(([id, c]) => [id, c.citeKey]))
}

// Classify a DOI match by title similarity. NEVER rejects — only flags. Only a
// genuine year AGREEMENT earns the lenient cutoff; disagree OR unverified is
// held to the stricter one (Fix A3b: missing != agreement).
export function classifyDoiMatch(score: number, yearState: YearState): MatchStatus {
  const cutoff = yearState === 'agree'
    ? DOI_SUSPICIOUS_THRESHOLD
    : DOI_SUSPICIOUS_THRESHOLD_ON_YEAR_MISMATCH
  return score < cutoff ? 'suspicious' : 'matched-by-doi'
}

function pendingRow(entry: BibEntry): ResultRow {
  const notes = entry.dupKeyIndex == null ? [] // v1.4.5 (H3)
    : entry.dupKeyIndex === 1 ? ['cite key used more than once — BibTeX uses this copy (#1)']
      : [`duplicate cite key (copy #${entry.dupKeyIndex}) — BibTeX uses copy #1 and ignores this one`]
  return {
    notes,
    rowId: entry.rowId,
    sourceOffset: entry.sourceOffset,
    citeKey: entry.citeKey,
    title: entry.title,
    bibYear: entry.year,
    status: 'pending',
    openalex: null,
    matchScore: null,
    matchSignals: null,
    yearState: 'unverified',
    duplicateOf: null,
    error: null,
    raw: entry.raw,
    entry,
  }
}

// Build all rows (matched-or-not entries + unparseable blocks) in original .bib
// file order (Fix A5). Pure; used by runMatching and unit-tested directly.
export function buildRows(parsed: ParseResult): ResultRow[] {
  const rows: ResultRow[] = parsed.entries.map(pendingRow)
  for (const u of parsed.unparseable) {
    rows.push({
      rowId: u.rowId,
      sourceOffset: u.sourceOffset,
      citeKey: u.citeKey ?? '(unparseable)',
      title: '—',
      bibYear: null,
      status: 'unparseable',
      openalex: null,
      matchScore: null,
      yearState: 'unverified',
      duplicateOf: null,
      error: u.error,
      raw: u.raw,
      entry: null,
    })
  }
  rows.sort((a, b) => a.sourceOffset - b.sourceOffset)
  return rows
}

// --- v1.4.4: title resolution (Crossref first, OpenAlex search fallback) ----

// Where title candidates come from. Injectable so the regression test replays
// recorded responses through exactly this logic.
export interface TitleSources {
  crossref: (e: BibEntry) => Promise<OpenAlexWork[] | null> // null = unavailable
  openalexByDoi: (doi: string) => Promise<OpenAlexWork | null> // FREE singleton
  openalexSearch: (query: string) => Promise<TitleSearch> // BILLABLE
  lookup: (key: string) => Promise<DoiLookup> // v1.4.5: FREE singleton by "doi:…" / "pmid:…" / "pmcid:…"
  pause: (ms: number) => Promise<void> // v1.4.5: request pacing (instant in the offline regression)
}

export interface TitleResolution {
  decision: TitleDecision | null // null with error / empty title
  via: 'crossref' | 'openalex-search'
  billable: boolean // an OpenAlex search was spent
  error: string | null
}

// arXiv/CoRR records carry DataCite DOIs, which Crossref doesn't index — skip the
// (rate-limited) Crossref call for them and go straight to the fallback.
export function usesCrossref(e: BibEntry): boolean {
  return !/\barxiv\b|\bcorr\b/i.test(e.venue) && !/archiveprefix\s*=\s*[{"']?\s*arxiv/i.test(e.raw)
}

export async function resolveByTitle(
  entry: BibEntry,
  src: Pick<TitleSources, 'crossref' | 'openalexByDoi' | 'openalexSearch'>,
  onStep: (label: string) => void = () => {},
  missingDoi: string | null = null, // v1.4.5 (H8): a cited DOI OpenAlex doesn't know
): Promise<TitleResolution> {
  const q = entry.titleForSearch || (entry.title === '(no title)' ? '' : entry.title)
  if (!q) return { decision: null, via: 'openalex-search', billable: false, error: null }

  if (usesCrossref(entry)) {
    onStep(`Crossref search (free) — ${entry.citeKey}`)
    const cands = await src.crossref(entry)
    const d1 = cands ? chooseTitleMatch(entry, cands, missingDoi) : null
    const doi = d1?.status === 'matched-by-title' && d1.work?.doi ? normalizeDoi(d1.work.doi) : null
    if (doi) {
      const oa = await src.openalexByDoi(doi)
      // Re-score the OpenAlex record itself; accept only if it is still confident.
      const d2 = oa ? chooseTitleMatch(entry, [oa], missingDoi) : null
      if (d2?.status === 'matched-by-title') return { decision: d2, via: 'crossref', billable: false, error: null }
    }
  }

  onStep(`Title search (billable) — ${entry.citeKey}`)
  const res = await src.openalexSearch(q)
  if (res.kind === 'error') return { decision: null, via: 'openalex-search', billable: true, error: res.error }
  return { decision: chooseTitleMatch(entry, res.candidates, missingDoi), via: 'openalex-search', billable: true, error: null }
}

// --- v1.4.5: post-match notes and same-work duplicates -----------------------

const PREPRINT_VENUE = /arxiv|biorxiv|medrxiv|chemrxiv|ssrn|research\s*square|preprint/i
const bare = (id: string | null | undefined) => (id ?? '').replace(/^https?:\/\/openalex\.org\//i, '')
const isConfident = (r: ResultRow) => r.status === 'matched-by-doi' || r.status === 'matched-by-title'
const note = (r: ResultRow, n: string) => { if (!r.notes?.includes(n)) r.notes = [...(r.notes ?? []), n] }

// Idempotent (Resume / Retry run it again over the merged rows).
export function finishRows(rows: ResultRow[]): void {
  // H9 — cited as a journal / proceedings paper, but only the preprint is indexed.
  // v1.4.6 (F10): the record must sit on a preprint SERVER (arXiv, bioRxiv, …) —
  // OpenAlex also types Cold Spring Harbor journal articles (10.1101) `preprint`.
  for (const r of rows) {
    const e = r.entry
    if (!e || !r.openalex || !isConfident(r)) continue
    if (r.openalex.type === 'preprint' && isPreprintVenue(r.openalex.hostVenue, null) && e.venue && !PREPRINT_VENUE.test(e.venue)) {
      r.preprintVersion = true
      note(r, `matched to the preprint version — your entry cites ${e.venue}`)
    }
  }
  // H2 — confident rows on the SAME OpenAlex work are one reference. v1.4.6 (F4): the
  // most complete entry is kept (file order breaks ties); the others — and anything
  // already pointing to them — point to it. An uncertain row on that work gets a hint.
  const groups = new Map<string, ResultRow[]>()
  for (const r of rows) {
    if (r.duplicateOf || !r.openalex || !isConfident(r)) continue
    groups.set(bare(r.openalex.id), [...(groups.get(bare(r.openalex.id)) ?? []), r])
  }
  const firstById = new Map<string, ResultRow>()
  for (const [id, g] of groups) {
    // (an identifier counts only if it actually found the record — an ignored one doesn't)
    const rank = (r: ResultRow) => completeness(r.entry) - (r.entry && (r.entry.doi || r.entry.altId) && !r.idSource ? 8 : 0)
    const canon = g.reduce((best, r) => (rank(r) > rank(best) ? r : best), g[0])
    firstById.set(id, canon)
    for (const r of g) {
      if (r === canon) continue
      for (const o of rows) if (o !== r && o.duplicateOf === r.citeKey) o.duplicateOf = canon.citeKey
      r.duplicateOf = canon.citeKey
      note(r, `same OpenAlex work as ${canon.citeKey}`)
    }
  }
  for (const r of rows) {
    if (r.duplicateOf || r.status !== 'uncertain' || !r.openalex) continue
    const first = firstById.get(bare(r.openalex.id))
    if (first) note(r, `possibly the same work as ${first.citeKey}`)
  }
  // C2 — a suspicious DOI that another entry carries: say whose it is.
  const byDoi = new Map<string, ResultRow[]>()
  for (const r of rows) if (r.entry?.doi) byDoi.set(r.entry.doi, [...(byDoi.get(r.entry.doi) ?? []), r])
  for (const r of rows) {
    if (r.status !== 'suspicious' || !r.entry?.doi) continue
    const owner = (byDoi.get(r.entry.doi) ?? []).find(o => o !== r && isConfident(o))
    if (owner) note(r, `this DOI belongs to ${owner.citeKey}: "${owner.openalex?.displayName ?? ''}"`)
  }
}

// --- Orchestration ---------------------------------------------------------

// A run may HALT on shared-pool budget exhaustion (W4.1): already-matched rows
// are kept, the rest stay `pending`, and `exhausted` is set so the UI can offer
// the user-key + Resume path. `exhausted` is null on a normal completed run.
export interface MatchRunResult {
  rows: ResultRow[]
  summary: MatchSummary
  exhausted: { resetsAt: string | null } | null
}

export async function runMatching(
  parsed: ParseResult,
  onProgress: (p: Progress) => void,
  cred: Credential = sharedCredential(),
  sourceOverrides: Partial<TitleSources> = {},
): Promise<MatchRunResult> {
  const sources: TitleSources = {
    crossref: searchCrossref,
    openalexByDoi: async doi => { const r = await lookupByDoi(doi, cred); return r.kind === 'ok' ? r.work : null },
    openalexSearch: q => searchByTitle(q, false, cred),
    lookup: key => lookupWork(key, cred),
    pause: sleep,
    ...sourceOverrides,
  }
  const rows = buildRows(parsed)
  const byRowId = new Map(rows.map(r => [r.rowId, r]))

  const duplicates = duplicateCanon(parsed.entries)
  const canonicalEntries = parsed.entries.filter(e => !duplicates.has(e.rowId))
  const dupsByCanonRowId = new Map<string, BibEntry[]>()
  for (const e of parsed.entries) {
    const canon = duplicates.get(e.rowId)
    if (!canon) continue
    const dupRow = byRowId.get(e.rowId)
    if (dupRow) dupRow.duplicateOf = canon.citeKey
    dupsByCanonRowId.set(canon.rowId, [...(dupsByCanonRowId.get(canon.rowId) ?? []), e])
  }

  let done = 0
  let searchCalls = 0
  const total = canonicalEntries.length

  async function attemptTitleSearch(entry: BibEntry, row: ResultRow, missingDoi: string | null = null): Promise<void> {
    const r = await resolveByTitle(entry, sources, label => onProgress({ stage: 'title', label, done, total, searchCalls }), missingDoi)
    if (r.billable) searchCalls++
    if (r.error) { row.status = 'error'; row.error = r.error; return }
    const d = r.decision
    if (!d) { row.status = 'not-found'; return }
    row.matchedVia = d.work ? r.via : undefined
    row.status = d.status
    if (d.work && d.signals) {
      row.openalex = d.work
      row.matchScore = d.signals.score
      row.matchSignals = d.signals
      row.yearState = compareYears(entry.year, d.work)
      row.twins = d.twins.map(t => ({ id: t.id, doi: t.doi, isRetracted: t.isRetracted })) // v1.4.2
      if (d.status === 'uncertain' && d.reasons?.length) row.notes = [...(row.notes ?? []), `uncertain: ${d.reasons.join('; ')}`]
    }
  }

  let exhausted: { resetsAt: string | null } | null = null

  for (const entry of canonicalEntries) {
    const row = byRowId.get(entry.rowId)!

    try {
      // The doi field, else (v1.4.5) a free identifier found elsewhere in the entry.
      const idKey = entry.doi ? `doi:${entry.doi}` : entry.altId?.key ?? null
      const idField = entry.doi ? 'doi' : entry.altId?.field ?? null
      if (idKey) {
        onProgress({ stage: 'doi', label: `${entry.doi ? 'DOI' : 'Identifier'} lookup (free) — ${entry.citeKey}`, done, total, searchCalls })
        const res = await sources.lookup(idKey)
        const sig = res.kind === 'ok' ? scoreCandidate(entry, res.work) : null // v1.4.1: real composite score
        const ys = res.kind === 'ok' ? compareYears(entry.year, res.work) : 'unverified'
        // Title rule as before (now retraction-prefix aware), plus: a DOI whose
        // record disagrees on several signals at once is flagged too.
        let status: MatchStatus = sig ? classifyDoiMatch(sig.title, ys) : 'pending'
        if (sig && status === 'matched-by-doi' && sig.score < MATCH_SCORE_FLOOR) status = 'suspicious'
        if (res.kind === 'ok' && sig && (entry.doi || status === 'matched-by-doi')) {
          row.openalex = res.work
          row.matchScore = sig.score
          row.matchSignals = sig
          row.yearState = ys
          row.status = status
          row.idSource = idField
          if (!entry.doi) row.notes = [...(row.notes ?? []), `identified by the ${entry.altId?.label ?? 'identifier'} in ${idField}`]
          if (status === 'suspicious') row.notes = [...(row.notes ?? []), sig.title < 0.7
            ? `the DOI's record has another title: "${res.work.displayName}"`
            : `the DOI's record disagrees on several details (score ${sig.score.toFixed(2)})`]
          const cited = entry.doi ?? entry.altId?.doi
          const own = res.work.doi ? normalizeDoi(res.work.doi) : null
          if (status === 'matched-by-doi' && cited && own && own !== cited) { // M5
            row.notes = [...(row.notes ?? []), `resolved to merged record ${own} (${res.work.hostVenue ?? 'no venue'}, ${res.work.publicationYear ?? 'no year'})`]
          }
        } else if (res.kind === 'error') {
          row.status = 'error'
          row.error = res.error
        } else {
          // Not in OpenAlex, or (an identifier outside the doi field) its record is
          // another work: fall back to the title path.
          if (res.kind === 'ok') row.notes = [...(row.notes ?? []), `the identifier in ${idField} points to another work ("${res.work.displayName}") — ignored`]
          await sources.pause(REQUEST_DELAY_MS)
          onProgress({ stage: 'title', label: `Identifier missed, searching title — ${entry.citeKey}`, done, total, searchCalls })
          const missing = res.kind === 'not-found' ? (entry.doi ?? entry.altId?.doi ?? null) : null
          await attemptTitleSearch(entry, row, missing)
        }
      } else {
        onProgress({ stage: 'title', label: `Looking up title — ${entry.citeKey}`, done, total, searchCalls })
        await attemptTitleSearch(entry, row)
      }
    } catch (e) {
      // Shared-pool budget exhaustion: halt cleanly. This entry and every one
      // after it stay `pending` (the run paused, it didn't fail). Auth and other
      // errors still propagate to App unchanged.
      if (e instanceof OpenAlexBudgetError) { exhausted = { resetsAt: e.resetsAt }; break }
      throw e
    }

    if (row.status === 'not-found' && entry.likelyNotIndexable) row.status = 'not-indexable'

    const dups = dupsByCanonRowId.get(entry.rowId)
    if (dups) {
      for (const de of dups) {
        const dr = byRowId.get(de.rowId)!
        dr.status = row.status
        dr.openalex = row.openalex
        dr.matchScore = row.matchScore
        dr.matchSignals = row.matchSignals
        dr.twins = row.twins
        dr.matchedVia = row.matchedVia
        dr.yearState = row.yearState
        dr.error = row.error
        // v1.4.6 (F12): its OWN identifier field (it shares the canonical's DOI key).
        dr.idSource = row.idSource ? (de.doi ? 'doi' : de.altId?.field ?? null) : null
      }
    }

    done++
    await sources.pause(REQUEST_DELAY_MS)
  }

  finishRows(rows)
  onProgress({ stage: 'done', label: 'Done', done, total, searchCalls })
  return { rows, summary: summarize(rows, searchCalls), exhausted }
}

// Build a MatchSummary from a row set + the billable search-call count. Pure and
// reusable so Resume (W4.1) can recompute the whole-file summary after merging
// resumed rows back in.
export function summarize(rows: ResultRow[], searchCalls: number): MatchSummary {
  const count = (s: MatchStatus) => rows.filter(r => r.status === s).length
  return {
    total: rows.length,
    matchedByDoi: count('matched-by-doi'),
    matchedByTitle: count('matched-by-title'),
    suspicious: count('suspicious'),
    uncertain: count('uncertain'),
    notFound: count('not-found'),
    notIndexable: count('not-indexable'),
    errored: count('error'),
    unparseable: count('unparseable'),
    duplicates: rows.filter(r => r.duplicateOf).length,
    searchCalls,
    searchCostUsd: searchCalls * SEARCH_CALL_COST_USD,
    viaCrossref: rows.filter(r => r.matchedVia === 'crossref' && !r.duplicateOf).length, // v1.4.4
    viaOtherId: rows.filter(r => r.status === 'matched-by-doi' && r.idSource && r.idSource !== 'doi').length, // v1.4.6
  }
}

// Merge resumed rows back into the master set by rowId (W4.1 Resume): rows that
// were re-queried replace their pending placeholders; everything else is kept.
export function mergeRows(master: ResultRow[], resumed: ResultRow[]): ResultRow[] {
  const byId = new Map(resumed.map(r => [r.rowId, r]))
  const merged = master.map(r => byId.get(r.rowId) ?? r)
  finishRows(merged) // v1.4.5: same-work duplicates across the two runs
  return merged
}
