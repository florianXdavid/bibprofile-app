// Card 2 — Journal concentration. Top venues by count, top-3 share, distinct
// venue count, and the single most-cited venue.
//
// Grouping: works are keyed by OpenAlex `source.id` when present (so the same
// journal under variant display names collapses correctly), falling back to a
// normalised display name. Preprint servers (arXiv, bioRxiv, medRxiv, …) are
// separated from journals — they behave differently and would otherwise
// dominate the ranking.

import type { AnalysisWork } from './denominator'
import { subset, type Cohort, type Stat } from './denominator'

export interface VenueTally {
  key: string
  name: string
  count: number
  isPreprint: boolean
}

export interface VenueStats extends Stat {
  journals: VenueTally[] // non-preprint venues, count-desc
  preprints: VenueTally[] // preprint servers, count-desc
  distinctJournals: number
  journalWorks: number // works counted in the journal ranking
  preprintWorks: number
  top3Share: number | null // top-3 journals / journalWorks (0..1)
  topVenue: VenueTally | null // most-cited journal (the screenshot line)
}

// Known preprint / e-print servers (lowercased, substring match).
const PREPRINT_SERVERS = [
  'arxiv', 'biorxiv', 'medrxiv', 'chemrxiv', 'psyarxiv', 'techrxiv', 'engrxiv',
  'preprints.org', 'research square', 'researchsquare', 'ssrn', 'osf preprints',
  'authorea', 'preprint',
]

export function isPreprintVenue(name: string | null, sourceType: string | null): boolean {
  const n = (name ?? '').toLowerCase()
  if (PREPRINT_SERVERS.some(s => n.includes(s))) return true
  // A `repository`-typed source that also lacks a journal-ish name is treated
  // as preprint-like for this card's purpose.
  if (sourceType === 'repository' && n) return true
  return false
}

export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function groupKey(w: AnalysisWork): string {
  const src = w.work
  if (src.sourceId) return src.sourceId
  return 'name:' + normalizeVenueName(src.hostVenue as string)
}

export function computeVenues(cohort: Cohort): VenueStats {
  const { used, n, flagged, excluded } = subset(
    cohort,
    w => !!(w.work.hostVenue && w.work.hostVenue.trim()),
    'no venue',
  )

  const tallies = new Map<string, VenueTally>()
  for (const w of used) {
    const key = groupKey(w)
    const existing = tallies.get(key)
    if (existing) {
      existing.count++
    } else {
      tallies.set(key, {
        key,
        name: w.work.hostVenue as string,
        count: 1,
        isPreprint: isPreprintVenue(w.work.hostVenue, w.work.sourceType),
      })
    }
  }

  const all = [...tallies.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const journals = all.filter(v => !v.isPreprint)
  const preprints = all.filter(v => v.isPreprint)

  const journalWorks = journals.reduce((s, v) => s + v.count, 0)
  const preprintWorks = preprints.reduce((s, v) => s + v.count, 0)
  const top3 = journals.slice(0, 3).reduce((s, v) => s + v.count, 0)

  return {
    n, flagged, excluded,
    journals,
    preprints,
    distinctJournals: journals.length,
    journalWorks,
    preprintWorks,
    top3Share: journalWorks > 0 ? top3 / journalWorks : null,
    topVenue: journals[0] ?? null,
  }
}
