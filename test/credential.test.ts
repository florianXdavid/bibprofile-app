import { describe, it, expect } from 'vitest'
import {
  OPENALEX_DIRECT_URL,
  isPlausibleKey,
  resolveCredential,
  sharedCredential,
  type Credential,
} from '../src/lib/credential'

// A stand-in for the pending Worker proxy: the SHARED path's base URL flips to
// this later. The user-key path must not be dragged along.
const workerShared: Credential = {
  kind: 'shared',
  baseUrl: 'https://bibprofile-proxy.workers.dev',
  apiKey: 'SHARED_KEY',
  mailto: '',
}

describe('resolveCredential — shared is the default', () => {
  it('no user key -> the shared credential', () => {
    const c = resolveCredential(null)
    expect(c.kind).toBe('shared')
    expect(c).toEqual(sharedCredential())
  })

  it('an empty / whitespace-only user key -> still shared', () => {
    expect(resolveCredential({ apiKey: '   ', mailto: '' }).kind).toBe('shared')
  })
})

describe('resolveCredential — a user key opts into browser-direct', () => {
  it('routes to api.openalex.org directly, carrying the (trimmed) user key', () => {
    const c = resolveCredential({ apiKey: '  mysecretkey123  ', mailto: '  me@x.org ' })
    expect(c.kind).toBe('user')
    expect(c.baseUrl).toBe(OPENALEX_DIRECT_URL)
    expect(c.baseUrl).toBe('https://api.openalex.org')
    expect(c.apiKey).toBe('mysecretkey123')
    expect(c.mailto).toBe('me@x.org')
  })
})

describe('the user-key path is decoupled from the shared base URL', () => {
  it('flipping the shared base to a Worker moves ONLY the shared path', () => {
    // shared path follows the flip…
    expect(resolveCredential(null, workerShared).baseUrl).toBe('https://bibprofile-proxy.workers.dev')
    // …the user-key path stays browser-direct regardless of the shared flip.
    const user = resolveCredential({ apiKey: 'userkey12345', mailto: '' }, workerShared)
    expect(user.baseUrl).toBe(OPENALEX_DIRECT_URL)
    expect(user.apiKey).toBe('userkey12345')
  })
})

describe('clearing returns to the shared pool', () => {
  it('resolving null (what Clear produces) yields the shared credential', () => {
    expect(resolveCredential(null).kind).toBe('shared')
  })
})

describe('isPlausibleKey — coarse client-side shape check only', () => {
  it('rejects empty / whitespace / too-short / internally-spaced values', () => {
    expect(isPlausibleKey('')).toBe(false)
    expect(isPlausibleKey('   ')).toBe(false)
    expect(isPlausibleKey('short')).toBe(false)
    expect(isPlausibleKey('has space inside')).toBe(false)
  })

  it('accepts a plausible token (after trimming)', () => {
    expect(isPlausibleKey('  abcd123456  ')).toBe(true)
  })
})
