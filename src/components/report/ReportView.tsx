// The report: a vertical scroll of analysis cards built from the matched data.
// Order is deliberate — recency (the headline) first, duplicates last. Every
// card draws from one shared cohort so the denominator rules apply uniformly.

import { useMemo } from 'react'
import type { ResultRow } from '../../types'
import { buildCohort } from '../../lib/stats/denominator'
import type { CoCiteResult, ForwardResult, GapsRunState } from '../../lib/gaps'
import RecencyCard from './RecencyCard'
import ShapeCard from './ShapeCard'
import VenuesCard from './VenuesCard'
import SelfCitationCard from './SelfCitationCard'
import OpenAccessCard from './OpenAccessCard'
import RetractionsCard from './RetractionsCard'
import GapsCard from './GapsCard'
import PreprintsCard from './PreprintsCard'
import DuplicatesCard from './DuplicatesCard'
import type { PreprintRunState } from '../../lib/preprintResolve'
import type { CrossrefRunState } from '../../lib/crossref'

// The gaps card's billable results are owned by App (W3.1) and passed straight
// through — ReportView holds none of that state itself.
export interface GapsProps {
  co: GapsRunState<CoCiteResult>
  fw: GapsRunState<ForwardResult>
  onRunCoCitation: () => void
  onRunForward: () => void
}

interface Props {
  rows: ResultRow[]
  referenceYear: number
  gaps: GapsProps
  preprints: PreprintRunState
  onResolvePreprints: () => void
  crossref: CrossrefRunState // v1.4.2 — owned by App, fetched after matching
}

export default function ReportView({ rows, referenceYear, gaps, preprints, onResolvePreprints, crossref }: Props) {
  const cohort = useMemo(() => buildCohort(rows), [rows])

  if (cohort.works.length === 0) {
    return (
      <div className="report">
        <p className="muted" style={{ padding: '8px 2px' }}>
          Nothing matched OpenAlex, so there are no works to profile. The table view still
          shows every entry and why it didn't match.
        </p>
        <RetractionsCard rows={rows} crossref={crossref} />
        <DuplicatesCard rows={rows} />
      </div>
    )
  }

  return (
    <div className="report">
      <RecencyCard cohort={cohort} referenceYear={referenceYear} />
      <ShapeCard cohort={cohort} referenceYear={referenceYear} />
      <VenuesCard cohort={cohort} />
      <SelfCitationCard cohort={cohort} />
      <OpenAccessCard cohort={cohort} />
      <RetractionsCard rows={rows} crossref={crossref} />
      <GapsCard rows={rows} {...gaps} />
      <PreprintsCard rows={rows} preprints={preprints} onResolve={onResolvePreprints} />
      <DuplicatesCard rows={rows} />
    </div>
  )
}
