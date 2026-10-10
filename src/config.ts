// ===========================================================================
// BibProfile configuration
//
// Everything network-related is funneled through the constants in this file.
// There is exactly ONE place that decides where requests go: OPENALEX_BASE_URL.
//
// W1 (now):  runs in your browser, talks directly to https://api.openalex.org,
//            authenticated with your personal key from a local .env file.
// W2 (next): flip OPENALEX_BASE_URL to a Cloudflare Worker proxy URL and leave
//            the key blank. The Worker holds the key server-side; the browser
//            never sees it. That swap is a one-line change (or one .env edit).
// ===========================================================================

// --- THE single network target for the whole app -------------------------
// Change this one line (or VITE_OPENALEX_BASE_URL in .env) to repoint the app.
// No trailing slash; requests are built as `${OPENALEX_BASE_URL}/works/...`.
export const OPENALEX_BASE_URL: string = (
  import.meta.env.VITE_OPENALEX_BASE_URL ?? 'https://api.openalex.org'
).replace(/\/+$/, '')

// --- Auth -----------------------------------------------------------------
// OpenAlex now requires an API key for meaningful rate limits (free tier is
// $1/day of usage with a key, ~$0.01/day without). Get one for free at
// https://openalex.org/settings/api.
//
// This key is read from VITE_OPENALEX_API_KEY. Because Vite inlines VITE_*
// vars into the client bundle, this is ONLY appropriate for local W1 use.
// In W2 leave it blank and let the Worker proxy attach the key.
export const OPENALEX_API_KEY: string = import.meta.env.VITE_OPENALEX_API_KEY ?? ''

// --- Politeness -----------------------------------------------------------
// Legacy "polite pool" contact. Superseded by the API key for rate limiting,
// but still accepted and harmless. Optional.
export const OPENALEX_MAILTO: string = import.meta.env.VITE_OPENALEX_MAILTO ?? ''

// --- Request pacing / matching tunables -----------------------------------
// Sequential requests, ~4.5/sec, comfortably under OpenAlex's ~10/sec ceiling.
export const REQUEST_DELAY_MS = 220
// One retry on transient failure (network / 429 / 5xx), then give up.
export const RETRY_BACKOFF_MS = 900
// Title-similarity GATE (Dice coefficient, 0..1): a search candidate whose title
// similarity is below this is never considered. A wrong match is worse than no
// match, so this is deliberately strict.
export const TITLE_MATCH_THRESHOLD = 0.7

// --- v1.4.1 multi-signal match score (src/lib/matchScore.ts) ---------------
// Each candidate is scored on several signals (each 0..1, or skipped when it
// can't be compared); the score is the weighted mean over the signals present.
// Title dominates; the others confirm or contradict it.
export const MATCH_WEIGHTS = {
  title: 0.5,
  author: 0.15, // first-author family name
  year: 0.12, // within ±1
  venue: 0.08, // journal / booktitle / publisher
  type: 0.1, // article vs book vs proceedings vs preprint (tells versions apart)
  biblio: 0.05, // volume and first page, when both sides have them
} as const
// Title path: >= CONFIDENT (and no near-tie) -> `matched-by-title`;
// >= FLOOR -> `uncertain` (shown, flagged, never written to the cleaned .bib);
// below FLOOR -> `not-found` (nothing attached). DOI path: a DOI match scoring
// below FLOOR is flagged `suspicious`.
export const MATCH_CONFIDENT_THRESHOLD = 0.85
export const MATCH_SCORE_FLOOR = 0.7
// Two DIFFERENT works whose scores are within this margin are a near-tie (e.g.
// a book and an article with the same title): the best one is only `uncertain`.
export const MATCH_AMBIGUITY_MARGIN = 0.05
// v1.4.4 — a candidate whose year is MORE than this far from the entry's is a
// different edition or a reprint (Kuhn 1962 vs its 1996 edition): never
// `matched-by-title`, at most `uncertain`. Small gaps stay allowed: journal
// versions are often 2 years after online-first (Mask R-CNN on TPAMI).
export const MATCH_MAX_YEAR_GAP = 3
// v1.4.3 — a DOI found by TITLE search is written into the cleaned .bib without
// review only for a matched-by-title whose title signal is >= this AND whose first
// author and year (±1) are both confirmed (not merely missing), and whose type
// isn't a different version (preprint vs published). See cleanBib.ts.
export const AUTO_DOI_TITLE_THRESHOLD = 0.95
// How many candidates to pull back per title search.
export const SEARCH_PER_PAGE = 5

// --- Cost accounting ------------------------------------------------------
// Under current OpenAlex pricing, single-work lookups (/works/doi:...) are
// FREE and unlimited, while search calls (?search=) are billable. We surface
// the search-call count so the daily-allowance cost is visible. This figure
// is OpenAlex's published per-search price and is used only for the estimate
// shown in the UI. See https://developers.openalex.org (pricing).
export const SEARCH_CALL_COST_USD = 0.001

// Fields we ask OpenAlex to return. Keeping this explicit documents exactly
// what we capture. See README "OpenAlex fields" for captured-vs-ignored.
//
// W2 note: `primary_location` and `open_access` are already requested as WHOLE
// objects, so `open_access.oa_status`, `primary_location.source.id` and
// `.source.type` (needed by the OA and venue cards) come back for free — only
// the mapping in openalex.ts changed, not this list. The one genuine addition
// is `authorships`, which the self-citation card needs and which meaningfully
// increases response size (author list + ORCIDs per work).
//
// W3 note: `is_retracted` (retraction card) and `biblio` (cleaned export —
// volume/issue/pages) are tiny/small and requested ALWAYS. `referenced_works`
// is a LARGE array per work; it is NOT in this default select and is added
// conditionally via GAPS_SELECT_FIELDS only when the citation-gap card runs.
export const OPENALEX_SELECT_FIELDS = [
  'id',
  'doi',
  'display_name',
  'publication_year',
  'primary_location',
  'cited_by_count',
  'open_access',
  'type',
  'primary_topic',
  'authorships', // W2: self-citation card (author display names + ORCIDs)
  'is_retracted', // W3: retraction card (tiny; always)
  'biblio', // W3: cleaned export volume/issue/pages (small; always)
].join(',')

// W3 conditional select: the default fields PLUS `referenced_works`. Used ONLY
// by the citation-gap path (`src/lib/gaps.ts`), never on a normal report run,
// because `referenced_works` is a large per-work array that inflates every
// response. On the shared key this restraint matters — see the README.
export const GAPS_SELECT_FIELDS = OPENALEX_SELECT_FIELDS + ',referenced_works'

// --- W3 citation-gap tunables ---------------------------------------------
// OpenAlex OR-filters (`openalex_id:W1|W2|…`, `cites:W1|W2|…`) take up to ~50
// ids per call. We keep well under any URL-length limit and batch accordingly.
export const OA_FILTER_BATCH = 50
// Shared display cap: each gap mode shows AT MOST this many results after
// flooring, ranked by count. It is also the co-citation hydration budget (~30
// ids in one OR-batched call), so one number covers both modes — a second
// hydration call is not worth it here. (W3.1)
export const GAPS_TOP_CANDIDATES = 30
// Post-fetch QUALITY floors (W3.1) — NOT cost reducers. The calls are made
// regardless: OpenAlex's `cites:` filter cannot express "cites >= N of my
// seeds", so the floor is applied to the *results*, not the query. Reasonable
// advisory defaults, tunable here; not validated boundaries.
export const GAPS_COCITATION_FLOOR = 4 // a co-cited work needs >= 4 of the user's refs citing it
export const GAPS_FORWARD_FLOOR = 2 // a citing work needs to cite >= 2 of the user's refs

// --- W3 reference-list shape floor ----------------------------------------
// Pattern detection on a tiny list is noise. Surface nothing below this n.
export const SHAPE_MIN_N = 20
// "Stale tail" months: no reference newer than ~this many months is a fact
// worth stating (about the list's freshness, not field norms).
export const SHAPE_STALE_MONTHS = 24

// --- W3.2 input guards (coarse per-paper scope, NOT metering) --------------
// Two gates enforced BEFORE any network call, on the single upload path:
//   • file size, before parsing — a huge file shouldn't freeze the browser parser
//   • parsed-entry count, before matching — one pathological load must not burn a
//     large share of the SHARED OpenAlex budget in a single go.
// Framed as scope ("a per-paper tool"), which is also true of the statistics.
// Pure client-side; survives the later move to a hosted static site unchanged.
export const MAX_BIB_BYTES = 1_000_000 // 1 MB (decimal), checked pre-parse
export const MAX_BIB_ENTRIES = 300 // parsed entries, checked pre-matching

// --- DOI-match validation (Fix 5) -----------------------------------------
// DOI lookups are authoritative for identity, but the returned record can be
// the wrong work (bad .bib DOI) or have truncated upstream metadata. We score
// every DOI match's title the same way we score title matches, and flag —
// never auto-reject — low-similarity ones as `suspicious` for the user to judge.
//
// A DOI match whose title similarity is below this is flagged `suspicious`.
// NOTE: tuned on only a handful of corpus data points (raised 0.60 -> 0.65 to
// catch a wrong 0.61 match). Treat this as a reasonable default, not a
// validated boundary. Do not add further tuning logic around it.
export const DOI_SUSPICIOUS_THRESHOLD = 0.65
// When the .bib year and OpenAlex year do NOT agree — i.e. they disagree OR the
// year is unverifiable (missing on either side) — weight suspicion harder:
// require a higher title similarity before trusting the match. Missing data is
// never treated as agreement.
export const DOI_SUSPICIOUS_THRESHOLD_ON_YEAR_MISMATCH = 0.75
