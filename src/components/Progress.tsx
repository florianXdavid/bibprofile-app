import type { Progress as ProgressState } from '../types'

const STAGE_LABEL: Record<string, string> = {
  parsing: 'Parsing',
  doi: 'Matching by DOI',
  title: 'Searching by title',
  done: 'Done',
}

export default function Progress({ progress }: { progress: ProgressState }) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="progress">
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="meta">
        <div>
          <span className="stage-tag">{STAGE_LABEL[progress.stage] ?? progress.stage}</span>
          {/* wrap dynamic label in a stable element: it updates on every tick and sits
              beside the stage-tag <span>; a bare text node here is what Google Translate
              wraps and React later fails to removeChild (white-screen). */}
          <span>{progress.label}</span>
        </div>
        <div>
          {progress.total > 0 && <span>Matching {progress.done}/{progress.total} · </span>}
          <span>{progress.searchCalls} search call{progress.searchCalls === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}
