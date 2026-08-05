// "Copy summary" — one plain-text paragraph suitable for pasting into a methods
// section or an email. Descriptive, never evaluative (see the presentation
// rules): it states what the list IS, and passes no judgement on it.
//
// Clauses drop out when their data is absent, so a sparse or unmatched list
// still yields a truthful (shorter) sentence rather than "NaN%".

import { uniqueWorkCount, type Cohort } from './denominator'
import { computeRecency } from './recency'
import { computeVenues } from './venues'
import { computeOpenAccess } from './openaccess'

const pct = (frac: number | null): string | null =>
  frac == null ? null : `${Math.round(frac * 100)}%`

export function buildSummaryText(cohort: Cohort, referenceYear: number): string {
  const recency = computeRecency(cohort, referenceYear)
  const venues = computeVenues(cohort)
  const oa = computeOpenAccess(cohort)

  const unique = uniqueWorkCount(cohort)
  const dups = cohort.excluded.duplicates
  const unpar = cohort.excluded.unparseable

  const sentences: string[] = []

  // 1. Composition.
  const parenthetical: string[] = []
  if (dups > 0) parenthetical.push(`${dups} duplicate${dups === 1 ? '' : 's'}`)
  if (unpar > 0) parenthetical.push(`${unpar} unparseable`)
  const worksNoun = unique === 1 ? 'work' : 'works'
  let s1 = `This bibliography contains ${unique} unique ${worksNoun} (from ${cohort.totalEntries} entries`
  s1 += parenthetical.length ? `; ${parenthetical.join(', ')}).` : ').'
  sentences.push(s1)

  // 2. Recency.
  if (recency.medianYear != null) {
    let s2 = `Median publication year ${recency.medianYear}`
    if (recency.q1 != null && recency.q3 != null) {
      s2 += ` (IQR ${Math.round(recency.q1)}–${Math.round(recency.q3)})`
    }
    const last5 = pct(recency.shareLast5)
    if (last5) s2 += `, with ${last5} published in the last 5 years`
    s2 += '.'
    sentences.push(s2)
  }

  // 3. Open access.
  const oaPct = pct(oa.shareOpen)
  if (oaPct) sentences.push(`${oaPct} are open access.`)

  // 4. Top venue.
  if (venues.topVenue && venues.journalWorks > 0) {
    const share = pct(venues.topVenue.count / venues.journalWorks)
    const n = venues.topVenue.count
    sentences.push(
      `The most frequently cited venue is ${venues.topVenue.name} ` +
      `(${n} work${n === 1 ? '' : 's'}${share ? `, ${share}` : ''}).`,
    )
  }

  return sentences.join(' ')
}
