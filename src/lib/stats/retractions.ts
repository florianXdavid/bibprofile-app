// Retraction check — v1.4.2: MULTI-SIGNAL. PURE (no fetch); the Crossref data is
// fetched by lib/crossref.ts and passed in.
//
// An entry is flagged RETRACTED when any of these says so:
//   • openalex           — the matched OpenAlex record has is_retracted
//   • openalex-duplicate — another OpenAlex record of the same work has it
//                          (OpenAlex sometimes flags only one of its duplicates)
//   • title              — the .bib title or the OpenAlex title carries a
//                          "RETRACTED:" / "Retracted article:" prefix
//   • crossref / retraction-watch — a Crossref update record (publisher-deposited,
//                          or from the Retraction Watch database)
// Expressions of concern and corrections come from Crossref only and are listed
// separately. Each entry appears once, under its most serious status; the other
// notices are kept on it. Wording stays neutral: verify, never "remove".

import type { ResultRow } from '../../types'
import { stripRetractedPrefix } from '../matchScore'
import { normalizeDoi } from '../doi'
import type { CrossrefResult, CrossrefUpdate } from '../crossref'

export type RetractionSignal = 'openalex' | 'openalex-duplicate' | 'title' | 'crossref' | 'retraction-watch'

export interface UpdateFinding {
  rowId: string
  citeKey: string
  bibTitle: string
  openalexId: string | null
  signals: RetractionSignal[] // why it's retracted ([] for concern/correction-only entries)
  updates: CrossrefUpdate[] // every Crossref notice for this entry
}

export interface RetractionReport {
  retracted: UpdateFinding[]
  concerns: UpdateFinding[] // expression of concern, not retracted
  corrections: UpdateFinding[] // corrected, no concern, not retracted
  checked: number // references checked (canonical, parseable)
  unchecked: number // of those: no OpenAlex retraction flag AND no DOI checked by Crossref — never assumed clean
  crossrefChecked: number // DOIs Crossref answered for
  crossrefFailed: number // DOIs whose Crossref batch failed
}

// Canonical (non-duplicate), parseable rows — the references we report on.
function canonical(rows: ResultRow[]): ResultRow[] {
  return rows.filter(r => !r.duplicateOf && r.status !== 'unparseable')
}

// The DOIs whose Crossref records matter for a row: the .bib DOI, the matched
// record's DOI, and the DOIs of its same-work twins.
export function rowDois(r: ResultRow): string[] {
  const ds = [r.entry?.doi ?? null, r.openalex?.doi ?? null, ...(r.twins ?? []).map(t => t.doi)]
  return [...new Set(ds.map(d => (d ? normalizeDoi(d) : null)).filter((d): d is string => !!d))]
}

export function retractionDois(rows: ResultRow[]): string[] {
  return [...new Set(canonical(rows).flatMap(rowDois))]
}

export function computeRetractions(rows: ResultRow[], crossref: CrossrefResult | null = null): RetractionReport {
  const report: RetractionReport = {
    retracted: [], concerns: [], corrections: [],
    checked: 0,
    unchecked: 0,
    crossrefChecked: crossref?.checked ?? 0,
    crossrefFailed: crossref?.failed ?? 0,
  }
  for (const r of canonical(rows)) {
    report.checked++
    const signals: RetractionSignal[] = []
    if (r.openalex?.isRetracted === true) signals.push('openalex')
    if ((r.twins ?? []).some(t => t.isRetracted === true)) signals.push('openalex-duplicate')
    if (r.entry?.titleRetracted || (r.openalex && stripRetractedPrefix(r.openalex.displayName).retracted)) signals.push('title')

    const dois = rowDois(r)
    const updates = crossref ? dois.flatMap(d => crossref.updates.get(d) ?? []) : []
    const anyFlag = typeof r.openalex?.isRetracted === 'boolean' || (r.twins ?? []).some(t => typeof t.isRetracted === 'boolean')
    if (!anyFlag && !(crossref && dois.length > 0)) report.unchecked++
    const retractionNotices = updates.filter(u => u.kind === 'retraction')
    if (retractionNotices.some(u => u.source !== 'retraction-watch')) signals.push('crossref')
    if (retractionNotices.some(u => u.source === 'retraction-watch')) signals.push('retraction-watch')

    const f: UpdateFinding = {
      rowId: r.rowId, citeKey: r.citeKey, bibTitle: r.title,
      openalexId: r.openalex?.id ?? null, signals, updates,
    }
    if (signals.length > 0) report.retracted.push(f)
    else if (updates.some(u => u.kind === 'concern')) report.concerns.push(f)
    else if (updates.some(u => u.kind === 'correction')) report.corrections.push(f)
  }
  return report
}
