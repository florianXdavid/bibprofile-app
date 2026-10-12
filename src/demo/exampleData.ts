// v1.5.2 — "Try with an example". The example .bib (example.bib) and the results
// of ONE real run over it (example-results.json, written by the opt-in recorder
// test/demo/record-example.test.ts) ship with the app, so the example loads
// instantly and spends nothing from the shared pool. Everything the app would
// fetch is in the snapshot: the matches, the Crossref notices, the Preprint →
// published lookups and both missing-citation scans.
//
// JSON has no Map, so the two Map-valued results travel as entry arrays.

import type { MatchSummary, OpenAlexWork, ResultRow } from '../types'
import type { CrossrefResult, CrossrefUpdate } from '../lib/crossref'
import type { CoCiteResult, ForwardResult } from '../lib/gaps'
import type { PreprintResolveResult } from '../lib/preprintResolve'
import type { ResolvedPreprint } from '../lib/stats/cleanBib'

export const EXAMPLE_FILE_NAME = 'example-bci-review.bib'

export interface ExampleSnapshot {
  version: 1
  recordedAt: string
  rows: ResultRow[]
  summary: MatchSummary
  crossref: { updates: [string, CrossrefUpdate[]][]; checked: number; failed: number }
  preprints: (Omit<PreprintResolveResult, 'resolved'> & { resolved: [string, ResolvedPreprint][] }) | null
  co: CoCiteResult | null
  fw: ForwardResult | null
}

export interface ExampleState {
  rows: ResultRow[]
  summary: MatchSummary
  crossref: CrossrefResult
  preprints: PreprintResolveResult | null
  co: CoCiteResult | null
  fw: ForwardResult | null
}

// referenced_works lists are large and only needed while a scan runs — drop them.
const slim = (w: OpenAlexWork | null): OpenAlexWork | null => (w ? { ...w, referencedWorks: null } : null)

export function serializeExample(s: ExampleState, recordedAt: string): ExampleSnapshot {
  const gaps = <T extends { candidates: { work: OpenAlexWork | null }[] }>(g: T | null): T | null =>
    g ? { ...g, candidates: g.candidates.map(c => ({ ...c, work: slim(c.work) })) } : null
  return {
    version: 1,
    recordedAt,
    rows: s.rows.map(r => ({ ...r, openalex: slim(r.openalex) })),
    summary: s.summary,
    crossref: { updates: [...s.crossref.updates], checked: s.crossref.checked, failed: s.crossref.failed },
    preprints: s.preprints ? { ...s.preprints, resolved: [...s.preprints.resolved] } : null,
    co: gaps(s.co),
    fw: gaps(s.fw),
  }
}

export function hydrateExample(snap: ExampleSnapshot): ExampleState {
  return {
    rows: snap.rows,
    summary: snap.summary,
    crossref: { updates: new Map(snap.crossref.updates), checked: snap.crossref.checked, failed: snap.crossref.failed },
    preprints: snap.preprints ? { ...snap.preprints, resolved: new Map(snap.preprints.resolved) } : null,
    co: snap.co,
    fw: snap.fw,
  }
}
