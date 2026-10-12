// v1.5.1 — "Is every reference real?" The headline count above the tabs. PURE.
//
// Every unique, parseable reference (duplicates counted once) lands in exactly one
// bucket, so the numbers always add up to `total`:
//   verified       — matched by its DOI / another identifier, or a confident title match
//   couldNotVerify — `not-found` or `uncertain`: check that it exists (Google Scholar link)
//   wrongDoi       — `suspicious`: the DOI resolves, but to another work
//   notCheckable   — `not-indexable`: web pages, software, datasets
//   errored        — the lookup failed (network); retry
//   pending        — not looked up yet (the shared pool ran out mid-run)
// `retracted` is separate (a verified reference can be retracted); it is null while the
// Crossref check is still running. Unparseable blocks are counted on their own.
//
// Wording stays honest: "could not verify" means OpenAlex and Crossref have no
// acceptable record — NOT that the reference is fabricated.

import type { MatchStatus, ResultRow } from '../../types'

// v1.5.1 — plain-language status labels (display only; the CSV keeps the status codes).
export const STATUS_LABEL: Record<MatchStatus, string> = {
  'matched-by-doi': 'matched by identifier',
  'matched-by-title': 'matched by title',
  'suspicious': 'DOI points to another work',
  'uncertain': 'unsure match',
  'not-found': 'could not verify',
  'not-indexable': 'not checkable',
  'error': 'error',
  'unparseable': 'unparseable',
  'pending': 'pending',
}

export type VerifyBucket = 'verified' | 'couldNotVerify' | 'wrongDoi' | 'notCheckable' | 'errored' | 'pending'

export interface Verification {
  total: number // unique, parseable references
  verified: number
  couldNotVerify: ResultRow[]
  wrongDoi: ResultRow[]
  notCheckable: number
  errored: number
  pending: number
  retracted: ResultRow[] | null // null = still checking
  unparseable: number
}

export function bucketOf(status: MatchStatus): VerifyBucket | null {
  switch (status) {
    case 'matched-by-doi': case 'matched-by-title': return 'verified'
    case 'not-found': case 'uncertain': return 'couldNotVerify'
    case 'suspicious': return 'wrongDoi'
    case 'not-indexable': return 'notCheckable'
    case 'error': return 'errored'
    case 'pending': return 'pending'
    default: return null // unparseable
  }
}

// `retractedRowIds` = the RetractionReport's `retracted[].rowId`, or null while checking.
export function computeVerification(rows: ResultRow[], retractedRowIds: string[] | null): Verification {
  const v: Verification = {
    total: 0, verified: 0, couldNotVerify: [], wrongDoi: [], notCheckable: 0, errored: 0, pending: 0,
    retracted: null, unparseable: 0,
  }
  const canonical = rows.filter(r => !r.duplicateOf)
  for (const r of canonical) {
    const b = bucketOf(r.status)
    if (!b) { v.unparseable++; continue }
    v.total++
    if (b === 'verified') v.verified++
    else if (b === 'couldNotVerify') v.couldNotVerify.push(r)
    else if (b === 'wrongDoi') v.wrongDoi.push(r)
    else v[b]++
  }
  if (retractedRowIds) {
    const ids = new Set(retractedRowIds)
    v.retracted = canonical.filter(r => ids.has(r.rowId))
  }
  return v
}

// A Google Scholar search for a reference (opened only when the user clicks it):
// the quoted, cleaned title plus the first author's surname.
export function scholarUrl(r: ResultRow): string {
  const raw = r.title === '(no title)' ? '' : (r.entry?.titleForSearch || r.title || '')
  const title = raw.replace(/"/g, '').trim()
  const q = [title ? `"${title}"` : '', r.entry?.firstAuthor ?? ''].filter(Boolean).join(' ')
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`
}

// v1.5.2 — the one line the user pastes into an email / Slack to co-authors.
export function coauthorMessage(v: Verification): string {
  const parts = [`${v.verified}/${v.total} verified`]
  if (v.retracted && v.retracted.length > 0) parts.push(`${v.retracted.length} retracted`)
  const check = v.couldNotVerify.length + v.wrongDoi.length
  if (check > 0) parts.push(`${check} to double-check`)
  return `Reference list checked with BibProfile: ${parts.join(', ')} (details in the attached report). bibprofile.com`
}
