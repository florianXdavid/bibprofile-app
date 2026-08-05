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
