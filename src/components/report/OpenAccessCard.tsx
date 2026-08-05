// Card 4 — Open access. Share OA, a status breakdown, and an EXPLICIT count of
// works whose OA status OpenAlex didn't report — never folded into "closed".

import type { Cohort } from '../../lib/stats/denominator'
import { computeOpenAccess } from '../../lib/stats/openaccess'
import { getBaseline } from '../../lib/baselines'
import CardShell from './CardShell'
import { pct, plural } from './format'

const STATUS_LABEL: Record<string, string> = {
  gold: 'Gold (published open)',
  green: 'Green (self-archived)',
  hybrid: 'Hybrid',
  bronze: 'Bronze (free, no licence)',
  closed: 'Closed (paywalled)',
  other: 'Other',
}

export default function OpenAccessCard({ cohort, fieldId }: { cohort: Cohort; fieldId?: string | null }) {
  const oa = computeOpenAccess(cohort)
  const baseline = getBaseline(fieldId ?? '')
  const maxStatus = Math.max(...oa.breakdown.map(b => b.count), 1)

  return (
    <CardShell
      title="Open access"
      basis={oa}
      intro="How much of the cited work is freely readable."
    >
      {oa.n === 0 ? (
        <p className="muted">No matched works carry open-access data.</p>
      ) : (
        <>
          <p className="stat-headline">
            <strong>{pct(oa.shareOpen)}</strong> open access
            <span className="muted"> ({oa.openCount} of {oa.n} {plural(oa.n, 'work')} with known status)</span>
          </p>

          {baseline && (
            <p className="baseline-line">Typical for this field: {pct(baseline.pctOpenAccess / 100)} open access.</p>
          )}

          {oa.breakdown.length > 0 && (
            <table className="mini-breakdown">
              <tbody>
                {oa.breakdown.map(b => (
                  <tr key={b.status}>
                    <td className="mb-label">{STATUS_LABEL[b.status] ?? b.status}</td>
                    <td className="mb-bar">
                      <span className={`mb-fill oa-${b.status}`} style={{ width: `${(b.count / maxStatus) * 100}%` }} />
                    </td>
                    <td className="mb-val">{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {oa.unknownOa > 0 && (
            <p className="card-note">
              <strong>{oa.unknownOa}</strong> {plural(oa.unknownOa, 'work')} had no OA status reported —
              counted as unknown, not as closed.
            </p>
          )}

          {/* Hidden-by-default plain-language explainer (W3.2). */}
          <details className="oa-help">
            <summary>What do these mean?</summary>
            <ul>
              <li><strong>Gold</strong> — published open access in a fully open-access journal (e.g. PLOS ONE, Scientific Reports).</li>
              <li><strong>Green</strong> — a free version is in a repository (e.g. arXiv, PubMed Central, an institutional repository), even if the journal itself is paywalled.</li>
              <li><strong>Hybrid</strong> — open in an otherwise subscription journal, usually because a fee was paid to open that one article.</li>
              <li><strong>Bronze</strong> — free to read on the publisher's site but with no open licence, so reuse rights are unclear and it could be withdrawn.</li>
              <li><strong>Closed</strong> — no free version located; typically paywalled.</li>
            </ul>
            <p className="muted">These are OpenAlex's categories; they describe how and where an article is available, not its quality.</p>
          </details>
        </>
      )}
    </CardShell>
  )
}
