// Card 5 — Duplicates. Surfaces the de-duplication that already ran. Quiet when
// the list is clean; when it isn't, it names each duplicated work and every
// cite key pointing at it, and flags the merged-bibliography signature (the
// same work under two different cite-key styles).

import type { ResultRow } from '../../types'
import { computeDuplicateReport } from '../../lib/stats/duplicates'
import CardShell from './CardShell'
import { plural } from './format'

export default function DuplicatesCard({ rows }: { rows: ResultRow[] }) {
  const dup = computeDuplicateReport(rows)

  return (
    <CardShell
      title="Duplicates"
      intro="Works cited more than once, collapsed to one before analysis."
    >
      {dup.duplicatedWorks === 0 ? (
        <p className="muted">No duplicates found — every entry is a distinct work.</p>
      ) : (
        <>
          <p className="stat-headline">
            <strong>{dup.totalCollapsed}</strong> duplicate {plural(dup.totalCollapsed, 'entry', 'entries')} across{' '}
            <strong>{dup.duplicatedWorks}</strong> {plural(dup.duplicatedWorks, 'work')}.
          </p>

          {dup.mixedStyleGroups > 0 && (
            <p className="card-note warn">
              {dup.mixedStyleGroups} {plural(dup.mixedStyleGroups, 'work')} appear under mixed cite-key
              styles — often the sign of two bibliographies merged without de-duplication.
            </p>
          )}

          <ul className="dup-list">
            {dup.groups.map(g => (
              <li key={g.canonicalKey}>
                <span title={g.title} className="dup-title">{g.title}</span>
                {g.mixedKeyStyles && <span className="mixed-flag" title="mixed cite-key styles"> ⚠ mixed styles</span>}
                <div className="dup-keys">
                  {g.citeKeys.map(k => <span key={k} className="mono chip">{k}</span>)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </CardShell>
  )
}
