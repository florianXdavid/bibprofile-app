// v1.5.2 — OPT-IN recorder for the "Try with an example" snapshot.
//
// SKIPPED in every normal test run. It runs only when BIBPROFILE_RECORD_EXAMPLE is
// set, because it runs the app's real pipeline over src/demo/example.bib through the
// SHARED pool (api.bibprofile.com, no key sent), exactly as a user would:
//   • the matching run (free DOI / identifier lookups, free Crossref title searches,
//     a billable OpenAlex search only where those fail),
//   • the Crossref retraction / correction check (free),
//   • Preprint → published (one billable search per detected preprint),
//   • Missing foundations (free singletons + 1 billable call) and Adjacent work
//     (1 billable call for 30 references).
// A few billable calls in total (~$0.01). It writes src/demo/example-results.json,
// which the app loads instead of making any request.
//
// Windows PowerShell:  $env:BIBPROFILE_RECORD_EXAMPLE="1"; npx vitest run record-example; Remove-Item Env:BIBPROFILE_RECORD_EXAMPLE
// macOS / Linux:       BIBPROFILE_RECORD_EXAMPLE=1 npx vitest run record-example

import { describe, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBib } from '../../src/lib/parseBib'
import { runMatching } from '../../src/lib/match'
import { fetchCrossrefUpdates } from '../../src/lib/crossref'
import { retractionDois } from '../../src/lib/stats/retractions'
import { runPreprintResolution } from '../../src/lib/preprintResolve'
import { runCoCitation, runForwardCitation } from '../../src/lib/gaps'
import { serializeExample } from '../../src/demo/exampleData'
import type { Credential } from '../../src/lib/credential'

const BIB = fileURLToPath(new URL('../../src/demo/example.bib', import.meta.url))
const OUT = fileURLToPath(new URL('../../src/demo/example-results.json', import.meta.url))
const cred: Credential = { kind: 'shared', baseUrl: 'https://api.bibprofile.com', apiKey: '', mailto: '' }

describe.skipIf(!process.env.BIBPROFILE_RECORD_EXAMPLE)('record the example snapshot (network, shared pool)', () => {
  it('runs the full pipeline over example.bib', async () => {
    const parsed = parseBib(readFileSync(BIB, 'utf8'))
    const { rows, summary, exhausted } = await runMatching(parsed, p => console.log(`[match] ${p.label}`), cred)
    if (exhausted) throw new Error('shared pool exhausted — try again tomorrow')
    console.log('[crossref] retraction check')
    const crossref = await fetchCrossrefUpdates(retractionDois(rows))
    const preprints = await runPreprintResolution(rows, p => console.log(`[preprints] ${p.label}`), cred)
    const co = await runCoCitation(rows, p => console.log(`[co-citation] ${p.label}`), cred)
    const fw = await runForwardCitation(rows, p => console.log(`[forward] ${p.label}`), cred)
    const snap = serializeExample({ rows, summary, crossref, preprints, co, fw }, new Date().toISOString())
    writeFileSync(OUT, JSON.stringify(snap) + '\n')
    const tally: Record<string, number> = {}
    for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1
    console.log(`Wrote ${OUT}`, tally, `— billable: ${summary.searchCalls} searches + ${preprints.billableCalls + co.billableCalls + fw.billableCalls} report calls`)
  }, 15 * 60 * 1000)
})
