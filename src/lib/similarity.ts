// Lightweight string similarity used to decide whether an OpenAlex title-search
// hit really is the same paper as the .bib entry. Uses the Sørensen–Dice
// coefficient over character bigrams, which is robust to word reordering and
// minor punctuation differences without needing a heavy dependency.

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ') // strip any HTML the parser emitted (italics, etc.)
    .replace(/&[a-z]+;/g, ' ') // stray entities
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop combining diacritics
    .replace(/[^a-z0-9]+/g, ' ') // punctuation -> space
    .trim()
    .replace(/\s+/g, ' ')
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>()
  const compact = s.replace(/\s+/g, '')
  for (let i = 0; i < compact.length - 1; i++) {
    const bg = compact.slice(i, i + 2)
    map.set(bg, (map.get(bg) ?? 0) + 1)
  }
  return map
}

// Returns a similarity score in [0, 1].
export function diceCoefficient(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const aB = bigrams(na)
  const bB = bigrams(nb)
  if (aB.size === 0 || bB.size === 0) return 0

  let intersection = 0
  for (const [bg, count] of aB) {
    const other = bB.get(bg)
    if (other) intersection += Math.min(count, other)
  }

  const total = [...aB.values()].reduce((s, n) => s + n, 0) +
    [...bB.values()].reduce((s, n) => s + n, 0)
  return (2 * intersection) / total
}
