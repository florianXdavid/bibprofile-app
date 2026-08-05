// Feature 5 — Cleaned .bib, the compute half (pure). Maps each row's match
// status to an action on the confidence gradient the enum already encodes, and
// computes ADDITIVE-ONLY field fills (never overwrites, never removes). The
// serialisation lives in `src/lib/bibWriter.ts`.
//
// Non-negotiables enforced here:
//   • Never drop, renumber, or re-key an entry. We only ADD missing fields to
//     an entry's verbatim source; cite keys and entry count are untouched.
//   • `not-found` / `error` / `unparseable` pass through byte-identical.
//   • `not-indexable` passes through unchanged, labelled "left unchanged".
//   • `suspicious` fills are shown as SUGGESTIONS only — never written.

import type { MatchStatus, OpenAlexBiblio, ResultRow } from '../../types'
import { normalizeDoi } from '../doi'
import { insertFields, spliceCleaned, type FieldInsert } from '../bibWriter'

export type CleanAction = 'applied' | 'suggested' | 'passed' | 'unchanged'
export type Confidence = 'confident' | 'tentative' | 'none'

export interface FieldChange {
  field: string
  value: string
}

// A resolved preprint→published match, shown in the diff as a SUGGESTION only.
// The cleaned .bib never writes it — the user applies the swap manually if they
// choose to.
export interface ResolvedPreprint {
  server: string
  publishedTitle: string
  publishedDoi: string | null
  publishedVenue: string | null
  publishedYear: number | null
  openalexId: string
}

export interface CleanedEntry {
  citeKey: string
  status: MatchStatus
  action: CleanAction
  confidence: Confidence
  applied: FieldChange[] // written into newRaw
  suggested: FieldChange[] // shown, NOT written (suspicious matches)
  preprint: ResolvedPreprint | null // suggested replacement, never written
  note: string | null
  sourceOffset: number
  originalRaw: string
  newRaw: string
}

export interface CleanedBib {
  entries: CleanedEntry[]
  counts: {
    applied: number
    suggested: number
    passed: number
    unchanged: number
    fieldsAdded: number
  }
}

// Is a field already present in the verbatim source? Fields are comma- (or, for
// the first field, brace-) delimited: `, journal = {…}`. Word-anchored so
// `journal` doesn't match `journaltitle`, nor `pages` match `numpages`.
function hasField(raw: string, name: string): boolean {
  return new RegExp(`[,{]\\s*${name}\\s*=`, 'i').test(raw)
}

interface FillSource {
  doi: string | null // already a bare DOI
  year: number | null
  venue: string | null
  biblio: OpenAlexBiblio | null
}

// Additive fills from a source (matched work OR resolved published version) —
// only fields the entry LACKS. Never overwrites existing fields, so it is
// round-trip-safe regardless of which source it draws from.
function fillsFromSource(row: ResultRow, src: FillSource): FieldChange[] {
  const e = row.entry
  if (!e) return []
  const raw = row.raw
  const out: FieldChange[] = []

  if (!e.doi && src.doi && !hasField(raw, 'doi')) out.push({ field: 'doi', value: src.doi })
  if (e.year == null && src.year && !hasField(raw, 'year')) out.push({ field: 'year', value: String(src.year) })
  if (!e.venue && src.venue && !hasField(raw, 'journal') && !hasField(raw, 'journaltitle')) {
    out.push({ field: 'journal', value: src.venue })
  }
  if (src.biblio) {
    if (src.biblio.volume && !hasField(raw, 'volume')) out.push({ field: 'volume', value: src.biblio.volume })
    if (src.biblio.issue && !hasField(raw, 'number') && !hasField(raw, 'issue')) {
      out.push({ field: 'number', value: src.biblio.issue })
    }
    if (src.biblio.firstPage && !hasField(raw, 'pages')) {
      const pages = src.biblio.lastPage ? `${src.biblio.firstPage}--${src.biblio.lastPage}` : src.biblio.firstPage
      out.push({ field: 'pages', value: pages })
    }
  }
  return out
}

// Fills sourced from the matched OpenAlex work (the default cleaning source).
function computeFills(row: ResultRow): FieldChange[] {
  const w = row.openalex
  if (!w) return []
  return fillsFromSource(row, {
    doi: w.doi ? normalizeDoi(w.doi) : null,
    year: w.publicationYear,
    venue: w.hostVenue,
    biblio: w.biblio,
  })
}

function passthrough(row: ResultRow, action: CleanAction, note: string | null): CleanedEntry {
  return {
    citeKey: row.citeKey,
    status: row.status,
    action,
    confidence: 'none',
    applied: [],
    suggested: [],
    preprint: null,
    note,
    sourceOffset: row.sourceOffset,
    originalRaw: row.raw,
    newRaw: row.raw,
  }
}

export function computeCleanedBib(
  rows: ResultRow[],
  resolved?: Map<string, ResolvedPreprint>,
): CleanedBib {
  const entries: CleanedEntry[] = rows.map(row => {
    // Duplicates and non-scholarly / unmatched rows pass through verbatim.
    if (row.duplicateOf) return passthrough(row, 'passed', `duplicate of ${row.duplicateOf}`)
    if (row.status === 'not-indexable') {
      return passthrough(row, 'unchanged', 'left unchanged — not the kind of record OpenAlex indexes')
    }
    if (row.status === 'not-found' || row.status === 'error' || row.status === 'unparseable') {
      return passthrough(row, 'passed', null)
    }

    const preprint = resolved?.get(row.rowId) ?? null
    const fills = computeFills(row)

    // Confidence gradient straight off the match status.
    const confidence: Confidence =
      row.status === 'matched-by-doi' ? 'confident'
        : row.status === 'matched-by-title' ? 'tentative'
          : 'none' // suspicious

    // matched-by-doi / matched-by-title WRITE fills; suspicious only suggests.
    const writes = confidence !== 'none'
    const applied = writes ? fills : []
    const suggested = writes ? [] : fills
    const newRaw = applied.length > 0 ? insertFields(row.raw, applied as FieldInsert[]) : row.raw

    const action: CleanAction =
      applied.length > 0 ? 'applied'
        : (suggested.length > 0 || preprint) ? 'suggested'
          : 'passed'

    return {
      citeKey: row.citeKey,
      status: row.status,
      action,
      confidence,
      applied,
      suggested,
      preprint,
      note: preprint ? `${preprint.server} preprint — a published version was found` : null,
      sourceOffset: row.sourceOffset,
      originalRaw: row.raw,
      newRaw,
    }
  })

  const counts = {
    applied: entries.filter(e => e.action === 'applied').length,
    suggested: entries.filter(e => e.action === 'suggested').length,
    passed: entries.filter(e => e.action === 'passed').length,
    unchanged: entries.filter(e => e.action === 'unchanged').length,
    fieldsAdded: entries.reduce((s, e) => s + e.applied.length, 0),
  }
  return { entries, counts }
}

// Assemble the downloadable .bib from the ORIGINAL text plus the applied edits.
// Everything not edited (including unparseable blocks and non-entry content) is
// byte-identical to the input.
export function serializeCleanedBib(originalText: string, cleaned: CleanedBib): string {
  return spliceCleaned(originalText, cleaned.entries)
}
