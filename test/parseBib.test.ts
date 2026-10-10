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

describe('parseBib v1.4.5', () => {
  const one = (bib: string) => parseBib(bib).entries[0]

  it('keeps the title as written: no sentence-casing, < and > literal (M3)', () => {
    expect(one('@article{a, title={{Discovery with SDSS-V and Gaia}}}').title).toBe('Discovery with SDSS-V and Gaia')
    expect(one('@article{a, title={Zur Elektrodynamik bewegter K{\\"o}rper}}').title).toBe('Zur Elektrodynamik bewegter Körper')
    const t = one('@article{a, title={{at 4 kpc <\\raisebox{-0.5ex}\\textasciitilde R}}}').title
    expect(t).toContain('4 kpc <')
    expect(t).not.toMatch(/¡|0\.5ex/)
  })

  it('finds identifiers outside the doi field (H4)', () => {
    const alt = (fields: string) => one(`@article{a, title={T}, ${fields}}`).altId
    expect(alt('url={https://doi.org/10.1038/382420a0}')).toEqual({ key: 'doi:10.1038/382420a0', doi: '10.1038/382420a0', field: 'url' })
    expect(alt('url={http://dx.doi.org/10.1103/PhysRevE.80.040903}')?.doi).toBe('10.1103/physreve.80.040903')
    expect(alt('note={\\url{https://doi.org/10.1038/s41551-026-01666-y}}')?.field).toBe('note')
    expect(alt('howpublished={bioRxiv [Preprint] (2021). \\url{https://doi.org/10.1101/2021.07.09.451638}}')?.doi).toBe('10.1101/2021.07.09.451638')
    expect(alt('journal={arXiv preprint arXiv:2009.07896}')?.doi).toBe('10.48550/arxiv.2009.07896')
    expect(alt('howpublished={arXiv:2503.01743 [cs.CL]}')?.doi).toBe('10.48550/arxiv.2503.01743')
    expect(alt('archivePrefix={arXiv}, eprint={2012.05220}')?.doi).toBe('10.48550/arxiv.2012.05220')
    expect(alt('eprint={astro-ph/0405198}, archivePrefix={arXiv}')?.doi).toBe('10.48550/arxiv.astro-ph/0405198')
    expect(alt('url={https://arxiv.org/abs/1611.07004v3}')?.doi).toBe('10.48550/arxiv.1611.07004')
    expect(alt('url={https://pubmed.ncbi.nlm.nih.gov/34260835/}')?.key).toBe('pmid:34260835')
    expect(alt('pmid={34260835}')?.key).toBe('pmid:34260835')
    expect(alt('url={https://elifesciences.org/articles/18554}')?.doi).toBe('10.7554/elife.18554')
    expect(alt('url={https://example.org/page}')).toBeNull()
    expect(alt('doi={10.1/x}, url={https://doi.org/10.2/y}')).toBeNull() // the doi field wins
  })

  it('reads a year in parentheses from howpublished / note when there is no year (L1)', () => {
    expect(one('@misc{a, title={T}, howpublished={bioRxiv 2021.07.09.451638 [Preprint] (2021).}}').year).toBe(2021)
  })

  it('skips a corporate first author for the author signal (H1)', () => {
    expect(one('@article{a, title={T}, author={{Gaia Collaboration} and {Brown}, A. G. A.}}').firstAuthor).toBe('Brown')
    expect(one('@misc{a, title={T}, author={{OpenAI}}}').firstAuthor).toBe('OpenAI') // nobody else to pick
  })

  it('numbers the copies of a repeated cite key, each at its own offset (H3)', () => {
    const src = '@article{d, title={T}}\n@article{d, title={T}}\n@article{e, title={U}}\n'
    const r = parseBib(src)
    expect(r.entries.map(e => e.dupKeyIndex)).toEqual([1, 2, null])
    expect(new Set(r.entries.map(e => e.sourceOffset)).size).toBe(3)
  })

  it('a web page / software / dataset with a URL and no identifier is likely not indexable (M4)', () => {
    expect(one('@misc{a, title={AntroPy}, author={Vallat, R.}, year={2025}, url={https://raphaelvallat.com/antropy}}').likelyNotIndexable).toBe(true)
    expect(one('@misc{a, title={X}, year={2020}, url={https://arxiv.org/abs/2001.00001}}').likelyNotIndexable).toBe(false)
  })
})
