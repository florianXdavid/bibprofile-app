// Card 3 — Self-citation. Counts how many references are by a given author —
// the user's own work, or ANY author they enter. Always open (W4.2). Matched
// references are shown explicitly (not just a number) so the user can verify and
// dismiss false positives — especially in name-only mode, which is inherently fuzzy.

import { useMemo, useState } from 'react'
import type { Cohort } from '../../lib/stats/denominator'
import { findSelfCitations, type SelfCiteQuery } from '../../lib/stats/selfCitation'
import CardShell from './CardShell'
import { pct, plural } from './format'

export default function SelfCitationCard({ cohort }: { cohort: Cohort }) {
  const [name, setName] = useState('')
  const [orcid, setOrcid] = useState('')
  const [query, setQuery] = useState<SelfCiteQuery | null>(null)

  const result = useMemo(
    () => (query ? findSelfCitations(cohort, query) : null),
    [cohort, query],
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() && !orcid.trim()) { setQuery(null); return }
    setQuery({ name, orcid })
  }

  return (
    <CardShell
      title="Self-citation"
      intro="How many references are by a given author — your own work, or any author you want to check. ORCID is exact; a name is matched on surname + first initial, so review the results."
    >
      <form className="selfcite-form" onSubmit={submit}>
        <label>
          Name
          <input type="text" value={name} placeholder="e.g. Emanuel Todorov"
            onChange={e => setName(e.target.value)} />
        </label>
        <label>
          ORCID <span className="muted">(optional, more reliable)</span>
          <input type="text" value={orcid} placeholder="0000-0002-1825-0097"
            onChange={e => setOrcid(e.target.value)} />
        </label>
        <button type="submit" className="primary">Check</button>
      </form>

      {result && (
        result.via == null ? (
          <p className="muted">Enter a name or ORCID above, then Check.</p>
        ) : (
          <>
            <p className="stat-headline">
              <strong>{result.selfCount}</strong> self-citation{result.selfCount === 1 ? '' : 's'}
              {result.share != null && <span className="muted"> ({pct(result.share)} of {result.n} searchable {plural(result.n, 'work')})</span>}
              <span className="muted"> — matched by {result.via === 'orcid' ? 'ORCID' : 'name'}</span>
            </p>

            {result.matches.length > 0 ? (
              <ul className="selfcite-list">
                {result.matches.map(m => (
                  <li key={m.citeKey}>
                    <span className="mono">{m.citeKey}</span> — <span title={m.title}>{m.title}</span>
                    <span className="muted"> · matched author: {m.matchedAuthor}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No references matched.</p>
            )}

            {result.noAuthorData > 0 && (
              <p className="card-note">
                {result.noAuthorData} {plural(result.noAuthorData, 'work')} had no author data to search.
              </p>
            )}
          </>
        )
      )}
    </CardShell>
  )
}
