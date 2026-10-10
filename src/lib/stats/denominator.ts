// ===========================================================================
// Shared denominator helper — governs what every analysis card is allowed to
// count. The honesty of the whole report rests on these rules, so they live in
// ONE place rather than being re-derived (and quietly diverging) per card.
//
// The four non-negotiable rules (see README "Denominator rules"):
//   1. Duplicates count once. Exclude rows carrying `duplicateOf`; keep the
//      canonical entry only. A paper cited four times is one work.
//   2. `suspicious` (and, v1.4.1, `uncertain`) is INCLUDED, but tracked so a card can say "3 flagged as
//      uncertain". Excluding it hides data; including it silently is dishonest.
//   3. `not-indexable` is EXCLUDED from statistics and reported separately.
//   4. Every card reports its OWN n — different fields are missing on different
//      works, and a single headline denominator would paper over that.
//
// buildCohort() applies rules 1–3 once. Each card then calls subset() with a
// field predicate to apply rule 4 and get back { value-ready works, n, flagged,
// excluded }.
// ===========================================================================

import type { MatchStatus, OpenAlexWork, ResultRow } from '../../types'

// A canonical, matched work eligible for statistics. Carries the .bib-side
// identifiers a card needs to name a specific reference back to the user.
export interface AnalysisWork {
  rowId: string
  citeKey: string
  title: string // .bib title, for "your oldest reference is …"
  bibYear: number | null
  suspicious: boolean // status was `suspicious` or `uncertain` (included, but flagged)
  preprintVersion: boolean // v1.4.5 (H9): cited as journal/proceedings, only the preprint is indexed
  work: OpenAlexWork
}

export interface CohortExclusions {
  duplicates: number // rule 1
  notIndexable: number // rule 3
  notFound: number
  errored: number
  unparseable: number
  matchedNoData: number // matched status but null OpenAlex work (defensive; ~never)
}

export interface Cohort {
  works: AnalysisWork[] // canonical + matched (incl. suspicious) + has OA data
  flagged: number // suspicious count within `works`
  totalEntries: number // every row incl. unparseable — the raw .bib size
  uniqueEntries: number // canonical entries (duplicates collapsed), any status
  excluded: CohortExclusions
}

// A single card's denominator report. `value` is card-specific and supplied by
// the caller; this module guarantees n / flagged / excluded are computed the
// same way everywhere.
export interface Stat {
  n: number // works actually used in this statistic
  flagged: number // of n, how many are `suspicious`
  excluded: Record<string, number> // reason -> count (e.g. { 'no venue': 12 })
}

const MATCHED: ReadonlySet<MatchStatus> = new Set<MatchStatus>([
  'matched-by-doi',
  'matched-by-title',
  'suspicious',
  'uncertain',
])

// Apply rules 1–3 to the full row set, producing the base cohort every card
// draws from. Pure and order-independent.
export function buildCohort(rows: ResultRow[]): Cohort {
  const works: AnalysisWork[] = []
  const excluded: CohortExclusions = {
    duplicates: 0,
    notIndexable: 0,
    notFound: 0,
    errored: 0,
    unparseable: 0,
    matchedNoData: 0,
  }

  let uniqueEntries = 0
  for (const r of rows) {
    if (r.duplicateOf) {
      excluded.duplicates++ // rule 1: never counted in any distribution
      continue
    }
    uniqueEntries++

    if (MATCHED.has(r.status)) {
      if (r.openalex) {
        works.push({
          rowId: r.rowId,
          citeKey: r.citeKey,
          title: r.title,
          bibYear: r.bibYear,
          suspicious: r.status === 'suspicious' || r.status === 'uncertain',
          preprintVersion: !!r.preprintVersion,
          work: r.openalex,
        })
      } else {
        excluded.matchedNoData++
      }
    } else if (r.status === 'not-indexable') {
      excluded.notIndexable++ // rule 3: reported, never in stats
    } else if (r.status === 'not-found') {
      excluded.notFound++
    } else if (r.status === 'error') {
      excluded.errored++
    } else if (r.status === 'unparseable') {
      excluded.unparseable++
    }
  }

  return {
    works,
    flagged: works.filter(w => w.suspicious).length,
    totalEntries: rows.length,
    uniqueEntries,
    excluded,
  }
}

// Rule 4: restrict a cohort to works that actually carry the field a card needs.
// `missingReason` labels the works dropped for lacking that field so the card
// can show e.g. "12 works had no venue data".
export function subset(
  cohort: Cohort,
  has: (w: AnalysisWork) => boolean,
  missingReason = 'missing data',
): { used: AnalysisWork[] } & Stat {
  const used = cohort.works.filter(has)
  const missing = cohort.works.length - used.length
  const excluded: Record<string, number> = {}
  if (missing > 0) excluded[missingReason] = missing
  return {
    used,
    n: used.length,
    flagged: used.filter(w => w.suspicious).length,
    excluded,
  }
}

// v1.4.5 (M1) — the year the author CITES: the .bib year when present and
// plausible, else the OpenAlex year of a confident match. (OpenAlex dates some
// records oddly — "Attention Is All You Need" = 2025, a 1989 volume = 2008 — and an
// uncertain / suspicious match may be another work altogether.)
export function citedYear(w: AnalysisWork, referenceYear = new Date().getFullYear()): number | null {
  if (w.bibYear != null && w.bibYear >= 1400 && w.bibYear <= referenceYear + 1) return w.bibYear
  return w.suspicious ? null : w.work.publicationYear
}

// Works with a usable (cited) year — the recency card's denominator, reused by the
// summary text and the shape card.
export function withYear(cohort: Cohort): { used: AnalysisWork[] } & Stat {
  return subset(cohort, w => citedYear(w) != null, 'no year')
}

// The plain-language "based on …" line every card footer shows.
export function describeBasis(stat: Stat): string {
  if (stat.n === 0) return 'No works with data for this card.'
  const noun = stat.n === 1 ? 'work' : 'works'
  let s = `Based on ${stat.n} ${noun}`
  if (stat.flagged > 0) s += `, ${stat.flagged} flagged as uncertain`
  s += '.'
  const parts = Object.entries(stat.excluded).filter(([, n]) => n > 0)
  if (parts.length > 0) {
    s += ' ' + parts.map(([reason, n]) => `${n} excluded (${reason})`).join('; ') + '.'
  }
  return s
}

// The total count of works OpenAlex-matched and unique — the report headline.
export function uniqueWorkCount(cohort: Cohort): number {
  return cohort.totalEntries - cohort.excluded.duplicates - cohort.excluded.unparseable
}
