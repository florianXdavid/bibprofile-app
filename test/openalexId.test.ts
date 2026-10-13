// F-08 (audit 2026-10-13) — OpenAlex ids are rendered as links, so only a real
// OpenAlex URL survives toOpenAlexWork; anything else becomes '' and no link renders.
import { describe, it, expect } from 'vitest'
import { isOpenAlexUrl, safeOpenAlexId, toOpenAlexWork } from '../src/lib/openalex'

describe('OpenAlex ids used as links (F-08)', () => {
  it('keeps a normal work id', () => {
    expect(toOpenAlexWork({ id: 'https://openalex.org/W2106006415', display_name: 'x' }).id).toBe('https://openalex.org/W2106006415')
    expect(safeOpenAlexId('https://openalex.org/a5023888391')).toBe('https://openalex.org/a5023888391') // case-insensitive
  })
  it('drops a javascript: id and other non-OpenAlex values', () => {
    expect(toOpenAlexWork({ id: 'javascript:alert(document.domain)', display_name: 'x' }).id).toBe('')
    for (const bad of ['javascript:alert(1)', 'https://evil.example/W1', 'https://openalex.org/W1/../x', 'http://openalex.org/W1',
      'https://openalex.org/W1?x', 'https://openalex.org/C123', ' https://openalex.org/W1', 'crossref:10.1/abc', '', null, 42]) {
      expect(isOpenAlexUrl(bad), String(bad)).toBe(false)
    }
  })
})
