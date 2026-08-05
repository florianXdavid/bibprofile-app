// In-browser BibTeX parsing built on @retorquere/bibtex-parser (v9).
//
// The library already:
//   - converts LaTeX escapes to Unicode (\"o -> ö, {\'e} -> é, braces handled),
//   - returns structured author/editor lists,
//   - collects problems into `errors` instead of throwing,
//   - exposes each entry's raw source text as `entry.input`.
//
// The parser is lenient — for a malformed block it may BOTH record an
// entry-level error AND recover a partial entry into `entries`. We treat any
// block that produced an entry-level error as "unparseable" and exclude its
// recovered-but-corrupt twin from the matched set, so counts stay honest.
//
// Every record carries a `sourceOffset` (its character position in the source
// .bib) so downstream rows can be presented in original file order (Fix A5).

import { parse, type Entry, type Creator } from '@retorquere/bibtex-parser'
import type { BibEntry, ParseResult, UnparseableEntry } from '../types'
import { normalizeDoi } from './doi'
import { cleanTitleForSearch, looksNotIndexable } from './titleClean'

const ENTRY_BLOCK = /@\s*[A-Za-z]+\s*\{/

// Strip inline HTML the parser emits for italics/small-caps/links (DISPLAY TEXT
// ONLY — never run this over identifier fields like DOI; see asIdentifier).
function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\\([_&%#$])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function asString(v: unknown): string {
  if (typeof v === 'string') return stripMarkup(v)
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : '')).join('; ')
  return ''
}

// Identifier fields (DOI): coerce and trim, but DO NOT strip markup — angle
// brackets are meaningful in legacy Wiley DOIs (Fix 2).
function asIdentifier(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : '')).join(' ').trim()
  return ''
}

function formatCreators(creators: Creator[] | undefined): string {
  if (!creators || creators.length === 0) return ''
  const names = creators.map(c => {
    if (c.name) return stripMarkup(c.name)
    const family = [c.prefix, c.lastName, c.suffix].filter(Boolean).join(' ').trim()
    const given = (c.firstName ?? c.initial ?? '').trim()
    const full = given ? `${family}, ${given}` : family
    return stripMarkup(full)
  }).filter(Boolean)
  if (names.length <= 3) return names.join('; ')
  return `${names.slice(0, 3).join('; ')}; et al.`
}

function extractYear(fields: Entry['fields']): number | null {
  const y = asString(fields.year)
  const m = y.match(/\d{4}/)
  if (m) return parseInt(m[0], 10)
  const d = asString(fields.date) // biblatex `date = {2020-05-01}`
  const dm = d.match(/\d{4}/)
  return dm ? parseInt(dm[0], 10) : null
}

function extractVenue(fields: Entry['fields']): string {
  const candidates = [
    'journal', 'journaltitle', 'booktitle', 'series',
    'publisher', 'howpublished', 'institution', 'school', 'organization',
  ]
  for (const key of candidates) {
    const val = asString((fields as Record<string, unknown>)[key])
    if (val) return val
  }
  return ''
}

function keyFromRaw(raw: string): string | null {
  const m = raw.match(/@\s*[A-Za-z]+\s*\{\s*([^,\s}]+)/)
  return m ? m[1] : null
}

export function parseBib(text: string): ParseResult {
  const entries: BibEntry[] = []
  const unparseable: UnparseableEntry[] = []
  const warnings: string[] = []

  // Offset of a raw block within the source; -1 pushed to the end but stable.
  const offsetOf = (raw: string, fallback: number): number => {
    const idx = raw ? text.indexOf(raw) : -1
    return idx >= 0 ? idx : text.length + fallback
  }

  let library
  try {
    library = parse(text, { unsupported: 'ignore' })
  } catch (err) {
    unparseable.push({
      rowId: 'u0', sourceOffset: 0, citeKey: null,
      error: err instanceof Error ? err.message : String(err),
      raw: text.slice(0, 2000),
    })
    return { entries, unparseable, warnings }
  }

  const failedKeys = new Set<string>()
  const seenBlocks = new Set<string>()
  library.errors.forEach((e, i: number) => {
    const raw = (e.input ?? '').trim()
    const message = e.error ?? 'parse error'
    if (raw && ENTRY_BLOCK.test(raw)) {
      if (seenBlocks.has(raw)) return
      seenBlocks.add(raw)
      const key = keyFromRaw(raw)
      if (key) failedKeys.add(key)
      unparseable.push({
        rowId: `u${i}`, sourceOffset: offsetOf(raw, i), citeKey: key,
        error: message, raw: raw.slice(0, 2000),
      })
    } else {
      warnings.push(raw ? `${message} — ${raw}` : message)
    }
  })

  library.entries.forEach((entry: Entry, i: number) => {
    if (entry.key && failedKeys.has(entry.key)) return

    const rawTitle = asString(entry.fields.title) || asString(entry.fields.booktitle)
    const authors = formatCreators(entry.fields.author) || formatCreators(entry.fields.editor)
    const year = extractYear(entry.fields)
    const venue = extractVenue(entry.fields)
    const doiRaw = asIdentifier(entry.fields.doi) || null
    const doi = normalizeDoi(doiRaw)
    const offset = offsetOf(entry.input, i)

    if (!rawTitle && !doi && !authors && !venue && year == null) {
      unparseable.push({
        rowId: `ue${i}`, sourceOffset: offset, citeKey: entry.key || null,
        error: 'empty entry — no title, DOI, author, venue, or year to match on',
        raw: entry.input.slice(0, 2000),
      })
      return
    }

    const title = rawTitle || '(no title)'
    entries.push({
      rowId: `e${i}`,
      sourceOffset: offset,
      citeKey: entry.key || `(entry ${i + 1})`,
      entryType: entry.type,
      title,
      titleForSearch: rawTitle ? cleanTitleForSearch(rawTitle) : '',
      authors,
      year,
      venue,
      doiRaw,
      doi,
      raw: entry.input,
      likelyNotIndexable: looksNotIndexable({ entryType: entry.type, title: rawTitle, venue, doi, year }),
    })
  })

  return { entries, unparseable, warnings }
}
