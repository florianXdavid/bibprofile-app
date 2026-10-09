// v1.4.2 — Crossref update records (retractions, expressions of concern,
// corrections), which include the Retraction Watch database. The SECOND (and only
// other) fetch layer besides openalex.ts; no component calls fetch directly.
//
// Free and key-less, so it never touches the OpenAlex budget; browser-direct to
// api.crossref.org. Only DOIs are sent. Batched: ONE request per CROSSREF_BATCH
// DOIs, sequential, one retry:
//   /works?filter=updates:A,updates:B…  -> the NOTICES that update those DOIs;
//   each carries `update-to: [{ DOI, type, source, updated }]` pointing back, with
//   `source` = `publisher` or `retraction-watch`. (Repeated filters are ORed.)
// Reading the originals' `updated-by` too was measured on the regression set and
// added nothing (same 71 notices), so it is not fetched.

const CROSSREF_BASE_URL = 'https://api.crossref.org'
const CROSSREF_MAILTO = 'contact@bibprofile.com' // Crossref "polite pool" contact
export const CROSSREF_BATCH = 40
const RETRY_MS = 1500

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
    mailto: CROSSREF_MAILTO,
  })
  return `${CROSSREF_BASE_URL}/works?${qs.toString()}`
}

async function getItems(url: string): Promise<unknown[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
