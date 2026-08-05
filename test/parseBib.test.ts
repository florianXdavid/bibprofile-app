import { describe, it, expect } from 'vitest'
import { parseBib } from '../src/lib/parseBib'

describe('parseBib', () => {
  it('routes a completely empty entry to unparseable, not not-found (Fix 7)', () => {
    const r = parseBib('@article{noauthor_notitle_nodate,\n}\n')
    expect(r.entries.find(e => e.citeKey === 'noauthor_notitle_nodate')).toBeUndefined()
    expect(r.unparseable.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps a legacy Wiley angle-bracket DOI intact at ingest (Fix 2)', () => {
    const bib = [
      '@article{altman1999,',
      '  title = {Why randomise?},',
      '  doi = {10.1002/(SICI)1097-0258(19990615)18:11<1387::AID-SIM126>3.0.CO;2-V}',
      '}',
    ].join('\n')
    const r = parseBib(bib)
    const e = r.entries.find(x => x.citeKey === 'altman1999')!
    expect(e.doi).toBe('10.1002/(sici)1097-0258(19990615)18:11<1387::aid-sim126>3.0.co;2-v')
    expect(e.doiRaw).toContain('<1387::AID-SIM126>')
  })

  it('decodes \\_ in titles and flags a URL-venue @misc as likely not indexable (Fix 7/8)', () => {
    const bib = '@misc{k, title={Standing\\_backflip motion dataset}, howpublished={https://example.org/standing_backflip}, year={2018}}'
    const r = parseBib(bib)
    const e = r.entries.find(x => x.citeKey === 'k')!
    expect(e.title).toBe('Standing_backflip motion dataset')
    expect(e.likelyNotIndexable).toBe(true)
  })

  it('cleans site-name cruft into titleForSearch but keeps the original title (Fix 3)', () => {
    const bib = '@article{t, title={Efficient computation of optimal actions | PNAS}, year={2009}}'
    const r = parseBib(bib)
    const e = r.entries.find(x => x.citeKey === 't')!
    expect(e.title).toBe('Efficient computation of optimal actions | PNAS')
    expect(e.titleForSearch).toBe('Efficient computation of optimal actions')
  })
})
