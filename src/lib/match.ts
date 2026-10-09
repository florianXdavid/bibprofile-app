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
//   3. No usable DOI match -> BILLABLE ?search= on the CLEANED title. The top
//      SEARCH_PER_PAGE candidates are scored on several signals (title, first
//      author, year ±1, venue, type, volume/pages — lib/matchScore.ts, v1.4.1):
//      confident -> `matched-by-title`; weak or a near-tie -> `uncertain`;
//      below the floor -> `not-found` (nothing attached).
//   4. A genuine miss on something that isn't a scholarly work is reclassified
//      `not-indexable` (A4).
// Year comparison is tri-state (agree/disagree/unverified); a missing year is
// never treated as agreement (Fix A3b). Requests are strictly sequential.

import {
  DOI_SUSPICIOUS_THRESHOLD,
  DOI_SUSPICIOUS_THRESHOLD_ON_YEAR_MISMATCH,
  MATCH_SCORE_FLOOR,
  REQUEST_DELAY_MS,
  SEARCH_CALL_COST_USD,
} from '../config'
import { lookupByDoi, OpenAlexBudgetError, searchByTitle } from './openalex'
import { sharedCredential, type Credential } from './credential'
import { normalizeTitle } from './similarity'
import { chooseTitleMatch, scoreCandidate } from './matchScore'
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
  if (entry.doi) return `doi:${entry.doi}`
  const t = normalizeTitle(entry.titleForSearch || entry.title)
  if (!t) return ''
  const surname = normalizeTitle(entry.firstAuthor ?? '').split(' ').pop() ?? ''
  return `title:${t}|year:${entry.year ?? ''}|author:${surname}`
}

export function computeDuplicates(entries: BibEntry[]): Map<string, string> {
  const firstByKey = new Map<string, BibEntry>()
  const dup = new Map<string, string>()
  for (const e of entries) {
    const k = dedupKey(e)
    if (!k) continue
    const canon = firstByKey.get(k)
    if (canon) dup.set(e.rowId, canon.citeKey)
    else firstByKey.set(k, e)
  }
  return dup
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
  return {
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
): Promise<MatchRunResult> {
  const rows = buildRows(parsed)
  const byRowId = new Map(rows.map(r => [r.rowId, r]))

  const duplicates = computeDuplicates(parsed.entries)
  const canonicalEntries = parsed.entries.filter(e => !duplicates.has(e.rowId))
  const canonByKey = new Map<string, BibEntry>()
  for (const e of canonicalEntries) {
    const k = dedupKey(e)
    if (k) canonByKey.set(k, e)
  }
  const dupsByCanonRowId = new Map<string, BibEntry[]>()
  for (const e of parsed.entries) {
    if (!duplicates.has(e.rowId)) continue
    const canon = canonByKey.get(dedupKey(e))
    const dupRow = byRowId.get(e.rowId)
    if (dupRow) dupRow.duplicateOf = duplicates.get(e.rowId) ?? null
    if (!canon) continue
    const arr = dupsByCanonRowId.get(canon.rowId) ?? []
    arr.push(e)
    dupsByCanonRowId.set(canon.rowId, arr)
  }

  let done = 0
  let searchCalls = 0
  const total = canonicalEntries.length

  async function attemptTitleSearch(entry: BibEntry, row: ResultRow): Promise<void> {
    const q = entry.titleForSearch || (entry.title === '(no title)' ? '' : entry.title)
    if (!q) { row.status = 'not-found'; return }
    searchCalls++
    const res = await searchByTitle(q, false, cred)
    if (res.kind === 'error') {
      row.status = 'error'
      row.error = res.error
      return
    }
    const d = chooseTitleMatch(entry, res.candidates) // v1.4.1 multi-signal
    row.status = d.status
    if (d.work && d.signals) {
      row.openalex = d.work
      row.matchScore = d.signals.score
      row.matchSignals = d.signals
      row.yearState = compareYears(entry.year, d.work)
    }
  }

  let exhausted: { resetsAt: string | null } | null = null

  for (const entry of canonicalEntries) {
    const row = byRowId.get(entry.rowId)!

    try {
      if (entry.doi) {
        onProgress({ stage: 'doi', label: `DOI lookup (free) — ${entry.citeKey}`, done, total, searchCalls })
        const res = await lookupByDoi(entry.doi, cred)
        if (res.kind === 'ok') {
          const ys = compareYears(entry.year, res.work)
          const sig = scoreCandidate(entry, res.work) // v1.4.1: real composite score
          row.openalex = res.work
          row.matchScore = sig.score
          row.matchSignals = sig
          row.yearState = ys
          // Title rule as before (now retraction-prefix aware), plus: a DOI whose
          // record disagrees on several signals at once is flagged too.
          row.status = classifyDoiMatch(sig.title, ys)
          if (row.status === 'matched-by-doi' && sig.score < MATCH_SCORE_FLOOR) row.status = 'suspicious'
        } else if (res.kind === 'not-found') {
          await sleep(REQUEST_DELAY_MS)
          onProgress({ stage: 'title', label: `DOI missed, searching title — ${entry.citeKey}`, done, total, searchCalls })
          await attemptTitleSearch(entry, row)
        } else {
          row.status = 'error'
          row.error = res.error
        }
      } else {
        onProgress({ stage: 'title', label: `Title search (billable) — ${entry.citeKey}`, done, total, searchCalls })
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
        dr.yearState = row.yearState
        dr.error = row.error
      }
    }

    done++
    await sleep(REQUEST_DELAY_MS)
  }

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
  }
}

// Merge resumed rows back into the master set by rowId (W4.1 Resume): rows that
// were re-queried replace their pending placeholders; everything else is kept.
export function mergeRows(master: ResultRow[], resumed: ResultRow[]): ResultRow[] {
  const byId = new Map(resumed.map(r => [r.rowId, r]))
  return master.map(r => byId.get(r.rowId) ?? r)
}
