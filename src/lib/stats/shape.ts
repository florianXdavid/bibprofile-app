// Feature 1 — Reference-list shape. A sixth card, ZERO new network calls: it
// re-reads the publication-year data the recency card already holds and reuses
// the venue concentration the venues card already computes.
//
// The governing rule — descriptive, never evaluative — is hardest and matters
// most here, because "no foundational work" reads as a verdict. Every pattern is
// a neutral observation that points the user back at their own histogram. No
// scoring, no healthy/unhealthy, no baseline dependency.
//
// Patterns are gated behind SHAPE_MIN_N: detection on a tiny list is noise, so
// below the floor we surface nothing at all.

import { SHAPE_MIN_N, SHAPE_STALE_MONTHS } from '../../config'
import { withYear, type Cohort, type Stat } from './denominator'
import { computeVenues } from './venues'

export type ShapePatternKind = 'stale-tail' | 'narrow-window' | 'gap' | 'concentration'

export interface ShapePattern {
  kind: ShapePatternKind
  text: string // a plain, descriptive sentence
}

export interface ShapeStats extends Stat {
  patterns: ShapePattern[]
  belowFloor: boolean // n < SHAPE_MIN_N — nothing surfaced (not enough data)
  minN: number
}

// Tunables local to this card (not user-facing config).
const NARROW_SPAN_YEARS = 8 // all refs within this span -> "narrow window"
const GAP_MIN_YEARS = 6 // an empty run this long between clusters -> "gap"
const CONCENTRATION_SHARE = 0.25 // one venue >= this share of journal works

// Largest empty run between consecutive distinct years, and the years bracketing
// it. Returns null if there is no interior gap.
export function largestYearGap(years: number[]): { gap: number; before: number; after: number } | null {
  const distinct = [...new Set(years)].sort((a, b) => a - b)
  if (distinct.length < 2) return null
  let best: { gap: number; before: number; after: number } | null = null
  for (let i = 1; i < distinct.length; i++) {
    const gap = distinct[i] - distinct[i - 1]
    if (!best || gap > best.gap) best = { gap, before: distinct[i - 1], after: distinct[i] }
  }
  return best
}

export function computeShape(cohort: Cohort, referenceYear: number): ShapeStats {
  const { n, flagged, excluded } = withYear(cohort)
  const base: ShapeStats = {
    n, flagged, excluded, patterns: [], belowFloor: n < SHAPE_MIN_N, minN: SHAPE_MIN_N,
  }
  if (base.belowFloor) return base

  const years = cohort.works
    .map(w => w.work.publicationYear)
    .filter((y): y is number => typeof y === 'number')
    .sort((a, b) => a - b)
  if (years.length === 0) return base

  const oldest = years[0]
  const newest = years[years.length - 1]
  const span = newest - oldest
  const staleYears = Math.floor(SHAPE_STALE_MONTHS / 12)
  const patterns: ShapePattern[] = []

  // Stale tail — the most defensible pattern: a fact about the date range.
  if (referenceYear - newest >= staleYears) {
    patterns.push({
      kind: 'stale-tail',
      text: `The most recent reference is from ${newest}; nothing in the list is newer than that.`,
    })
  }

  // Narrow window / no older anchor — descriptive, no implied "should".
  if (span <= NARROW_SPAN_YEARS) {
    patterns.push({
      kind: 'narrow-window',
      text: `All references fall within a ${span + 1}-year window (${oldest}–${newest}); the oldest is from ${oldest}.`,
    })
  }

  // The gap — a visible hole between an older cluster and a recent one.
  const g = largestYearGap(years)
  if (g && g.gap >= GAP_MIN_YEARS) {
    patterns.push({
      kind: 'gap',
      text: `There is a ${g.gap}-year span with no references, between ${g.before} and ${g.after}.`,
    })
  }

  // Concentration — reference (reuse) the venues card's finding, don't re-derive.
  const venues = computeVenues(cohort)
  if (venues.topVenue && venues.journalWorks > 0) {
    const share = venues.topVenue.count / venues.journalWorks
    if (share >= CONCENTRATION_SHARE) {
      patterns.push({
        kind: 'concentration',
        text: `One venue, ${venues.topVenue.name}, accounts for ${Math.round(share * 100)}% of references that have a journal (${venues.topVenue.count} of ${venues.journalWorks}).`,
      })
    }
  }

  return { ...base, patterns }
}
