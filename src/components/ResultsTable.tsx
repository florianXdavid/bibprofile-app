import { useMemo, useState } from 'react'
import type { MatchSignals, MatchStatus, ResultRow } from '../types'
import type { CrossrefRunState } from '../lib/crossref'
import { computeRetractions } from '../lib/stats/retractions'
import { normalizeDoi } from '../lib/doi'
import { cleanVenue } from '../lib/stats/venues'

type SortDir = 'asc' | 'desc'
type Primitive = string | number | null
type Filter = 'all' | 'duplicates' | MatchStatus

interface Column {
  key: string
  label: string
  numeric?: boolean
  get: (r: ResultRow) => Primitive
  cell: (r: ResultRow) => React.ReactNode
}

function shortId(id: string | null): string {
  if (!id) return ''
  return id.replace(/^https?:\/\/openalex\.org\//, '')
}

function yesNo(v: boolean | null): string {
  if (v === null) return ''
  return v ? 'Yes' : 'No'
}

// v1.4.1 — tooltip for the match score: the per-signal breakdown (— = not compared).
function signalsTitle(s: MatchSignals | null | undefined): string {
  const base = 'match score (0–1): title, first author, year ±1, venue, type, volume/pages'
  if (!s) return base
  const f = (v: number | null) => (v == null ? '—' : v.toFixed(2))
  return `${base}\ntitle ${f(s.title)} · author ${f(s.author)} · year ${f(s.year)} · venue ${f(s.venue)} · type ${f(s.type)} · vol/pages ${f(s.biblio)}`
}

// v1.4.5 (H3): a duplicate CITE KEY points to its first copy, never to "itself".
function dupLabel(r: ResultRow): string | null {
  if (!r.duplicateOf) return null
  return r.duplicateOf === r.citeKey ? `${r.citeKey} (copy #1)` : r.duplicateOf
}

const STATUS_ORDER: MatchStatus[] = [
  'matched-by-doi', 'matched-by-title', 'suspicious', 'uncertain',
  'not-found', 'not-indexable', 'error', 'unparseable',
]

const columns: Column[] = [
  {
    key: 'citeKey', label: 'Cite key',
    get: r => r.citeKey,
    cell: r => (
      <span title={r.citeKey}>
        {r.citeKey}
        {r.entry?.dupKeyIndex != null && (
          <span className="flag" title="This cite key occurs more than once — BibTeX uses copy #1 and ignores the others"> #{r.entry.dupKeyIndex} duplicate key</span>
        )}
        {r.duplicateOf && (
          <span className="dup" title={`duplicate of ${dupLabel(r)}`}> ↳ dup of {dupLabel(r)}</span>
        )}
      </span>
    ),
  },
  {
    key: 'title', label: 'Title (.bib)',
    get: r => r.title,
    cell: r => <span className="title-cell" title={r.title}>{r.title}</span>,
  },
  {
    key: 'bibYear', label: 'Yr (.bib)', numeric: true,
    get: r => r.bibYear,
    cell: r => r.bibYear ?? <span className="muted">—</span>,
  },
  {
    key: 'status', label: 'Status',
    get: r => r.status,
    cell: r => (
      <>
        <span className={`badge ${r.status}`}>{r.status}</span>
        {r.matchScore != null && (
          <span
            className={r.status === 'suspicious' || r.status === 'uncertain' ? 'flag' : 'muted'}
            title={signalsTitle(r.matchSignals) + (r.matchedVia === 'crossref' ? '\nfound via Crossref, record from OpenAlex by DOI' : '')}
          > {r.matchScore.toFixed(2)}</span>
        )}
        {r.preprintVersion && <span className="dup" title="Cited as a journal / proceedings paper; matched to its preprint record (the only one indexed)"> preprint version</span>}
        {(r.notes?.length ?? 0) > 0 && <span className="note-mark" title={r.notes!.join('\n')}> ⓘ</span>}
      </>
    ),
  },
  {
    key: 'openalexId', label: 'OpenAlex ID',
    get: r => shortId(r.openalex?.id ?? null),
    cell: r => r.openalex?.id
      ? <a href={r.openalex.id} target="_blank" rel="noreferrer">{shortId(r.openalex.id)}</a>
      : <span className="muted">—</span>,
  },
  {
    key: 'oaYear', label: 'Yr (OA)', numeric: true,
    get: r => r.openalex?.publicationYear ?? null,
    cell: r => {
      if (!r.openalex) return <span className="muted">—</span>
      return (
        <>
          {r.openalex.publicationYear ?? <span className="muted">—</span>}
          {r.yearState === 'disagree' && (
            <span
              className="flag"
              title={`.bib year ${r.bibYear} ≠ OpenAlex year ${r.openalex.publicationYear}`}
            > &#9888;</span>
          )}
          {r.yearState === 'unverified' && (
            <span
              className="year-unverified"
              title="year unverified — missing on the .bib or OpenAlex side; not treated as agreement"
            > ?</span>
          )}
        </>
      )
    },
  },
  {
    // v1.4.6 (F11): cleaned names (CVPR's doubled name, PubMed / eBooks dropped)
    key: 'hostVenue', label: 'Host venue (OA)',
    get: r => cleanVenue(r.openalex?.hostVenue),
    cell: r => cleanVenue(r.openalex?.hostVenue)
      ? <span className="title-cell" title={r.openalex!.hostVenue!}>{cleanVenue(r.openalex?.hostVenue)}</span>
      : <span className="muted">—</span>,
  },
  {
    key: 'citedBy', label: 'Cited by', numeric: true,
    get: r => r.openalex?.citedByCount ?? null,
    cell: r => r.openalex?.citedByCount ?? <span className="muted">—</span>,
  },
  {
    key: 'isOa', label: 'OA',
    get: r => (r.openalex?.isOa == null ? null : (r.openalex.isOa ? 1 : 0)),
    cell: r => r.openalex ? yesNo(r.openalex.isOa) : <span className="muted">—</span>,
  },
  {
    key: 'type', label: 'Type (OA)',
    get: r => r.openalex?.type ?? null,
    cell: r => r.openalex?.type ?? <span className="muted">—</span>,
  },
  {
    key: 'topic', label: 'Primary topic (OA)',
    get: r => r.openalex?.primaryTopic ?? null,
    cell: r => r.openalex?.primaryTopic
      ? <span className="title-cell" title={r.openalex.primaryTopic}>{r.openalex.primaryTopic}</span>
      : ((r.status === 'unparseable' || r.status === 'error') && r.error
          ? <span className="err-text" title={r.error}>{r.error}</span>
          : <span className="muted">—</span>),
  },
]

function compare(a: Primitive, b: Primitive, numeric: boolean): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (numeric) return Number(a) - Number(b)
  return String(a).localeCompare(String(b))
}

export default function ResultsTable({ rows, crossref }: { rows: ResultRow[]; crossref?: CrossrefRunState }) {
  const [sortKey, setSortKey] = useState<string>('') // '' = original .bib file order (Fix A5)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filter, setFilter] = useState<Filter>('all')

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])
  const dupCount = useMemo(() => rows.filter(r => r.duplicateOf).length, [rows])

  const visible = useMemo(() => {
    let filtered = rows
    if (filter === 'duplicates') filtered = rows.filter(r => r.duplicateOf)
    else if (filter !== 'all') filtered = rows.filter(r => r.status === filter)
    const col = columns.find(c => c.key === sortKey)
    if (!col) return filtered
    const sorted = [...filtered].sort((ra, rb) => compare(col.get(ra), col.get(rb), !!col.numeric))
    return sortDir === 'asc' ? sorted : sorted.reverse()
  }, [rows, filter, sortKey, sortDir])

  function onHeader(key: string) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  // 1f (v1.3) — export the CURRENT (filtered + sorted) view as CSV. No dependency:
  // a quoted/escaped Blob download with a UTF-8 BOM so Excel opens it correctly.
  function exportCsv() {
    const esc = (v: Primitive) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    // v1.4.1 hotfix: the on-screen "dup of …" tag lives in the cite-key cell's
    // markup only, so the CSV gets an explicit column for it. v1.4.2 patch: likewise
    // the error message (shown on screen in the topic cell of error rows).
    // v1.4.5 (M6): enough to audit a run — appended, so existing columns keep their place.
    const retracted = new Map(computeRetractions(rows, crossref?.status === 'done' ? crossref.result : null)
      .retracted.map(f => [f.rowId, f.signals.join(' + ')]))
    const header = [...columns.map(c => esc(c.label)), 'Duplicate of', 'Error',
      'Match score', 'OpenAlex DOI', 'OpenAlex title', 'Notes', 'Retracted', 'Preprint version', 'Identified by'].join(',')
    const body = visible.map(r => [
      ...columns.map(c => esc(c.get(r))), esc(dupLabel(r)), esc(r.error),
      esc(r.matchScore), esc(r.openalex?.doi ? normalizeDoi(r.openalex.doi) : null), esc(r.openalex?.displayName ?? null),
      esc((r.notes ?? []).join(' | ') || null), esc(retracted.has(r.rowId) ? `yes (${retracted.get(r.rowId)})` : (r.openalex ? 'no' : null)),
      esc(r.preprintVersion ? 'yes' : null), esc(r.idSource ?? null),
    ].join(',')).join('\n')
    const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bibprofile-table.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="filters" style={{ margin: '10px 0 12px' }}>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All ({rows.length})
        </button>
        {STATUS_ORDER.filter(s => counts[s]).map(s => (
          <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
            {s} ({counts[s]})
          </button>
        ))}
        {dupCount > 0 && (
          <button className={filter === 'duplicates' ? 'active' : ''} onClick={() => setFilter('duplicates')}>
            duplicates ({dupCount})
          </button>
        )}
      </div>

      <div className="table-toolbar" style={{ margin: '0 0 12px' }}>
        <button type="button" onClick={exportCsv}>Export CSV</button>
        <span className="muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>{visible.length} row{visible.length === 1 ? '' : 's'} (current view)</span>
      </div>

      {/* Hidden-by-default explainer for the match statuses (W4.2). */}
      <details className="oa-help" style={{ margin: '0 0 12px' }}>
        <summary>What do the statuses mean?</summary>
        <ul>
          <li><strong>matched-by-doi</strong> — matched via its DOI, or another identifier the entry carries (an arXiv ID, a PMID, a DOI in <code>url</code> or <code>note</code> — see “Identified by” in the CSV).</li>
          <li><strong>matched-by-title</strong> — no usable DOI; matched by a title search that cleared the similarity bar.</li>
          <li><strong>suspicious</strong> — matched by DOI, but the OpenAlex record disagrees with your entry (title, or several details at once) — shown for you to judge (often a wrong <code>.bib</code> DOI, sometimes a real work with truncated metadata).</li>
          <li><strong>uncertain</strong> — no usable DOI; a title search found a likely candidate, but not confidently (weak overall score, or two different works scored almost the same) — shown for you to judge, never written to the cleaned <code>.bib</code>.</li>
          <li><strong>not-found</strong> — looked up, but OpenAlex has no acceptable record. Not proof that the work doesn't exist: OpenAlex misses some works (recent conference papers, translations, old editions), and some of its records are corrupt.</li>
          <li><strong>not-indexable</strong> — not the kind of record OpenAlex indexes (a dataset, a software library, a URL used as a title).</li>
          <li><strong>error</strong> — a network or server failure after one retry.</li>
          <li><strong>unparseable</strong> — the <code>.bib</code> block couldn't be turned into a usable record.</li>
          <li><strong>duplicates</strong> — the same work cited more than once (same DOI, or the same OpenAlex record); collapsed to one before analysis (tagged “dup of …”).</li>
        </ul>
        <p className="muted">ⓘ marks a row with notes — why it is flagged, where its identifier was found, or a hint (hover it; also in the CSV). “preprint version” = cited as a journal or proceedings paper, but only its preprint is indexed.</p>
        <p className="muted">The number after the status is the match score (0–1), combining title, first author, year (±1), venue, entry type and volume/pages — hover it for the breakdown. The “Yr (OA)” column also shows ⚠ when the <code>.bib</code> year and the OpenAlex year disagree, and ? when a year is missing on either side.</p>
      </details>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key} onClick={() => onHeader(col.key)}>
                  {col.label}
                  {sortKey === col.key && <span className="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.rowId}>
                {columns.map(col => (
                  <td key={col.key} className={col.numeric ? 'num' : (col.key === 'title' ? 'title' : '')}>
                    {col.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={columns.length} className="muted" style={{ textAlign: 'center', padding: 20 }}>No rows for this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
