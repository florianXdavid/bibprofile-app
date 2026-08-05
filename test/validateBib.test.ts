import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { byteLength, checkBibSize, checkBibEntryCount } from '../src/lib/validateBib'
import { parseBib } from '../src/lib/parseBib'
import { MAX_BIB_BYTES, MAX_BIB_ENTRIES } from '../src/config'

describe('gate 1 — file size (before parsing)', () => {
  it('rejects a file over the limit, stating the actual size and the limit', () => {
    const r = checkBibSize(byteLength('x'.repeat(MAX_BIB_BYTES + 1)))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/MB/)
    expect(r.message).toContain('up to 1 MB')
  })

  it('accepts a file at the limit', () => {
    expect(checkBibSize(MAX_BIB_BYTES).ok).toBe(true)
  })
})

describe('gate 2 — parsed-entry count (before matching)', () => {
  it('rejects 301 entries with an actionable, scope-framed message', () => {
    const r = checkBibEntryCount(301)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('301 entries')
    expect(r.message).toContain('up to 300 references')
    expect(r.message).not.toMatch(/quota|credit|limit reached/i) // scope, not scarcity
  })

  it('accepts exactly 300', () => {
    expect(checkBibEntryCount(MAX_BIB_ENTRIES).ok).toBe(true)
  })

  it('counts PARSED entries, not raw @ occurrences', () => {
    const bib = Array.from({ length: 301 }, (_, i) =>
      `@article{k${i}, title = {T${i}}, doi = {10.1234/x${i}}}`,
    ).join('\n\n')
    const parsed = parseBib(bib)
    expect(parsed.entries.length).toBe(301)
    expect(checkBibEntryCount(parsed.entries.length).ok).toBe(false)
  })
})

describe('the bundled sample passes both gates', () => {
  const sample = readFileSync(fileURLToPath(new URL('../src/sample.bib', import.meta.url)), 'utf8')

  it('is under the size limit', () => {
    expect(checkBibSize(byteLength(sample)).ok).toBe(true)
  })

  it('has at most 300 parsed entries', () => {
    expect(checkBibEntryCount(parseBib(sample).entries.length).ok).toBe(true)
  })
})
