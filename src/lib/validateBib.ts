// W3.2 — input guards. Two coarse gates that reject a pathological upload BEFORE
// any OpenAlex call, so a single 1,000-entry dump can't burn a large share of the
// shared budget. Pure (no fetch, no DOM); enforced on the one upload path in
// App.tsx: size before parsing, entry count after parsing and before matching.
//
// Framing is scope, never scarcity — this is a per-paper tool, which is also true
// of the report's statistics (they describe one paper's reference list).

import { MAX_BIB_BYTES, MAX_BIB_ENTRIES } from '../config'

export interface BibCheck {
  ok: boolean
  message?: string
}

// UTF-8 byte length of the .bib text (multibyte-safe — a char isn't a byte).
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`

// Gate 1 — file size, checked before the parser is invoked.
export function checkBibSize(bytes: number): BibCheck {
  if (bytes <= MAX_BIB_BYTES) return { ok: true }
  return {
    ok: false,
    message: `This file is ${mb(bytes)}. BibProfile handles files up to ${(MAX_BIB_BYTES / 1_000_000).toFixed(0)} MB.`,
  }
}

// Gate 2 — parsed-entry count (the unit that drives lookups), checked after a
// successful parse and before the matching pipeline starts.
export function checkBibEntryCount(entries: number): BibCheck {
  if (entries <= MAX_BIB_ENTRIES) return { ok: true }
  return {
    ok: false,
    message: `This file has ${entries} entries. BibProfile is built for single-paper bibliographies and handles up to ${MAX_BIB_ENTRIES} references.`,
  }
}
