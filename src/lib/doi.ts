// DOI normalisation. .bib files store DOIs every which way:
//   https://doi.org/10.1/x , http://dx.doi.org/10.1/x , doi:10.1/x ,
//   "  10.1/X  ", with trailing punctuation, etc.
// We reduce all of that to a bare, lowercased DOI: `10.xxxx/yyyy`.
//
// Note: legacy Wiley DOIs legitimately contain angle brackets, e.g.
//   10.1002/(sici)1097-0258(19990615)18:11<1387::aid-sim126>3.0.co;2-v
// so the value handed here must NOT have been run through an HTML tag stripper
// (see parseBib.ts — identifier fields skip stripMarkup).

export function normalizeDoi(input: string | null | undefined): string | null {
  if (!input) return null
  let doi = input.trim()

  // Un-escape LaTeX escapes that can survive in verbatim fields (Fix 7).
  // A DOI may legitimately contain an underscore; `\_` must become `_`.
  doi = doi.replace(/\\([_&%#$])/g, '$1')

  // Strip common URL / scheme prefixes.
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  doi = doi.replace(/^doi:\s*/i, '')

  // Some exports wrap the value in braces or angle brackets AT THE ENDS only.
  // (Do not strip interior <...> — those are part of legacy Wiley DOIs.)
  doi = doi.replace(/^[<{[]+/, '').replace(/[>}\]]+$/, '')

  // Trim stray surrounding whitespace/quotes and a single trailing period.
  doi = doi.trim().replace(/^["']+|["']+$/g, '').replace(/\.$/, '').trim()

  doi = doi.toLowerCase()

  // A DOI must start with a "10." registrant prefix; otherwise treat as absent.
  if (!/^10\.\d{3,9}\/\S+$/.test(doi)) return null

  return doi
}

// --- v1.4.5 (H4): identifiers OUTSIDE the doi field ---------------------------
// Zotero, Google Scholar, ADS and hand-written entries often carry the DOI in
// `url` / `note` / `howpublished`, an arXiv id in `eprint` / `journal`, or a
// PubMed id. Each of these is a FREE OpenAlex singleton lookup — far better than
// a billable title search. Read from the VERBATIM source fields (`read`), in
// priority order: pmid/pmcid fields, then a DOI, an arXiv id, a PubMed / PMC URL,
// an eLife article URL (searched across ALT_FIELDS for each pattern in turn).

const ALT_FIELDS = ['url', 'note', 'howpublished', 'eprint', 'journal', 'annote']
const DOI_IN_TEXT = /(?:doi\.org\/|\bdoi:\s*)(10\.\d{4,9}\/[^\s{}"<>\\]+)/i
const ARXIV = '([a-z-]+(?:\\.[a-z]{2})?\\/\\d{7}|\\d{4}\\.\\d{4,5})'
const ARXIV_URL = new RegExp(`arxiv\\.org\\/(?:abs|pdf)\\/${ARXIV}`, 'i')
const ARXIV_TAG = new RegExp(`\\barxiv:\\s*${ARXIV}`, 'i')
const ARXIV_BARE = new RegExp(`^\\s*${ARXIV}(?:v\\d+)?\\s*$`, 'i')

export interface FoundId { key: string; doi: string | null; field: string }

function cleanDoiMatch(s: string): string | null {
  let d = s.replace(/[.,;]+$/, '')
  if (d.endsWith(')') && !d.includes('(')) d = d.slice(0, -1)
  try { d = decodeURIComponent(d) } catch { /* keep as is */ }
  return normalizeDoi(d)
}

export function findAltId(read: (field: string) => string | null): FoundId | null {
  const pmid = (read('pmid') ?? '').match(/^\s*(\d+)\s*$/)
  if (pmid) return { key: `pmid:${pmid[1]}`, doi: null, field: 'pmid' }
  const pmcid = (read('pmcid') ?? '').match(/^\s*(PMC\d+)\s*$/i)
  if (pmcid) return { key: `pmcid:${pmcid[1].toUpperCase()}`, doi: null, field: 'pmcid' }

  const vals = ALT_FIELDS.map(f => [f, read(f) ?? ''] as const).filter(([, v]) => v)
  const isArxivEprint = /arxiv/i.test(read('archiveprefix') ?? read('eprinttype') ?? '')
  const asDoi = (doi: string | null, field: string): FoundId | null => (doi ? { key: `doi:${doi}`, doi, field } : null)

  for (const [f, v] of vals) {
    const m = v.match(DOI_IN_TEXT)
    const hit = m && asDoi(cleanDoiMatch(m[1]), f)
    if (hit) return hit
  }
  for (const [f, v] of vals) {
    const m = v.match(ARXIV_URL) ?? v.match(ARXIV_TAG) ?? (f === 'eprint' && isArxivEprint ? v.match(ARXIV_BARE) : null)
    if (m) return asDoi(`10.48550/arxiv.${m[1].toLowerCase()}`, f)
  }
  for (const [f, v] of vals) {
    const pm = v.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)
    if (pm) return { key: `pmid:${pm[1]}`, doi: null, field: f }
    const pmc = v.match(/\/pmc\/articles\/(PMC\d+)/i)
    if (pmc) return { key: `pmcid:${pmc[1].toUpperCase()}`, doi: null, field: f }
    const el = v.match(/elifesciences\.org\/articles\/(\d+)/i)
    if (el) return asDoi(`10.7554/elife.${el[1]}`, f)
  }
  return null
}
