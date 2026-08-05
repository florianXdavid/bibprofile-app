// Card 3 — Self-citation. The only card requiring user input (a name, and
// optionally an ORCID). Two match modes:
//
//   ORCID given  -> exact match against authorships[].author.orcid. Reliable.
//   Name only    -> surname + first initial against author display names. This
//                   is fuzzy: we return the matched references EXPLICITLY so the
//                   user can eyeball and dismiss false positives, rather than
//                   reporting a bare number they can't check.
//
// Works whose OpenAlex record carried no authorship data can't be searched;
// they are reported as `noAuthorData` rather than silently counted as "no".

import { normalizeOrcid } from '../openalex'
import type { AnalysisWork, Cohort, Stat } from './denominator'

export interface SelfCiteQuery {
  name: string
  orcid?: string
}

export interface SelfCiteMatch {
  citeKey: string
  title: string
  matchedAuthor: string // the OpenAlex author name that matched — for verification
  via: 'orcid' | 'name'
}

export interface SelfCiteResult extends Stat {
  matches: SelfCiteMatch[]
  selfCount: number // matches.length
  share: number | null // selfCount / n (0..1)
  noAuthorData: number // works with no authorship list to search
  via: 'orcid' | 'name' | null // which mode actually ran
}

interface NameKey {
  surname: string
  initial: string
}

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s,.-]/g, '')
    .trim()
}

// Parse a person name into { surname, first initial }. Handles "Last, First",
// "First Last", "First M. Last", and "Last F". Compound/hyphenated surnames are
// reduced to their final token (documented limitation).
export function nameKey(raw: string): NameKey | null {
  const folded = fold(raw)
  if (!folded) return null

  let surname = ''
  let given = ''
  if (folded.includes(',')) {
    const [last, first] = folded.split(',', 2)
    surname = last.trim()
    given = (first ?? '').trim()
  } else {
    const tokens = folded.split(/\s+/).filter(Boolean)
    if (tokens.length === 1) {
      surname = tokens[0]
    } else {
      surname = tokens[tokens.length - 1]
      given = tokens[0]
    }
  }
  const surTokens = surname.split(/[\s-]+/).filter(Boolean)
  const sur = surTokens[surTokens.length - 1] ?? ''
  if (!sur) return null
  return { surname: sur, initial: given ? given[0] : '' }
}

export function nameKeysMatch(query: NameKey, candidate: NameKey): boolean {
  if (query.surname !== candidate.surname) return false
  // If either side lacks a first initial, surname agreement is all we have.
  if (!query.initial || !candidate.initial) return true
  return query.initial === candidate.initial
}

export function findSelfCitations(cohort: Cohort, query: SelfCiteQuery): SelfCiteResult {
  const searchable = cohort.works.filter(w => w.work.authorships.length > 0)
  const noAuthorData = cohort.works.length - searchable.length
  const n = searchable.length
  const flagged = searchable.filter(w => w.suspicious).length

  const wantOrcid = normalizeOrcid(query.orcid ?? '')
  const wantName = query.name.trim() ? nameKey(query.name) : null
  const via: 'orcid' | 'name' | null = wantOrcid ? 'orcid' : wantName ? 'name' : null

  const matches: SelfCiteMatch[] = []
  if (via) {
    for (const w of searchable) {
      const hit = matchWork(w, wantOrcid, wantName)
      if (hit) matches.push({ citeKey: w.citeKey, title: w.title, matchedAuthor: hit.author, via: hit.via })
    }
  }

  return {
    n, flagged,
    excluded: noAuthorData > 0 ? { 'no author data': noAuthorData } : {},
    matches,
    selfCount: matches.length,
    share: n > 0 && via ? matches.length / n : null,
    noAuthorData,
    via,
  }
}

// ORCID takes precedence (reliable); name is the fallback. Returns the matched
// author name so the UI can show WHY a reference was flagged.
function matchWork(
  w: AnalysisWork,
  wantOrcid: string | null,
  wantName: NameKey | null,
): { author: string; via: 'orcid' | 'name' } | null {
  if (wantOrcid) {
    const a = w.work.authorships.find(au => au.orcid === wantOrcid)
    if (a) return { author: a.authorName || wantOrcid, via: 'orcid' }
    return null // ORCID mode is exact: no ORCID hit means no self-citation here
  }
  if (wantName) {
    for (const au of w.work.authorships) {
      const k = nameKey(au.authorName)
      if (k && nameKeysMatch(wantName, k)) return { author: au.authorName, via: 'name' }
    }
  }
  return null
}
