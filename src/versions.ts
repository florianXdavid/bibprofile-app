// Manual version history, shown (collapsed) in the About tab. No persistence, no
// fetch — a small hardcoded list. Bump by hand on each release; newest first.

export interface VersionEntry {
  version: string
  date: string // YYYY-MM-DD
  note: string
}

export const VERSIONS: VersionEntry[] = [
  {
    version: 'v1.5',
    date: '2026-10-12',
    note: 'Unverified references get a Google Scholar link, a “Try with an example” button, a report to download or print as PDF for co-authors, and pasting BibTeX instead of uploading a file.',
  },
  {
    version: 'v1.4',
    date: '2026-10-10',
    note: 'Smarter matching (Crossref first, then OpenAlex; an “uncertain” status; DOIs and arXiv / PubMed IDs found in url and note fields), retraction checks via Crossref and Retraction Watch, better duplicate detection, and a safer cleaned .bib (only verified fills written automatically, the rest for review).',
  },
  {
    version: 'v1.3',
    date: '2026-08-16',
    note: 'Auto-jump to the Report + collapsible upload zone, shared-pool explainer, CSV export and in-page raw view (JSON export removed), preprint→published moved to the Report tab with title-based resolution, and refreshed SEO/agent metadata.',
  },
  {
    version: 'v1.2',
    date: '2026-08-14',
    note: 'Added a maintenance page.',
  },
  {
    version: 'v1.1',
    date: '2026-08-14',
    note: 'iOS .bib upload fix, Google Translate crash fix, always-visible tabs, per-field .bib diff review, and a contact address.',
  },
  {
    version: 'v1.0',
    date: '2026-08-09',
    note: 'Initial public release.',
  },
]
