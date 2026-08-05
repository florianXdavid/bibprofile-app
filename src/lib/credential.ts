// W4 — runtime request credential. The app's first RUNTIME choice of network
// path. Two credentials, selected per session:
//
//   • Shared (default): our build-time env values. base URL is OPENALEX_BASE_URL
//     (today api.openalex.org; LATER the Worker proxy). Frictionless, no account.
//   • User key (opt-in): the user's OWN free OpenAlex key, on THEIR budget. Its
//     base URL is ALWAYS api.openalex.org directly — deliberately a SEPARATE
//     constant so that when the shared path later flips to the Worker, the
//     user-key path is NOT dragged along (routing a user's secret through our
//     server would put it on our infrastructure for zero benefit).
//
// This module is the ONE place that decides which credential is active; the
// fetch layer (openalex.ts) consumes it. Pure and unit-tested. The user's key
// lives only in App.tsx in-memory state (dies on reload) — never persisted.

import { OPENALEX_API_KEY, OPENALEX_BASE_URL, OPENALEX_MAILTO } from '../config'

// The user-key path's endpoint. SEPARATE from OPENALEX_BASE_URL on purpose: the
// shared path's base URL will later become the Worker; this one must not move.
export const OPENALEX_DIRECT_URL = 'https://api.openalex.org'

export interface Credential {
  kind: 'shared' | 'user'
  baseUrl: string
  apiKey: string
  mailto: string
}

// What the UI collects for the opt-in path (in-memory only).
export interface UserCredential {
  apiKey: string
  mailto: string
}

// The default shared credential from build-time env (unchanged W1 behaviour when
// the feature is unused).
export function sharedCredential(): Credential {
  return { kind: 'shared', baseUrl: OPENALEX_BASE_URL, apiKey: OPENALEX_API_KEY, mailto: OPENALEX_MAILTO }
}

export function userCredential(u: UserCredential): Credential {
  return { kind: 'user', baseUrl: OPENALEX_DIRECT_URL, apiKey: u.apiKey.trim(), mailto: u.mailto.trim() }
}

// Which credential is active. A user key (once set) always routes browser-direct
// to OpenAlex; otherwise the shared credential. `shared` is injectable so a test
// can flip the shared base URL (simulating the Worker) and prove the user-key
// path is unaffected.
export function resolveCredential(
  user: UserCredential | null,
  shared: Credential = sharedCredential(),
): Credential {
  if (user && user.apiKey.trim()) return userCredential(user)
  return shared
}

// Basic client-side shape check only — trim + reject obviously empty/malformed.
// We do NOT probe OpenAlex to pre-validate; if the key is wrong the first real
// request fails and that is surfaced (see openalex.ts OpenAlexAuthError).
export function isPlausibleKey(raw: string): boolean {
  const k = (raw ?? '').trim()
  return k.length >= 8 && !/\s/.test(k)
}
