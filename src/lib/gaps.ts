// Feature 3 — citation-gap ORCHESTRATION. Sits between the cards and the fetch
// layer: it sequences OpenAlex calls (through openalex.ts, honouring pacing) and
// hands the raw data to the pure counters in stats/coCitation.ts. No card calls
// fetch; no fetching happens on a normal report run — only when a gaps button is
// pressed.
//
// Cost model (shared-key aware):
//   Co-citation  — re-fetches each matched work as a FREE singleton to get its
//                  referenced_works, then ONE billable hydration call. ~1 billable.
//   Forward      — ceil(seeds / OA_FILTER_BATCH) BILLABLE list calls. This is the
//                  one feature that can exhaust the shared daily budget; its cost
//                  is projected before it runs.

import {
  GAPS_COCITATION_FLOOR,
  GAPS_FORWARD_FLOOR,
  GAPS_TOP_CANDIDATES,
  OA_FILTER_BATCH,
  REQUEST_DELAY_MS,
  SEARCH_CALL_COST_USD,
} from '../config'
import { buildCohort } from './stats/denominator'
import {
  bareId,
  computeCoCitation,
  computeForwardCitation,
  type UserWorkRefs,
} from './stats/coCitation'
import { fetchCitingWorks, fetchWorkWithRefs, fetchWorksByIds } from './openalex'
import { sharedCredential, type Credential } from './credential'
import type { OpenAlexWork, ResultRow } from '../types'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface GapsProgress {
  phase: 'refs' | 'hydrate' | 'forward' | 'done'
  done: number
  total: number
  billableCalls: number
  label: string
}

// UI run-state, owned by App.tsx (W3.1 — lifted above the view toggle so a tab
// switch never discards these billable results). Generic over the result type
// so co-citation and forward-citation share one shape.
export type GapsRunState<T> =
  | { status: 'idle' }
  | { status: 'running'; progress: GapsProgress }
  | { status: 'done'; result: T }
  | { status: 'error'; error: string }

export interface GapCandidate {
  id: string
  count: number
  citedByKeys: string[] // user cite keys (co-citation) / seed cite keys (forward)
  work: OpenAlexWork | null // hydrated title etc. (null if hydration missed it)
}

export interface CoCiteResult {
  candidates: GapCandidate[]
  matchedWorks: number // works whose references we pooled
  poolSize: number // distinct co-cited works above the min-count floor
  billableCalls: number
  costUsd: number
}

export interface ForwardResult {
  candidates: GapCandidate[]
  seedCount: number
  billableCalls: number
  costUsd: number
}

// The matched works with a real OpenAlex id — the seeds for both modes.
function matchedSeeds(rows: ResultRow[]): { citeKey: string; id: string }[] {
  return buildCohort(rows).works
    .filter(w => w.work.id)
    .map(w => ({ citeKey: w.citeKey, id: bareId(w.work.id) }))
}

function idToKeyMap(rows: ResultRow[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of matchedSeeds(rows)) m.set(s.id, s.citeKey)
  return m
}

// Projected cost of the forward scan, shown BEFORE it runs (reuses the existing
// per-search cost constant — no new cost display invented).
export function forwardCostEstimate(rows: ResultRow[]): { calls: number; usd: number } {
  const seeds = matchedSeeds(rows).length
  const calls = Math.ceil(seeds / OA_FILTER_BATCH)
  return { calls, usd: calls * SEARCH_CALL_COST_USD }
}

// --- Co-citation (default, ~1 billable call) ------------------------------
export async function runCoCitation(
  rows: ResultRow[],
  onProgress: (p: GapsProgress) => void,
  cred: Credential = sharedCredential(),
): Promise<CoCiteResult> {
  const seeds = matchedSeeds(rows)

  // 1. Free singleton re-fetch of each matched work to obtain referenced_works.
  const userWorks: UserWorkRefs[] = []
  let done = 0
  for (const s of seeds) {
    onProgress({ phase: 'refs', done, total: seeds.length, billableCalls: 0, label: `Reading references — ${s.citeKey}` })
    const res = await fetchWorkWithRefs(s.id, cred)
    if (res.kind === 'ok') {
      userWorks.push({ citeKey: s.citeKey, id: s.id, referencedWorks: res.work.referencedWorks ?? [] })
    }
    done++
    await sleep(REQUEST_DELAY_MS)
  }

  // 2. Pure ranking; keep the transparent "cited by these keys" list.
  const ranked = computeCoCitation(userWorks, GAPS_COCITATION_FLOOR)
  const top = ranked.slice(0, GAPS_TOP_CANDIDATES)

  // 3. ONE billable hydration call to turn the top ids into titles.
  onProgress({ phase: 'hydrate', done: seeds.length, total: seeds.length, billableCalls: 1, label: 'Fetching candidate titles' })
  let byId = new Map<string, OpenAlexWork>()
  if (top.length > 0) {
    const hyd = await fetchWorksByIds(top.map(c => c.id), false, cred)
    if (hyd.kind === 'ok') byId = new Map(hyd.candidates.map(w => [bareId(w.id), w]))
  }

  const candidates: GapCandidate[] = top.map(c => ({
    id: c.id,
    count: c.count,
    citedByKeys: c.citedBy,
    work: byId.get(c.id) ?? null,
  }))

  onProgress({ phase: 'done', done: seeds.length, total: seeds.length, billableCalls: 1, label: 'Done' })
  return {
    candidates,
    matchedWorks: userWorks.length,
    poolSize: ranked.length,
    billableCalls: 1,
    costUsd: SEARCH_CALL_COST_USD,
  }
}

// --- Forward-citation (gated; N billable calls) ---------------------------
export async function runForwardCitation(
  rows: ResultRow[],
  onProgress: (p: GapsProgress) => void,
  cred: Credential = sharedCredential(),
): Promise<ForwardResult> {
  const seeds = matchedSeeds(rows)
  const seedIds = seeds.map(s => s.id)
  const keyById = idToKeyMap(rows)

  const batches: string[][] = []
  for (let i = 0; i < seedIds.length; i += OA_FILTER_BATCH) batches.push(seedIds.slice(i, i + OA_FILTER_BATCH))

  const citing: { id: string; referencedWorks: string[]; work: OpenAlexWork }[] = []
  const seen = new Set<string>()
  let billable = 0
  for (let b = 0; b < batches.length; b++) {
    onProgress({ phase: 'forward', done: b, total: batches.length, billableCalls: billable, label: `Forward-citation scan — batch ${b + 1}/${batches.length}` })
    const res = await fetchCitingWorks(batches[b], 100, cred)
    billable++
    if (res.kind === 'ok') {
      for (const w of res.candidates) {
        const id = bareId(w.id)
        if (seen.has(id)) continue
        seen.add(id)
        citing.push({ id, referencedWorks: w.referencedWorks ?? [], work: w })
      }
    }
    await sleep(REQUEST_DELAY_MS)
  }

  const ranked = computeForwardCitation(seedIds, citing, GAPS_FORWARD_FLOOR).slice(0, GAPS_TOP_CANDIDATES)
  const workById = new Map(citing.map(c => [c.id, c.work]))
  const candidates: GapCandidate[] = ranked.map(c => ({
    id: c.id,
    count: c.count,
    citedByKeys: c.seeds.map(sid => keyById.get(sid) ?? sid),
    work: workById.get(c.id) ?? null,
  }))

  onProgress({ phase: 'done', done: batches.length, total: batches.length, billableCalls: billable, label: 'Done' })
  return { candidates, seedCount: seeds.length, billableCalls: billable, costUsd: billable * SEARCH_CALL_COST_USD }
}
