// Feature 3 — Missing-citation recommendations, PURE counting half. The network
// half (fetching referenced_works, hydrating candidate titles, forward-citation
// scan) lives in `src/lib/gaps.ts`; this file only tallies.
//
// Co-citation: pool every matched work's `referenced_works`; for each referenced
// work, count how many of the user's works cite it; DROP anything already in the
// user's set; rank by that count. Built-in bias (surfaced in the UI): this only
// finds work the user's references *could already* cite — i.e. missing
// FOUNDATIONS, never recent work.
//
// Forward-citation: among works that cite the user's set, count how many of the
// user's seeds each one cites; rank. This catches RECENT adjacent work.

// Bare OpenAlex id (W123…) — kept local so this module has no dependency on the
// network layer and stays trivially unit-testable.
export function bareId(id: string): string {
  return (id || '').replace(/^https?:\/\/openalex\.org\//i, '').trim()
}

export interface UserWorkRefs {
  citeKey: string
  id: string // the user's matched work OpenAlex id
  referencedWorks: string[] // its referenced_works (may be empty)
}

export interface CoCiteCandidate {
  id: string // bare OpenAlex id of the co-cited work (not in the user's list)
  count: number // how many of the user's works cite it
  citedBy: string[] // the cite keys of those works (transparency)
}

// Rank co-cited works. `minCount` filters out one-off overlaps (noise).
export function computeCoCitation(userWorks: UserWorkRefs[], minCount: number): CoCiteCandidate[] {
  const own = new Set(userWorks.map(w => bareId(w.id)).filter(Boolean))
  const count = new Map<string, number>()
  const citedBy = new Map<string, string[]>()

  for (const w of userWorks) {
    // A given user work should contribute at most once per referenced id.
    const seen = new Set<string>()
    for (const refRaw of w.referencedWorks) {
      const ref = bareId(refRaw)
      if (!ref || own.has(ref) || seen.has(ref)) continue // drop self-set + dupes
      seen.add(ref)
      count.set(ref, (count.get(ref) ?? 0) + 1)
      const arr = citedBy.get(ref) ?? []
      arr.push(w.citeKey)
      citedBy.set(ref, arr)
    }
  }

  const out: CoCiteCandidate[] = []
  for (const [id, c] of count) {
    if (c >= minCount) out.push({ id, count: c, citedBy: citedBy.get(id) ?? [] })
  }
  out.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  return out
}

export interface ForwardCandidate {
  id: string // bare id of the citing work (recent adjacent work)
  count: number // how many of the user's seeds it cites
  seeds: string[] // which seed ids (bare) it cites
}

// Rank works that cite the user's set by how many seeds each cites. `citing`
// works carry their own referenced_works; we intersect with the seed set.
export function computeForwardCitation(
  seedIds: string[],
  citing: { id: string; referencedWorks: string[] }[],
  minCount: number,
): ForwardCandidate[] {
  const seeds = new Set(seedIds.map(bareId).filter(Boolean))
  const out: ForwardCandidate[] = []
  for (const c of citing) {
    const cid = bareId(c.id)
    if (!cid || seeds.has(cid)) continue // a seed citing another seed isn't a gap
    const hit = [...new Set(c.referencedWorks.map(bareId))].filter(r => seeds.has(r))
    if (hit.length >= minCount) out.push({ id: cid, count: hit.length, seeds: hit })
  }
  out.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  return out
}
