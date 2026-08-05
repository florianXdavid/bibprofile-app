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
