import { useMemo, useState } from 'react'
import FileDrop from './components/FileDrop'
import Progress from './components/Progress'
import Summary from './components/Summary'
import ResultsTable from './components/ResultsTable'
import ReportView from './components/report/ReportView'
import CleanedExport from './components/report/CleanedExport'
import KeyControl from './components/KeyControl'
import UsageIndicator, { type UsageState } from './components/UsageIndicator'
import About from './components/About'
import { parseBib } from './lib/parseBib'
import { mergeRows, runMatching, summarize } from './lib/match'
import { byteLength, checkBibEntryCount, checkBibSize } from './lib/validateBib'
import { buildCohort } from './lib/stats/denominator'
import { buildSummaryText } from './lib/stats/summaryText'
import {
  runCoCitation,
  runForwardCitation,
  type CoCiteResult,
  type ForwardResult,
  type GapsRunState,
} from './lib/gaps'
import { runPreprintResolution, type PreprintRunState } from './lib/preprintResolve'
import { fetchRateLimit, OpenAlexAuthError, OpenAlexBudgetError } from './lib/openalex'
import { resolveCredential, type UserCredential } from './lib/credential'
import { formatResetClockUtc } from './lib/rateLimit'
import { OPENALEX_API_KEY, OPENALEX_BASE_URL } from './config'
import type { MatchSummary, Progress as ProgressState, ResultRow } from './types'

type Phase = 'idle' | 'working' | 'done'
type View = 'report' | 'cleaned' | 'table'

const INITIAL_PROGRESS: ProgressState = {
  stage: 'idle', label: '', done: 0, total: 0, searchCalls: 0,
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS)
  const [rows, setRows] = useState<ResultRow[]>([])
  const [summary, setSummary] = useState<MatchSummary | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [notice, setNotice] = useState<string>('')
  const [view, setView] = useState<View>('report')
  const [copied, setCopied] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false) // W4.2 — About panel toggle
  const [sourceText, setSourceText] = useState<string>('') // original .bib text (cleaned export)

  // W3.1 — billable results live HERE, above the Report/Cleaned/Table toggle, so
  // switching tabs (which unmounts the inactive view) never discards them and
  // never re-triggers the paid OpenAlex calls. Cleared only on a new upload,
  // hung on the same reset as the core matched data — one invalidation path.
  const [gapsCo, setGapsCo] = useState<GapsRunState<CoCiteResult>>({ status: 'idle' })
  const [gapsFw, setGapsFw] = useState<GapsRunState<ForwardResult>>({ status: 'idle' })
  const [preprints, setPreprints] = useState<PreprintRunState>({ status: 'idle' })

  // W4 — the user's OWN OpenAlex key (opt-in). In-memory ONLY: dies on reload,
  // never persisted anywhere. null = the shared pool (default). `keyError` holds
  // an auth-rejection message shown inline by KeyControl.
  const [userKey, setUserKey] = useState<UserCredential | null>(null)
  const [keyError, setKeyError] = useState<string>('')
  // W4.1 — user-key usage readout, and the shared-pool exhaustion state.
  const [usage, setUsage] = useState<UsageState>({ status: 'shared' })
  const [exhausted, setExhausted] = useState<{ resetsAt: string | null; kind: 'shared' | 'user' } | null>(null)

  // Read a credential's usage — USER KEY ONLY (the fetcher refuses to read the
  // shared key). Never blocks; any failure degrades to 'unavailable'.
  async function refreshUsageFor(uc: UserCredential | null) {
    const cred = resolveCredential(uc)
    if (cred.kind !== 'user') { setUsage({ status: 'shared' }); return }
    setUsage({ status: 'loading' })
    const res = await fetchRateLimit(cred)
    setUsage(res.kind === 'ok' ? { status: 'ok', usage: res.usage } : { status: 'unavailable' })
  }

  // Surface an OpenAlex auth rejection. With a user key we say so and offer Clear
  // (never silently fall back to the shared key); on the shared path it's ours.
  function reportAuthError() {
    if (userKey) setKeyError('That key was rejected by OpenAlex. Check it, or clear it to return to the shared pool.')
    else setNotice('OpenAlex rejected the request. Please try again shortly.')
  }
  function applyUserKey(apiKey: string) {
    const uc = { apiKey, mailto: '' } // mailto input removed (W4.2); polite-pool contact is optional
    setUserKey(uc)
    setKeyError('')
    setNotice('')
    void refreshUsageFor(uc) // fetch usage immediately with the new key
  }
  function clearUserKey() {
    setUserKey(null) // actually drops the in-memory secret
    setKeyError('')
    setUsage({ status: 'shared' })
  }

  async function run(text: string, name: string) {
    setPhase('working')
    setRows([])
    setSummary(null)
    setNotice('')
    setCopied(false)
    setFileName(name)
    setSourceText(text)
    // Single invalidation path: a new .bib clears the lifted billable results
    // alongside the core matched data, so they can never show against the wrong file.
    setGapsCo({ status: 'idle' })
    setGapsFw({ status: 'idle' })
    setPreprints({ status: 'idle' })
    setExhausted(null) // W4.1 — a fresh run clears any prior exhaustion banner
    setProgress({ stage: 'parsing', label: 'Parsing .bib…', done: 0, total: 0, searchCalls: 0 })

    // Gate 1 (W3.2): file size — BEFORE the parser is invoked.
    const sizeCheck = checkBibSize(byteLength(text))
    if (!sizeCheck.ok) {
      setNotice(sizeCheck.message!)
      setPhase('idle')
      return
    }

    // Let the "Parsing" frame paint before the (synchronous) parse runs.
    await new Promise(r => setTimeout(r, 0))
    const parsed = parseBib(text)
    setWarnings(parsed.warnings)

    // Gate 2 (W3.2): parsed-entry count — AFTER parse, BEFORE any lookup fires.
    const countCheck = checkBibEntryCount(parsed.entries.length)
    if (!countCheck.ok) {
      setNotice(countCheck.message!)
      setPhase('idle')
      return
    }

    if (parsed.entries.length === 0 && parsed.unparseable.length === 0) {
      setNotice('No BibTeX entries found in that file.')
      setPhase('idle')
      return
    }

    // W4 — resolve the active credential (shared by default; the user's own key
    // if set). The fetch layer consumes it; an auth rejection is surfaced, never
    // silently switched to the shared key.
    try {
      const cred = resolveCredential(userKey)
      const { rows: resultRows, summary: resultSummary, exhausted: ex } = await runMatching(parsed, setProgress, cred)
      setRows(resultRows)
      setSummary(resultSummary)
      setPhase('done')
      // W4.1 — a budget halt keeps partial results; the rest stay pending.
      setExhausted(ex ? { resetsAt: ex.resetsAt, kind: cred.kind } : null)
      void refreshUsageFor(userKey)
    } catch (e) {
      if (e instanceof OpenAlexAuthError) reportAuthError()
      else setNotice('Something went wrong reaching OpenAlex. Please try again.')
      setPhase('idle')
    }
  }

  // W4.1 — Resume re-queries ONLY the still-pending entries on the current
  // credential (typically the user's key just set), then merges them back. The
  // already-matched entries are never re-queried — no wasted budget, no lost work.
  async function handleResume() {
    const cred = resolveCredential(userKey)
    if (cred.kind !== 'user') return // Resume needs a user key
    const pendingEntries = rows.filter(r => r.status === 'pending' && r.entry).map(r => r.entry!)
    if (pendingEntries.length === 0) { setExhausted(null); return }
    setPhase('working')
    setNotice('')
    setProgress({ stage: 'parsing', label: 'Resuming…', done: 0, total: pendingEntries.length, searchCalls: 0 })
    try {
      const sub = { entries: pendingEntries, unparseable: [], warnings: [] }
      const { rows: resumedRows, summary: subSummary, exhausted: ex } = await runMatching(sub, setProgress, cred)
      const merged = mergeRows(rows, resumedRows)
      setRows(merged)
      setSummary(summarize(merged, (summary?.searchCalls ?? 0) + subSummary.searchCalls))
      setExhausted(ex ? { resetsAt: ex.resetsAt, kind: cred.kind } : null)
      setPhase('done')
      void refreshUsageFor(userKey)
    } catch (e) {
      if (e instanceof OpenAlexAuthError) reportAuthError()
      else setNotice('Something went wrong reaching OpenAlex. Please try again.')
      setPhase('done') // keep the partial results visible
    }
  }

  function exportJson() {
    const payload = {
      source: fileName || 'bibtex',
      generatedAt: new Date().toISOString(),
      openalexBaseUrl: OPENALEX_BASE_URL,
      summary,
      rows: rows.map(r => ({
        citeKey: r.citeKey,
        status: r.status,
        duplicateOf: r.duplicateOf,
        entryType: r.entry?.entryType ?? null,
        bib: r.entry ? {
          title: r.entry.title,
          titleForSearch: r.entry.titleForSearch,
          year: r.entry.year,
          authors: r.entry.authors,
          venue: r.entry.venue,
          doi: r.entry.doi,
          doiRaw: r.entry.doiRaw,
          likelyNotIndexable: r.entry.likelyNotIndexable,
        } : null,
        matchScore: r.matchScore,
        yearState: r.yearState,
        openalex: r.openalex,
        error: r.error,
        raw: r.status === 'unparseable' ? r.raw : undefined,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = fileName.replace(/\.[^.]+$/, '') || 'bibprofile'
    a.href = url
    a.download = `${base}-bibprofile.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Plain-text one-paragraph summary for pasting into a methods section / email.
  const referenceYear = useMemo(() => new Date().getFullYear(), [])
  async function copySummary() {
    const text = buildSummaryText(buildCohort(rows), referenceYear)
    const flash = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    try {
      await navigator.clipboard.writeText(text)
      flash()
    } catch {
      // Clipboard API can be unavailable in a non-secure context; fall back so
      // the button still works when running the built site over plain http.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); flash() } catch { setNotice('Could not copy to clipboard.') }
      document.body.removeChild(ta)
    }
  }

  // W3.1 — the parent-owned triggers. The presentational cards call these; the
  // results land in parent state and survive tab switches.
  // W4.1 — a budget halt mid-gaps/forward/preprint shows the same exhaustion
  // banner and stops cleanly (these spend too), rather than erroring out.
  function onBudget(e: OpenAlexBudgetError) {
    setExhausted({ resetsAt: e.resetsAt, kind: resolveCredential(userKey).kind })
  }
  async function handleCoCitation() {
    setGapsCo({ status: 'running', progress: { phase: 'refs', done: 0, total: 0, billableCalls: 0, label: 'Starting…' } })
    try {
      const result = await runCoCitation(rows, p => setGapsCo({ status: 'running', progress: p }), resolveCredential(userKey))
      setGapsCo({ status: 'done', result })
      void refreshUsageFor(userKey)
    } catch (e) {
      if (e instanceof OpenAlexBudgetError) { onBudget(e); setGapsCo({ status: 'idle' }) }
      else if (e instanceof OpenAlexAuthError) { reportAuthError(); setGapsCo({ status: 'idle' }) }
      else setGapsCo({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }
  async function handleForward() {
    setGapsFw({ status: 'running', progress: { phase: 'forward', done: 0, total: 0, billableCalls: 0, label: 'Starting…' } })
    try {
      const result = await runForwardCitation(rows, p => setGapsFw({ status: 'running', progress: p }), resolveCredential(userKey))
      setGapsFw({ status: 'done', result })
      void refreshUsageFor(userKey)
    } catch (e) {
      if (e instanceof OpenAlexBudgetError) { onBudget(e); setGapsFw({ status: 'idle' }) }
      else if (e instanceof OpenAlexAuthError) { reportAuthError(); setGapsFw({ status: 'idle' }) }
      else setGapsFw({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }
  async function handleResolvePreprints() {
    setPreprints({ status: 'running', progress: { done: 0, total: 0, label: 'Starting…' } })
    try {
      const result = await runPreprintResolution(rows, p => setPreprints({ status: 'running', progress: p }), resolveCredential(userKey))
      setPreprints({ status: 'done', result })
      void refreshUsageFor(userKey)
    } catch (e) {
      if (e instanceof OpenAlexBudgetError) { onBudget(e); setPreprints({ status: 'idle' }) }
      else if (e instanceof OpenAlexAuthError) { reportAuthError(); setPreprints({ status: 'idle' }) }
      else setPreprints({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const busy = phase === 'working'

  return (
    <div className="app">
      <div className="app-header">
        <h1>BibProfile</h1>
        <button type="button" className="about-btn" onClick={() => setAboutOpen(o => !o)}>
          {aboutOpen ? 'Close' : 'About'}
        </button>
      </div>

      {aboutOpen ? (
        <About onClose={() => setAboutOpen(false)} />
      ) : (
        <>
      <p className="subtitle">
        Parse a BibTeX file and match it against OpenAlex.
      </p>

      {!OPENALEX_API_KEY && !userKey && (
        <p className="hint">
          No OpenAlex API key detected. Requests may be heavily rate-limited.
          Add <code>VITE_OPENALEX_API_KEY</code> to a local <code>.env</code> (see README),
          or use your own key below.
        </p>
      )}

      <FileDrop onText={run} disabled={busy} />

      <KeyControl active={!!userKey} error={keyError} onSet={applyUserKey} onClear={clearUserKey} />
      <UsageIndicator state={usage} onRetry={() => void refreshUsageFor(userKey)} />

      {exhausted && (
        <div className="card-note warn exhausted-banner">
          {exhausted.kind === 'shared' ? (
            <>
              The shared daily pool is used up (resets {formatResetClockUtc(exhausted.resetsAt) || 'tomorrow'}).
              Enter your own free OpenAlex key above to finish now — your already-matched references are kept.
              {userKey && rows.some(r => r.status === 'pending') && (
                <>
                  {' '}
                  <button type="button" className="primary" onClick={handleResume} disabled={busy}>
                    Resume {rows.filter(r => r.status === 'pending').length} remaining
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              Your OpenAlex key’s daily budget is used up (resets {formatResetClockUtc(exhausted.resetsAt) || 'tomorrow'}).
              It refreshes then, or add a prepaid balance on OpenAlex.
            </>
          )}
        </div>
      )}

      {notice && <p className="err-text" style={{ marginTop: 14 }}>{notice}</p>}

      {(busy || phase === 'done') && <Progress progress={progress} />}

      {phase === 'done' && summary && (
        <>
          <Summary summary={summary} fileName={fileName} />
          <div className="summary toolbar" style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'none', border: 'none', padding: 0, margin: '-8px 0 4px' }}>
            <button className="primary" onClick={copySummary}>{copied ? 'Copied ✓' : 'Copy summary'}</button>
            <button onClick={exportJson}>Export matched data (JSON)</button>
            {warnings.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                  {warnings.length} parser warning{warnings.length === 1 ? '' : 's'}
                </summary>
                <ul style={{ fontSize: '0.82rem', color: 'var(--muted)', maxHeight: 160, overflow: 'auto' }}>
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </div>

          <div className="viewtoggle" role="tablist" aria-label="Report, cleaned .bib, or table view">
            <button role="tab" aria-selected={view === 'report'} className={view === 'report' ? 'active' : ''}
              onClick={() => setView('report')}>Report</button>
            <button role="tab" aria-selected={view === 'cleaned'} className={view === 'cleaned' ? 'active' : ''}
              onClick={() => setView('cleaned')}>Cleaned .bib</button>
            <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'active' : ''}
              onClick={() => setView('table')}>Table</button>
          </div>

          {view === 'report' && (
            <ReportView
              rows={rows}
              referenceYear={referenceYear}
              gaps={{ co: gapsCo, fw: gapsFw, onRunCoCitation: handleCoCitation, onRunForward: handleForward }}
            />
          )}
          {view === 'cleaned' && (
            <CleanedExport
              rows={rows}
              sourceText={sourceText}
              fileName={fileName}
              preprints={preprints}
              onResolvePreprints={handleResolvePreprints}
            />
          )}
          {view === 'table' && <ResultsTable rows={rows} />}
        </>
      )}
        </>
      )}
    </div>
  )
}
