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
import { normalizeDoi } from './doi'
import type { BibEntry, MatchSignals, OpenAlexWork } from '../types'

const SUBTITLE_SCORE = 0.9
const NEAR_PERFECT = 0.95
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
// v1.4.5 (H1): also '. ' — A&A's "Title. Subtitle" / "Series. III. Part" style, which
// OpenAlex truncates to the part before the first '. '. Only when that part still
// has >= 3 words (so "Dr. Who …" or "U.S. …" don't count).
function mainTitle(t: string): string {
  const head = t.split(/[:?]|\s[-–—]\s|\.\s/)[0]
  if (head.trim().split(/\s+/).length >= 3) return head
  return t.split(/[:?]|\s[-–—]\s/)[0]
}

// v1.4.6 (F6) — OpenAlex / Crossref hold many pre-1950 German and French titles and
// names with U+FFFD where an accented letter was ("Die gegen\uFFFDrtige Situation",
// "Schr\uFFFDdinger"). Such a string is compared as a pattern: each U+FFFD stands for
// up to two letters.
const MOJIBAKE = /\uFFFD/
const HOLE = 'qqhqq' // a letter-only placeholder that survives normalisation
function wildcardEqual(withHoles: string, other: string, norm: (s: string) => string): boolean {
  const parts = norm(withHoles.replace(/\uFFFD/g, HOLE)).split(HOLE)
  return new RegExp(`^${parts.join('[a-z]{0,2}')}$`).test(norm(other))
}

export function titleSimilarity(a: string, b: string): number {
  const ta = stripRetractedPrefix(a).title
  const tb = stripRetractedPrefix(b).title
  if (MOJIBAKE.test(ta) !== MOJIBAKE.test(tb) && (MOJIBAKE.test(ta) ? wildcardEqual(ta, tb, normalizeTitle) : wildcardEqual(tb, ta, normalizeTitle))) return 1
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
    .replace(/\uFFFD/g, HOLE) // v1.4.6 (F6): keep a mojibake hole inside its token
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean)
}
// A name token equals the surname, a U+FFFD hole matching up to two letters.
const sameName = (token: string, surname: string) =>
  token === surname || (token.includes(HOLE) && new RegExp(`^${token.split(HOLE).join('[a-z]{0,2}')}$`).test(surname))

export function authorSignal(firstAuthor: string, w: OpenAlexWork): number | null {
  const bib = nameTokens(firstAuthor)
  const names = w.authorships.map(a => nameTokens(a.authorName)).filter(t => t.length > 0)
  if (bib.length === 0 || names.length === 0) return null
  const surname = bib[bib.length - 1] // "van der Maaten" -> "maaten"; "García-López" -> "lopez"
  if (names[0].some(t => sameName(t, surname))) return 1
  if (names.some(n => n.some(t => sameName(t, surname)))) return AUTHOR_LATER
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
  reasons?: string[] // v1.4.5: why an `uncertain` decision isn't confident (shown in the table)
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
    // v1.4.6: not two PARTS of one paper (same title, different first pages)
    && !(a.biblio?.firstPage && b.biblio?.firstPage && a.biblio.firstPage !== b.biblio.firstPage)
}

// v1.4.5 (H7) — OpenAlex "stub" records (e.g. CiNii imports): no DOI and a single
// author where the .bib lists several, or a junk venue. Never preferred over a
// real record; alone, never confident.
const JUNK_VENUE = /^medical entomology and zoology$/i
function isStub(e: BibEntry, w: OpenAlexWork): boolean {
  if (w.doi) return false
  return JUNK_VENUE.test((w.hostVenue ?? '').trim())
    || (w.authorships.length <= 1 && (e.authors ?? '').includes(';'))
}

// v1.4.5 (H8) — too few words to identify a work on its own ("somatomotor").
export function isShortTitle(title: string): boolean {
  const t = normalizeTitle(title)
  return t.length < 15 || t.split(' ').filter(w => w && !FUNCTION_WORDS.has(w)).length < 3
}
// v1.4.5 (H6) — a saved peer-review page ("PEER REVIEW - <paper title>"), not the paper.
const PEER_REVIEW = /^\s*(?:peer\s+review|review\s+for)\b/i

// v1.4.6 (F1) — tokens that tell otherwise identical titles apart: numbers ("2008",
// "DR2"), Roman numerals (Part II), and single capital letters ("data set A" / "B").
// A capital A counts only at the end or after set/part/type/phase/series/group.
const ROMAN = /\b(?:I{2,3}|IV|VI{0,3}|IX|XI{0,3})\b/g
const LETTER = /(?:^|[\s(—–-])([B-Z])(?=$|[\s).,:;—–-])/g
const LETTER_A = /(?:\b(?:set|part|type|phase|series|group|appendix|section)\s+(A)\b|\s(A)\s*$)/gi
function discriminators(title: string): Set<string> {
  const out = new Set<string>()
  for (const tok of normalizeTitle(title).split(' ')) if (/\d/.test(tok)) out.add(tok)
  for (const m of title.matchAll(ROMAN)) out.add(m[0].toLowerCase())
  for (const m of title.matchAll(LETTER)) out.add(m[1].toLowerCase())
  if (title.match(LETTER_A)) out.add('a')
  return out
}
// "'a' vs 'b'" when two titles carry different discriminators (both must have some).
// When one title is the other plus a subtitle, only the shared part is compared.
export function discriminatorClash(a: string, b: string): string | null {
  let ta = stripRetractedPrefix(a).title, tb = stripRetractedPrefix(b).title
  const na = normalizeTitle(ta), nb = normalizeTitle(tb)
  if (na !== nb && nb.startsWith(na)) tb = mainTitle(tb)
  else if (na !== nb && na.startsWith(nb)) ta = mainTitle(ta)
  const da = discriminators(ta), db = discriminators(tb)
  if (!da.size || !db.size) return null
  const onlyA = [...da].filter(x => !db.has(x)), onlyB = [...db].filter(x => !da.has(x))
  return onlyA.length || onlyB.length ? `'${onlyA.join(' ') || '—'}' vs '${onlyB.join(' ') || '—'}'` : null
}

// v1.4.6 (F5) — two records that look like ONE work held twice by OpenAlex: same
// title, same first author, years within 1, and not two parts with different pages.
function looseSameWork(a: OpenAlexWork, b: OpenAlexWork): boolean {
  const first = (w: OpenAlexWork) => { const t = nameTokens(w.authorships[0]?.authorName ?? ''); return t[t.length - 1] ?? '' }
  const pa = a.biblio?.firstPage, pb = b.biblio?.firstPage
  return normalizeTitle(stripRetractedPrefix(a.displayName).title) === normalizeTitle(stripRetractedPrefix(b.displayName).title)
    && first(a) === first(b)
    && (a.publicationYear == null || b.publicationYear == null || Math.abs(a.publicationYear - b.publicationYear) <= 1)
    && !(pa && pb && pa !== pb)
}

// Pick the best title-search candidate. Deterministic order: score desc, then
// title signal desc, then OpenAlex's own rank.
// `missingDoi` (v1.4.5, H8): a DOI the .bib cites that OpenAlex doesn't know — a
// record carrying a DIFFERENT DOI is then another object (a mirror, another version).
export function chooseTitleMatch(e: BibEntry, candidates: OpenAlexWork[], missingDoi: string | null = null): TitleDecision {
  const bibIsNotice = isNoticeTitle(stripRetractedPrefix(e.title).title)
  const gated = candidates
    .map((w, rank) => ({ w, rank, sig: scoreCandidate(e, w) }))
    .filter(c => c.sig.title >= TITLE_MATCH_THRESHOLD && (bibIsNotice || !isNoticeWork(c.w)))
    .sort((x, y) => y.sig.score - x.sig.score || y.sig.title - x.sig.title || x.rank - y.rank)
  const real = gated.filter(c => !isStub(e, c.w))
  const scored = real.length ? real : gated

  const top = scored[0]
  if (!top || top.sig.score < MATCH_SCORE_FLOOR) {
    return { status: 'not-found', work: null, signals: top?.sig ?? null, ambiguous: false, twins: [] }
  }
  // Collapse near-tied duplicates of the top record onto the most-cited one.
  const dupes = scored.filter(c => c.sig.score >= top.sig.score - MATCH_AMBIGUITY_MARGIN && sameWork(c.w, top.w))
  const best = dupes.reduce((x, y) => ((y.w.citedByCount ?? 0) > (x.w.citedByCount ?? 0) ? y : x), top)
  const runnerUp = scored.find(c => !dupes.includes(c) && bareId(c.w.id) !== bareId(best.w.id))
  // v1.4.6 (F5): a near-perfect best (>= NEAR_PERFECT: title, author, year, venue, type
  // all agree) is not made ambiguous by a runner-up it strictly beats, nor by a twin
  // record of the same work (Dumont 2015 was `uncertain` at score 1.0).
  const ambiguous = !!runnerUp && runnerUp.sig.score >= best.sig.score - MATCH_AMBIGUITY_MARGIN
    && !(best.sig.score >= NEAR_PERFECT && (best.sig.score > runnerUp.sig.score || looseSameWork(best.w, runnerUp.w)))
  const yearGap = e.year != null && best.w.publicationYear != null ? Math.abs(e.year - best.w.publicationYear) : 0
  const s = best.sig
  const reasons: string[] = []
  if (s.score < MATCH_CONFIDENT_THRESHOLD) reasons.push(`weak match (score ${s.score.toFixed(2)})`)
  if (ambiguous) reasons.push('another record scored almost the same')
  if (yearGap > MATCH_MAX_YEAR_GAP) reasons.push(`years ${yearGap} apart — another edition or a reprint?`)
  if (!real.length) reasons.push('only a stub record (no DOI, incomplete authors)')
  if (!((s.author ?? 0) > 0 || s.year === 1)) reasons.push('no author or year to confirm the title') // H6
  if (PEER_REVIEW.test(e.title)) reasons.push('the title is a peer-review page, not the paper') // H6
  // H8: a very short title also needs the first author AND the venue (or, when the
  // venue can't be compared, the year) — "Mask R-CNN" in TPAMI yes, a one-word
  // dataset title on another repository no.
  if (isShortTitle(e.title) && !(s.author === 1 && (s.venue != null ? s.venue >= 0.5 : s.year === 1))) {
    reasons.push('title too short to match on alone')
  }
  if (missingDoi && best.w.doi && normalizeDoi(best.w.doi) !== missingDoi) reasons.push('same title, different DOI') // H8
  const clash = discriminatorClash(e.title, best.w.displayName)
  if (clash) reasons.push(`titles differ on ${clash}`) // v1.4.6 (F1)
  const confident = reasons.length === 0
  return { status: confident ? 'matched-by-title' : 'uncertain', work: best.w, signals: best.sig, ambiguous, twins: findTwins(e, best.w, candidates), reasons }
}
