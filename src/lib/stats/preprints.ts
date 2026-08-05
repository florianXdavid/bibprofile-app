// Feature 4 — Preprint → published. DETECTION is pure `.bib` inspection (no
// network): DOI prefixes, arXiv eprint fields, and the Google-Scholar
// `journal = {arXiv preprint arXiv:…}` tell. RESOLUTION (finding the published
// version) is the billable step and lives in `src/lib/preprintResolve.ts`; the
// acceptance test (`bestPublishedMatch`) is pure and unit-tested here.
//
// We SUGGEST, never auto-replace: people cite preprints deliberately (the
// version differs, or the published one is paywalled).

import { TITLE_MATCH_THRESHOLD } from '../../config'
import { diceCoefficient } from '../similarity'
import type { OpenAlexWork } from '../../types'

export interface PreprintSignal {
  server: string // arXiv, bioRxiv, medRxiv, SSRN, ChemRxiv, …
  via: 'doi' | 'eprint' | 'venue'
}

// Known preprint DOI prefixes -> server. Matched case-insensitively at the start
// of the (normalised) DOI.
const DOI_PREFIXES: { re: RegExp; server: string }[] = [
  { re: /^10\.48550\/arxiv/i, server: 'arXiv' },
  { re: /^10\.1101\//i, server: 'bioRxiv/medRxiv' },
  { re: /^10\.26434\/chemrxiv/i, server: 'ChemRxiv' },
  { re: /^10\.2139\/ssrn/i, server: 'SSRN' },
  { re: /^10\.21203\/rs/i, server: 'Research Square' },
  { re: /^10\.31234\//i, server: 'PsyArXiv' },
  { re: /^10\.31219\//i, server: 'OSF Preprints' },
  { re: /^10\.20944\/preprints/i, server: 'Preprints.org' },
  { re: /^10\.36227\/techrxiv/i, server: 'TechRxiv' },
  { re: /^10\.22541\/au/i, server: 'Authorea' },
]

const VENUE_TELLS: { re: RegExp; server: string }[] = [
  { re: /arxiv\s+preprint/i, server: 'arXiv' },
  { re: /\barxiv\b/i, server: 'arXiv' },
  { re: /\bbiorxiv\b/i, server: 'bioRxiv' },
  { re: /\bmedrxiv\b/i, server: 'medRxiv' },
  { re: /\bchemrxiv\b/i, server: 'ChemRxiv' },
  { re: /\bssrn\b/i, server: 'SSRN' },
  { re: /\bresearch\s*square\b/i, server: 'Research Square' },
  { re: /\bpreprint\b/i, server: 'preprint' },
]

// Detect a preprint from the fields we already hold. `raw` is the verbatim
// source block (used only for the arXiv eprint/archivePrefix tell).
export function detectPreprint(e: {
  doi: string | null
  doiRaw: string | null
  venue: string
  raw: string
}): PreprintSignal | null {
  const doi = (e.doi || e.doiRaw || '').trim()
  for (const { re, server } of DOI_PREFIXES) if (re.test(doi)) return { server, via: 'doi' }

  // arXiv eprint fields: `archivePrefix = {arXiv}` or `eprint` + `primaryClass`.
  if (/archiveprefix\s*=\s*[{"']?\s*arxiv/i.test(e.raw)) return { server: 'arXiv', via: 'eprint' }
  if (/\beprint\s*=/i.test(e.raw) && /\bprimaryclass\s*=/i.test(e.raw)) return { server: 'arXiv', via: 'eprint' }

  for (const { re, server } of VENUE_TELLS) if (re.test(e.venue)) return { server, via: 'venue' }
  return null
}

// Pure acceptance test for a resolved published version. Accept the best
// candidate only if it is NOT itself a preprint, clears the title-similarity
// bar, and is published no earlier than the preprint.
export function bestPublishedMatch(
  preprintTitle: string,
  preprintYear: number | null,
  candidates: OpenAlexWork[],
): { work: OpenAlexWork; score: number } | null {
  let best: { work: OpenAlexWork; score: number } | null = null
  for (const c of candidates) {
    if (c.type === 'preprint') continue
    if (preprintYear != null && c.publicationYear != null && c.publicationYear < preprintYear) continue
    const score = diceCoefficient(preprintTitle, c.displayName)
    if (!best || score > best.score) best = { work: c, score }
  }
  return best && best.score >= TITLE_MATCH_THRESHOLD ? best : null
}
