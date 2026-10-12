import { describe, it, expect } from 'vitest'
import { bucketOf, computeVerification, scholarUrl } from '../../src/lib/stats/verification'
import { mkRow } from './fixtures'
import type { MatchStatus } from '../../src/types'

describe('verification card (v1.5.1)', () => {
  const statuses: MatchStatus[] = ['matched-by-doi', 'matched-by-title', 'not-found', 'uncertain', 'suspicious', 'not-indexable', 'error', 'pending', 'unparseable']
  const rows = statuses.map((status, i) => mkRow({ rowId: `r${i}`, citeKey: `k${i}`, status }))

  it('puts every unique, parseable reference in exactly one bucket (the numbers add up)', () => {
    const v = computeVerification([...rows, mkRow({ status: 'matched-by-doi', duplicateOf: 'k0' })], null)
    expect(v.total).toBe(8) // the duplicate and the unparseable block don't count
    expect(v.verified).toBe(2)
    expect(v.couldNotVerify.map(r => r.status)).toEqual(['not-found', 'uncertain'])
    expect(v.wrongDoi.map(r => r.citeKey)).toEqual(['k4'])
    expect([v.notCheckable, v.errored, v.pending, v.unparseable]).toEqual([1, 1, 1, 1])
    expect(v.verified + v.couldNotVerify.length + v.wrongDoi.length + v.notCheckable + v.errored + v.pending).toBe(v.total)
  })
  it('retracted is null while Crossref is still checking, then lists the rows', () => {
    expect(computeVerification(rows, null).retracted).toBeNull()
    expect(computeVerification(rows, ['r0']).retracted?.map(r => r.citeKey)).toEqual(['k0'])
  })
  it('every status has a bucket except unparseable', () => {
    expect(statuses.filter(s => bucketOf(s) == null)).toEqual(['unparseable'])
  })
  it('links to a Google Scholar search on the quoted title and first author', () => {
    const r = mkRow({ title: 'Generative "Adversarial" Nets' })
    r.entry = { titleForSearch: 'Generative "Adversarial" Nets', firstAuthor: 'Goodfellow' } as any
    expect(scholarUrl(r)).toBe('https://scholar.google.com/scholar?q=' + encodeURIComponent('"Generative Adversarial Nets" Goodfellow'))
  })
})
