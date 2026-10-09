import { describe, it, expect, vi, afterEach } from 'vitest'
import { lookupByDoi, retryDelayMs } from '../src/lib/openalex'

// v1.4.2 patch — the one retry after a plain 429 waits as long as the server asks.
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('retryDelayMs', () => {
  it('uses the Retry-After header when readable', () => {
    expect(retryDelayMs('10', '')).toBe(10_000)
  })
  it("falls back to the Worker's JSON body (the header isn't CORS-exposed)", () => {
    expect(retryDelayMs(null, '{"error":"rate_limited","retry_after_seconds":10}')).toBe(10_000)
  })
  it('never waits less than the default backoff, never more than 15 s', () => {
    expect(retryDelayMs(null, 'not json')).toBe(900)
    expect(retryDelayMs('0', '')).toBe(900)
    expect(retryDelayMs('120', '')).toBe(15_000)
  })
})

describe('request — 429 then success', () => {
  it('waits for the hinted delay, retries once, and returns the result', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      return calls === 1
        ? new Response('{"error":"rate_limited","retry_after_seconds":10}', { status: 429 })
        : new Response(JSON.stringify({ id: 'https://openalex.org/W1', display_name: 'X' }), { status: 200 })
    }))
    const p = lookupByDoi('10.1000/x')
    await vi.advanceTimersByTimeAsync(9_000)
    expect(calls).toBe(1) // still waiting — a 900 ms retry would already have fired
    await vi.advanceTimersByTimeAsync(1_000)
    const res = await p
    expect(calls).toBe(2)
    expect(res.kind).toBe('ok')
  })
})
