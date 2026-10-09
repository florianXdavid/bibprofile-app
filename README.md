# BibProfile

Browser-only tool that profiles a BibTeX reference list against
[OpenAlex](https://openalex.org): **upload your `.bib`, see the shape of your
bibliography, and get a cleaned copy back.** Handy as a final sanity-check right
before you submit a paper to a journal or conference.

Everything runs in your browser. On the shared pool, queries pass through
BibProfile's own proxy (`api.bibprofile.com`), which forwards them to OpenAlex and
stores nothing; with your own key they go straight to OpenAlex. Nothing is stored,
no account, no tracking.

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
  except OpenAlex. (A static test, `test/noPersistence.test.ts`, fails if any
  source file references a storage API.)
- **One fetch layer** (`src/lib/openalex.ts`) reaching a small, fixed set of hosts:
  the shared proxy (`api.bibprofile.com`, which just forwards to OpenAlex) or, for a
  user key, OpenAlex directly (`api.openalex.org`). OpenAlex is the only data host;
  the proxy stores nothing. No component calls `fetch` directly — that would bypass
  the pacing, retry, credential and cost logic.
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

1. **De-duplicate** — entries sharing a normalised DOI (or, lacking one, a
   normalised title) are queried once; duplicates are kept in the table, tagged,
   and reported as a finding.
2. **Has a DOI → free singleton lookup** (`/works/doi:…`, free and unlimited).
   The returned title is scored against the `.bib` title; a low score downgrades
   the match to `suspicious` (shown, never auto-rejected).
3. **No usable DOI → billable title search** (`?search=` on a cleaned title,
   fuzzy-matched with Sørensen–Dice against the original). Below threshold is
   `not-found`; an accepted-but-weak match is `suspicious`.
4. Genuine misses that aren't scholarly records are reclassified `not-indexable`.

Requests are sequential (~4.5/sec), retried once on a transient failure. Statuses:
`matched-by-doi`, `matched-by-title`, `suspicious`, `not-found`, `not-indexable`,
`error`, `unparseable`. Thresholds (title 0.7 / 0.85, DOI 0.65/0.75) are advisory
defaults in `src/config.ts`. The summary is deliberately blunt about misses.

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
re-derived per card): duplicates count once; `suspicious` is included but flagged;
`not-indexable` is excluded and reported separately; and **every card reports its
own `n`** (different fields are missing on different works). Baselines
(`src/lib/baselines.ts`) are stubbed — cards render a field comparison only
`if (baseline)`.

Cards: **recency** (median year + IQR, last-5/10-year share, oldest/newest,
histogram), **shape** (neutral patterns: stale tail, narrow window, gap,
concentration — gated behind a minimum n), **journal concentration** (top
venues, preprint servers separated), **self-citation** (name or ORCID, matched
references shown for review), **open access** (share + status breakdown, unknown
counted separately), **retractions** (OpenAlex's `is_retracted` flag only —
verify, never "remove"), **missing citations** (below), **preprint → published**
(below), and **duplicates** (surfaces the de-duplication, flags mixed cite-key
styles).

**Copy summary** produces a one-paragraph plain-text description for a methods
section. The **Table** tab has **Export CSV** (the current filtered + sorted view,
UTF-8 with BOM for Excel), and the **Cleaned .bib** tab has **View raw** (the cleaned
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
`matched-by-title` filled but flagged, `suspicious` shown as a suggestion (never
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
      OpenAccessCard.tsx  RetractionsCard.tsx  GapsCard.tsx  PreprintsCard.tsx
      DuplicatesCard.tsx  CleanedExport.tsx
  lib/
    doi.ts  similarity.ts  titleClean.ts  parseBib.ts  validateBib.ts
    credential.ts        # pure: shared vs. user-key resolution (the one active-credential decision)
    rateLimit.ts         # pure: defensive /rate-limit parse + formatting
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
```

## Testing

`npm test` runs **156 tests**. Highlights: parsing/DOI/title-clean/similarity
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
similarity clustering · PNG export · accounts, storage, analytics · Crossref or
any second network host · the Retraction Watch CSV · paginated forward-citation ·
full reference *validation* (we check retraction and suggest fixes; we
don't claim to verify references are real).

## Credits

Bibliographic data from [OpenAlex](https://openalex.org). Built with React, Vite,
and `@retorquere/bibtex-parser`, with the assistance of Claude (Anthropic's AI).
Built by Florian David (ORCID: [0009-0001-7990-3186](https://orcid.org/0009-0001-7990-3186)).
