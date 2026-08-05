// Feature 4 — preprint→published RESOLUTION (network orchestration). Detection
// is pure (`stats/preprints.ts`); this runner turns each detected preprint into
// a suggested published replacement via the EXISTING title-search path plus a
// `type:!preprint` filter — no new fetch code. BILLABLE: one search per detected
// preprint, so it is gated behind a button with a projected cost, like the gaps
// scan. Results feed the cleaned export as SUGGESTIONS (never auto-applied).

import { REQUEST_DELAY_MS, SEARCH_CALL_COST_USD } from '../config'
import { searchByTitle } from './openalex'
import { sharedCredential, type Credential } from './credential'
import { normalizeDoi } from './doi'
import { bestPublishedMatch, detectPreprint } from './stats/preprints'
import type { ResolvedPreprint } from './stats/cleanBib'
import type { ResultRow } from '../types'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface PreprintDetection {
  rowId: string
  citeKey: string
  title: string
  year: number | null
  server: string
  via: 'doi' | 'eprint' | 'venue'
}

export interface PreprintProgress {
  done: number
  total: number
  label: string
}

export interface PreprintResolveResult {
  resolved: Map<string, ResolvedPreprint>
  detected: PreprintDetection[]
  resolvedCount: number
  billableCalls: number
  costUsd: number
}

// UI run-state, owned by App.tsx (W3.1 — lifted above the view toggle so a tab
// switch never discards these billable results).
export type PreprintRunState =
  | { status: 'idle' }
  | { status: 'running'; progress: PreprintProgress }
  | { status: 'done'; result: PreprintResolveResult }
  | { status: 'error'; error: string }

// Pure detection over the parsed, canonical (non-duplicate) rows.
export function detectPreprints(rows: ResultRow[]): PreprintDetection[] {
  const out: PreprintDetection[] = []
  for (const row of rows) {
    if (row.duplicateOf || !row.entry) continue
    const sig = detectPreprint({
      doi: row.entry.doi,
      doiRaw: row.entry.doiRaw,
      venue: row.entry.venue,
      raw: row.raw,
    })
    if (sig) {
      out.push({ rowId: row.rowId, citeKey: row.citeKey, title: row.entry.title, year: row.entry.year, server: sig.server, via: sig.via })
    }
  }
  return out
}

export function preprintCostEstimate(rows: ResultRow[]): { calls: number; usd: number } {
  const calls = detectPreprints(rows).length
  return { calls, usd: calls * SEARCH_CALL_COST_USD }
}

export async function runPreprintResolution(
  rows: ResultRow[],
  onProgress: (p: PreprintProgress) => void,
  cred: Credential = sharedCredential(),
): Promise<PreprintResolveResult> {
  const detected = detectPreprints(rows)
  const resolved = new Map<string, ResolvedPreprint>()
  let billable = 0

  for (let i = 0; i < detected.length; i++) {
    const d = detected[i]
    onProgress({ done: i, total: detected.length, label: `Checking preprint — ${d.citeKey}` })
    if (!d.title || d.title === '(no title)') continue
    const res = await searchByTitle(d.title, true, cred) // exclude type:preprint
    billable++
    if (res.kind === 'ok') {
      const best = bestPublishedMatch(d.title, d.year, res.candidates)
      if (best) {
        resolved.set(d.rowId, {
          server: d.server,
          publishedTitle: best.work.displayName,
          publishedDoi: best.work.doi ? normalizeDoi(best.work.doi) : null,
          publishedVenue: best.work.hostVenue,
          publishedYear: best.work.publicationYear,
          openalexId: best.work.id,
        })
      }
    }
    await sleep(REQUEST_DELAY_MS)
  }

  onProgress({ done: detected.length, total: detected.length, label: 'Done' })
  return {
    resolved,
    detected,
    resolvedCount: resolved.size,
    billableCalls: billable,
    costUsd: billable * SEARCH_CALL_COST_USD,
  }
}
