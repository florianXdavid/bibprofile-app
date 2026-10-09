import type { MatchSummary } from '../types'

// Being honest about misses is a product principle, not an afterthought.
export default function Summary({ summary, fileName }: { summary: MatchSummary; fileName?: string }) {
  const matched = summary.matchedByDoi + summary.matchedByTitle
  const parseable = summary.total - summary.unparseable

  const notes: string[] = []
  if (summary.suspicious) notes.push(`${summary.suspicious} suspicious (DOI record disagrees)`)
  if (summary.uncertain) notes.push(`${summary.uncertain} uncertain (title match below confidence)`)
  if (summary.notFound) notes.push(`${summary.notFound} not found`)
  if (summary.notIndexable) notes.push(`${summary.notIndexable} not indexable`)
  if (summary.errored) notes.push(`${summary.errored} errored`)
  if (summary.unparseable) notes.push(`${summary.unparseable} unparseable`)

  return (
    <div className="summary">
      {fileName && <p className="cost" style={{ marginTop: 0 }}>File: <strong>{fileName}</strong></p>}
      <p className="headline">
        Matched <strong>{matched}</strong> of <strong>{parseable}</strong> parseable entries
        {' '}<span>({summary.matchedByDoi} by DOI, {summary.matchedByTitle} by title).</span>
        {notes.length > 0 && <span> {notes.join(', ')}.</span>}
      </p>
      {summary.duplicates > 0 && (
        <p className="cost">
          <strong>{summary.duplicates}</strong> duplicate entr{summary.duplicates === 1 ? 'y' : 'ies'} collapsed
          before querying (kept in the table, tagged “dup of …”).
        </p>
      )}
      <p className="cost">
        Title searches used <strong>{summary.searchCalls}</strong> billable OpenAlex search call
        {summary.searchCalls === 1 ? '' : 's'} (~${summary.searchCostUsd.toFixed(3)} of daily allowance).
        DOI lookups are free singletons.
      </p>
    </div>
  )
}
