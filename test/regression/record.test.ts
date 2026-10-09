// v1.4.1 — OPT-IN recorder for the title-matching regression fixture.
//
// SKIPPED in every normal test run. It runs only when BIBPROFILE_RECORD is set,
// because it makes real network calls through the SHARED pool (api.bibprofile.com,
// no key sent — the Worker injects it):
//   • one BILLABLE title search per .bib entry (the exact query the app sends), and
//   • FREE DOI singleton lookups to resolve each ground-truth DOI to its OpenAlex ID,
//   • v1.4.2: FREE Crossref update-record lookups (api.crossref.org, batched) for
//     every candidate DOI — the retraction / concern / correction notices.
// It writes test/regression/hard-titles.fixture.json; hard-titles.test.ts then
// replays that fixture OFFLINE on every run.
//
// INCREMENTAL by default: entries whose query and ground-truth DOIs are unchanged
// are kept from the existing fixture; only new/changed ones are fetched. Set
// BIBPROFILE_RECORD=all to re-record everything (e.g. after changing SEARCH_PER_PAGE
// or to refresh against today's OpenAlex).
//
// Windows PowerShell:  $env:BIBPROFILE_RECORD="1"; npx vitest run record; Remove-Item Env:BIBPROFILE_RECORD
// macOS / Linux:       BIBPROFILE_RECORD=1 npx vitest run record

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBib } from '../../src/lib/parseBib'
import { readField } from '../../src/lib/bibWriter'
import { normalizeDoi } from '../../src/lib/doi'
import { buildDoiUrl, buildWorksSearchUrl } from '../../src/lib/openalex'
import { buildCrossrefUrl, CROSSREF_BATCH } from '../../src/lib/crossref'
import type { Credential } from '../../src/lib/credential'

const BIB = fileURLToPath(new URL('./hard-titles.bib', import.meta.url))
const OUT = fileURLToPath(new URL('./hard-titles.fixture.json', import.meta.url))
const BASE = 'https://api.bibprofile.com'
const cred: Credential = { kind: 'shared', baseUrl: BASE, apiKey: '', mailto: '' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Keep only what toOpenAlexWork reads (smaller, stable fixture; long author
// lists capped at 15 — the author signal only needs the first few).
function trim(w: any) {
  const src = w?.primary_location?.source
  return {
    id: w?.id ?? '', doi: w?.doi ?? null, display_name: w?.display_name ?? '',
    publication_year: w?.publication_year ?? null, type: w?.type ?? null,
    cited_by_count: w?.cited_by_count ?? null,
    primary_location: w?.primary_location
      ? { is_oa: w.primary_location.is_oa ?? null, source: src ? { id: src.id ?? null, display_name: src.display_name ?? null, type: src.type ?? null } : null }
      : null,
    open_access: w?.open_access ? { is_oa: w.open_access.is_oa ?? null, oa_status: w.open_access.oa_status ?? null } : null,
    primary_topic: w?.primary_topic ? { display_name: w.primary_topic.display_name ?? null } : null,
    authorships: (Array.isArray(w?.authorships) ? w.authorships : []).slice(0, 15)
      .map((a: any) => ({ author: { display_name: a?.author?.display_name ?? '', orcid: a?.author?.orcid ?? null } })),
    is_retracted: w?.is_retracted ?? null,
    biblio: w?.biblio ?? null,
  }
}

async function getJson(url: string): Promise<{ status: number; json: any }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.status === 429 || res.status >= 500) { await sleep(attempt === 0 ? 2000 : 11000); continue }
    return { status: res.status, json: res.ok ? await res.json() : null }
  }
  throw new Error(`gave up after retries: ${url}`)
}

async function resolveDoi(doi: string) {
  const d = normalizeDoi(doi)
  if (!d) return { doi, error: 'not a DOI' }
  const { status, json } = await getJson(buildDoiUrl(d, cred))
  await sleep(250)
  if (!json) return { doi: d, error: `HTTP ${status}` }
  return { doi: d, id: json.id, title: json.display_name, year: json.publication_year, type: json.type, venue: json?.primary_location?.source?.display_name ?? null }
}

describe.skipIf(!process.env.BIBPROFILE_RECORD)('record hard-titles fixture (network, shared pool)', () => {
  it('records top-5 candidates + ground truth for every entry', async () => {
    const parsed = parseBib(readFileSync(BIB, 'utf8'))
    expect(parsed.unparseable).toEqual([])
    const prev: Record<string, any> = process.env.BIBPROFILE_RECORD !== 'all' && existsSync(OUT)
      ? JSON.parse(readFileSync(OUT, 'utf8')).entries : {}
    const entries: Record<string, unknown> = {}
    let searches = 0
    for (const e of parsed.entries) {
      const query = e.titleForSearch || e.title
      const old = prev[e.citeKey]
      const sameDoi = (r: any, d: string | null) => (r?.doi ?? null) === (d ? normalizeDoi(d) : null)
      if (old && old.query === query && sameDoi(old.expectDoi, readField(e.raw, 'expectdoi')) && sameDoi(old.expectNot, readField(e.raw, 'expectnot'))) {
        entries[e.citeKey] = old // unchanged — keep the recorded responses
        continue
      }
      const { json } = await getJson(buildWorksSearchUrl(query, false, cred))
      searches++
      await sleep(250)
      const expectDoi = readField(e.raw, 'expectdoi')
      const expectNot = readField(e.raw, 'expectnot')
      entries[e.citeKey] = {
        query,
        candidates: (Array.isArray(json?.results) ? json.results : []).map(trim),
        expectDoi: expectDoi ? await resolveDoi(expectDoi) : null,
        expectNot: expectNot ? await resolveDoi(expectNot) : null,
      }
      console.log(`[${searches}] ${e.citeKey}`)
    }
    // v1.4.2 — Crossref notices for every candidate DOI (and ground-truth DOI).
    // Incremental too: DOIs already checked in the previous fixture are kept.
    const prevFx = process.env.BIBPROFILE_RECORD !== 'all' && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null
    const prevChecked = new Set<string>(prevFx?.crossref?.checked ?? [])
    const items: unknown[] = [...(prevFx?.crossref?.items ?? [])]
    const all = new Set<string>()
    for (const r of Object.values(entries) as any[]) {
      for (const c of r.candidates) if (c.doi) all.add(normalizeDoi(c.doi) ?? '')
      for (const x of [r.expectDoi, r.expectNot]) if (x?.doi) all.add(x.doi)
    }
    all.delete('')
    const todo = [...all].filter(d => !prevChecked.has(d) && !d.includes(','))
    let crossrefCalls = 0
    for (let i = 0; i < todo.length; i += CROSSREF_BATCH) {
      const batch = todo.slice(i, i + CROSSREF_BATCH)
      const res = await fetch(buildCrossrefUrl(batch), { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`)
      const json: any = await res.json()
      for (const it of json?.message?.items ?? []) {
        if (it['update-to']) items.push({ DOI: it.DOI, 'update-to': it['update-to'] })
      }
      crossrefCalls++
      await sleep(300)
      console.log(`[crossref] ${Math.min(i + CROSSREF_BATCH, todo.length)}/${todo.length} DOIs`)
    }
    const checked = [...new Set([...prevChecked, ...todo])].filter(d => all.has(d)).sort()

    writeFileSync(OUT, JSON.stringify({
      recordedAt: new Date().toISOString(), base: BASE, searchCalls: searches, crossrefCalls, entries,
      crossref: { checked, items },
    }, null, 1) + '\n')
    console.log(`Wrote ${OUT} — ${searches} billable searches, ${crossrefCalls} free Crossref calls.`)
  }, 30 * 60 * 1000)
})
