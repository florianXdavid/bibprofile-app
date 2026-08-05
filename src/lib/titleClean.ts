// Title hygiene for the search path (A1 + Fix 7 ligature + A4 detection).
//
// Zotero and browser "Save to..." workflows often store the *page* title rather
// than the article title, leaving publisher/aggregator cruft on the ends:
//   "Efficient computation of optimal actions | PNAS"
//   "MuJoCo … | Robotics | IEEE Xplore"   (two pipes)
//   "…Standing Back Flip - ScienceDirect"
//   "Frontiers | Mechanosensory encoding…"
//
// Pipe handling (A1): rather than enumerate every site name, we split on `|`
// and keep the LONGEST segment — empirically the real article title in every
// pipe case in the corpus except a non-paper landing page. This also handles
// multi-word site names ("ScienceDirect Topics") and multiple pipes for free.
// Dash-suffix and junk-prefix cruft is still stripped only for KNOWN sites, so
// legitimate "Title - a review" subtitles are never truncated.
//
// The original title is always kept for display and similarity comparison; the
// cleaned form is used only to build the query.

// Known publisher / aggregator / repository names (lowercased). Used only for
// the conservative DASH-suffix / leading-tag rules.
const SITE_NAMES = new Set([
  'pubmed', 'pmc', 'europe pmc', 'ncbi', 'sciencedirect', 'sciencedirect topics',
  'elsevier', 'elife', 'ieee', 'ieee xplore', 'pnas', 'frontiers', 'biorxiv',
  'medrxiv', 'arxiv', 'nature', 'nature portfolio', 'springer', 'springerlink',
  'springer nature', 'wiley', 'wiley online library', 'researchgate',
  'google scholar', 'semantic scholar', 'semanticscholar', 'jstor',
  'taylor & francis', 'taylor and francis', 'tandfonline', 'sage',
  'sage journals', 'acs publications', 'acs', 'oxford academic',
  'oxford university press', 'cambridge core', 'mdpi', 'plos', 'plos one',
  'cell', 'cell press', 'science', 'sciencemag', 'aaas', 'jama',
  'jama network', 'nejm', 'the lancet', 'lancet', 'bmj', 'bmc',
  'mit press', 'acm', 'acm digital library', 'dl.acm.org', 'ssrn', 'osf',
  'zenodo', 'figshare', 'dblp', 'crossref', 'scopus', 'web of science',
  'neurips', 'openreview', 'proceedings of machine learning research', 'pmlr',
  'psychology today', 'bohrium',
])

const LEADING_JUNK = /^\s*(PEER REVIEW|From the Cover|Editorial|Correction|Retraction|Erratum|Commentary|Preprint)\s*[:\-–—|]\s*/i

function longestPipeSegment(t: string): string {
  const segs = t.split('|').map(s => s.trim()).filter(Boolean)
  if (segs.length <= 1) return t
  return segs.slice().sort((a, b) => b.length - a.length)[0]
}

function stripTrailingSite(t: string): string {
  // Peel a trailing " - Site" / " – Site" / " — Site" when the tail is a known
  // site (pipes are already handled by longestPipeSegment).
  let out = t
  for (let i = 0; i < 3; i++) {
    const idx = Math.max(out.lastIndexOf(' - '), out.lastIndexOf(' – '), out.lastIndexOf(' — '))
    if (idx < 0) break
    const head = out.slice(0, idx).trim()
    const tail = out.slice(idx).replace(/^\s*[–—-]\s*/, '').trim().toLowerCase()
    if (head.length > 3 && SITE_NAMES.has(tail)) out = head
    else break
  }
  return out
}

function stripLeadingSite(t: string): string {
  const m = t.match(/^([^–—-]+?)\s*[–—-]\s*(.+)$/)
  if (m && SITE_NAMES.has(m[1].trim().toLowerCase()) && m[2].trim().length > 3) {
    return m[2].trim()
  }
  return t
}

export function cleanTitleForSearch(title: string): string {
  if (!title) return ''
  let t = title.trim()
  // Fix 7: TeX guillemet ligatures are correct for display but wrong for search.
  t = t.replace(/«/g, '<<').replace(/»/g, '>>')
  // Fix 7: un-escape a stray `\_`.
  t = t.replace(/\\_/g, '_')
  // Strip a junk leading tag (PEER REVIEW - , From the Cover: , …).
  t = t.replace(LEADING_JUNK, '').trim()
  // A1: pipe-delimited page titles -> keep the longest segment.
  if (t.includes('|')) t = longestPipeSegment(t)
  // Conservative dash-suffix / leading-tag cleanup for known sites only.
  t = stripTrailingSite(t)
  t = stripLeadingSite(t)
  t = t.replace(/\s+/g, ' ').trim()
  return t || title.trim()
}

// Does the string look like a bare URL / hostname rather than prose?
export function isUrlLike(s: string): boolean {
  const v = (s || '').trim()
  if (!v) return false
  if (/^https?:\/\//i.test(v)) return true
  if (/^www\./i.test(v)) return true
  return /^[a-z0-9][a-z0-9.-]*\.(com|org|net|edu|gov|io|ai|co|dev)(\/|$)/i.test(v)
}

// A4: conservative, multi-signal "this is not a scholarly work" detector. Any
// ONE signal is sufficient. We still run the lookup and only use this to
// classify a *miss*, so a false positive costs a wasted search, not a match.
export function looksNotIndexable(e: {
  entryType: string
  title: string
  venue: string
  doi: string | null
  year: number | null
}): boolean {
  if (e.doi) return false // has a DOI -> assume indexable
  if (isUrlLike(e.title)) return true // the title itself is a URL
  if (isUrlLike(e.venue)) return true // venue/journal/howpublished is a bare URL
  const type = (e.entryType || '').toLowerCase()
  const isMiscish = type === 'misc' || type === 'online' || type === 'electronic' || type === 'www'
  if (isMiscish && e.year == null) return true // @misc/@online with no year and no DOI
  return false
}
