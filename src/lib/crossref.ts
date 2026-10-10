// Crossref — the SECOND (and only other) fetch layer besides openalex.ts; no
// component calls fetch directly. Two uses:
//   • v1.4.4 — FIRST title search (`query.bibliographic`), free, so the shared
//     OpenAlex budget is only spent when Crossref can't place a reference;
//   • v1.4.2 — update records (retractions, expressions of concern, corrections),
//     which include the Retraction Watch database.
//
// PUBLIC pool, no `mailto`: since 21 Jul 2026 Crossref rate-limits the polite pool
// per email address, so one shared address would cap ALL BibProfile users at 3
// list requests/s together. Without it each visitor's browser has its own budget
// (1 list request/s). Every list call here is paced >= LIST_INTERVAL_MS apart.
//
// Free and key-less, so it never touches the OpenAlex budget; browser-direct to
// api.crossref.org. Only DOIs are sent. Batched: ONE request per CROSSREF_BATCH
// DOIs, sequential, one retry:
//   /works?filter=updates:A,updates:B…  -> the NOTICES that update those DOIs;
//   each carries `update-to: [{ DOI, type, source, updated }]` pointing back, with
//   `source` = `publisher` or `retraction-watch`. (Repeated filters are ORed.)
// Reading the originals' `updated-by` too was measured on the regression set and
// added nothing (same 71 notices), so it is not fetched.

import type { BibEntry, OpenAlexWork } from '../types'

const CROSSREF_BASE_URL = 'https://api.crossref.org'
export const CROSSREF_BATCH = 40
const RETRY_MS = 1500
const LIST_INTERVAL_MS = 1100 // public pool: 1 list (search/filter) request per second

// One pace for every Crossref list call (searches AND update lookups), in memory.
let lastListCall = 0
async function paceList(): Promise<void> {
  const wait = lastListCall + LIST_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastListCall = Date.now()
}

export type UpdateKind = 'retraction' | 'concern' | 'correction'

export interface CrossrefUpdate {
  target: string // the (lowercased) DOI that is updated
  kind: UpdateKind
  type: string // Crossref's own type, normalised (e.g. partial_retraction)
  noticeDoi: string | null
  source: string // 'publisher' | 'retraction-watch' | …
  date: string | null // YYYY-MM-DD when given
}

export interface CrossrefResult {
  updates: Map<string, CrossrefUpdate[]> // by target DOI
  checked: number // DOIs successfully checked
  failed: number // DOIs whose batch failed
}

export type CrossrefRunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: CrossrefResult }

// Crossref update types we report, grouped into the three labels the UI shows.
// Anything else (addendum, new_version, …) is ignored.
const KIND: Record<string, UpdateKind> = {
  retraction: 'retraction', partial_retraction: 'retraction', withdrawal: 'retraction', removal: 'retraction',
  expression_of_concern: 'concern',
  correction: 'correction', corrigendum: 'correction', erratum: 'correction',
}

const normType = (t: unknown) => String(t ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
const normDoi = (d: unknown) => String(d ?? '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')

function dateOf(u: any): string | null {
  const p = u?.updated?.['date-parts']?.[0]
  if (!Array.isArray(p) || !p[0]) return null
  return [p[0], p[1], p[2]].filter(x => x != null).map((x, i) => (i ? String(x).padStart(2, '0') : String(x))).join('-')
}

// PURE: turn Crossref notice `items` into updates for the
// DOIs we asked about. Duplicates (same notice listed by publisher AND Retraction
// Watch) are kept once per (target, kind, notice); both sources are remembered.
export function parseCrossrefItems(items: unknown[], wanted: Set<string>): CrossrefUpdate[] {
  const out: CrossrefUpdate[] = []
  const seen = new Set<string>()
  const push = (target: string, u: any, noticeDoi: string | null) => {
    const kind = KIND[normType(u?.type)]
    if (!kind || !wanted.has(target)) return
    const source = String(u?.source ?? 'publisher')
    const key = `${target}|${kind}|${noticeDoi ?? ''}|${source}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ target, kind, type: normType(u?.type), noticeDoi, source, date: dateOf(u) })
  }
  for (const it of Array.isArray(items) ? items : []) {
    const item = it as any
    const own = normDoi(item?.DOI)
    for (const u of Array.isArray(item?.['update-to']) ? item['update-to'] : []) push(normDoi(u?.DOI), u, own || null)
  }
  return out
}

export function buildCrossrefUrl(dois: string[]): string {
  const qs = new URLSearchParams({
    filter: dois.map(d => `updates:${d}`).join(','),
    rows: '1000',
  })
  return `${CROSSREF_BASE_URL}/works?${qs.toString()}`
}

async function getItems(url: string): Promise<unknown[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await paceList()
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (res.ok) {
        const json = await res.json()
        return Array.isArray(json?.message?.items) ? json.message.items : []
      }
    } catch { /* network — retry once */ }
    if (attempt === 0) await new Promise(r => setTimeout(r, RETRY_MS))
  }
  throw new Error('Crossref unavailable')
}

// Check a set of DOIs. Never throws: a failed batch is counted in `failed` and
// the report says the check was partial.
export async function fetchCrossrefUpdates(dois: string[]): Promise<CrossrefResult> {
  // A comma would split the filter value, so such (rare) DOIs are not sent.
  const list = [...new Set(dois.map(normDoi))].filter(d => d.startsWith('10.') && !d.includes(','))
  const updates = new Map<string, CrossrefUpdate[]>()
  let checked = 0, failed = 0
  for (let i = 0; i < list.length; i += CROSSREF_BATCH) {
    const batch = list.slice(i, i + CROSSREF_BATCH)
    try {
      const items = await getItems(buildCrossrefUrl(batch))
      for (const u of parseCrossrefItems(items, new Set(batch))) {
        const arr = updates.get(u.target) ?? []
        arr.push(u)
        updates.set(u.target, arr)
      }
      checked += batch.length
    } catch {
      failed += batch.length
    }
  }
  return { updates, checked, failed }
}

// --- v1.4.4: Crossref as the FIRST title search ------------------------------

// Fields the scorer needs; `select` keeps responses small.
const SEARCH_SELECT = 'DOI,title,subtitle,author,issued,container-title,publisher,type,volume,issue,page'
export const CROSSREF_SEARCH_ROWS = 5

export function buildCrossrefSearchUrl(e: BibEntry): string {
  const q = [e.titleForSearch || e.title, e.firstAuthor, e.year ?? ''].join(' ').replace(/\s+/g, ' ').trim()
  const qs = new URLSearchParams({ 'query.bibliographic': q, rows: String(CROSSREF_SEARCH_ROWS), select: SEARCH_SELECT })
  return `${CROSSREF_BASE_URL}/works?${qs.toString()}`
}

const CROSSREF_TYPE: Record<string, string> = {
  'journal-article': 'article', 'proceedings-article': 'conference-paper',
  'book': 'book', 'monograph': 'book', 'edited-book': 'book', 'reference-book': 'book',
  'book-chapter': 'book-chapter', 'book-section': 'book-chapter', 'book-part': 'book-chapter',
  'posted-content': 'preprint', 'dissertation': 'dissertation', 'report': 'report',
}

// PURE: a Crossref work item in the OpenAlexWork shape the scorer reads. The id is
// `crossref:<doi>` (unique per DOI, never an OpenAlex id); OpenAlex-only fields are null.
export function crossrefToWork(item: any): OpenAlexWork {
  const doi = normDoi(item?.DOI)
  // Title only: Crossref keeps subtitles separate and OpenAlex display names usually
  // don't include them; gluing them on hid the right record (Tversky 1974).
  const title = String(item?.title?.[0] ?? '')
  const pages = String(item?.page ?? '').split(/[-–—]+/)
  const authors: any[] = Array.isArray(item?.author) ? item.author : []
  return {
    id: `crossref:${doi}`, doi: doi ? `https://doi.org/${doi}` : null, displayName: title,
    publicationYear: Number(item?.issued?.['date-parts']?.[0]?.[0]) || null,
    hostVenue: item?.['container-title']?.[0] ?? null,
    citedByCount: null, isOa: null, type: CROSSREF_TYPE[item?.type] ?? null, primaryTopic: null,
    oaStatus: null, sourceId: null, sourceType: null,
    authorships: authors.map(a => ({ authorName: [a?.given, a?.family ?? a?.name].filter(Boolean).join(' '), orcid: null })).filter(a => a.authorName),
    isRetracted: null,
    biblio: (item?.volume || item?.issue || pages[0])
      ? { volume: item?.volume ?? null, issue: item?.issue ?? null, firstPage: pages[0] || null, lastPage: pages[1] || null }
      : null,
    referencedWorks: null,
  }
}

// Top candidates for an entry, or null when Crossref is unavailable (the caller
// then falls back to OpenAlex search — a Crossref failure never fails a row).
export async function searchCrossref(e: BibEntry): Promise<OpenAlexWork[] | null> {
  try {
    return (await getItems(buildCrossrefSearchUrl(e))).map(crossrefToWork)
  } catch {
    return null
  }
}
