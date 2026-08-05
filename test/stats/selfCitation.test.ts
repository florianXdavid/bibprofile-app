import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import { findSelfCitations, nameKey, nameKeysMatch } from '../../src/lib/stats/selfCitation'
import { matchedRow, mkAuthor } from './fixtures'

const ORCID = '0000-0002-1825-0097'

const cohort = buildCohort([
  matchedRow(
    { authorships: [mkAuthor('Emanuel Todorov', ORCID), mkAuthor('Weiwei Li')] },
    { citeKey: 'todorov2005', title: 'Optimal feedback control' },
  ),
  matchedRow(
    { authorships: [mkAuthor('Grace Hopper')] },
    { citeKey: 'hopper1952', title: 'Compilers' },
  ),
  matchedRow({ authorships: [] }, { citeKey: 'noauthors', title: 'Mystery work' }),
])

describe('nameKey parsing', () => {
  it('parses "First Last" and "Last, First" to the same key', () => {
    expect(nameKey('Emanuel Todorov')).toEqual({ surname: 'todorov', initial: 'e' })
    expect(nameKey('Todorov, Emanuel')).toEqual({ surname: 'todorov', initial: 'e' })
  })

  it('surname agreement matches when an initial is missing on one side', () => {
    expect(nameKeysMatch({ surname: 'todorov', initial: '' }, { surname: 'todorov', initial: 'e' })).toBe(true)
    expect(nameKeysMatch({ surname: 'todorov', initial: 'x' }, { surname: 'todorov', initial: 'e' })).toBe(false)
  })
})

describe('findSelfCitations', () => {
  it('matches exactly by ORCID', () => {
    const r = findSelfCitations(cohort, { name: '', orcid: `https://orcid.org/${ORCID}` })
    expect(r.via).toBe('orcid')
    expect(r.matches.map(m => m.citeKey)).toEqual(['todorov2005'])
    expect(r.matches[0].via).toBe('orcid')
  })

  it('matches by surname + initial and reports the matched author for verification', () => {
    const r = findSelfCitations(cohort, { name: 'Emanuel Todorov' })
    expect(r.via).toBe('name')
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].matchedAuthor).toBe('Emanuel Todorov')
  })

  it('does not match a different surname', () => {
    const r = findSelfCitations(cohort, { name: 'Ada Lovelace' })
    expect(r.selfCount).toBe(0)
  })

  it('counts works with no author data separately and sizes n on searchable works', () => {
    const r = findSelfCitations(cohort, { name: 'Emanuel Todorov' })
    expect(r.n).toBe(2) // two works had authorship data
    expect(r.noAuthorData).toBe(1)
    expect(r.share).toBeCloseTo(1 / 2)
  })
})
