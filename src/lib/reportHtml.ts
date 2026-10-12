// v1.5.2 — the report people forward to co-authors. PURE: builds ONE self-contained
// HTML document (inline CSS, no script, no external request) from results already in
// memory. It is generated in the browser and handed to the user as a download or to
// the browser's print dialog ("Save as PDF") — nothing is uploaded anywhere.
//
// Content: the reference check (verified / could not verify / DOI to check /
// retracted), then the key findings (duplicates, preprints, the bibliography's
// profile, missing citations if they were run, what the cleaned .bib can add), and a
// footer naming BibProfile.

import type { ResultRow } from '../types'
import type { CrossrefResult } from './crossref'
import type { CoCiteResult, ForwardResult, GapCandidate } from './gaps'
import type { PreprintResolveResult } from './preprintResolve'
import { computeRetractions } from './stats/retractions'
import { computeVerification, scholarUrl } from './stats/verification'
import { buildCohort } from './stats/denominator'
import { computeRecency } from './stats/recency'
import { computeVenues } from './stats/venues'
import { computeOpenAccess } from './stats/openaccess'
import { computeDuplicateReport } from './stats/duplicates'
import { computeCleanedBib } from './stats/cleanBib'
import { detectPreprints } from './preprintResolve'

export interface ReportInput {
  rows: ResultRow[]
  fileName: string
  crossref: CrossrefResult | null // null = the retraction check hadn't finished
  preprints: PreprintResolveResult | null
  co: CoCiteResult | null
  fw: ForwardResult | null
  date: Date
  referenceYear: number
}

export const REPORT_FOOTER = 'Checked with BibProfile — bibprofile.com · runs in your browser, nothing stored'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const ref = (r: ResultRow, extra = '') =>
  `<li><code>${esc(r.citeKey)}</code> ${esc(r.title)}${extra}</li>`
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`

function gapList(title: string, verb: string, g: { candidates: GapCandidate[] } | null, denom: number): string {
  if (!g) return ''
  const items = g.candidates.slice(0, 5)
  return `<h3>${esc(title)}</h3>` + (items.length === 0
    ? '<p class="muted">No candidates cleared the threshold.</p>'
    : `<ol>${items.map(c => `<li>${esc(c.work?.displayName ?? c.id)}${c.work?.publicationYear ? ` (${c.work.publicationYear})` : ''} <span class="muted">— ${verb} ${c.count} of your ${denom} references</span></li>`).join('')}</ol>`)
}

export function buildReportHtml(input: ReportInput): string {
  const { rows, crossref } = input
  const retractions = computeRetractions(rows, crossref)
  const v = computeVerification(rows, crossref ? retractions.retracted.map(f => f.rowId) : null)
  const cohort = buildCohort(rows)
  const recency = computeRecency(cohort, input.referenceYear)
  const venues = computeVenues(cohort)
  const oa = computeOpenAccess(cohort)
  const dups = computeDuplicateReport(rows)
  const cleaned = computeCleanedBib(rows)
  const preprintsDetected = detectPreprints(rows)
  const dateStr = input.date.toISOString().slice(0, 10)

  const check: string[] = []
  check.push(v.verified === v.total
    ? `<p class="big">All <b>${v.total}</b> references verified to exist ✓</p>`
    : `<p class="big"><b>${v.verified}</b> of <b>${v.total}</b> references verified to exist</p>`)
  if (v.couldNotVerify.length) {
    check.push(`<h3 class="bad">${plural(v.couldNotVerify.length, 'reference')} could not be verified — check ${v.couldNotVerify.length === 1 ? 'it exists' : 'they exist'}</h3>
<ul>${v.couldNotVerify.map(r => ref(r, `${r.status === 'uncertain' ? ' <span class="muted">(unsure match)</span>' : ''} · ${link(scholarUrl(r), 'search Google Scholar')}`)).join('')}</ul>`)
  }
  if (v.wrongDoi.length) {
    check.push(`<h3 class="bad">${plural(v.wrongDoi.length, 'DOI points', 'DOIs point')} to another work — check the DOI</h3>
<ul>${v.wrongDoi.map(r => ref(r, r.openalex ? ` <span class="muted">— the DOI leads to “${esc(r.openalex.displayName)}”</span>` : '')).join('')}</ul>`)
  }
  if (v.retracted == null) check.push('<p class="muted">The retraction check had not finished when this report was made.</p>')
  else if (retractions.retracted.length) {
    check.push(`<h3 class="bad">${plural(retractions.retracted.length, 'retracted paper')}</h3>
<ul>${retractions.retracted.map(f => {
      const notice = f.updates.find(u => u.kind === 'retraction' && u.noticeDoi)
      const row = rows.find(r => r.rowId === f.rowId)!
      return ref(row, notice ? ` · ${link(`https://doi.org/${notice.noticeDoi}`, 'retraction notice')}` : '')
    }).join('')}</ul>`)
  } else check.push('<p>No retracted papers found.</p>')
  const grey = [
    v.notCheckable ? `${v.notCheckable} not checkable (web pages, software, datasets)` : '',
    v.errored ? `${v.errored} couldn’t be checked (network error)` : '',
    v.pending ? `${v.pending} not checked` : '',
    v.unparseable ? `${plural(v.unparseable, 'entry', 'entries')} couldn’t be read` : '',
  ].filter(Boolean)
  if (grey.length) check.push(`<p class="muted">${esc(grey.join(' · '))}</p>`)

  const findings: string[] = []
  if (dups.groups.length) {
    findings.push(`<h3>${plural(dups.totalCollapsed, 'duplicate entry', 'duplicate entries')}</h3>
<ul>${dups.groups.map(g => `<li>${g.citeKeys.map(k => `<code>${esc(k)}</code>`).join(' = ')} ${esc(g.title)}</li>`).join('')}</ul>`)
  }
  if (preprintsDetected.length) {
    const resolved = input.preprints?.resolved
    findings.push(`<h3>${plural(preprintsDetected.length, 'reference')} cited as ${preprintsDetected.length === 1 ? 'a preprint' : 'preprints'}</h3>
<ul>${preprintsDetected.map(d => {
      const p = resolved?.get(d.rowId)
      const pub = p ? ` <span class="muted">— published: ${esc(p.publishedTitle)}${p.publishedVenue ? `, ${esc(p.publishedVenue)}` : ''}${p.publishedYear ? ` ${p.publishedYear}` : ''}${p.publishedDoi ? ` · ${link(`https://doi.org/${p.publishedDoi}`, p.publishedDoi)}` : ''}</span>` : ''
      return `<li><code>${esc(d.citeKey)}</code> ${esc(d.title)} <span class="muted">(${esc(d.server)})</span>${pub}</li>`
    }).join('')}</ul>`)
  }
  const profile = [
    recency.medianYear != null ? `Median year cited: <b>${recency.medianYear}</b>; ${pct(recency.shareLast5)} from the last 5 years, ${pct(recency.shareLast10)} from the last 10.` : '',
    venues.journals.length ? `Most cited venues: ${venues.journals.slice(0, 3).map(j => `${esc(j.name)} (${j.count})`).join(', ')}.` : '',
    oa.shareOpen != null ? `Open access: <b>${pct(oa.shareOpen)}</b> of the references with known status.` : '',
  ].filter(Boolean)
  if (profile.length) findings.push(`<h3>Profile of the bibliography</h3><ul>${profile.map(p => `<li>${p}</li>`).join('')}</ul>`)
  findings.push(gapList('Possibly missing foundations', 'cited by', input.co, input.co?.matchedWorks ?? 0))
  findings.push(gapList('Adjacent work', 'cites', input.fw, input.fw?.seedCount ?? 0))
  const fills = cleaned.counts.fieldsAdded + cleaned.counts.reviewFills
  const review = cleaned.counts.reviewFills + cleaned.counts.mismatches
  if (fills) {
    findings.push(`<h3>Cleaned .bib</h3><p>${plural(cleaned.counts.fieldsAdded, 'missing field')} (DOIs, venues, volume/pages) can be added automatically from verified records${review ? `, and ${plural(review, 'more item')} ${review === 1 ? 'awaits' : 'await'} review` : ''} — in BibProfile’s “Cleaned .bib” tab.</p>`)
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reference check — ${esc(input.fileName)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;max-width:820px;margin:32px auto;padding:0 20px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
h3{font-size:1rem;margin:16px 0 4px}.bad{color:#8a3b00}.big{font-size:1.25rem;margin:8px 0}.muted{color:#666}
code{font:0.85em ui-monospace,Menlo,Consolas,monospace;background:#f2f3f5;padding:1px 4px;border-radius:4px}
ul,ol{padding-left:20px}li{margin:3px 0}a{color:#2b6cb0}
footer{margin-top:36px;padding-top:10px;border-top:1px solid #ddd;font-size:0.85rem;color:#666}
@media print{body{margin:0;max-width:none}a{color:inherit}}
</style></head><body>
<h1>Reference check</h1>
<p class="muted">${esc(input.fileName)} · ${esc(dateStr)} · ${plural(rows.length, 'entry', 'entries')}</p>
<h2>Is every reference real?</h2>
${check.join('\n')}
<p class="muted">Verified = found in OpenAlex by its DOI or another identifier, or by a confident title match. “Could not be verified” isn’t proof that a reference is fabricated: some real works are missing from OpenAlex.</p>
<h2>Key findings</h2>
${findings.filter(Boolean).join('\n') || '<p>Nothing else to report.</p>'}
<footer>${esc(REPORT_FOOTER.replace('bibprofile.com', '§'))
    .replace('§', '<a href="https://bibprofile.com">bibprofile.com</a>')}</footer>
</body></html>
`
}
