import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchRateLimit,
  ipQuotaResetFromBody,
  looksLikeBudgetExhaustion,
  OpenAlexAuthError,
} from '../src/lib/openalex'
import { mergeRows, runMatching } from '../src/lib/match'
import { sharedCredential, userCredential, type Credential } from '../src/lib/credential'
import type { BibEntry, ParseResult } from '../src/types'

afterEach(() => vi.unstubAllGlobals())

// Serve mocked fetch responses in order; the last responder repeats.
function mockFetch(responders: Array<() => Response>) {
  let i = 0
  const spy = vi.fn(async () => responders[Math.min(i++, responders.length - 1)]())
  vi.stubGlobal('fetch', spy)
  return spy
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const work = (id: string, title: string) => jsonRes({ id, display_name: title, publication_year: 2020 })
const budget429 = () => new Response('{"error":"daily budget exhausted"}', { status: 429 })

function entry(over: Partial<BibEntry>): BibEntry {
  return {
    rowId: 'e', sourceOffset: 0, citeKey: 'k', entryType: 'article',
    title: 'T', titleForSearch: 'T', authors: '', year: null, venue: '',
    doiRaw: null, doi: null, firstAuthor: '', volume: '', pages: '', titleRetracted: false,
    altId: null, dupKeyIndex: null, raw: '', likelyNotIndexable: false, ...over,
  }
}
const parsed = (entries: BibEntry[]): ParseResult => ({ entries, unparseable: [], warnings: [] })
const user = userCredential({ apiKey: 'userkey12345', mailto: '' })

// ---------------------------------------------------------------------------

describe('W4.1 SAFETY — never read the shared key usage from the browser', () => {
  it('shared credential → makes NO network call (the load-bearing invariant)', async () => {
    const spy = mockFetch([() => jsonRes({})])
    const res = await fetchRateLimit(sharedCredential())
    expect(spy).not.toHaveBeenCalled()
    expect(res).toEqual({ kind: 'unavailable' })
  })

  it('shared credential routed through the WORKER → reads the Worker /rate-limit (no key sent) and maps it', async () => {
    const spy = mockFetch([() => jsonRes({ daily_budget_usd: 1, daily_used_usd: 0.3, resets_at: '2026-01-01T18:00:00Z' })])
    // Post-cutover: the shared base URL is the Worker and the shared credential
    // carries NO key (the Worker injects it). The browser reads the Worker, never
    // OpenAlex-with-the-shared-key — preserving the safety invariant's intent.
    const sharedViaWorker: Credential = { kind: 'shared', baseUrl: 'https://bibprofile-worker.example.workers.dev', apiKey: '', mailto: '' }
    const res = await fetchRateLimit(sharedViaWorker)
    expect(spy).toHaveBeenCalledTimes(1)
    const url = String(spy.mock.calls[0][0])
    expect(url).toContain('https://bibprofile-worker.example.workers.dev/rate-limit')
    expect(url).not.toContain('api_key=') // shared path sends NO key — the Worker injects it
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') expect(res.usage.usedUsd).toBe(0.3)
  })

  it('user credential → calls /rate-limit with the user key, maps the payload', async () => {
    const spy = mockFetch([() => jsonRes({ daily_budget_usd: 1, daily_used_usd: 0.2, resets_at: '2026-01-01T18:00:00Z' })])
    const res = await fetchRateLimit(user)
    expect(spy).toHaveBeenCalledTimes(1)
    const url = String(spy.mock.calls[0][0])
    expect(url).toContain('https://api.openalex.org/rate-limit')
    expect(url).toContain('api_key=userkey12345')
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') expect(res.usage.usedUsd).toBe(0.2)
  })

  it('a failed usage read degrades to "unavailable" (never throws / never a 0 bar)', async () => {
    mockFetch([() => new Response('boom', { status: 500 })])
    expect(await fetchRateLimit(user)).toEqual({ kind: 'unavailable' })
  })
})

describe('looksLikeBudgetExhaustion', () => {
  it('distinguishes budget wording from plain rate-limiting', () => {
    expect(looksLikeBudgetExhaustion('Your daily budget has been exhausted')).toBe(true)
    expect(looksLikeBudgetExhaustion('{"error":"insufficient funds"}')).toBe(true)
    expect(looksLikeBudgetExhaustion('too many requests, please slow down')).toBe(false)
  })
})

describe('W4.1 graceful shared-pool exhaustion + Resume', () => {
  const three = () => [
    entry({ rowId: 'e1', sourceOffset: 0, citeKey: 'a', title: 'Alpha', doi: '10.1234/a' }),
    entry({ rowId: 'e2', sourceOffset: 1, citeKey: 'b', title: 'Beta', doi: '10.1234/b' }),
    entry({ rowId: 'e3', sourceOffset: 2, citeKey: 'c', title: 'Gamma', doi: '10.1234/c' }),
  ]

  it('halts on a shared-pool budget rejection: partial kept, remainder pending', async () => {
    mockFetch([() => work('https://openalex.org/W1', 'Alpha'), budget429])
    const { rows, exhausted } = await runMatching(parsed(three()), () => {}, sharedCredential())
    expect(exhausted).toBeTruthy()
    const status = Object.fromEntries(rows.map(r => [r.citeKey, r.status]))
    expect(status.a).toBe('matched-by-doi') // already matched, kept
    expect(status.b).toBe('pending') // run paused, did not fail
    expect(status.c).toBe('pending')
  })

  it('Resume re-queries ONLY the pending set and merges — matched ones untouched', async () => {
    // 1. halt after 'a'
    mockFetch([() => work('https://openalex.org/W1', 'Alpha'), budget429])
    const first = await runMatching(parsed(three()), () => {}, sharedCredential())
    const pending = first.rows.filter(r => r.status === 'pending' && r.entry).map(r => r.entry!)
    expect(pending.map(e => e.citeKey)).toEqual(['b', 'c'])

    // 2. resume the pending two on the user key
    mockFetch([() => work('https://openalex.org/W2', 'Beta'), () => work('https://openalex.org/W3', 'Gamma')])
    const resumed = await runMatching(parsed(pending), () => {}, user)
    const merged = mergeRows(first.rows, resumed.rows)

    const status = Object.fromEntries(merged.map(r => [r.citeKey, r.status]))
    expect(status).toEqual({ a: 'matched-by-doi', b: 'matched-by-doi', c: 'matched-by-doi' })
    expect(resumed.exhausted).toBeNull()
  })

  // F-03 (audit 2026-10-13) — the proxy's per-IP daily quota halts like exhaustion,
  // with its own reason (the UI shows its own message), and is never retried.
  it('halts on the proxy\'s ip_daily_quota reply with reason "ip-quota", no retry', async () => {
    const ipQuota429 = () => new Response('{"error":"ip_daily_quota","retry_after_seconds":3600}', { status: 429, headers: { 'Retry-After': '3600' } })
    const spy = mockFetch([() => work('https://openalex.org/W1', 'Alpha'), ipQuota429])
    const before = Date.now()
    const { rows, exhausted } = await runMatching(parsed(three()), () => {}, sharedCredential())
    expect(exhausted?.reason).toBe('ip-quota')
    const reset = Date.parse(exhausted!.resetsAt!)
    expect(reset).toBeGreaterThanOrEqual(before + 3600_000 - 1000)
    expect(reset).toBeLessThanOrEqual(Date.now() + 3600_000 + 1000)
    expect(Object.fromEntries(rows.map(r => [r.citeKey, r.status]))).toEqual({ a: 'matched-by-doi', b: 'pending', c: 'pending' })
    expect(spy).toHaveBeenCalledTimes(2) // the 429 was not retried
  })

  it('the pool running dry keeps reason "pool"; the proxy\'s counter outage is not exhaustion', async () => {
    mockFetch([() => work('https://openalex.org/W1', 'Alpha'), budget429])
    expect((await runMatching(parsed(three()), () => {}, sharedCredential())).exhausted?.reason).toBe('pool')
    expect(looksLikeBudgetExhaustion('{"error":"counter_unavailable","retry_after_seconds":60}')).toBe(false)
    expect(ipQuotaResetFromBody('{"error":"rate_limited","retry_after_seconds":10}')).toBeUndefined()
    expect(ipQuotaResetFromBody('not json')).toBeUndefined()
  })

  it('an AUTH failure on a user key is NOT the exhaustion path — it propagates', async () => {
    mockFetch([() => new Response('no', { status: 401 })])
    await expect(
      runMatching(parsed([entry({ rowId: 'e1', citeKey: 'a', title: 'Alpha', doi: '10.1234/a' })]), () => {}, user),
    ).rejects.toBeInstanceOf(OpenAlexAuthError)
  })
})
