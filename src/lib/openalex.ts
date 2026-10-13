// OpenAlex client. Every request goes through `request()`, which is the only
// place that knows the base URL, attaches the API key, and retries once.
//
// Pricing note (current OpenAlex model): single-work lookups (/works/doi:...)
// are FREE and unlimited; list/search calls draw down the daily allowance.
// So the DOI path uses free singletons (see match.ts) and only the no-DOI
// fallback spends money on ?search=.

import {
  GAPS_SELECT_FIELDS,
  OPENALEX_SELECT_FIELDS,
  RETRY_BACKOFF_MS,
  SEARCH_PER_PAGE,
} from '../config'
import { OPENALEX_DIRECT_URL, sharedCredential, type Credential } from './credential'
import { parseRateLimit, type RateLimitUsage } from './rateLimit'
import type { OpenAlexWork } from '../types'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Thrown when OpenAlex rejects the request's auth (401/403). Never retried and
// never swallowed into a per-row error — it propagates to App, which surfaces a
// clear message and (for a user key) offers Clear. We do NOT silently fall back
// to the shared key: the user chose their key deliberately.
export class OpenAlexAuthError extends Error {
  status: number
  constructor(status: number) {
    super(`OpenAlex rejected the request (HTTP ${status})`)
    this.name = 'OpenAlexAuthError'
    this.status = status
  }
}

// Thrown when the ACTIVE pool's daily budget is exhausted (W4.1). Distinct from
// auth: on the shared pool this drives the graceful-halt + user-key + Resume
// flow; App decides what to do based on which credential was active. Never
// retried (retrying an empty budget is pointless).
export class OpenAlexBudgetError extends Error {
  resetsAt: string | null
  constructor(resetsAt: string | null = null) {
    super('OpenAlex daily credits used up')
    this.name = 'OpenAlexBudgetError'
    this.resetsAt = resetsAt
  }
}

// Does a 429 body read like budget/quota exhaustion (vs. plain "too fast")?
// Coarse and defensive — the exact wording has changed before. Exported for tests.
export function looksLikeBudgetExhaustion(body: string): boolean {
  return /budget|quota|insufficient|exhaust|out of (credit|budget|funds)|payment required|daily (limit|budget)|top ?up|add funds/i.test(body || '')
}

// Best-effort reset time out of a 429 body (JSON with a reset-ish field). null
// if absent — the UI then falls back to "tomorrow".
function budgetResetFromBody(body: string): string | null {
  try {
    const j = JSON.parse(body) as Record<string, unknown>
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === 'string' && /reset/i.test(k) && /\d{4}-\d\d-\d\d/.test(v)) return v
    }
  } catch { /* not JSON — no reset available */ }
  return null
}

// Strip the URL prefix from an OpenAlex id -> bare short id (W123…). Accepts an
// already-short id unchanged. Used for /works/{id} paths and OR-filter values.
// F-08 (audit 2026-10-13) — an OpenAlex work/author/source/institution/publisher/
// funder id as the API returns it. Anything else (a `javascript:` URL, a relative
// path…) is dropped, because ids are rendered as links: only ids that pass this test
// ever become an href.
const OPENALEX_ID_RE = /^https:\/\/openalex\.org\/[WASIPF]\d+$/i
export function isOpenAlexUrl(v: unknown): v is string {
  return typeof v === 'string' && OPENALEX_ID_RE.test(v)
}
export function safeOpenAlexId(v: unknown): string {
  return isOpenAlexUrl(v) ? v : ''
}

export function shortOpenAlexId(id: string): string {
  return (id || '').replace(/^https?:\/\/openalex\.org\//i, '').trim()
}

// Build a URL from a path + params. `URLSearchParams` percent-encodes every
// value, so query metacharacters (| ? $ ^ : etc.) go out escaped — nothing is
// ever hand-concatenated into the query string, and we never use the
// deprecated `filter=title.search:` syntax where a bare `|` would be read as an
// OR separator (Fix 1). `select` defaults to the standard fields; the gaps path
// passes GAPS_SELECT_FIELDS to opt into the large `referenced_works` array.
//
// Note on OR-filters: `filter=openalex_id:W1|W2` sends the `|`/`:` percent-
// encoded, which OpenAlex decodes server-side before parsing — so the OR
// operator survives. That is safe here (ids never contain `|`), unlike the W1
// `search=` case where a title's literal `|` was misread.
// The base URL + auth now come from a Credential (W4). It defaults to the shared
// credential, so every existing call site (and the URL-builder tests) behaves
// byte-for-byte as before when the feature is unused.
function buildUrl(
  path: string,
  params: Record<string, string>,
  select: string,
  cred: Credential,
): string {
  const qs = new URLSearchParams(params)
  qs.set('select', select)
  if (cred.apiKey) qs.set('api_key', cred.apiKey)
  if (cred.mailto) qs.set('mailto', cred.mailto)
  return `${cred.baseUrl}${path}?${qs.toString()}`
}

// Exported for unit tests (URL-building is the one thing we assert without a
// network round-trip).
export function buildDoiUrl(doi: string, cred: Credential = sharedCredential()): string {
  const encoded = doi.split('/').map(encodeURIComponent).join('/')
  return buildUrl(`/works/doi:${encoded}`, {}, OPENALEX_SELECT_FIELDS, cred)
}

// v1.4.5 — free singleton by any external id OpenAlex accepts in the path:
// "doi:10.x/y", "pmid:123", "pmcid:PMC123".
export function buildLookupUrl(key: string, cred: Credential = sharedCredential()): string {
  const m = key.match(/^doi:(.+)$/)
  if (m) return buildDoiUrl(m[1], cred)
  return buildUrl(`/works/${encodeURIComponent(key).replace('%3A', ':')}`, {}, OPENALEX_SELECT_FIELDS, cred)
}

// Free singleton by OpenAlex id. `withRefs` opts into the referenced_works
// select (gaps path only).
export function buildWorkByIdUrl(id: string, withRefs = false, cred: Credential = sharedCredential()): string {
  const short = shortOpenAlexId(id)
  return buildUrl(`/works/${encodeURIComponent(short)}`, {}, withRefs ? GAPS_SELECT_FIELDS : OPENALEX_SELECT_FIELDS, cred)
}

// Title search. `filterExcludePreprint` adds `filter=type:!preprint` for the
// preprint→published resolver (Feature 4); the query itself is unchanged.
export function buildWorksSearchUrl(title: string, filterExcludePreprint = false, cred: Credential = sharedCredential()): string {
  const params: Record<string, string> = { search: title, per_page: String(SEARCH_PER_PAGE) }
  if (filterExcludePreprint) params.filter = 'type:!preprint'
  return buildUrl('/works', params, OPENALEX_SELECT_FIELDS, cred)
}

// A `filter=` list call over an OR-joined id set. `withRefs` opts into
// referenced_works (forward-citation needs it to tally which seeds each result
// cites). BILLABLE — one list call per invocation.
export function buildFilterUrl(filter: string, withRefs = false, perPage = 50, cred: Credential = sharedCredential()): string {
  return buildUrl('/works', { filter, per_page: String(perPage) }, withRefs ? GAPS_SELECT_FIELDS : OPENALEX_SELECT_FIELDS, cred)
}

// How long to wait before the one retry after a plain (non-budget) 429. Honours
// the server's hint: the `Retry-After` header when readable, else the JSON body's
// `retry_after_seconds` (our Worker sends both; the header isn't CORS-exposed, so
// the body is what the browser actually sees). At least RETRY_BACKOFF_MS, capped
// at 15 s so a run never stalls for long. Pure; exported for tests. (v1.4.2 patch)
export function retryDelayMs(retryAfterHeader: string | null, body: string): number {
  let secs = Number(retryAfterHeader)
  if (!Number.isFinite(secs) || secs <= 0) {
    try { secs = Number((JSON.parse(body) as Record<string, unknown>)?.retry_after_seconds) } catch { secs = NaN }
  }
  const ms = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0
  return Math.min(Math.max(ms, RETRY_BACKOFF_MS), 15_000)
}

// One fetch with a single retry on transient failure (network / 429 / 5xx).
// A 404 is returned as-is (it is meaningful: "not in OpenAlex"). A 401/403 is an
// auth rejection: thrown as OpenAlexAuthError immediately (retrying a bad key is
// pointless) and never swallowed into a retry.
async function request(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (res.status === 401 || res.status === 403) throw new OpenAlexAuthError(res.status)
      if (res.ok || res.status === 404) return res
      if (res.status === 429) {
        // A 429 is either transient pacing OR budget exhaustion. Peek the body
        // once to tell them apart (a normal caller treats a 429 as a plain error
        // and never reads its body, so consuming a clone here is safe).
        const body = await res.clone().text().catch(() => '')
        if (looksLikeBudgetExhaustion(body)) throw new OpenAlexBudgetError(budgetResetFromBody(body))
        if (attempt === 0) { await sleep(retryDelayMs(res.headers.get('Retry-After'), body)); continue } // transient — retry once, after the server's hint
        return res
      }
      if (attempt === 0) { await sleep(RETRY_BACKOFF_MS); continue }
      return res
    } catch (err) {
      if (err instanceof OpenAlexAuthError || err instanceof OpenAlexBudgetError) throw err // never retry/mask
      if (attempt === 0) { await sleep(RETRY_BACKOFF_MS); continue }
      throw err
    }
  }
  throw new Error('request: exhausted retries')
}

// Normalise an ORCID to its bare form (0000-0002-1825-0097), uppercasing a
// trailing check `x`. OpenAlex stores it as a full URL. Returns null if absent
// or malformed. Exported for the self-citation matcher and its tests.
export function normalizeOrcid(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const m = input.trim().toUpperCase().match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/)
  return m ? m[1] : null
}

// Pull the authorship list down to what the self-citation card needs.
function toAuthorships(raw: any): OpenAlexWork['authorships'] {
  const list: unknown[] = Array.isArray(raw?.authorships) ? raw.authorships : []
  return list.map((a: any) => ({
    authorName: typeof a?.author?.display_name === 'string' ? a.author.display_name : '',
    orcid: normalizeOrcid(a?.author?.orcid),
  })).filter(a => a.authorName || a.orcid)
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : (typeof v === 'number' ? String(v) : null)

function toBiblio(raw: any): OpenAlexWork['biblio'] {
  const b = raw?.biblio
  if (!b || typeof b !== 'object') return null
  const out = {
    volume: str(b.volume),
    issue: str(b.issue),
    firstPage: str(b.first_page),
    lastPage: str(b.last_page),
  }
  return (out.volume || out.issue || out.firstPage || out.lastPage) ? out : null
}

// Map a raw OpenAlex Work JSON object to the subset we keep.
export function toOpenAlexWork(raw: any): OpenAlexWork {
  const source = raw?.primary_location?.source
  return {
    id: safeOpenAlexId(raw?.id), // F-08: only a real OpenAlex URL, else ''
    doi: typeof raw?.doi === 'string' ? raw.doi : null,
    displayName: raw?.display_name ?? raw?.title ?? '',
    publicationYear: typeof raw?.publication_year === 'number' ? raw.publication_year : null,
    hostVenue: source?.display_name ?? null,
    citedByCount: typeof raw?.cited_by_count === 'number' ? raw.cited_by_count : null,
    isOa: typeof raw?.open_access?.is_oa === 'boolean'
      ? raw.open_access.is_oa
      : (typeof raw?.primary_location?.is_oa === 'boolean' ? raw.primary_location.is_oa : null),
    type: raw?.type ?? null,
    primaryTopic: raw?.primary_topic?.display_name ?? null,
    // --- W2 additions ---
    oaStatus: typeof raw?.open_access?.oa_status === 'string' ? raw.open_access.oa_status : null,
    sourceId: typeof source?.id === 'string' ? source.id : null,
    sourceType: typeof source?.type === 'string' ? source.type : null,
    authorships: toAuthorships(raw),
    // --- W3 additions ---
    isRetracted: typeof raw?.is_retracted === 'boolean' ? raw.is_retracted : null,
    biblio: toBiblio(raw),
    // Only present when the gaps select was used; null (not requested) otherwise.
    referencedWorks: Array.isArray(raw?.referenced_works) ? raw.referenced_works : null,
  }
}

export type DoiLookup =
  | { kind: 'ok'; work: OpenAlexWork }
  | { kind: 'not-found' }
  | { kind: 'error'; error: string }

// FREE singleton lookup by DOI: GET /works/doi:10.xxxx/yyyy
export async function lookupByDoi(doi: string, cred: Credential = sharedCredential()): Promise<DoiLookup> {
  return lookupWork(`doi:${doi}`, cred)
}

// v1.4.5 — FREE singleton lookup by a DOI, PMID or PMCID key (see buildLookupUrl).
export async function lookupWork(key: string, cred: Credential = sharedCredential()): Promise<DoiLookup> {
  try {
    const res = await request(buildLookupUrl(key, cred))
    if (res.status === 404) return { kind: 'not-found' }
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` }
    const json = await res.json()
    return { kind: 'ok', work: toOpenAlexWork(json) }
  } catch (err) {
    if (err instanceof OpenAlexAuthError || err instanceof OpenAlexBudgetError) throw err
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export type TitleSearch =
  | { kind: 'ok'; candidates: OpenAlexWork[] }
  | { kind: 'error'; error: string }

// BILLABLE search fallback. Uses the `search` parameter (the old
// `filter=title.search:` syntax is deprecated). Returns candidates for the
// caller to fuzzy-match; a wrong match is worse than no match.
// `excludePreprints` adds `filter=type:!preprint` for the preprint→published
// resolver (Feature 4) — same search path, one extra filter.
export async function searchByTitle(title: string, excludePreprints = false, cred: Credential = sharedCredential()): Promise<TitleSearch> {
  try {
    const res = await request(buildWorksSearchUrl(title, excludePreprints, cred))
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` }
    const json = await res.json()
    const results: unknown[] = Array.isArray(json?.results) ? json.results : []
    return { kind: 'ok', candidates: results.map(toOpenAlexWork) }
  } catch (err) {
    if (err instanceof OpenAlexAuthError || err instanceof OpenAlexBudgetError) throw err
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// --- W3 citation-gap fetchers ---------------------------------------------
// All of these go through the same `request()` (pacing + retry). The gaps
// orchestrator in `src/lib/gaps.ts` sequences and paces them; no card fetches
// directly.

// FREE singleton re-fetch of an already-matched work, opting into
// `referenced_works` (gaps candidate pool). Same cost profile as a DOI lookup.
export async function fetchWorkWithRefs(openalexId: string, cred: Credential = sharedCredential()): Promise<DoiLookup> {
  try {
    const res = await request(buildWorkByIdUrl(openalexId, true, cred))
    if (res.status === 404) return { kind: 'not-found' }
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` }
    return { kind: 'ok', work: toOpenAlexWork(await res.json()) }
  } catch (err) {
    if (err instanceof OpenAlexAuthError || err instanceof OpenAlexBudgetError) throw err
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// BILLABLE list call: hydrate a batch of OpenAlex ids into full works via
// `filter=openalex_id:W1|W2|…`. `withRefs` requests referenced_works too
// (forward-citation needs it to tally which seeds each result cites).
export async function fetchWorksByIds(shortIds: string[], withRefs = false, cred: Credential = sharedCredential()): Promise<TitleSearch> {
  if (shortIds.length === 0) return { kind: 'ok', candidates: [] }
  try {
    const res = await request(buildFilterUrl(`openalex_id:${shortIds.join('|')}`, withRefs, shortIds.length, cred))
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` }
    const json = await res.json()
    const results: unknown[] = Array.isArray(json?.results) ? json.results : []
    return { kind: 'ok', candidates: results.map(toOpenAlexWork) }
  } catch (err) {
    if (err instanceof OpenAlexAuthError || err instanceof OpenAlexBudgetError) throw err
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// BILLABLE list call: works that CITE any of the seed ids (`filter=cites:…`),
// with referenced_works so the caller can tally how many seeds each cites.
export async function fetchCitingWorks(shortSeedIds: string[], perPage = 100, cred: Credential = sharedCredential()): Promise<TitleSearch> {
  if (shortSeedIds.length === 0) return { kind: 'ok', candidates: [] }
  try {
    const res = await request(buildFilterUrl(`cites:${shortSeedIds.join('|')}`, true, perPage, cred))
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` }
    const json = await res.json()
    const results: unknown[] = Array.isArray(json?.results) ? json.results : []
    return { kind: 'ok', candidates: results.map(toOpenAlexWork) }
  } catch (err) {
    if (err instanceof OpenAlexAuthError || err instanceof OpenAlexBudgetError) throw err
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// --- W4.1 usage readout ----------------------------------------------------

export function buildRateLimitUrl(cred: Credential): string {
  // No `select` needed for /rate-limit; pass '' so the shape stays a plain
  // key/mailto query built through the same encoder.
  return buildUrl('/rate-limit', {}, '', cred)
}

export type UsageResult = { kind: 'ok'; usage: RateLimitUsage } | { kind: 'unavailable' }

// Read the ACTIVE credential's usage. SAFETY INVARIANT (W4.1): never read the
// SHARED key's /rate-limit from the browser — if the active credential isn't the
// user's own key, make no call at all and report unavailable. A usage read never
// throws or blocks: any failure (network, bad shape, rejection) degrades to
// `unavailable`.
export async function fetchRateLimit(cred: Credential): Promise<UsageResult> {
  // SAFETY INVARIANT (W4.1, updated at the Worker cutover): the browser must never
  // read the SHARED key's usage by calling OpenAlex DIRECTLY. Post-cutover the
  // shared path goes through the Worker, which serves KEY-STRIPPED /rate-limit, so a
  // shared read is only safe — and only meaningful — when the shared base URL is the
  // Worker (not api.openalex.org). A user key always reads OpenAlex directly on its
  // own budget. If the shared path is still pointed straight at OpenAlex (pre-cutover
  // or rolled back), make NO call and report unavailable — exactly as before.
  if (cred.kind === 'shared' && cred.baseUrl === OPENALEX_DIRECT_URL) {
    return { kind: 'unavailable' } // shared, direct-to-OpenAlex: DO NOT CALL
  }
  try {
    const res = await request(buildRateLimitUrl(cred))
    if (!res.ok) return { kind: 'unavailable' }
    const usage = parseRateLimit(await res.json())
    return usage ? { kind: 'ok', usage } : { kind: 'unavailable' }
  } catch {
    return { kind: 'unavailable' }
  }
}
