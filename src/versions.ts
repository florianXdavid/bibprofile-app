// Manual version history, shown (collapsed) in the About tab. No persistence, no
// fetch — a small hardcoded list. Bump by hand on each release; newest first.

export interface VersionEntry {
  version: string
  date: string // YYYY-MM-DD
  note: string
}

export const VERSIONS: VersionEntry[] = [
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
