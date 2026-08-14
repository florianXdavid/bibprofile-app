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
import { insertFields, readField, replaceFieldValue, spliceCleaned, type FieldInsert } from '../bibWriter'

export type CleanAction = 'applied' | 'suggested' | 'passed' | 'unchanged'
export type Confidence = 'confident' | 'tentative' | 'none'

export interface FieldChange {
  field: string
  value: string
}

// A field the user HAS but whose value disagrees with the matched OpenAlex work.
// Review-only SUGGESTION — never auto-applied; the user accepts it per-field.
export interface FieldMismatch {
  field: string    // the field name as the user wrote it (replacement target)
  yours: string    // the user's current verbatim value
  openalex: string // OpenAlex's value — written only if the user accepts it
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
  mismatches: FieldMismatch[] // user has a value that differs from OpenAlex — review-only
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
    mismatches: number
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
    mismatches: [],
    preprint: null,
    note,
    sourceOffset: row.sourceOffset,
    originalRaw: row.raw,
    newRaw: row.raw,
  }
}

// --- mismatch normalisers: loose enough that formatting / venue-normalisation /
// LaTeX / dash-style differences don't flag; only substantive disagreements do. ---
const textNorm = (s: string) => s.replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}"]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const yearNorm = (s: string) => (s.match(/\d{4}/) || [''])[0]
const idNorm = (s: string) => s.replace(/[{}"]/g, '').trim().toLowerCase()
const pagesNorm = (s: string) => s.replace(/[{}"\s]/g, '').replace(/[–—-]+/g, '-').toLowerCase()

// Detect fields the user HAS but whose value disagrees with the matched OpenAlex
// work. Review-only suggestions (never auto-applied). Only the FIRST alias the user
// actually wrote is considered, so a later accept targets the right field name.
function computeMismatches(row: ResultRow): FieldMismatch[] {
  const w = row.openalex
  if (!w) return []
  const raw = row.raw
  const out: FieldMismatch[] = []
  const push = (aliases: string[], oa: string | null, norm: (s: string) => string) => {
    if (!oa) return
    for (const a of aliases) {
      const mine = readField(raw, a)
      if (mine == null || mine.trim() === '') continue
      const nm = norm(mine), no = norm(oa)
      if (nm && no && nm !== no) out.push({ field: a, yours: mine.trim(), openalex: oa })
      return // only the first alias the user actually has
    }
  }
  const pagesOf = (b: OpenAlexBiblio | null) =>
    b?.firstPage ? (b.lastPage ? `${b.firstPage}--${b.lastPage}` : b.firstPage) : null

  push(['year'], w.publicationYear != null ? String(w.publicationYear) : null, yearNorm)
  push(['doi'], w.doi ? normalizeDoi(w.doi) : null, s => normalizeDoi(s) ?? idNorm(s))
  push(['journal', 'journaltitle'], w.hostVenue, textNorm)
  push(['title'], w.displayName, textNorm)
  push(['volume'], w.biblio?.volume ?? null, idNorm)
  push(['number', 'issue'], w.biblio?.issue ?? null, idNorm)
  push(['pages'], pagesOf(w.biblio), pagesNorm)
  return out
}

export function computeCleanedBib(
  rows: ResultRow[],
  resolved?: Map<string, ResolvedPreprint>,
  accepted: Set<string> = new Set(), // keys "sourceOffset::field" the user accepted
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

    // matched-by-doi / matched-by-title WRITE additive fills; suspicious only suggests.
    const writes = confidence !== 'none'
    const applied = writes ? fills : []
    const suggested = writes ? [] : fills
    // Mismatches (user has a differing value) are review-only for the same
    // confident/tentative matches, and are written ONLY where the user has accepted
    // that specific field (accepted set keyed "sourceOffset::field").
    const mismatches = writes ? computeMismatches(row) : []
    const acceptedFields = mismatches
      .map(m => m.field)
      .filter(f => accepted.has(`${row.sourceOffset}::${f}`))

    let newRaw = applied.length > 0 ? insertFields(row.raw, applied as FieldInsert[]) : row.raw
    for (const m of mismatches) {
      if (acceptedFields.includes(m.field)) newRaw = replaceFieldValue(newRaw, m.field, m.openalex)
    }

    const action: CleanAction =
      (applied.length > 0 || acceptedFields.length > 0) ? 'applied'
        : (suggested.length > 0 || mismatches.length > 0 || preprint) ? 'suggested'
          : 'passed'

    return {
      citeKey: row.citeKey,
      status: row.status,
      action,
      confidence,
      applied,
      suggested,
      mismatches,
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
    mismatches: entries.reduce((s, e) => s + e.mismatches.length, 0),
  }
  return { entries, counts }
}

// Assemble the downloadable .bib from the ORIGINAL text plus the applied edits.
// Everything not edited (including unparseable blocks and non-entry content) is
// byte-identical to the input.
export function serializeCleanedBib(originalText: string, cleaned: CleanedBib): string {
  return spliceCleaned(originalText, cleaned.entries)
}
