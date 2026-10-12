// v1.5.2 — guards the shipped "Try with an example" snapshot (offline). If example.bib
// changes, re-record (see record-example.test.ts). The example must keep showing
// exactly what it promises: one retracted paper, one preprint since published, one
// duplicate, one missing DOI added by the cleaned .bib, one reference that can't be
// verified — and nothing else alarming.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBib } from '../../src/lib/parseBib'
import { hydrateExample, type ExampleSnapshot } from '../../src/demo/exampleData'
import { computeRetractions } from '../../src/lib/stats/retractions'
import { computeVerification } from '../../src/lib/stats/verification'
import { computeCleanedBib } from '../../src/lib/stats/cleanBib'
import { detectPreprints } from '../../src/lib/preprintResolve'
import { buildReportHtml } from '../../src/lib/reportHtml'

const bib = readFileSync(fileURLToPath(new URL('../../src/demo/example.bib', import.meta.url)), 'utf8')
const snap = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/demo/example-results.json', import.meta.url)), 'utf8')) as ExampleSnapshot
const ex = hydrateExample(snap)
const row = (k: string) => ex.rows.find(r => r.citeKey === k)!

describe('the "Try with an example" snapshot', () => {
  it('was recorded from the current example.bib (else re-record)', () => {
    const parsed = parseBib(bib)
    expect(ex.rows.map(r => r.raw)).toEqual(parsed.entries.map(e => e.raw))
    expect(parsed.entries).toHaveLength(30)
  })
  it('shows what the example promises', () => {
    const retracted = computeRetractions(ex.rows, ex.crossref).retracted.map(f => f.rowId)
    const v = computeVerification(ex.rows, retracted)
    expect(v.couldNotVerify.map(r => r.citeKey)).toEqual(['kessler2021']) // the invented reference
    expect(v.wrongDoi).toEqual([])
    expect(v.retracted?.map(r => r.citeKey)).toEqual(['chaudhary2017'])
    expect(row('noauthor_neuroprosthesis_nodate').duplicateOf).toBe('moses2021')
    expect(v.verified).toBe(v.total - 1)
    const hochberg = computeCleanedBib(ex.rows).entries.find(c => c.citeKey === 'hochberg2012')!
    expect(hochberg.applied.map(f => f.field)).toContain('doi')
    expect(detectPreprints(ex.rows).map(d => d.citeKey)).toEqual(['willett2023pre'])
    expect([...(ex.preprints?.resolved.keys() ?? [])]).toEqual([row('willett2023pre').rowId])
  })
  it('builds a self-contained report: no script, no external resource, the footer', () => {
    const html = buildReportHtml({ rows: ex.rows, fileName: 'example.bib', crossref: ex.crossref, preprints: ex.preprints, co: ex.co, fw: ex.fw, date: new Date('2026-10-12'), referenceYear: 2026 })
    expect(html).not.toMatch(/<script|<link|<img|src=/i)
    expect(html).toContain('Checked with BibProfile — <a class="site" href="https://bibprofile.com">bibprofile.com</a> · runs in your browser, nothing stored')
    expect(html).toContain('kessler2021')
    expect(html).toContain('chaudhary2017')
  })
})
