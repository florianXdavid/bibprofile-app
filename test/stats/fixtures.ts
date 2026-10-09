// Shared builders for the W2 stats tests. Not a test file itself (no *.test.ts),
// so vitest ignores it. All data is mock — no network, matching W1's approach.

import type { MatchStatus, OpenAlexAuthorship, OpenAlexWork, ResultRow } from '../../src/types'

const MATCHED: MatchStatus[] = ['matched-by-doi', 'matched-by-title', 'suspicious']

export function mkAuthor(name: string, orcid: string | null = null): OpenAlexAuthorship {
  return { authorName: name, orcid }
}

export function mkWork(over: Partial<OpenAlexWork> = {}): OpenAlexWork {
  return {
    id: 'https://openalex.org/W' + Math.random().toString(36).slice(2, 7),
    doi: null,
    displayName: 'Work',
    publicationYear: null,
    hostVenue: null,
    citedByCount: null,
    isOa: null,
    type: null,
    primaryTopic: null,
    oaStatus: null,
    sourceId: null,
    sourceType: null,
    authorships: [],
    isRetracted: null,
    biblio: null,
    referencedWorks: null,
    ...over,
  }
}

let counter = 0
export function mkRow(over: Partial<ResultRow> = {}): ResultRow {
  counter++
  const status: MatchStatus = over.status ?? 'matched-by-doi'
  const openalex = 'openalex' in over
    ? over.openalex ?? null
    : (MATCHED.includes(status) ? mkWork() : null)
  return {
    rowId: over.rowId ?? `r${counter}`,
    sourceOffset: over.sourceOffset ?? counter,
    citeKey: over.citeKey ?? `key${counter}`,
    title: over.title ?? 'Title',
    bibYear: over.bibYear ?? null,
    status,
    openalex,
    matchScore: over.matchScore ?? null,
    yearState: over.yearState ?? 'unverified',
    duplicateOf: over.duplicateOf ?? null,
    error: over.error ?? null,
    raw: over.raw ?? '',
    entry: over.entry ?? null,
    twins: over.twins,
  }
}

// A matched row that carries a specific OpenAlex work.
export function matchedRow(work: Partial<OpenAlexWork>, over: Partial<ResultRow> = {}): ResultRow {
  return mkRow({ status: 'matched-by-doi', openalex: mkWork(work), ...over })
}
