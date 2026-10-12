// v1.6.1 — one page per problem researchers search for. The pages themselves are
// plain static HTML in public/<slug>/index.html (no React, no build step, no script),
// so crawlers get real content. This list is the single source for the links the app
// shows (About tab, page footer); test/guides.test.ts checks that every page exists
// and is listed in the sitemap, llms.txt and index.html's static fallback.
//
// `example` is the "See it on an example" deep-link each page uses: /?example=<key>
// loads the bundled example and opens the matching tab and card (EXAMPLE_FOCUS).

export interface Guide {
  slug: string // URL path without slashes: https://bibprofile.com/<slug>/
  label: string // short link text
  example: ExampleFocusKey
}

export type ExampleFocusKey = 'references' | 'retractions' | 'dois' | 'preprints'

// Where "See it on an example" lands: the tab, then the element id scrolled into view.
export const EXAMPLE_FOCUS: Record<ExampleFocusKey, { view: 'report' | 'cleaned'; anchor: string }> = {
  references: { view: 'report', anchor: 'verify' },
  retractions: { view: 'report', anchor: 'retractions' },
  dois: { view: 'cleaned', anchor: 'cleaned' },
  preprints: { view: 'report', anchor: 'preprints' },
}

export const GUIDES: Guide[] = [
  { slug: 'check-hallucinated-references', label: 'Check a .bib for hallucinated references', example: 'references' },
  { slug: 'find-retracted-papers', label: 'Find retracted papers in a bibliography', example: 'retractions' },
  { slug: 'add-missing-dois-bibtex', label: 'Add missing DOIs to a BibTeX file', example: 'dois' },
  { slug: 'preprint-published-version', label: 'Replace preprints with published versions', example: 'preprints' },
]

export function isExampleFocus(s: string | null): s is ExampleFocusKey {
  return s != null && Object.prototype.hasOwnProperty.call(EXAMPLE_FOCUS, s)
}
