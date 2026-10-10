// Feature 5 — BibTeX (re-)serialisation, the round-trip-safe half.
//
// THE LATEX ROUND-TRIP TRAP (investigated — see README): the parser decodes
// LaTeX to Unicode on the way in, so regenerating an entry from its parsed AST
// would risk emitting `ö` where the user wrote `\"{o}`, and would lose
// brace-protected caps (`{DNA}`) and custom fields (`keywords`, Zotero paths).
//
// We sidestep it entirely: the cleaner is ADDITIVE-ONLY and edits the VERBATIM
// SOURCE TEXT, never the AST. `insertFields` splices new field lines before an
// entry's closing brace and touches nothing else; existing fields (with their
// escapes and braces) are left byte-for-byte intact. `spliceCleaned` reassembles
// the whole file from the ORIGINAL text, replacing only the edited blocks — so
// non-entry content (@string macros, @comment, preamble, blank lines) and every
// pass-through / unparseable entry survive verbatim.

export interface FieldInsert {
  field: string
  value: string
}

// Insert `fields` just before an entry block's final closing brace. Detects the
// existing indentation, ensures the preceding field has a trailing comma, and
// leaves everything else unchanged. Pure string surgery — no parsing.
export function insertFields(raw: string, fields: FieldInsert[]): string {
  if (fields.length === 0) return raw
  const lastBrace = raw.lastIndexOf('}')
  if (lastBrace < 0) return raw // not a well-formed block — refuse to touch it

  const head = raw.slice(0, lastBrace)
  const tail = raw.slice(lastBrace) // the closing '}' (+ any trailing text)

  // Indentation = the leading whitespace of the first indented field line.
  const indentMatch = head.match(/\n([ \t]+)\S/)
  const indent = indentMatch ? indentMatch[1] : '  '

  let newHead = head.replace(/\s+$/, '') // drop trailing whitespace/newlines
  if (!newHead.endsWith(',') && !newHead.endsWith('{')) newHead += ',' // comma after previous field

  const added = fields.map(f => `\n${indent}${f.field} = {${f.value}},`).join('')
  return `${newHead}${added}\n${tail}`
}

export interface SpliceEntry {
  sourceOffset: number
  originalRaw: string
  newRaw: string
}

// Reassemble the full .bib from the ORIGINAL text, replacing only entries whose
// newRaw differs from originalRaw. Edits are applied high-offset-first so earlier
// offsets never shift. Each replacement is verified against the source slice
// before it is applied — a mismatch falls back to a first-occurrence replace,
// and if even that fails the block is left untouched (never corrupt the file).
export function spliceCleaned(originalText: string, entries: SpliceEntry[]): string {
  const edits = entries
    .filter(e => e.newRaw !== e.originalRaw)
    .sort((a, b) => b.sourceOffset - a.sourceOffset)

  let out = originalText
  for (const e of edits) {
    const at = e.sourceOffset
    if (at >= 0 && out.slice(at, at + e.originalRaw.length) === e.originalRaw) {
      out = out.slice(0, at) + e.newRaw + out.slice(at + e.originalRaw.length)
      continue
    }
    const idx = out.indexOf(e.originalRaw)
    if (idx >= 0) out = out.slice(0, idx) + e.newRaw + out.slice(idx + e.originalRaw.length)
  }
  return out
}

// --- v1.1: per-field CORRECTION support (mismatch accept) --------------------
// Unlike insertFields (additive), these locate an EXISTING field's value in the
// verbatim source so a user-accepted correction can replace just that value,
// leaving the field name, delimiters, and all other bytes intact. Balanced-brace
// aware and backslash-escape aware, so nested `{…}` and `\{`/`\}` don't confuse it.

interface FieldSpan { valueStart: number; valueEnd: number; inner: string }

// Locate `field = <value>` in an entry's verbatim raw. Word-anchored via the
// required `=` (so `journal` won't match `journaltitle`). Returns the value span
// (delimiters included) and its inner text, or null if not found / unbalanced.
function locateField(raw: string, field: string): FieldSpan | null {
  // Fields follow a comma (the first one follows `key,`). v1.4.5: not `{` — that
  // also matched text inside a value, e.g. `note = {journal=…}`.
  const m = new RegExp(`,\\s*${field}\\s*=\\s*`, 'i').exec(raw)
  if (!m) return null
  const s = m.index + m[0].length
  const ch = raw[s]
  if (ch === '{') {
    let depth = 0, i = s
    for (; i < raw.length; i++) {
      const c = raw[i]
      if (c === '\\') { i++; continue } // skip an escaped char (\{ \})
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) break }
    }
    if (depth !== 0) return null // unbalanced — refuse to touch it
    return { valueStart: s, valueEnd: i + 1, inner: raw.slice(s + 1, i) }
  }
  if (ch === '"') {
    let i = s + 1
    for (; i < raw.length; i++) { if (raw[i] === '\\') { i++; continue } if (raw[i] === '"') break }
    if (i >= raw.length) return null
    return { valueStart: s, valueEnd: i + 1, inner: raw.slice(s + 1, i) }
  }
  // bare value (e.g. `year = 2020,` or an @string macro name): up to , newline or }
  let i = s
  for (; i < raw.length; i++) { const c = raw[i]; if (c === ',' || c === '\n' || c === '}') break }
  return { valueStart: s, valueEnd: i, inner: raw.slice(s, i).trim() }
}

// The verbatim inner value of an existing field, or null if the field is absent.
export function readField(raw: string, field: string): string | null {
  const f = locateField(raw, field)
  return f ? f.inner : null
}

// Replace ONLY the value of an existing field; everything else stays byte-identical.
// Preserves `"…"` quoting when the original used it, otherwise writes `{…}` (always
// valid). Returns raw unchanged if the field can't be safely located.
export function replaceFieldValue(raw: string, field: string, newValue: string): string {
  const f = locateField(raw, field)
  if (!f) return raw
  const wrapped = raw[f.valueStart] === '"' ? `"${newValue}"` : `{${newValue}}`
  return raw.slice(0, f.valueStart) + wrapped + raw.slice(f.valueEnd)
}
