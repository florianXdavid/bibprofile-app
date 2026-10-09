# BibProfile

Browser-only tool that profiles a BibTeX reference list against
[OpenAlex](https://openalex.org): **upload your `.bib`, see the shape of your
bibliography, and get a cleaned copy back.** Handy as a final sanity-check right
before you submit a paper to a journal or conference.

Everything runs in your browser. On the shared pool, queries pass through
BibProfile's own proxy (`api.bibprofile.com`), which forwards them to OpenAlex and
stores nothing; with your own key they go straight to OpenAlex. To check for
retractions and corrections, the DOIs of your references are also sent to Crossref
(`api.crossref.org`), which includes the Retraction Watch database. Nothing is
stored, no account, no tracking.

> Building this project was a **week-by-week** effort. The full history — every
> feature, fix and scope decision in order — lives in **[DEVLOG.md](./DEVLOG.md)**.
> This README describes the tool **as it is now** (current release: **v1.3**;
> the version history shown in the app lives in `src/versions.ts`).

## What it does

- **Match & inspect** — parses your `.bib`, matches each reference against
  OpenAlex, and shows an honest match rate with a sortable, filterable table.
- **Report** — analysis cards: recency profile, journal concentration,
  self-citation (for you or any author), open access, reference-list shape,
  retractions, and duplicates. Every card is descriptive — never a score or a
  judgement — and each reports its own honest denominator.
- **Missing citations** — *co-citation* (works your references collectively point
  to but you haven't cited — missing foundations) and *forward-citation* (recent
  work that cites your set — adjacent work). Off until you press a button.
- **Preprint → published** — detects preprints (arXiv, bioRxiv, medRxiv, SSRN, …)
  and looks up their published versions (shown as suggestions).
- **Cleaned `.bib`** — suggested fixes (missing DOIs, venues, volume/pages from
  OpenAlex) as a reviewable diff and a downloadable file. It never changes cite
  keys, drops entries, or edits text you already wrote.

## Architectural constraints

These are load-bearing — the whole design depends on them.

- **No backend, no database, no auth, no persistence** — no `localStorage`,
  `sessionStorage`, IndexedDB, or cookies. Nothing is stored or sent anywhere
  except OpenAlex (and, DOIs only, Crossref). (A static test, `test/noPersistence.test.ts`, fails if any
  source file references a storage API.)
- **Two fetch modules, a fixed set of hosts.** `src/lib/openalex.ts` reaches the
  shared proxy (`api.bibprofile.com`, which just forwards to OpenAlex) or, for a
  user key, OpenAlex directly (`api.openalex.org`); the proxy stores nothing.
  `src/lib/crossref.ts` (v1.4.2) reaches `api.crossref.org` for retraction /
  correction notices — free, key-less, DOIs only. No component calls `fetch`
  directly — that would bypass the pacing, retry, credential and cost logic. (A new
  host also needs adding to the CSP in `public/_headers`.)
- **No chart library.** The two charts (year histogram, venue bars) are
  hand-rolled inline SVG.
- Deploys as a **static site**: `npm run build` emits `/dist`.

## Stack

Vite + React + TypeScript · [`@retorquere/bibtex-parser`](https://www.npmjs.com/package/@retorquere/bibtex-parser)
for parsing · [Vitest](https://vitest.dev) for unit tests · plain CSS. No UI,
state, or chart library.

## Running it

Requires Node 18+.

```bash
npm install
cp .env.example .env      # optional — see "Credentials" below
npm run dev               # http://localhost:5173
npm run build             # tsc --noEmit + vite build -> /dist  (deploy this)
npm run typecheck         # types only
npm test                  # vitest unit tests
```

Drag a `.bib` onto the drop zone or click **Choose .bib file**.

## Credentials — shared pool, your own key, and the Worker swap

Matching and lookups use OpenAlex, which meters usage by cost. There are two
network paths, chosen at runtime by `src/lib/credential.ts` (the one place that
decides the active credential; the fetch layer consumes it):

| Path | Base URL | Key | Where the key lives |
|---|---|---|---|
| **Shared** (default) | `OPENALEX_BASE_URL` — the Worker proxy at `https://api.bibprofile.com` | a shared key | held server-side in the Worker |
| **User key** (opt-in) | **always** `OPENALEX_DIRECT_URL` = `api.openalex.org`, browser-direct | the user's own free key | **in memory, this session only** |

The **shared, no-account pool is the default** so anyone can just upload a `.bib`.
If it runs dry, a user can paste their **own free OpenAlex key**
(`openalex.org/settings/api`) to run on their own budget. That key is held in
memory only and is never persisted or sent anywhere but OpenAlex.

The user-key path deliberately uses a **separate** constant (`OPENALEX_DIRECT_URL`)
from the shared `OPENALEX_BASE_URL`: now that the shared path routes through the
Worker (`https://api.bibprofile.com`), the user-key path stays pointed straight at
OpenAlex — a user's secret is never routed through our server.

Config lives in `.env` / the Cloudflare Pages dashboard. The shared path's base URL
points at the Worker (`https://api.bibprofile.com`), which holds the key server-side,
so the deployed bundle no longer contains the shared key:

```
VITE_OPENALEX_BASE_URL=https://api.bibprofile.com  # the Worker proxy (set in the Pages dashboard)
VITE_OPENALEX_API_KEY=                             # blank on the deployed shared build — the Worker holds the key
VITE_OPENALEX_MAILTO=you@example.com               # optional polite-pool contact
```

## Matching

Per entry, after DOI normalisation (`src/lib/doi.ts`):

1. **De-duplicate** — entries sharing a normalised DOI (or, lacking one, the same
   normalised title **and** year **and** first-author surname) are queried once;
   duplicates are kept in the table, tagged, and reported as a finding. A shared
   title alone is not enough: conference/journal versions, books/articles and
   reprints often share one.
2. **Has a DOI → free singleton lookup** (`/works/doi:…`, free and unlimited).
   A low title similarity (0.65, or 0.75 when the year isn't confirmed), or a
   match score below 0.7, downgrades it to `suspicious` (shown, never auto-rejected).
3. **No usable DOI → billable title search** (`?search=` on a cleaned title; the
   query drops site cruft and "RETRACTED:" prefixes, folds accents and drops
   `?`/`*`). The top 5 candidates are each scored by **`src/lib/matchScore.ts`**
   (v1.4.1) and the best one decides the status: `matched-by-title`, `uncertain`
   or `not-found` (see *Match score* below).
4. Genuine misses that aren't scholarly records are reclassified `not-indexable`.

Requests are sequential (~4.5/sec), retried once on a transient failure. After a
"too many requests" (429), the retry waits as long as the server asks (`Retry-After`
header, or the Worker's `retry_after_seconds`), between 0.9 s and 15 s. Entries whose
lookup still fails are `error`. A **Retry N failed entries** button re-queries only
those, on the active credential, and keeps every other result (DOI retries are free;
title retries cost one search each). Statuses:
`matched-by-doi`, `matched-by-title`, `suspicious`, `uncertain`, `not-found`,
`not-indexable`, `error`, `unparseable`. Thresholds are advisory defaults in
`src/config.ts`. The summary is deliberately blunt about misses.

### Match score (v1.4.1)

Pure and deterministic. Each candidate gets six signals, each 0–1, or skipped when
either side lacks the data:

| Signal | Weight | Rule |
|---|---|---|
| title | 0.50 | Dice similarity after stripping "RETRACTED:"-style prefixes; a title missing only its subtitle scores 0.9 |
| first author | 0.15 | family name = OpenAlex first author 1, a later author 0.7, absent 0 |
| year | 0.12 | within ±1 → 1, else 0 |
| venue | 0.08 | abbreviation/acronym aware ("Phys. Rev. Lett.", "PNAS", "CVPR"), else token overlap |
| type | 0.10 | @article / @book / @inproceedings / preprint vs OpenAlex type (1, 0.5 partial, 0) |
| volume/pages | 0.05 | volume and first page equal |

**Score** = weighted mean of the signals present. Rules:
- A candidate needs title ≥ 0.7. Retraction or erratum *notices* are never candidates.
- Best score ≥ **0.85** with no near-tie → `matched-by-title`.
- A score from 0.7 up to 0.85, or a different work within **0.05** of the best → `uncertain`.
- Below 0.7 → `not-found`, and nothing is attached.
- OpenAlex duplicate records of one work (same title, year, first author, venue
  and type) aren't a tie; the most-cited one is kept.

The table shows the score next to the status and the per-signal breakdown on
hover. `uncertain` is treated like `suspicious`: counted in the report but
flagged, and never written to the cleaned `.bib`.

**Regression set:** `test/regression/hard-titles.bib` holds ~100 hard entries.
They cover retracted papers, books vs. articles with the same title,
preprint/proceedings/journal versions, republished classics, non-English titles,
generic titles and fabricated titles. Each carries its correct OpenAlex record
(via DOI or ID). `hard-titles.test.ts` replays recorded OpenAlex responses
**offline** on every `npm test`, through the real duplicate step: a confident match
must never be the wrong record (currently 0), and recall can't drop below a floor
(currently 100 of 111). It also checks the retraction report: all 24 known
retractions flagged, nothing else, and the Wakefield duplicate case. Re-recording is opt-in, goes through the shared
pool, and only re-fetches changed entries (see `test/regression/record.test.ts`).

## OpenAlex fields captured

Requested via a narrow `select=` (`src/config.ts` → `OPENALEX_SELECT_FIELDS`) and
mapped in `src/lib/openalex.ts` → `toOpenAlexWork` (see `OpenAlexWork` in
`src/types.ts`): `id`, `doi`, `display_name`, `publication_year`,
`primary_location` (venue name / `source.id` / `source.type`), `cited_by_count`,
`open_access` (`is_oa` / `oa_status`), `type`, `primary_topic`, `authorships`
(names + ORCIDs), `is_retracted`, and `biblio` (volume/issue/pages).
`referenced_works` is **not** in the default select — it's a large array added
only for the citation-gap path (`GAPS_SELECT_FIELDS`), so a normal run never pays
for it.

## The report

The UI has four always-visible tabs — **About** (the default landing tab) ·
**Report** · **Cleaned .bib** · **Table**. When an analysis finishes the app jumps
to **Report** and collapses the upload zone (a link re-opens it). The raw table
stays as the "show me the data" affordance.

**Denominator rules** (enforced once in `src/lib/stats/denominator.ts`, never
re-derived per card): duplicates count once; `suspicious` / `uncertain` are included but flagged;
`not-indexable` is excluded and reported separately; and **every card reports its
own `n`** (different fields are missing on different works). Baselines
(`src/lib/baselines.ts`) are stubbed — cards render a field comparison only
`if (baseline)`.

Cards: **recency** (median year + IQR, last-5/10-year share, oldest/newest,
histogram), **shape** (neutral patterns: stale tail, narrow window, gap,
concentration — gated behind a minimum n), **journal concentration** (top
venues, preprint servers separated), **self-citation** (name or ORCID, matched
references shown for review), **open access** (share + status breakdown, unknown
counted separately), **retractions & corrections** (multi-signal — see below;
verify, never "remove"), **missing citations** (below), **preprint → published**
(below), and **duplicates** (surfaces the de-duplication, flags mixed cite-key
styles).

**Copy summary** produces a one-paragraph plain-text description for a methods
section. The **Table** tab has **Export CSV** (the current filtered + sorted view,
UTF-8 with BOM for Excel, with "Duplicate of" and "Error" columns), and the **Cleaned .bib** tab has **View raw** (the cleaned
file shown in-page). The old JSON export was removed in v1.3.

## Missing citations

Off until pressed (it's the only path that enlarges responses / makes extra
billable calls — and BibProfile runs on a **shared** budget by default):

- **Co-citation** (safe, ~1 billable call) — re-fetches matched works as free
  singletons to pool `referenced_works`, ranks works cited by ≥ 4 of your
  references but absent from your list, and hydrates the top ~30 titles in one
  batched call. Finds missing **foundations**, never recent work.
- **Forward-citation** (gated, N billable calls) — scans works that cite your set
  (`cites:…`) and ranks those citing ≥ 2 of your references. Catches **recent
  adjacent work**.

Floors/cap are single constants in `src/config.ts` (`GAPS_COCITATION_FLOOR` = 4,
`GAPS_FORWARD_FLOOR` = 2, `GAPS_TOP_CANDIDATES` = 30) — post-fetch quality filters,
not cost reducers. Results are owned by `App.tsx` so they survive tab switches.

## Cleaned `.bib` export

`src/lib/stats/cleanBib.ts` (pure) computes corrections; `src/lib/bibWriter.ts`
serialises. Labelled **"suggested fixes — review before use"**. It is
**additive-only** and edits the **verbatim source text** (never regenerates from
the parser's AST — which would turn `\"{o}` into `ö` and drop brace-caps / custom
fields), so LaTeX escapes, Zotero fields, `@string` macros and comments survive
byte-identical, and **cite keys and entry count are invariant** (asserted by
test). Action is tiered by match status: `matched-by-doi` filled confidently,
`matched-by-title` filled but flagged, `suspicious` / `uncertain` shown as a suggestion (never
written), everything else passed through. Fields you wrote that **differ** from
OpenAlex are surfaced as review-only suggestions you accept per field. A colour
legend maps green = applied, yellow = suggested-not-applied, blue = review.

**Preprint → published** (`src/lib/stats/preprints.ts`) — lives in the **Report**
tab (it's analysis, never written to the cleaned file). Detecting preprints is
**free**; resolving each one to its published version reuses the title-search path
plus a `type:!preprint` filter, which is a **billable** search (one per detected
preprint). It therefore runs only when the user presses the button — never
automatically, so it can't quietly spend the shared budget. Matches are
**suggestions only** — a preprint is often cited on purpose, so applying the swap is
left to the user.

## Retractions & corrections (v1.4.2)

`src/lib/stats/retractions.ts` (pure) merges several signals. An entry is reported
**retracted** when any of these says so:
- the matched OpenAlex record is flagged `is_retracted`;
- **another OpenAlex record of the same work** is flagged. OpenAlex holds some works
  several times and may flag only one; the Wakefield 1998 Lancet paper has four
  records. These "twins" are near-identical-title candidates whose first author and
  year don't contradict the entry (`findTwins` in `matchScore.ts`);
- the `.bib` or OpenAlex title carries a "RETRACTED:" / "Retracted article:" prefix;
- a **Crossref** update record, either publisher-deposited or from **Retraction Watch**.

Expressions of concern and corrections come from Crossref and are listed
**separately**. Each entry appears once, under its most serious status. References
with no data at all are counted, never assumed clean.

**How the Crossref check runs.** `src/lib/crossref.ts` runs it **automatically**
after matching: it's free and doesn't touch the OpenAlex budget. It sends the DOIs
of the `.bib` entry, the match and its twins, about 40 per request, using
`filter=updates:…` (the notices pointing at those DOIs, each with `update-to`).

A failed batch is reported as "could not be checked", never as clean.

## Usage readout & graceful exhaustion

A compact bar shows live budget usage read from `/rate-limit`
(`src/lib/rateLimit.ts` parses it defensively — reads the `_usd` figures and reset
from the payload, never a hard-coded price). It is read once on page load, when a
key is set or cleared, and after each run — never on a timer.

- **User key:** read directly from OpenAlex — *"You've used $x of your $y daily budget"*.
- **Shared pool:** read through the Worker, which serves `/rate-limit` with the key
  stripped — worded as a **pooled** figure (*"The shared pool has used …"*), with a
  small "?" explainer.

**Safety invariant:** the browser never reads the shared key's usage from OpenAlex
**directly** — if the shared path points straight at `api.openalex.org` (local dev
or a rollback), `fetchRateLimit` makes no call and the UI shows a deferral line
instead.

If the **shared pool** is exhausted mid-run, a distinct `OpenAlexBudgetError`
halts cleanly — matched entries are kept, the rest left **pending** — and an
inline banner offers the user-key path plus **Resume**, which re-queries only the
pending entries on the new credential. (Auth failure on a *user* key is a
separate signal: no fallback to the shared pool.)

## Input guards

Two coarse gates (`src/lib/validateBib.ts`) reject a pathological upload before
any lookup: **file size** ≤ `MAX_BIB_BYTES` (1 MB, pre-parse) and **entry count**
≤ `MAX_BIB_ENTRIES` (300 parsed entries, pre-matching). Framed as scope ("a
per-paper tool"), not scarcity.

## Google Translate crash mitigation (v1.1)

Browser page-translation rewrites text nodes behind React's back and could
white-screen the app. Mitigations, all load-bearing: `translate="no"` +
`<meta name="google" content="notranslate">` on `<html>` and `notranslate` on
`#root` (`index.html`); dynamic text wrapped in its own `<span>` rather than bare
text nodes beside conditionals (e.g. `Progress.tsx`, `Summary.tsx`); and a root
`ErrorBoundary` (`src/components/ErrorBoundary.tsx`, mounted in `main.tsx`) that
shows a reload fallback instead of a blank page.

## Static site files (`public/` and `index.html`)

- `index.html` — SEO meta, Open Graph/Twitter tags, JSON-LD (`@graph`:
  SoftwareApplication + Organization), and a static no-JS fallback inside `#root`
  that crawlers index (keep it accurate when features change).
- `public/_headers` — Cloudflare Pages security headers (CSP **report-only**,
  X-Frame-Options, COOP/CORP, Permissions-Policy).
- `public/robots.txt` (allows indexing), `sitemap.xml`, `llms.txt` (facts for AI
  crawlers), `og-image.jpg`.
- `public/maintenance.html` — self-contained maintenance page. Maintenance mode is
  switched on/off by a Cloudflare **Redirect Rule** in the dashboard (not in this repo).

Production builds strip `console.*` and `debugger` (`vite.config.ts`).

## Project layout

```
index.html               # SEO meta + JSON-LD + no-JS fallback + notranslate
public/                  # _headers, robots.txt, sitemap.xml, llms.txt, og-image.jpg, maintenance.html
src/
  main.tsx               # React root, wrapped in ErrorBoundary
  config.ts              # base URL, key, pacing, thresholds, cost, select fields, gap floors/cap, input guards
  types.ts               # shared pipeline types
  versions.ts            # manual version history shown in About
  App.tsx                # orchestration, 4-tab layout, active credential, usage + exhaustion, billable results
  components/
    FileDrop.tsx  Progress.tsx  Summary.tsx  ResultsTable.tsx (incl. CSV export)
    KeyControl.tsx        # "use your own OpenAlex key"
    UsageIndicator.tsx    # usage bar (user or pooled) / deferral / unavailable
    About.tsx             # the About tab (incl. version history + contact)
    ErrorBoundary.tsx     # root crash fallback (Google Translate)
    report/              # the analysis report + cleaned export tab
      ReportView.tsx  CardShell.tsx  Histogram.tsx  BarChart.tsx  format.ts
      RecencyCard.tsx  ShapeCard.tsx  VenuesCard.tsx  SelfCitationCard.tsx
      OpenAccessCard.tsx  RetractionsCard.tsx (v1.4.2: retractions & corrections)  GapsCard.tsx  PreprintsCard.tsx
      DuplicatesCard.tsx  CleanedExport.tsx
  lib/
    doi.ts  similarity.ts  titleClean.ts  parseBib.ts  validateBib.ts
    credential.ts        # pure: shared vs. user-key resolution (the one active-credential decision)
    rateLimit.ts         # pure: defensive /rate-limit parse + formatting
    matchScore.ts        # v1.4.1 pure multi-signal match score + title-candidate decision (+ v1.4.2 findTwins)
    crossref.ts          # v1.4.2 the second fetch module: Crossref update records (retractions, concerns, corrections)
    openalex.ts          # the ONLY fetch layer (URLs, credential, retry, mapping, auth/budget errors, /rate-limit)
    match.ts             # orchestration: dedup, DOI-first (free), then title; halt/Resume on exhaustion
    gaps.ts              # citation-gap orchestration (co-citation + forward)
    preprintResolve.ts   # preprint -> published resolution orchestration
    bibWriter.ts         # additive, round-trip-safe BibTeX serialisation
    baselines.ts         # field-baseline stub (returns null)
    stats/               # PURE statistics, no React, no fetch, unit-tested
      denominator.ts  recency.ts  venues.ts  openaccess.ts  selfCitation.ts
      duplicates.ts  summaryText.ts  shape.ts  retractions.ts  coCitation.ts
      preprints.ts  cleanBib.ts
test/                    # vitest unit tests (pure functions; no network except mocked)
  regression/            # hard-titles.bib + recorded fixture (offline replay) + opt-in recorder
```

## Testing

`npm test` runs **200 tests** (plus 1 skipped: the opt-in regression recorder). Highlights: the v1.4.1
match-score signals and the hard-titles regression (offline); parsing/DOI/title-clean/similarity
regressions; every report statistic on fixtures (median/IQR year, top-venue
share, OA %, self-citation matching, shape patterns + min-n floor, retraction
filter, co-citation counting, preprint detection); the cleaned-export cite-key /
entry-count and LaTeX round-trip guards; the credential resolution + shared/user
decoupling; a static no-persistence guard over all of `src/`; rate-limit parsing;
the "never read the shared key's usage directly" safety invariant; budget-exhaustion
halt + Resume; the per-field mismatch accept in the cleaned export; and the
ErrorBoundary contract. UI/DOM behaviour is covered by documented manual checks (see
DEVLOG.md).

## Out of scope

Field baselines (stubbed) · topic/field-spread and impact-spread cards ·
similarity clustering · PNG export · accounts, storage, analytics · any network
host beyond OpenAlex and Crossref · the Retraction Watch CSV (its data comes via
Crossref) · paginated forward-citation ·
full reference *validation* (we check retraction and suggest fixes; we
don't claim to verify references are real).

## Credits

Bibliographic data from [OpenAlex](https://openalex.org). Retraction data from
[Crossref](https://www.crossref.org), including Retraction Watch. Built with React, Vite,
and `@retorquere/bibtex-parser`, with the assistance of Claude (Anthropic's AI).
Built by Florian David (ORCID: [0009-0001-7990-3186](https://orcid.org/0009-0001-7990-3186)).
