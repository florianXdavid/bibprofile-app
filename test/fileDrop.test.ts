import { describe, it, expect } from 'vitest'
import { looksLikeBibtex } from '../src/components/FileDrop'

describe('pasted BibTeX check (v1.5.3)', () => {
  it('accepts BibTeX entries, also with a leading comment or @type (…) parentheses', () => {
    expect(looksLikeBibtex('@article{key,\n title = {T}\n}')).toBe(true)
    expect(looksLikeBibtex('% exported\n@InProceedings (k, title = "T")')).toBe(true)
  })
  it('rejects a pasted reference list, a DOI or prose', () => {
    expect(looksLikeBibtex('Smith, J. (2020). A title. Nature, 1, 2–3. https://doi.org/10.1/x')).toBe(false)
    expect(looksLikeBibtex('10.1038/nature14539')).toBe(false)
    expect(looksLikeBibtex('email me @ john')).toBe(false)
  })
})
