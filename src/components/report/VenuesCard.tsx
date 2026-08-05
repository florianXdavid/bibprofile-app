// Card 2 — Journal concentration. Top venues, top-3 share, distinct count, and
// the single most-cited venue called out prominently. Preprint servers are
// reported separately from journals.

import type { Cohort } from '../../lib/stats/denominator'
import { computeVenues } from '../../lib/stats/venues'
import CardShell from './CardShell'
import BarChart, { type BarItem } from './BarChart'
import { pct, plural } from './format'

export default function VenuesCard({ cohort }: { cohort: Cohort }) {
  const v = computeVenues(cohort)

  const bars: BarItem[] = v.journals.slice(0, 10).map((t, i) => ({
    label: t.name,
    value: t.count,
    emphasis: i === 0,
  }))

  return (
    <CardShell
      title="Journal concentration"
      basis={v}
      intro="Which venues the references cluster in."
    >
      {v.topVenue ? (
        <>
          <p className="stat-headline">
            Most cited: <strong>{v.topVenue.name}</strong>
            {' — '}{v.topVenue.count} of {v.journalWorks} {plural(v.journalWorks, 'work')}
            {v.journalWorks > 0 && <span className="muted"> ({pct(v.topVenue.count / v.journalWorks)})</span>}
          </p>

          <div className="stat-row">
            <div className="stat-cell">
              <span className="stat-big">{pct(v.top3Share)}</span>
              <span className="stat-label">in the top 3 venues</span>
            </div>
            <div className="stat-cell">
              <span className="stat-big">{v.distinctJournals}</span>
              <span className="stat-label">distinct venues</span>
            </div>
          </div>

          <BarChart items={bars} />

          {v.preprintWorks > 0 && (
            <p className="card-note">
              Plus <strong>{v.preprintWorks}</strong> {plural(v.preprintWorks, 'reference')} on preprint
              servers ({v.preprints.slice(0, 4).map(p => p.name).join(', ')}
              {v.preprints.length > 4 ? ', …' : ''}), counted separately from journals.
            </p>
          )}
        </>
      ) : (
        <p className="muted">No matched works carry a venue name.</p>
      )}
    </CardShell>
  )
}
