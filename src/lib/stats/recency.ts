// Card 1 — Recency profile. Median publication year + IQR, share from the last
// 5 / 10 years, the oldest and newest reference (named), and a year histogram.
//
// "Last N years" is an INCLUSIVE window ending at the reference year: for N=5
// and referenceYear=2026 that is 2022–2026. The reference year is injected so
// this is deterministic and unit-testable (the UI passes the current year).

import type { AnalysisWork } from './denominator'
import { citedYear, withYear, type Cohort, type Stat } from './denominator'

export interface DatedRef {
  citeKey: string
  title: string
  year: number
}

export interface HistogramBin {
  from: number
  to: number // inclusive
  label: string
  count: number
}

export interface RecencyStats extends Stat {
  medianYear: number | null
  q1: number | null
  q3: number | null
  shareLast5: number | null // 0..1
  shareLast10: number | null // 0..1
  oldest: DatedRef | null
  newest: DatedRef | null
  bins: HistogramBin[]
  binSize: 1 | 2
}

// Median of an already-sorted numeric array.
export function median(sortedAsc: number[]): number | null {
  const n = sortedAsc.length
  if (n === 0) return null
  const mid = Math.floor(n / 2)
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
}

// Linear-interpolation quantile (same convention as numpy's default), on a
// sorted-ascending array. Used for the IQR (q=0.25, 0.75).
export function quantile(sortedAsc: number[], q: number): number | null {
  const n = sortedAsc.length
  if (n === 0) return null
  if (n === 1) return sortedAsc[0]
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (pos - lo) * (sortedAsc[hi] - sortedAsc[lo])
}

// Share of `years` within the inclusive N-year window ending at referenceYear.
export function shareWithinLast(years: number[], n: number, referenceYear: number): number | null {
  if (years.length === 0) return null
  const cutoff = referenceYear - n + 1
  return years.filter(y => y >= cutoff).length / years.length
}

function buildBins(years: number[]): { bins: HistogramBin[]; binSize: 1 | 2 } {
  const min = Math.min(...years)
  const max = Math.max(...years)
  const span = max - min
  // One bar per year for a tight span; 2-year bins once it would get crowded.
  const binSize: 1 | 2 = span <= 24 ? 1 : 2
  const start = binSize === 1 ? min : min - (min % 2) // align 2-year bins to even years
  const bins: HistogramBin[] = []
  for (let from = start; from <= max; from += binSize) {
    const to = from + binSize - 1
    const count = years.filter(y => y >= from && y <= to).length
    bins.push({
      from,
      to,
      label: binSize === 1 ? String(from) : `${from}–${to}`,
      count,
    })
  }
  return { bins, binSize }
}

export function computeRecency(cohort: Cohort, referenceYear: number): RecencyStats {
  const { used, n, flagged, excluded } = withYear(cohort)
  const base: RecencyStats = {
    n, flagged, excluded,
    medianYear: null, q1: null, q3: null,
    shareLast5: null, shareLast10: null,
    oldest: null, newest: null, bins: [], binSize: 1,
  }
  if (used.length === 0) return base

  const years = used.map(w => citedYear(w) as number).sort((a, b) => a - b)
  const { bins, binSize } = buildBins(years)

  const named = (target: number): DatedRef => {
    const w = used.find(u => citedYear(u) === target) as AnalysisWork
    return { citeKey: w.citeKey, title: w.title, year: target }
  }

  return {
    ...base,
    medianYear: median(years),
    q1: quantile(years, 0.25),
    q3: quantile(years, 0.75),
    shareLast5: shareWithinLast(years, 5, referenceYear),
    shareLast10: shareWithinLast(years, 10, referenceYear),
    oldest: named(years[0]),
    newest: named(years[years.length - 1]),
    bins,
    binSize,
  }
}
