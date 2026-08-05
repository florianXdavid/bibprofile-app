// Shared types for the parse -> match -> display pipeline.

export type MatchStatus =
  | 'matched-by-doi'
  | 'matched-by-title'
  | 'suspicious' // matched but title similarity is low — user should judge
  | 'not-found'
  | 'not-indexable' // not a scholarly work OpenAlex would index
  | 'error'
  | 'unparseable'
  | 'pending'

// Tri-state year check (Fix A3b). `unverified` = a year is missing on either
// side. It must NEVER be treated as agreement anywhere.
export type YearState = 'agree' | 'disagree' | 'unverified'

export interface BibEntry {
  rowId: string
  sourceOffset: number // character offset of this block in the source .bib (file order)
  citeKey: string
  entryType: string
  title: string // for display / similarity comparison (original)
  titleForSearch: string // cleaned of site-name cruft etc. (query only)
  authors: string
  year: number | null
  venue: string
  doiRaw: string | null // exactly as it appeared in the .bib (NOT html-sanitised)
  doi: string | null // normalised (see lib/doi.ts)
  raw: string
  likelyNotIndexable: boolean // Fix 8/A4 pre-flag; used only to classify a miss
}

export interface UnparseableEntry {
  rowId: string
  sourceOffset: number
  citeKey: string | null
  error: string
  raw: string
}

// One author slot from an OpenAlex Work's `authorships[]` (W2, self-citation).
export interface OpenAlexAuthorship {
  authorName: string // authorships[].author.display_name
  orcid: string | null // authorships[].author.orcid (normalised bare form)
}

// Bibliographic detail (W3, cleaned export). All strings — OpenAlex returns page
// numbers as strings ("1387") and they can be non-numeric ("e0234").
export interface OpenAlexBiblio {
  volume: string | null
  issue: string | null
  firstPage: string | null
  lastPage: string | null
}

// The subset of an OpenAlex Work we capture. W1 kept the first block; W2 adds
// the analysis-card fields; W3 adds retraction, biblio, and (conditionally)
// the referenced-works list used only by the citation-gap card.
export interface OpenAlexWork {
  id: string
  doi: string | null
  displayName: string
  publicationYear: number | null
  hostVenue: string | null // primary_location.source.display_name
  citedByCount: number | null
  isOa: boolean | null // open_access.is_oa
  type: string | null
  primaryTopic: string | null
  // --- W2 additions (analysis cards) ---
  oaStatus: string | null // open_access.oa_status (gold/green/hybrid/bronze/closed)
  sourceId: string | null // primary_location.source.id — stable venue-grouping key
  sourceType: string | null // primary_location.source.type — journal/repository/conference
  authorships: OpenAlexAuthorship[] // author display names + ORCIDs (self-citation)
  // --- W3 additions ---
  isRetracted: boolean | null // is_retracted (retraction card)
  biblio: OpenAlexBiblio | null // volume/issue/pages (cleaned export)
  referencedWorks: string[] | null // referenced_works — ONLY populated on the
  // conditional gaps select; null on a normal run (never requested, never paid for)
}

export interface ResultRow {
  rowId: string
  sourceOffset: number
  citeKey: string
  title: string
  bibYear: number | null
  status: MatchStatus
  openalex: OpenAlexWork | null
  matchScore: number | null // title similarity — populated for DOI matches too
  yearState: YearState // agree / disagree / unverified
  duplicateOf: string | null
  error: string | null
  raw: string
  entry: BibEntry | null // null for unparseable rows
}

export interface ParseResult {
  entries: BibEntry[]
  unparseable: UnparseableEntry[]
  warnings: string[]
}

export type MatchStage = 'idle' | 'parsing' | 'doi' | 'title' | 'done'

export interface Progress {
  stage: MatchStage
  label: string
  done: number
  total: number
  searchCalls: number
}

export interface MatchSummary {
  total: number
  matchedByDoi: number
  matchedByTitle: number
  suspicious: number
  notFound: number
  notIndexable: number
  errored: number
  unparseable: number
  duplicates: number
  searchCalls: number
  searchCostUsd: number
}
