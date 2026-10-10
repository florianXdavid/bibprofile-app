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
//   • v1.4.3 — nothing unverified is written. AUTOMATIC fills only:
//       - every fill on a `matched-by-doi` entry (the user's own DOI identified
//         the record), and
//       - the DOI of a HIGH-CONFIDENCE `matched-by-title` (title >= 0.95, first
//         author and year confirmed, entry type not a different version —
//         isHighConfidenceTitleMatch).
//     Every other fill (the rest of a title match, any lower-confidence title
//     match, `uncertain`) is REVIEW: written only if the user accepts that field
//     (accepted key "sourceOffset::add:field").
//   • v1.4.5 — every value written or proposed is LaTeX-escaped (texEscape: & % $ # _);
//     a `suspicious` entry gets nothing (its DOI points to another work); venue
//     names are cleaned (cleanVenue) and a preprint server never becomes a journal;
//     a journal or DOI you wrote is never "corrected"; a year only when it is 1 off
//     (online-first vs print); pages are never written "N--N"; a DOI that resolved
//     to a merged record of another version, or a DOI found outside the doi field,
//     is review-only; a duplicate cite key gets a comment line (no edits).

import type { MatchStatus, OpenAlexBiblio, ResultRow } from '../../types'
import { AUTO_DOI_TITLE_THRESHOLD } from '../../config'
import { isUsableDoi, normalizeDoi } from '../doi'
import { insertFields, readField, replaceFieldValue, spliceCleaned, type FieldInsert } from '../bibWriter'
import { cleanVenue } from './venues'

// v1.4.5 (C1) — ONE serialisation for every value the tool writes or proposes:
// escape LaTeX specials that aren't escaped yet (a bare `&` stops the LaTeX build).
// Identifier fields are verbatim in BibTeX and stay untouched; Unicode is kept.
export function texEscape(field: string, value: string): string {
  if (/^(?:doi|url|eprint)$/i.test(field)) return value
  return value.replace(/(?<!\\)([&%$#_])/g, '\\$1')
}

// v1.4.5 (H5) — an article number / single page is "N", never "N--N".
export function pagesOf(b: OpenAlexBiblio | null): string | null {
  if (!b?.firstPage) return null
  return b.lastPage && b.lastPage !== b.firstPage ? `${b.firstPage}--${b.lastPage}` : b.firstPage
}

const PREPRINT_SERVER = /arxiv|biorxiv|medrxiv|chemrxiv|ssrn|research\s*square|preprint/i
// Marks the 2nd, 3rd … copy of a cite key in the cleaned .bib (v1.4.5, H3).
export const DUP_KEY_COMMENT = '% BibProfile: duplicate key — BibTeX will ignore this entry\n'

export type CleanAction = 'applied' | 'suggested' | 'passed' | 'unchanged'
export type Confidence = 'confident' | 'tentative' | 'none'

export interface FieldChange {
  field: string
  value: string
  basis?: FillBasis // set on automatic fills: why it was written without review
}

// Why an automatic fill was trusted (shown in the diff header).
export type FillBasis = 'doi-match' | 'title-high-confidence'

// v1.4.3 — strict bar for writing a title-found DOI without review.
export function isHighConfidenceTitleMatch(row: ResultRow): boolean {
  const s = row.matchSignals
  return row.status === 'matched-by-title' && !!s
    && s.title >= AUTO_DOI_TITLE_THRESHOLD && s.author === 1 && s.year === 1
    // and not a different VERSION (e.g. an arXiv entry vs the proceedings record):
    // a partial type match means the DOI would switch which version is cited.
    && (s.type == null || s.type === 1)
}

// Accept-key for a review fill (distinct from mismatch keys "offset::field").
export const addKey = (sourceOffset: number, field: string) => `${sourceOffset}::add:${field}`

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
  applied: FieldChange[] // AUTOMATIC fills, written into newRaw (with their basis)
  suggested: FieldChange[] // REVIEW fills: written only once accepted (see `accepted`)
  acceptedFills: string[] // fields of `suggested` the user accepted (written)
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
    fieldsAdded: number // automatic fills written
    autoFromDoiMatch: number // … of which on entries matched by the user's own DOI
    autoTitleDois: number // … of which DOIs from high-confidence title matches
    reviewFills: number // fills awaiting review
    acceptedFills: number // review fills the user accepted (written)
    mismatches: number
  }
}

// Is a field already present in the verbatim source? Fields follow a comma (the
// first one follows `key,`): `, journal = {…}`. (v1.4.5: not `{`, which also
// matched `note = {journal=…}` inside a value.) Word-anchored so
// `journal` doesn't match `journaltitle`, nor `pages` match `numpages`.
function hasField(raw: string, name: string): boolean {
  return new RegExp(`,\\s*${name}\\s*=`, 'i').test(raw)
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

  // v1.4.6 (F3): never a placeholder / self-assigned DOI (ACM 10.5555, ResearchGate 10.13140)
  if (!e.doi && src.doi && isUsableDoi(src.doi) && !hasField(raw, 'doi')) out.push({ field: 'doi', value: src.doi })
  if (e.year == null && src.year && !hasField(raw, 'year')) out.push({ field: 'year', value: String(src.year) })
  const venue = cleanVenue(src.venue)
  if (!e.venue && venue && !PREPRINT_SERVER.test(venue) && !hasField(raw, 'journal') && !hasField(raw, 'journaltitle')) {
    out.push({ field: 'journal', value: venue })
  }
  if (src.biblio) {
    if (src.biblio.volume && !hasField(raw, 'volume')) out.push({ field: 'volume', value: src.biblio.volume })
    if (src.biblio.issue && !hasField(raw, 'number') && !hasField(raw, 'issue')) {
      out.push({ field: 'number', value: src.biblio.issue })
    }
    const pages = pagesOf(src.biblio)
    if (pages && !hasField(raw, 'pages')) out.push({ field: 'pages', value: pages })
  }
  return out.map(f => ({ ...f, value: texEscape(f.field, f.value) }))
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
    acceptedFills: [],
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
const yearNorm = (s: string) => (s.match(/\d{4}/) || [''])[0]
const idNorm = (s: string) => s.replace(/[{}"]/g, '').trim().toLowerCase()
const pagesNorm = (s: string) => s.replace(/[{}"\s]/g, '').replace(/[–—-]+/g, '-').toLowerCase()

// Detect fields the user HAS but whose value disagrees with the matched OpenAlex
// work. Review-only suggestions (never auto-applied). Only the FIRST alias the user
// actually wrote is considered, so a later accept targets the right field name.
// v1.4.5 (H5/M2): a venue or DOI you wrote is never proposed for "correction" (a
// different journal name, a preprint server or a merged record's DOI is not a fix),
// and a year only when it is 1 off (online-first vs print) — see yearNote.
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
      if (nm && no && nm !== no) out.push({ field: a, yours: mine.trim(), openalex: texEscape(a, oa) })
      return // only the first alias the user actually has
    }
  }

  const bibYear = row.entry?.year
  if (bibYear != null && w.publicationYear != null && Math.abs(bibYear - w.publicationYear) === 1) {
    push(['year'], String(w.publicationYear), yearNorm)
  }
  // (v1.4.6, F18: no title "corrections" — differences are case, LaTeX or a
  // "RETRACTED:" prefix, never a fix to text you wrote.)
  push(['volume'], w.biblio?.volume ?? null, idNorm)
  push(['number', 'issue'], w.biblio?.issue ?? null, idNorm)
  push(['pages'], pagesOf(w.biblio), pagesNorm)
  return out
}

export function computeCleanedBib(
  rows: ResultRow[],
  resolved?: Map<string, ResolvedPreprint>,
  accepted: Set<string> = new Set(), // "sourceOffset::field" (mismatch) / "sourceOffset::add:field" (review fill)
): CleanedBib {
  const entries: CleanedEntry[] = rows.map(row => {
    const ce = cleanEntry(row, resolved, accepted)
    // v1.4.5 (H3): BibTeX ignores the 2nd+ copy of a cite key — say so in the file.
    if ((row.entry?.dupKeyIndex ?? 0) > 1) {
      return { ...ce, action: 'applied' as const, newRaw: DUP_KEY_COMMENT + ce.newRaw,
        note: ['duplicate cite key — a comment line marks this copy (BibTeX uses copy #1)', ce.note].filter(Boolean).join(' · ') }
    }
    return ce
  })

  const counts = {
    applied: entries.filter(e => e.action === 'applied').length,
    suggested: entries.filter(e => e.action === 'suggested').length,
    passed: entries.filter(e => e.action === 'passed').length,
    unchanged: entries.filter(e => e.action === 'unchanged').length,
    fieldsAdded: entries.reduce((s, e) => s + e.applied.length, 0),
    autoFromDoiMatch: entries.reduce((s, e) => s + e.applied.filter(f => f.basis === 'doi-match').length, 0),
    autoTitleDois: entries.reduce((s, e) => s + e.applied.filter(f => f.basis === 'title-high-confidence').length, 0),
    reviewFills: entries.reduce((s, e) => s + e.suggested.length, 0),
    acceptedFills: entries.reduce((s, e) => s + e.acceptedFills.length, 0),
    mismatches: entries.reduce((s, e) => s + e.mismatches.length, 0),
  }
  return { entries, counts }
}

function cleanEntry(row: ResultRow, resolved: Map<string, ResolvedPreprint> | undefined, accepted: Set<string>): CleanedEntry {
  // Duplicates and non-scholarly / unmatched rows pass through verbatim.
  if (row.duplicateOf) return passthrough(row, 'passed', `duplicate of ${row.duplicateOf === row.citeKey ? 'copy #1 (same cite key)' : row.duplicateOf}`)
  if (row.status === 'not-indexable') {
    return passthrough(row, 'unchanged', 'left unchanged — not the kind of record OpenAlex indexes')
  }
  if (row.status === 'not-found' || row.status === 'error' || row.status === 'unparseable') {
    return passthrough(row, 'passed', null)
  }
  // v1.4.5 (C3): the DOI's record is another work — nothing from it is offered.
  if (row.status === 'suspicious') {
    return { ...passthrough(row, 'suggested', 'The DOI points to another work — check the DOI.'), confidence: 'none' }
  }

  const preprint = resolved?.get(row.rowId) ?? null
  const fills = computeFills(row)

  // Confidence gradient straight off the match status.
  const confidence: Confidence =
    row.status === 'matched-by-doi' ? 'confident'
      : row.status === 'matched-by-title' ? 'tentative'
        : 'none' // suspicious / uncertain

  // v1.4.3 policy (see header): automatic vs review.
  const writes = confidence !== 'none' // mismatches are still offered for doi/title matches
  let applied: FieldChange[] = []
  let suggested: FieldChange[] = fills
  const e = row.entry
  const w = row.openalex
  const notes: string[] = []
  // M5: the DOI you wrote resolved to a merged record with another DOI (often the
  // other version) — its venue / year / pages are for review, not automatic.
  const ownDoi = w?.doi ? normalizeDoi(w.doi) : null
  const merged = row.status === 'matched-by-doi' && !!e?.doi && !!ownDoi && ownDoi !== e.doi
  if (merged) notes.push(`your DOI resolved to the merged record ${ownDoi} (${w?.hostVenue ?? 'no venue'}, ${w?.publicationYear ?? 'no year'}) — review before accepting`)
  // v1.4.6 (F3): automatic only when YOUR doi field found the record, and the record's
  // year is within 1 of yours. Found through an arXiv ID / PMID / a DOI in url or note,
  // or dated 2+ years off (a reprint, a merged record): every fill is review.
  const viaAltId = !!row.idSource && row.idSource !== 'doi'
  const yearOff = e?.year != null && w?.publicationYear != null && Math.abs(e.year - w.publicationYear) >= 2
  if (row.status === 'matched-by-doi' && !merged && !viaAltId && !yearOff) {
    applied = fills.map(f => ({ ...f, basis: 'doi-match' as const }))
    suggested = []
  } else if (isHighConfidenceTitleMatch(row) && !row.preprintVersion) {
    applied = fills.filter(f => f.field === 'doi').map(f => ({ ...f, basis: 'title-high-confidence' as const }))
    suggested = fills.filter(f => f.field !== 'doi')
  }
  const acceptedFills = suggested.filter(f => accepted.has(addKey(row.sourceOffset, f.field))).map(f => f.field)
  const written = [...applied, ...suggested.filter(f => acceptedFills.includes(f.field))]
  // Mismatches (user has a differing value) are review-only for the same
  // confident/tentative matches, and are written ONLY where the user has accepted
  // that specific field (accepted set keyed "sourceOffset::field").
  const mismatches = writes ? computeMismatches(row) : []
  const acceptedFields = mismatches
    .map(m => m.field)
    .filter(f => accepted.has(`${row.sourceOffset}::${f}`))

  let newRaw = written.length > 0 ? insertFields(row.raw, written as FieldInsert[]) : row.raw
  for (const m of mismatches) {
    if (acceptedFields.includes(m.field)) newRaw = replaceFieldValue(newRaw, m.field, m.openalex)
  }

  // H5: info notes instead of harmful proposals.
  if (e && w && e.year != null && w.publicationYear != null && Math.abs(e.year - w.publicationYear) >= 2) {
    notes.push(`OpenAlex dates this record ${w.publicationYear} — probably a reprint, a digitisation or another version; your year is kept`)
  }
  if (e?.doi?.startsWith('10.48550/') && e.venue && !PREPRINT_SERVER.test(e.venue)) {
    notes.push(`your DOI is the arXiv preprint's; the entry names ${e.venue} — the published DOI may differ`)
  }
  if (preprint) notes.unshift(`${preprint.server} preprint — a published version was found`)

  const action: CleanAction =
    (written.length > 0 || acceptedFields.length > 0) ? 'applied'
      : (suggested.length > 0 || mismatches.length > 0 || preprint || notes.length > 0) ? 'suggested'
        : 'passed'

  return {
    citeKey: row.citeKey,
    status: row.status,
    action,
    confidence,
    applied,
    suggested,
    acceptedFills,
    mismatches,
    preprint,
    note: notes.length ? notes.join(' · ') : null,
    sourceOffset: row.sourceOffset,
    originalRaw: row.raw,
    newRaw,
  }
}

// Assemble the downloadable .bib from the ORIGINAL text plus the applied edits.
// Everything not edited (including unparseable blocks and non-entry content) is
// byte-identical to the input.
export function serializeCleanedBib(originalText: string, cleaned: CleanedBib): string {
  return spliceCleaned(originalText, cleaned.entries)
}
