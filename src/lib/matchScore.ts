// v1.4.1 — multi-signal match scoring. PURE and deterministic: the same entry and
// candidates always give the same scores, order and decision (no randomness, no
// clock, no network). Used by match.ts for both paths:
//   • title search — score up to SEARCH_PER_PAGE candidates, pick the best, and
//     decide matched-by-title / uncertain / not-found;
//   • DOI lookup   — score the one returned work (shown as the row's score).
//
// Signals (each 0..1, or null = "can't compare, skip it"):
//   title  — Dice similarity after stripping "RETRACTED:" prefixes; a title that
//            equals the other's title minus its subtitle scores SUBTITLE_SCORE
//   author — the .bib first author's family name vs OpenAlex authors
//            (1 = first author, AUTHOR_LATER = a later author, 0 = absent)
//   year   — 1 within ±1 year, else 0
//   venue  — journal/booktitle vs OpenAlex host venue (abbreviation/acronym aware)
//   type   — @article / @book / @inproceedings … vs OpenAlex `type`
//   biblio — volume and first page, when both sides have them
// score = Σ weight·signal / Σ weight over the non-null signals (weights: config.ts).

import {
  MATCH_AMBIGUITY_MARGIN,
  MATCH_CONFIDENT_THRESHOLD,
  MATCH_MAX_YEAR_GAP,
  MATCH_SCORE_FLOOR,
  MATCH_WEIGHTS,
  TITLE_MATCH_THRESHOLD,
} from '../config'
import { diceCoefficient, normalizeTitle } from './similarity'
import type { BibEntry, MatchSignals, OpenAlexWork } from '../types'

const SUBTITLE_SCORE = 0.9
const AUTHOR_LATER = 0.7
const PARTIAL_TYPE = 0.5

// --- Title -------------------------------------------------------------------

// Labels publishers put IN FRONT OF the retracted paper's own title ("RETRACTED:",
// "RETRACTED ARTICLE:", "Retracted article:", "[Retracted]"). Stripped before
// comparing; the fact is kept (BibEntry.titleRetracted) for v1.4.2.
const RETRACTED_PREFIX = /^\s*(?:\[\s*retracted\s*\]\s*:?|retracted(?:\s+article)?\s*:)\s*/i

export function stripRetractedPrefix(title: string): { title: string; retracted: boolean } {
  const t = title ?? ''
  return RETRACTED_PREFIX.test(t)
    ? { title: t.replace(RETRACTED_PREFIX, ''), retracted: true }
    : { title: t, retracted: false }
}

// SEPARATE records that are notices ABOUT a paper ("Retraction note to: X",
// "Erratum: X", "Correction to: X") — never the paper itself. Unlike the prefix
// above they are not stripped: such candidates are dropped unless the .bib entry
// is itself a notice.
const NOTICE_TITLE = /^\s*(?:retraction(?:\s+(?:note|notice|statement))?|notice\s+of\s+retraction|expression\s+of\s+concern|erratum|corrigendum|correction|withdrawal|withdrawn)(?:\s*[:\-–—]|\s+(?:to|for)\b)/i
// (OpenAlex's `retraction` type is NOT here: it is also applied to the retracted
// paper itself, which must stay matchable.)
const NOTICE_TYPES = new Set(['erratum', 'paratext', 'peer-review', 'supplementary-materials'])

export function isNoticeTitle(title: string): boolean {
  return NOTICE_TITLE.test(title ?? '')
}
function isNoticeWork(w: OpenAlexWork): boolean {
  return NOTICE_TYPES.has((w.type ?? '').toLowerCase()) || isNoticeTitle(w.displayName)
}

// Main title = text before the first ':' / '?' / ' - ' (subtitle separator).
function mainTitle(t: string): string {
  return t.split(/[:?]|\s[-–—]\s/)[0]
}

export function titleSimilarity(a: string, b: string): number {
  const ta = stripRetractedPrefix(a).title
  const tb = stripRetractedPrefix(b).title
  const full = diceCoefficient(ta, tb)
  if (full >= 1) return 1
  const na = normalizeTitle(ta), nb = normalizeTitle(tb)
  const ma = normalizeTitle(mainTitle(ta)), mb = normalizeTitle(mainTitle(tb))
  // One side is the other's title without its subtitle (needs >= 8 chars so that
  // very short titles can't ride on this rule).
  const subtitleDropped =
    (na.length >= 8 && na === mb && nb !== mb) || (nb.length >= 8 && nb === ma && na !== ma)
  return Math.max(full, subtitleDropped ? SUBTITLE_SCORE : 0)
}

// --- Author ------------------------------------------------------------------

function nameTokens(s: string): string[] {
  return (s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // "PedregosaFabian" -> "Pedregosa Fabian"
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean)
}

export function authorSignal(firstAuthor: string, w: OpenAlexWork): number | null {
  const bib = nameTokens(firstAuthor)
  const names = w.authorships.map(a => nameTokens(a.authorName)).filter(t => t.length > 0)
  if (bib.length === 0 || names.length === 0) return null
  const surname = bib[bib.length - 1] // "van der Maaten" -> "maaten"; "García-López" -> "lopez"
  if (names[0].includes(surname)) return 1
  if (names.some(t => t.includes(surname))) return AUTHOR_LATER
  return 0
}

// --- Year --------------------------------------------------------------------

export function yearSignal(bibYear: number | null, w: OpenAlexWork): number | null {
  if (bibYear == null || w.publicationYear == null) return null
  return Math.abs(bibYear - w.publicationYear) <= 1 ? 1 : 0
}

// --- Venue -------------------------------------------------------------------

const VENUE_STOP = new Set([
  'the', 'of', 'and', 'on', 'in', 'for', 'a', 'an', 'to', 'at', 'de', 'la', 'le', 'des', 'du',
  'und', 'fur', 'der', 'die', 'das', 'et', 'proceedings', 'proc', 'conference', 'conf',
  'international', 'annual', 'ieee', 'acm', 'cvf', 'preprint', 'press',
])

function rawVenueTokens(s: string): string[] {
  return (s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(t => t.length > 0)
}
function venueTokens(s: string): string[] {
  return rawVenueTokens(s).filter(t => t.length > 1 && !VENUE_STOP.has(t))
}
// Acronym initials skip only function words, so "Proceedings of the National
// Academy of Sciences" -> "pnas".
const FUNCTION_WORDS = new Set(['the', 'of', 'and', 'on', 'in', 'for', 'a', 'an', 'to', 'at', 'de', 'la', 'le', 'des', 'du', 'und', 'fur', 'der', 'die', 'das', 'et'])
function initials(s: string): string {
  return rawVenueTokens(s).filter(t => !FUNCTION_WORDS.has(t)).map(t => t[0]).join('')
}

// Every token of `abbr` is a prefix of a token of `full`, in order
// ("phys rev lett" ⊑ "physical review letters").
function isAbbreviationOf(abbr: string[], full: string[]): boolean {
  if (abbr.length < 2) return false
  let j = 0
  for (const t of abbr) {
    while (j < full.length && !full[j].startsWith(t)) j++
    if (j === full.length) return false
    j++
  }
  return true
}

export function venueSignal(bibVenue: string, oaVenue: string | null): number | null {
  const a = venueTokens(bibVenue)
  const b = venueTokens(oaVenue ?? '')
  if (a.length === 0 || b.length === 0) return null
  // A one-word acronym on either side: "CVPR" in "… Pattern Recognition (CVPR)",
  // or "PNAS" = initials of "Proceedings of the National Academy of Sciences".
  if (a.length === 1 && (b.includes(a[0]) || initials(oaVenue ?? '') === a[0])) return 1
  if (b.length === 1 && (a.includes(b[0]) || initials(bibVenue) === b[0])) return 1
  if (isAbbreviationOf(a, b) || isAbbreviationOf(b, a)) return 1
  const sa = new Set(a), sb = new Set(b)
  let shared = 0
  for (const t of sa) if (sb.has(t)) shared++
  return shared / Math.max(sa.size, sb.size)
}

// --- Type --------------------------------------------------------------------

type Kind = 'article' | 'conf' | 'book' | 'chapter' | 'thesis' | 'report' | 'preprint' | 'notice' | 'bookreview'

const PREPRINT_VENUE = /arxiv|biorxiv|medrxiv|chemrxiv|ssrn|research\s*square|preprint/i

function bibKind(entryType: string, venue: string): Kind | null {
  const t = (entryType ?? '').toLowerCase()
  if ((t === 'article' || t === 'misc' || t === 'online' || t === 'unpublished') && PREPRINT_VENUE.test(venue)) return 'preprint'
  if (t === 'article') return 'article'
  if (t === 'inproceedings' || t === 'conference') return 'conf'
  if (t === 'book' || t === 'booklet' || t === 'proceedings') return 'book'
  if (t === 'inbook' || t === 'incollection') return 'chapter'
  if (t === 'phdthesis' || t === 'mastersthesis' || t === 'thesis') return 'thesis'
  if (t === 'techreport' || t === 'report') return 'report'
  return null // misc / online / unknown: not comparable
}

function oaKind(type: string | null): Kind | null {
  const t = (type ?? '').toLowerCase()
  if (t === 'article' || t === 'review' || t === 'letter' || t === 'editorial') return 'article'
  if (t === 'conference-paper') return 'conf'
  if (t === 'preprint') return 'preprint'
  if (t === 'book') return 'book'
  if (t === 'book-review') return 'bookreview'
  if (t === 'book-chapter' || t === 'reference-entry') return 'chapter'
  if (t === 'dissertation') return 'thesis'
  if (t === 'report') return 'report'
  if (NOTICE_TYPES.has(t)) return 'notice'
  return null
}

// OpenAlex files conference papers as `conference-paper`, `article` or (LNCS-style)
// `book-chapter`, so @inproceedings matches all three.
const FULL: Record<Kind, Kind[]> = {
  article: ['article'], conf: ['conf', 'article', 'chapter'], book: ['book'], chapter: ['chapter'],
  thesis: ['thesis'], report: ['report'], preprint: ['preprint'], notice: ['notice'], bookreview: [],
}
const PARTIAL: Record<Kind, Kind[]> = {
  article: ['preprint', 'conf'], conf: ['preprint'], book: ['chapter'], chapter: ['book'],
  thesis: [], report: ['preprint'], preprint: ['article', 'conf', 'report'], notice: [], bookreview: [],
}

export function typeSignal(entryType: string, bibVenue: string, w: OpenAlexWork): number | null {
  const a = bibKind(entryType, bibVenue)
  const b = oaKind(w.type)
  if (!a || !b) return null
  if (FULL[a].includes(b)) return 1
  if (PARTIAL[a].includes(b)) return PARTIAL_TYPE
  return 0
}

// --- Volume / pages ----------------------------------------------------------

const idNorm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function biblioSignal(volume: string, pages: string, w: OpenAlexWork): number | null {
  const checks: number[] = []
  const bv = idNorm(volume), ov = idNorm(w.biblio?.volume ?? null)
  if (bv && ov) checks.push(bv === ov ? 1 : 0)
  const bp = idNorm((pages ?? '').split(/[-–—]+/)[0]), op = idNorm(w.biblio?.firstPage ?? null)
  if (bp && op) checks.push(bp === op ? 1 : 0)
  return checks.length ? checks.reduce((s, x) => s + x, 0) / checks.length : null
}

// --- Composite ---------------------------------------------------------------

const round3 = (x: number) => Math.round(x * 1000) / 1000

export function scoreCandidate(e: BibEntry, w: OpenAlexWork): MatchSignals {
  // Compare against both the title as written and its search-cleaned form (which
  // only drops site-name cruft like "… | PNAS"); keep the better.
  const title = round3(Math.max(
    titleSimilarity(e.title, w.displayName),
    e.titleForSearch && e.titleForSearch !== e.title ? titleSimilarity(e.titleForSearch, w.displayName) : 0,
  ))
  const s = {
    title,
    author: authorSignal(e.firstAuthor, w),
    year: yearSignal(e.year, w),
    venue: venueSignal(e.venue, w.hostVenue),
    type: typeSignal(e.entryType, e.venue, w),
    biblio: biblioSignal(e.volume, e.pages, w),
  }
  let num = 0, den = 0
  for (const k of Object.keys(MATCH_WEIGHTS) as (keyof typeof MATCH_WEIGHTS)[]) {
    const v = s[k]
    if (v == null) continue
    num += MATCH_WEIGHTS[k] * v
    den += MATCH_WEIGHTS[k]
  }
  return { ...s, score: den > 0 ? round3(num / den) : 0 }
}

export interface TitleDecision {
  status: 'matched-by-title' | 'uncertain' | 'not-found'
  work: OpenAlexWork | null // null for not-found — nothing is attached
  signals: MatchSignals | null
  ambiguous: boolean // a different work scored within MATCH_AMBIGUITY_MARGIN
  twins: OpenAlexWork[] // v1.4.2: other candidates that look like the same work as `work`
}

// v1.4.2 — candidates that look like the SAME work as the chosen one: near-identical
// title (>= 0.9, retraction prefixes ignored), first author and year (±1) not
// contradicting the entry, and not a notice. Used only to widen the retraction
// check (OpenAlex may flag just one of several duplicate records).
export function findTwins(e: BibEntry, chosen: OpenAlexWork, candidates: OpenAlexWork[]): OpenAlexWork[] {
  return candidates.filter(c =>
    bareId(c.id) !== bareId(chosen.id)
    && !isNoticeWork(c)
    && titleSimilarity(e.title, c.displayName) >= 0.9
    && authorSignal(e.firstAuthor, c) !== 0
    && yearSignal(e.year, c) !== 0)
}

const bareId = (id: string) => (id || '').replace(/^https?:\/\/openalex\.org\//i, '')

// OpenAlex sometimes holds the SAME work twice (identical title, year, first
// author, venue and type). Such duplicates are not a real near-tie; the most-cited
// record is kept (it carries the citation graph).
function sameWork(a: OpenAlexWork, b: OpenAlexWork): boolean {
  const first = (w: OpenAlexWork) => { const t = nameTokens(w.authorships[0]?.authorName ?? ''); return t[t.length - 1] ?? '' }
  const v = venueSignal(a.hostVenue ?? '', b.hostVenue)
  return normalizeTitle(stripRetractedPrefix(a.displayName).title) === normalizeTitle(stripRetractedPrefix(b.displayName).title)
    && a.publicationYear === b.publicationYear
    && first(a) === first(b)
    && oaKind(a.type) === oaKind(b.type)
    && (v == null || v >= 0.5)
}

// Pick the best title-search candidate. Deterministic order: score desc, then
// title signal desc, then OpenAlex's own rank.
export function chooseTitleMatch(e: BibEntry, candidates: OpenAlexWork[]): TitleDecision {
  const bibIsNotice = isNoticeTitle(stripRetractedPrefix(e.title).title)
  const scored = candidates
    .map((w, rank) => ({ w, rank, sig: scoreCandidate(e, w) }))
    .filter(c => c.sig.title >= TITLE_MATCH_THRESHOLD && (bibIsNotice || !isNoticeWork(c.w)))
    .sort((x, y) => y.sig.score - x.sig.score || y.sig.title - x.sig.title || x.rank - y.rank)

  const top = scored[0]
  if (!top || top.sig.score < MATCH_SCORE_FLOOR) {
    return { status: 'not-found', work: null, signals: top?.sig ?? null, ambiguous: false, twins: [] }
  }
  // Collapse near-tied duplicates of the top record onto the most-cited one.
  const dupes = scored.filter(c => c.sig.score >= top.sig.score - MATCH_AMBIGUITY_MARGIN && sameWork(c.w, top.w))
  const best = dupes.reduce((x, y) => ((y.w.citedByCount ?? 0) > (x.w.citedByCount ?? 0) ? y : x), top)
  const runnerUp = scored.find(c => !dupes.includes(c) && bareId(c.w.id) !== bareId(best.w.id))
  const ambiguous = !!runnerUp && runnerUp.sig.score >= best.sig.score - MATCH_AMBIGUITY_MARGIN
  const yearGap = e.year != null && best.w.publicationYear != null ? Math.abs(e.year - best.w.publicationYear) : 0
  const confident = best.sig.score >= MATCH_CONFIDENT_THRESHOLD && !ambiguous && yearGap <= MATCH_MAX_YEAR_GAP
  return { status: confident ? 'matched-by-title' : 'uncertain', work: best.w, signals: best.sig, ambiguous, twins: findTwins(e, best.w, candidates) }
}
