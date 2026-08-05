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
          {progress.label}
        </div>
        <div>
          {progress.total > 0 && <>Matching {progress.done}/{progress.total} · </>}
          {progress.searchCalls} search call{progress.searchCalls === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  )
}
