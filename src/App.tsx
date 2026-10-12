import { useEffect, useMemo, useRef, useState } from 'react'
import FileDrop from './components/FileDrop'
import Progress from './components/Progress'
import Summary from './components/Summary'
import VerificationCard from './components/VerificationCard'
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
import { OPENALEX_DIRECT_URL, resolveCredential, type UserCredential } from './lib/credential'
import { formatResetClockUtc } from './lib/rateLimit'
import { fetchCrossrefUpdates, type CrossrefRunState } from './lib/crossref'
import { retractionDois } from './lib/stats/retractions'
import { computeRetractions } from './lib/stats/retractions'
import { coauthorMessage, computeVerification } from './lib/stats/verification'
import { buildReportHtml } from './lib/reportHtml'
import { EXAMPLE_FILE_NAME, hydrateExample, type ExampleSnapshot } from './demo/exampleData'
import type { MatchSummary, Progress as ProgressState, ResultRow } from './types'

type Phase = 'idle' | 'working' | 'done'
type View = 'about' | 'report' | 'cleaned' | 'table'

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
  const [view, setView] = useState<View>('about') // v1.1 — four tabs; About is the default landing tab
  const [copied, setCopied] = useState(false)
  const [sourceText, setSourceText] = useState<string>('') // original .bib text (cleaned export)
  const [uploadOpen, setUploadOpen] = useState(true) // v1.3 — collapse the drop zone once results are in
  const [isExample, setIsExample] = useState(false) // v1.5.2 — the precomputed example is showing
  const [copiedMsg, setCopiedMsg] = useState(false)

  // W3.1 — billable results live HERE, above the Report/Cleaned/Table toggle, so
  // switching tabs (which unmounts the inactive view) never discards them and
  // never re-triggers the paid OpenAlex calls. Cleared only on a new upload,
  // hung on the same reset as the core matched data — one invalidation path.
  const [gapsCo, setGapsCo] = useState<GapsRunState<CoCiteResult>>({ status: 'idle' })
  const [gapsFw, setGapsFw] = useState<GapsRunState<ForwardResult>>({ status: 'idle' })
  const [preprints, setPreprints] = useState<PreprintRunState>({ status: 'idle' })
  // v1.4.2 — Crossref retraction / concern / correction notices. FREE (no OpenAlex
  // budget), so it runs automatically after matching. `crossrefRun` drops a stale
  // result if a new file was uploaded while it was in flight.
  const [crossref, setCrossref] = useState<CrossrefRunState>({ status: 'idle' })
  const crossrefRun = useRef(0)
  async function checkCrossref(forRows: ResultRow[]) {
    const runId = ++crossrefRun.current
    const dois = retractionDois(forRows)
    if (dois.length === 0) { setCrossref({ status: 'done', result: { updates: new Map(), checked: 0, failed: 0 } }); return }
    setCrossref({ status: 'running' })
    const result = await fetchCrossrefUpdates(dois) // never throws
    if (runId === crossrefRun.current) setCrossref({ status: 'done', result })
  }

  // W4 — the user's OWN OpenAlex key (opt-in). In-memory ONLY: dies on reload,
  // never persisted anywhere. null = the shared pool (default). `keyError` holds
  // an auth-rejection message shown inline by KeyControl.
  const [userKey, setUserKey] = useState<UserCredential | null>(null)
  const [keyError, setKeyError] = useState<string>('')
  // W4.1 — user-key usage readout, and the shared-pool exhaustion state.
  const [usage, setUsage] = useState<UsageState>({ status: 'shared' })
  const [exhausted, setExhausted] = useState<{ resetsAt: string | null; kind: 'shared' | 'user' } | null>(null)

  // Read a credential's usage. USER KEY → OpenAlex directly (its own budget).
  // SHARED → only when it's routed through the Worker (which serves key-stripped
  // /rate-limit); if the shared path is still direct-to-OpenAlex (local dev or a
  // rollback) we keep the honest deferral line and make NO call — the browser never
  // reads the shared key's usage from OpenAlex. Never blocks; failure → 'unavailable'.
  async function refreshUsageFor(uc: UserCredential | null) {
    const cred = resolveCredential(uc)
    const canRead = cred.kind === 'user' || cred.baseUrl !== OPENALEX_DIRECT_URL
    if (!canRead) { setUsage({ status: 'shared' }); return }
    setUsage({ status: 'loading' })
    const res = await fetchRateLimit(cred)
    const scope = cred.kind === 'user' ? 'user' : 'shared'
    setUsage(res.kind === 'ok' ? { status: 'ok', usage: res.usage, scope } : { status: 'unavailable' })
  }

  // Issue 1 (05c) — show the shared-pool bar on first load (before any upload),
  // whenever the shared-via-Worker path is active. One-shot on mount; never a timer.
  useEffect(() => { void refreshUsageFor(null) }, [])

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
    void refreshUsageFor(null) // back to the shared pool → refetch and show the pooled bar now
  }

  // v1.5.2 — "Try with an example": the bundled example .bib and the results of one
  // real run over it (src/demo). No request is made and nothing is spent; every
  // billable result (preprints, missing citations) is already in the snapshot.
  async function loadExample() {
    setNotice('')
    try {
      const [bib, snap] = await Promise.all([import('./demo/example.bib?raw'), import('./demo/example-results.json')])
      const ex = hydrateExample(snap.default as unknown as ExampleSnapshot)
      crossrefRun.current++ // drop any in-flight check for a previous file
      setIsExample(true)
      setCopied(false)
      setFileName(EXAMPLE_FILE_NAME)
      setSourceText(bib.default)
      setWarnings([])
      setRows(ex.rows)
      setSummary(ex.summary)
      setCrossref({ status: 'done', result: ex.crossref })
      setPreprints(ex.preprints ? { status: 'done', result: ex.preprints } : { status: 'idle' })
      setGapsCo(ex.co ? { status: 'done', result: ex.co } : { status: 'idle' })
      setGapsFw(ex.fw ? { status: 'done', result: ex.fw } : { status: 'idle' })
      setExhausted(null)
      setProgress({ stage: 'done', label: 'Example loaded (precomputed — no lookups made)', done: ex.summary.total, total: ex.summary.total, searchCalls: 0 })
      setPhase('done')
      setView('report')
      setUploadOpen(false)
    } catch {
      setNotice('Could not load the example.')
    }
  }

  async function run(text: string, name: string) {
    setIsExample(false)
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
    crossrefRun.current++ // invalidate any in-flight Crossref check
    setCrossref({ status: 'idle' })
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
      setNotice(name === 'pasted.bib' ? 'No BibTeX entries found in the pasted text.' : 'No BibTeX entries found in that file.')
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
      setView('report')     // v1.3 — jump to the report when analysis finishes
      setUploadOpen(false)  // v1.3 — collapse the drop zone to give results room
      // W4.1 — a budget halt keeps partial results; the rest stay pending.
      setExhausted(ex ? { resetsAt: ex.resetsAt, kind: cred.kind } : null)
      void refreshUsageFor(userKey)
      void checkCrossref(resultRows) // v1.4.2 — free, automatic
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
    await requery(pendingEntries, 'Resuming…', cred)
  }

  // v1.4.2 patch — re-query ONLY the entries whose lookup failed (`error`, e.g. a
  // transient 429/5xx), on the active credential; every other result is kept. DOI
  // retries are free; a title retry is one billable search each.
  async function handleRetryErrors() {
    const failed = rows.filter(r => r.status === 'error' && r.entry).map(r => r.entry!)
    if (failed.length > 0) await requery(failed, 'Retrying failed entries…', resolveCredential(userKey))
  }

  // Shared by Resume and Retry: match a subset again and merge it back by rowId.
  async function requery(entries: NonNullable<ResultRow['entry']>[], label: string, cred: ReturnType<typeof resolveCredential>) {
    setPhase('working')
    setNotice('')
    setProgress({ stage: 'parsing', label, done: 0, total: entries.length, searchCalls: 0 })
    try {
      const sub = { entries, unparseable: [], warnings: [] }
      const { rows: resumedRows, summary: subSummary, exhausted: ex } = await runMatching(sub, setProgress, cred)
      const merged = mergeRows(rows, resumedRows)
      setRows(merged)
      setSummary(summarize(merged, (summary?.searchCalls ?? 0) + subSummary.searchCalls))
      setExhausted(ex ? { resetsAt: ex.resetsAt, kind: cred.kind } : null)
      setPhase('done')
      void refreshUsageFor(userKey)
      void checkCrossref(merged) // v1.4.2 — re-check with the resumed matches
    } catch (e) {
      if (e instanceof OpenAlexAuthError) reportAuthError()
      else setNotice('Something went wrong reaching OpenAlex. Please try again.')
      setPhase('done') // keep the partial results visible
    }
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

  // v1.5.2 — the forwardable report and the one-line message for co-authors. Built
  // locally from what's already in memory; nothing is uploaded.
  function reportHtml(): string {
    return buildReportHtml({
      rows, fileName: fileName || 'references.bib',
      crossref: crossref.status === 'done' ? crossref.result : null,
      preprints: preprints.status === 'done' ? preprints.result : null,
      co: gapsCo.status === 'done' ? gapsCo.result : null,
      fw: gapsFw.status === 'done' ? gapsFw.result : null,
      date: new Date(), referenceYear,
    })
  }
  function downloadReport() {
    const blob = new Blob([reportHtml()], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(fileName || 'references').replace(/\.[^.]+$/, '')}-reference-check.html`
    a.click()
    URL.revokeObjectURL(url)
  }
  // Print the report alone (the browser's dialog offers "Save as PDF"), from a hidden
  // same-page frame — no new tab, no request.
  function printReport() {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    frame.srcdoc = reportHtml()
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 60_000)
    }
    document.body.appendChild(frame)
  }
  const verification = useMemo(() => computeVerification(rows,
    crossref.status === 'done' ? computeRetractions(rows, crossref.result).retracted.map(f => f.rowId) : null), [rows, crossref])
  async function copyCoauthorMessage() {
    try {
      await navigator.clipboard.writeText(coauthorMessage(verification))
      setCopiedMsg(true)
      setTimeout(() => setCopiedMsg(false), 2000)
    } catch { setNotice('Could not copy to clipboard — select the message and copy it by hand.') }
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
  const hasResults = phase === 'done' && !!summary

  // Neutral placeholder shown in a result tab before a .bib has been analysed.
  const tabPlaceholder = (what: string) => (
    <p className="tab-placeholder muted">
      <span>{what}</span> will appear here after you upload a <code>.bib</code> file above.
    </p>
  )

  return (
    <div className="app">
      <div className="app-header">
        <h1>BibProfile</h1>
      </div>
      <p className="tagline">
        <strong>Check your references before the reviewers do.</strong> Find unmatched references,
        retracted papers and outdated preprints, and get a cleaned .bib. In your browser, no account.
      </p>

      {uploadOpen ? (
        <FileDrop onText={run} onExample={loadExample} disabled={busy} />
      ) : (
        <p className="upload-collapsed muted">
          <button type="button" className="key-link" onClick={() => setUploadOpen(true)}>↑ Check another .bib (upload or paste)</button>
          {fileName && <> · current file: <strong>{fileName}</strong></>}
        </p>
      )}

      {exhausted && (
        <div className="card-note warn exhausted-banner">
          {exhausted.kind === 'shared' ? (
            <>
              The shared daily pool is used up (resets {formatResetClockUtc(exhausted.resetsAt) || 'tomorrow'}).
              Enter your own free OpenAlex key here to finish now — your already-matched references are kept.
              {!userKey && <KeyControl active={false} error={keyError} onSet={applyUserKey} onClear={clearUserKey} />}
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
          {/* v1.5.1 — the headline question first; the match details one click away. */}
          {isExample && (
            <p className="card-note example-note">
              <strong>This is an example</strong> — a 30-reference review on brain–computer interfaces, with a
              retracted paper, a preprint since published, a duplicate, a missing DOI and one invented
              reference planted on purpose. Its results were saved from a real run, so nothing was looked up
              now. Upload your own <code>.bib</code> to check yours.
            </p>
          )}
          <VerificationCard rows={rows} crossref={crossref} />
          <details className="summary-details">
            <summary>Matching details</summary>
            <Summary summary={summary} />
          </details>
          <div className="summary toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', background: 'none', border: 'none', padding: 0, margin: '-8px 0 4px' }}>
            <button className="primary" onClick={copySummary}>{copied ? 'Copied ✓' : 'Copy summary'}</button>
            <button type="button" onClick={downloadReport} title="A self-contained HTML report to send to your co-authors — made in your browser, nothing uploaded">Download report</button>
            <button type="button" onClick={printReport} title="Opens the report in your browser's print dialog — choose “Save as PDF”">Print / save as PDF</button>
            {summary.errored > 0 && (
              <button type="button" onClick={handleRetryErrors} disabled={busy}
                title="Look up only the entries whose request failed; everything else is kept">
                Retry {summary.errored} failed {summary.errored === 1 ? 'entry' : 'entries'}
              </button>
            )}
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
          {/* v1.5.2 — one line to paste into an email or Slack, with the report attached. */}
          <div className="coauthor-line">
            <span className="muted">Send to co-authors:</span>{' '}
            <span className="coauthor-text">{coauthorMessage(verification)}</span>{' '}
            <button type="button" className="key-link" onClick={copyCoauthorMessage}>{copiedMsg ? 'Copied ✓' : 'Copy'}</button>
          </div>
        </>
      )}

      {/* Four always-visible tabs (About is the default so first-time visitors see
          what the tool is). The drop zone above stays accessible from every tab; the
          result tabs show a neutral placeholder until a .bib is analysed. */}
      <div className="viewtoggle" role="tablist" aria-label="About, report, cleaned .bib, or table view">
        <button role="tab" aria-selected={view === 'about'} className={view === 'about' ? 'active' : ''}
          onClick={() => setView('about')}>About</button>
        <button role="tab" aria-selected={view === 'report'} className={view === 'report' ? 'active' : ''}
          onClick={() => setView('report')}>Report</button>
        <button role="tab" aria-selected={view === 'cleaned'} className={view === 'cleaned' ? 'active' : ''}
          onClick={() => setView('cleaned')}>Cleaned .bib</button>
        <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'active' : ''}
          onClick={() => setView('table')}>Table</button>
      </div>

      {view === 'about' && <About />}
      {view === 'report' && (hasResults
        ? (
          <ReportView
            rows={rows}
            referenceYear={referenceYear}
            gaps={{ co: gapsCo, fw: gapsFw, onRunCoCitation: handleCoCitation, onRunForward: handleForward }}
            preprints={preprints}
            onResolvePreprints={handleResolvePreprints}
            crossref={crossref}
          />
        )
        : tabPlaceholder('Your report'))}
      {view === 'cleaned' && (hasResults
        ? (
          <CleanedExport
            rows={rows}
            sourceText={sourceText}
            fileName={fileName}
          />
        )
        : tabPlaceholder('Your cleaned .bib'))}
      {view === 'table' && (hasResults ? <ResultsTable rows={rows} crossref={crossref} /> : tabPlaceholder('The match table'))}

      {/* v1.5.3 — the pool meter and the own-key option live at the bottom: at the top they
          read as warnings to a first-time visitor. When the shared pool runs out, the key
          field also appears in the banner above, where it's needed. */}
      <section className="pool-footer" aria-label="Shared pool and your own OpenAlex key">
        <UsageIndicator state={usage} onRetry={() => void refreshUsageFor(userKey)} />
        {!(exhausted?.kind === 'shared' && !userKey) && (
          <KeyControl active={!!userKey} error={keyError} onSet={applyUserKey} onClear={clearUserKey} />
        )}
      </section>
    </div>
  )
}
