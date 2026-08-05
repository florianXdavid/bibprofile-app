// Feature 2 — Retraction check. Near-free: `is_retracted` is now in the default
// select (Step 0), so this makes NO new network calls — it just filters the
// cohort. Scope is deliberately light (OpenAlex's flag only; no Retraction Watch
// reason/date — see the README scope note).
//
// Wording stays neutral: a retracted work is flagged for the user to VERIFY, not
// ordered removed — people sometimes cite a retraction deliberately.

import { subset, type Cohort, type Stat } from './denominator'

export interface RetractionHit {
  citeKey: string
  bibTitle: string
  openalexId: string
  displayName: string
}

export interface RetractionReport extends Stat {
  hits: RetractionHit[]
  checked: number // works with a known is_retracted value (== n)
  unknown: number // works where OpenAlex reported no retraction flag
}

export function computeRetractions(cohort: Cohort): RetractionReport {
  const { used, n, flagged, excluded } = subset(
    cohort,
    w => typeof w.work.isRetracted === 'boolean',
    'no retraction data',
  )
  const hits: RetractionHit[] = used
    .filter(w => w.work.isRetracted === true)
    .map(w => ({
      citeKey: w.citeKey,
      bibTitle: w.title,
      openalexId: w.work.id,
      displayName: w.work.displayName,
    }))

  return {
    n, flagged, excluded,
    hits,
    checked: n,
    unknown: cohort.works.length - n,
  }
}
