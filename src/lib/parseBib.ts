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
import { findAltId, normalizeDoi } from './doi'
import { readField } from './bibWriter'
import { cleanTitleForSearch, looksNotIndexable } from './titleClean'
import { stripRetractedPrefix } from './matchScore'

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

// v1.4.1 — first author's (or, failing that, first editor's) family name, for the
// match-scoring author signal. Institutional names come through as `name`.
// v1.4.5 (H1) — a corporate author ({Gaia Collaboration}, a consortium, a team)
// is skipped in favour of the first PERSON, as OpenAlex lists people.
const CORPORATE = /\b(collaboration|consortium|group|team|laborator(y|ies)|project)\b/i
function firstFamilyName(fields: Entry['fields']): string {
  const list = (fields.author && fields.author.length ? fields.author : fields.editor) ?? []
  if (!list.length) return ''
  const isCorporate = (c: Creator) => (c.name ? !c.name.includes(',') : false)
    || CORPORATE.test(c.name ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`)
  const c = list.find(x => !isCorporate(x)) ?? list[0]
  return stripMarkup(c.lastName || c.name || '')
}

function extractYear(fields: Entry['fields']): number | null {
  const y = asString(fields.year)
  const m = y.match(/\d{4}/)
  if (m) return parseInt(m[0], 10)
  const d = asString(fields.date) // biblatex `date = {2020-05-01}`
  const dm = d.match(/\d{4}/)
  if (dm) return parseInt(dm[0], 10)
  // v1.4.5 (L1): "bioRxiv … [Preprint] (2021)" — a year in parentheses in howpublished / note.
  const hm = `${asString(fields.howpublished)} ${asString(fields.note)}`.match(/\(((?:19|20)\d{2})\)/)
  return hm ? parseInt(hm[1], 10) : null
}

// v1.4.5 (M3): the parser maps `<` / `>` to the OT1 glyphs `¡` / `¿` (what LaTeX would
// print in text mode), and leaves \raisebox's length behind — the user meant the symbols.
function displayTitle(t: string, rawTitle: string): string {
  let s = (/[¡¿]/.test(rawTitle) ? t : t.replace(/¡/g, '<').replace(/¿/g, '>')).normalize('NFC')
  if (/\\raisebox/.test(rawTitle)) s = s.replace(/-?\d*\.?\d+(?:ex|em|pt)\b/g, '')
  return s
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

const PLACEHOLDER_TITLES = new Set(['vol', 'pp', 'pages', 'in', 'et al', 'n a', 'na', 'tbd', 'title', 'untitled', 'none', 'no title'])
function isPlaceholderTitle(t: string): boolean {
  if (!t) return false
  const n = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return n.replace(/ /g, '').length <= 3 || PLACEHOLDER_TITLES.has(n)
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
  // v1.4.5: two byte-identical blocks (a duplicated entry) get their own offsets.
  const usedOffsets = new Set<number>()
  const offsetOf = (raw: string, fallback: number): number => {
    let idx = raw ? text.indexOf(raw) : -1
    while (idx >= 0 && usedOffsets.has(idx)) idx = text.indexOf(raw, idx + 1)
    if (idx >= 0) { usedOffsets.add(idx); return idx }
    return text.length + fallback
  }

  let library
  try {
    // v1.4.5 (M3): english:false = no sentence-casing. The title stays as the user
    // wrote it (minus TeX); `{SDSS-V}` and German nouns keep their capitals.
    library = parse(text, { unsupported: 'ignore', english: false })
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

    const rawTitle = displayTitle(asString(entry.fields.title) || asString(entry.fields.booktitle),
      readField(entry.input, 'title') ?? readField(entry.input, 'booktitle') ?? '')
    const authors = formatCreators(entry.fields.author) || formatCreators(entry.fields.editor)
    const year = extractYear(entry.fields)
    const venue = extractVenue(entry.fields)
    const doiRaw = asIdentifier(entry.fields.doi) || null
    const doi = normalizeDoi(doiRaw)
    const offset = offsetOf(entry.input, i)
    const altId = doi ? null : findAltId(f => readField(entry.input, f)) // v1.4.5 (H4)
    const hasUrl = !!readField(entry.input, 'url')

    if (!rawTitle && !doi && !authors && !venue && year == null) {
      unparseable.push({
        rowId: `ue${i}`, sourceOffset: offset, citeKey: entry.key || null,
        error: 'empty entry — no title, DOI, author, venue, or year to match on',
        raw: entry.input.slice(0, 2000),
      })
      return
    }

    // v1.4.6 (F8): a placeholder title ("J", "vol") with no identifier can't be
    // searched — say so, instead of a `not-found` that reads like "doesn't exist".
    if (!doi && !altId && isPlaceholderTitle(rawTitle)) {
      unparseable.push({
        rowId: `ue${i}`, sourceOffset: offset, citeKey: entry.key || null,
        error: `title missing or truncated ("${rawTitle}") — cannot search`,
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
      firstAuthor: firstFamilyName(entry.fields),
      volume: asString((entry.fields as Record<string, unknown>).volume),
      pages: asString((entry.fields as Record<string, unknown>).pages),
      titleRetracted: stripRetractedPrefix(rawTitle).retracted,
      altId,
      dupKeyIndex: null,
      raw: entry.input,
      likelyNotIndexable: looksNotIndexable({ entryType: entry.type, title: rawTitle, venue, doi: doi ?? altId?.key ?? null, year, hasUrl }),
    })
  })

  // v1.4.5 (H3): a cite key used twice. BibTeX keeps the first copy and ignores the
  // rest; each copy is numbered so it can be told apart (never "duplicate of itself").
  const byKey = new Map<string, BibEntry[]>()
  for (const e of entries) byKey.set(e.citeKey, [...(byKey.get(e.citeKey) ?? []), e])
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => a.sourceOffset - b.sourceOffset).forEach((e, k) => { e.dupKeyIndex = k + 1 })
  }

  return { entries, unparseable, warnings }
}
