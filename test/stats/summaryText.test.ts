import { describe, it, expect } from 'vitest'
import { buildCohort } from '../../src/lib/stats/denominator'
import { buildSummaryText } from '../../src/lib/stats/summaryText'
import { getBaseline } from '../../src/lib/baselines'
import { matchedRow, mkRow } from './fixtures'

describe('buildSummaryText', () => {
  const rows = [
    matchedRow({ publicationYear: 2015, isOa: true, oaStatus: 'gold', hostVenue: 'Journal of Neurophysiology', sourceId: 'S_jn', sourceType: 'journal' }, { citeKey: 'a' }),
    matchedRow({ publicationYear: 2019, isOa: false, oaStatus: 'closed', hostVenue: 'Journal of Neurophysiology', sourceId: 'S_jn', sourceType: 'journal' }, { citeKey: 'b' }),
    matchedRow({ publicationYear: 2022, isOa: true, oaStatus: 'green', hostVenue: 'Nature', sourceId: 'S_nat', sourceType: 'journal' }, { citeKey: 'c' }),
    mkRow({ citeKey: 'c2', duplicateOf: 'c', openalex: null }),
    mkRow({ status: 'unparseable', openalex: null }),
  ]
  const text = buildSummaryText(buildCohort(rows), 2024)

  it('states the composition with duplicates and unparseable counts', () => {
    expect(text).toContain('unique works')
    expect(text).toMatch(/1 duplicate/)
    expect(text).toMatch(/1 unparseable/)
  })

  it('reports median year and the most-cited venue', () => {
    expect(text).toContain('Median publication year 2019')
    expect(text).toContain('Journal of Neurophysiology')
  })

  it('is a single descriptive paragraph, no evaluative wording', () => {
    expect(text).not.toMatch(/too (recent|old)|should|poor|good/i)
  })
})

describe('baselines stub', () => {
  it('returns null for every field in v1 (no placeholder numbers)', () => {
    expect(getBaseline('neuroscience')).toBeNull()
    expect(getBaseline('')).toBeNull()
  })
})
