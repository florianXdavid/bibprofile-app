# BibProfile

**Check your references before the reviewers do.** Find unmatched references,
retracted papers and outdated preprints, and get a cleaned `.bib`. In your browser,
no account.

BibProfile checks a BibTeX reference list against [OpenAlex](https://openalex.org)
and Crossref: how many references it could verify to exist, which ones to check by
hand, which are retracted — then the shape of your bibliography, the citations you
may have missed, and a cleaned copy back. Run it right before you submit a paper.

Everything runs in your browser. On the shared pool, queries pass through
BibProfile's own proxy (`api.bibprofile.com`), which forwards them to OpenAlex and
stores nothing; with your own key they go straight to OpenAlex. To find each
reference, its title, first author and year are sent to Crossref
(`api.crossref.org`); matched records are then fetched from OpenAlex. DOIs are also
checked against Crossref for retractions (Crossref includes the Retraction Watch
database). A "search Google Scholar" link sends a reference's title to Google only
when clicked. Nothing is stored, no account, no tracking.

> Building this project was a **week-by-week** effort. The full history — every
> feature, fix and scope decision in order — lives in **[DEVLOG.md](./DEVLOG.md)**.
> This README describes the tool **as it is now** (current release: **v1.5**;
> the version history shown in the app lives in `src/versions.ts`).

## What it does

- **Is every reference real?** (v1.5.1) — a card above the tabs: "X of Y references
  verified to exist", then the references that **could not be verified** (`not-found`
  or `uncertain`, each with a Google Scholar search link), **DOIs that point to another
  work** (`suspicious`), **retracted** papers (once the Crossref check is done), and
  grey notes for what isn't checkable (web pages, software, datasets), failed lookups
  and unreadable entries. Every unique, parseable reference is in exactly one bucket,
  so the numbers add up (`src/lib/stats/verification.ts`). "Could not verify" is never
  worded as "fabricated": some real works are missing from OpenAlex. The previous
  match summary sits under "Matching details". The table uses plain labels ("matched
  by identifier", "could not verify — check it exists ↗", "unsure match", "DOI points
  to another work", "not checkable"); the CSV keeps the status codes.
- **Try with an example / share with co-authors** (v1.5.2) — "Try with an example"
  (next to "Choose .bib file") loads a 30-reference BCI review (`src/demo/example.bib`)
  with the saved results of one real run (`src/demo/example-results.json`): instant,
  no request, nothing spent. It plants a retracted paper (Chaudhary 2017, PLoS Biol),
  a bioRxiv preprint since published, a PubMed-snapshot duplicate, a missing DOI and
  an invented reference. Re-record with `BIBPROFILE_RECORD_EXAMPLE=1 npx vitest run
  record-example` (shared pool, a few billable calls); `test/demo/example.test.ts`
  guards that the snapshot matches the .bib and shows exactly those findings. After any
  run, **Download report** saves a self-contained HTML report (no script, no external
  resource; `src/lib/reportHtml.ts`) — the reference check, then duplicates, preprints,
  the profile, missing citations if run, and what the cleaned .bib can add — with the
  footer "Checked with BibProfile — bibprofile.com · runs in your browser, nothing
  stored"; **Print / save as PDF** sends the same report to the browser's print dialog
  from a hidden frame. A "Send to co-authors" line ("Reference list checked with
  BibProfile: 41/43 verified, 1 retracted, 1 to double-check (details in the attached
  report). bibprofile.com") has a Copy button. All of it is generated locally.
  v1.5.3: the report always lists every section — one that needs a button says which
  to press ("Not run yet — press “Find adjacent work” …"); print uses small type on A4,
  and links print as plain text (DOIs in full, Scholar links hidden) because some PDF
  printers drop links.
- **Paste BibTeX** (v1.5.3) — beside the drop zone, for Overleaf users: paste the
  entries and press "Check pasted BibTeX"; same parser as a file. Text without any
  `@type{…` entry gets a clear message instead of a run.
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
  except OpenAlex and Crossref. (A static test, `test/noPersistence.test.ts`, fails if any
  source file references a storage API.)
- **Two fetch modules, a fixed set of hosts.** `src/lib/openalex.ts` reaches the
  shared proxy (`api.bibprofile.com`, which just forwards to OpenAlex) or, for a
  user key, OpenAlex directly (`api.openalex.org`); the proxy stores nothing.
  `src/lib/crossref.ts` reaches `api.crossref.org` — free, key-less, public pool —
  for the first title search (v1.4.4) and for retraction / correction notices
  (v1.4.2). No component calls `fetch`
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
(`openalex.org/settings/api`) to get their own daily credits. That key is held in
memory only and is never persisted or sent anywhere but OpenAlex. Since v1.5.3 the
pool meter and the key control sit in a footer below the tabs; when the pool runs
out, the key field appears in the exhaustion banner.

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

1. **De-duplicate** — entries sharing a normalised DOI **whose titles also agree**
   (or, lacking a DOI, the same normalised title **and** year **and** first-author
   surname) are queried once; duplicates are kept in the table, tagged, and
   reported as a finding. A shared title alone is not enough: conference/journal
   versions, books/articles and reprints often share one. A shared DOI alone is not
   enough either (v1.4.5): a DOI pasted onto the wrong entry is looked up on its
   own, comes out `suspicious`, and its note names the entry that owns the DOI.
2. **Has a DOI → free singleton lookup** (`/works/doi:…`, free and unlimited).
   A low title similarity (0.65, or 0.75 when the year isn't confirmed), or a
   match score below 0.7, downgrades it to `suspicious` (shown, never auto-rejected).
   **v1.4.5 — identifiers outside the `doi` field** (`findAltId` in `doi.ts`): a DOI
   in `url` / `note` / `howpublished` / `annote` (`doi.org`, `dx.doi.org`, `doi:`),
   an arXiv id (arxiv.org URL, `arXiv:…`, or `eprint` + `archivePrefix = arXiv` →
   `10.48550/arXiv.…`), a PubMed / PMC URL or `pmid` / `pmcid` field
   (`/works/pmid:…`; v1.4.6: also the legacy `ncbi.nlm.nih.gov/pubmed/…` and Europe PMC
   forms; `eprint` is read before `howpublished`), and an eLife article URL (`10.7554/eLife.…`) are looked up
   the same way, for free. Such an identifier is a hint: if its record disagrees
   with the entry, it is ignored (with a note) and the title path runs instead.
3. **No usable DOI → title resolution** (`resolveByTitle`, v1.4.4), cheapest first.
   Candidates at every step are scored by **`src/lib/matchScore.ts`** (see
   *Match score* below).
   - **Crossref search (free):** `query.bibliographic` = title + first author +
     year, top 5. Public pool, no `mailto`: since 21 Jul 2026 Crossref rate-limits
     the polite pool per email, so a shared address would cap all users together;
     without one, each browser has its own 1 search/s. Calls are paced ≥ 1.1 s
     apart. arXiv/CoRR entries skip this step (their DataCite DOIs aren't in
     Crossref).
   - A confident Crossref match → **OpenAlex record by DOI (free)**, re-scored. It
     is accepted only if still confident.
   - Otherwise, or if Crossref is unavailable, the **billable OpenAlex search**
     (`?search=` on a cleaned title; the query drops site cruft and "RETRACTED:"
     prefixes, folds accents and drops `?`/`*`).
   - On the hard-titles set (166 entries), free DOI / identifier lookups and Crossref
     place most entries; 43 need a billable search. The table tooltip and the summary say which path was used.
4. v1.4.6: an entry whose title is a placeholder ("J", "vol", ≤ 3 characters) and that
   has no identifier is `unparseable` ("title missing or truncated — cannot search"),
   not `not-found`. `not-found` means "OpenAlex has no acceptable record" — not proof
   the work doesn't exist.
   Genuine misses that aren't scholarly records are reclassified `not-indexable` —
   including (v1.4.5) a `@misc` / `@online` / `@software` / `@dataset` entry with a
   URL and no identifier, whoever its author is.
5. **v1.4.5 — after the run** (`finishRows`): confident rows that landed on the
   **same OpenAlex work** are duplicates too (a title-path and a DOI-path entry, a
   PubMed snapshot and the article; "Duplicate of" points to the first); an
   `uncertain` row on that work only gets a hint. A row cited as a journal or
   proceedings paper but matched to the **preprint** record is labelled "preprint
   version" (v1.4.6: only when that record is on a preprint server — OpenAlex also
   types Cold Spring Harbor journal articles `preprint`). A **cite key used twice** is
   flagged on both copies (BibTeX uses the first). The main copy of a duplicated work
   is the **most complete** entry (identifier, author, year, venue; file order breaks
   ties), never a web snapshot that happens to come first (v1.4.6). Every row carries plain-language **notes** (why it is flagged, where its
   identifier was found, a merged record of another version), shown under ⓘ in the
   table and in the CSV.

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
  A title also matches its main title before `: `, ` - ` or (v1.4.5, ≥ 3 words) `. `
  — OpenAlex keeps only "Gaia Data Release 2" of A&A's "Gaia Data Release 2. Summary
  of …". A corporate first author (`{Gaia Collaboration}`) is skipped for the first
  person.
- Best score ≥ **0.85** with no near-tie → `matched-by-title`, unless the year is
  more than **3** years off (a different edition or reprint, v1.4.4), which caps it at
  `uncertain`. v1.4.5 caps it at `uncertain` too (the reasons are in the row's notes)
  when: neither the first author nor the year confirms the title (web snapshots);
  the title is a saved "PEER REVIEW - …" page; only an OpenAlex **stub** is left (no
  DOI and one author where the `.bib` lists several, or the CiNii junk venue — a stub
  is never preferred over a real record); the title is very short (< 15 characters
  or < 3 words) without the first author **and** the venue (or, when the venue can't
  be compared, the year); or the `.bib` cites a DOI OpenAlex doesn't know and the
  candidate has another one (a dataset mirror, another version). v1.4.6 adds: the
  titles differ on a **discriminating token** — a number, a Roman numeral or a single
  capital letter ("data set A" vs "data set B", "Part II", "DR3").
- v1.4.6: a near-perfect best (≥ 0.95) is not made ambiguous by a runner-up it
  strictly beats, nor by a twin record of the same work (same title, first author,
  years within 1, not two parts with different first pages). U+FFFD in OpenAlex /
  Crossref titles and author names (pre-1950 German records) matches the lost
  accented letter.
- A score from 0.7 up to 0.85, or a different work within **0.05** of the best → `uncertain`.
- Below 0.7 → `not-found`, and nothing is attached.
- OpenAlex duplicate records of one work (same title, year, first author, venue
  and type) aren't a tie; the most-cited one is kept.

The table shows the score next to the status and the per-signal breakdown on
hover. `uncertain` is treated like `suspicious`: counted in the report but
flagged, and never written to the cleaned `.bib`.

**Regression set:** `test/regression/hard-titles.bib` holds 167 hard entries.
They cover retracted papers, books vs. articles with the same title,
preprint/proceedings/journal versions, republished classics, non-English titles,
generic titles and fabricated titles. Each carries its correct OpenAlex record
(via DOI or ID). v1.5 sections (v1.4.5, from a real-world audit) add identifiers
outside the `doi` field, a DOI shared by two works, A&A titles, same-work pairs,
weak evidence, proceedings with only a preprint, cleaned-`.bib` safety, web
resources, title display, a repeated cite key and parser edge cases, with their own
ground-truth fields (`expectstatus`, `expectlookup`, `expectdup`, `expectfill`,
`expectnosuggest`, …; defined in the file header). `hard-titles.test.ts` replays the
**whole run** (`runMatching`: dedup, DOI / identifier lookups, title path, same-work
duplicates) and the cleaned `.bib` from recorded Crossref and OpenAlex responses,
**offline**, on every `npm test`. A confident match must never be the wrong record
(currently 0); recall can't drop below a floor (currently 125 of 130 entries with a
known record); every v1.5 field holds; and the
invariants G1–G5 hold (escaped values, no junk venue, nothing for `suspicious`
rows, no shared OpenAlex work without a duplicate link, no `N--N` pages). It also
checks the retraction report: all 24 known retractions flagged, nothing else, and
the Wakefield duplicate case. Re-recording is opt-in, goes through the shared pool,
and only re-fetches changed entries (see `test/regression/record.test.ts`).

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
re-derived per card): duplicates count once; `suspicious` / `uncertain` are included but flagged
(v1.4.6: an `uncertain` match scoring below `REPORT_UNCERTAIN_MIN_SCORE` = 0.8 is left
out of every card and of the citation-gap seeds, and each card says how many);
`not-indexable` is excluded and reported separately; and **every card reports its
own `n`** (different fields are missing on different works). Baselines
(`src/lib/baselines.ts`) are stubbed — cards render a field comparison only
`if (baseline)`.

Cards: **recency** (median year + IQR, last-5/10-year share, oldest/newest,
histogram — v1.4.5: the year **you cite**, i.e. the `.bib` year, and the OpenAlex
year only when the entry has none and the match is confident; OpenAlex dates some
records oddly), **shape** (neutral patterns: stale tail, narrow window, gap,
concentration — gated behind a minimum n), **journal concentration** (top
venues, preprint servers separated; v1.4.5: OpenAlex venue names cleaned —
`cleanVenue` — and a paper cited as published but matched to its preprint counted
on its own line, not as a preprint), **self-citation** (name or ORCID, matched
references shown for review), **open access** (share + status breakdown, unknown
counted separately), **retractions & corrections** (multi-signal — see below;
verify, never "remove"), **missing citations** (below), **preprint → published**
(below), and **duplicates** (surfaces the de-duplication, flags mixed cite-key
styles).

**Copy summary** produces a one-paragraph plain-text description for a methods
section. The **Table** tab has **Export CSV** (the current filtered + sorted view,
UTF-8 with BOM for Excel, with "Duplicate of" and "Error" columns, and since v1.4.5
match score, OpenAlex DOI, OpenAlex title, notes, retracted, preprint version and
"identified by"; v1.4.6: the venue column shows cleaned names), and the **Cleaned .bib** tab has **View raw** (the cleaned
file shown in-page). The old JSON export was removed in v1.3.

## Missing citations

Off until pressed (it's the only path that enlarges responses / makes extra
billable calls — and BibProfile runs on a **shared** budget by default):

- **Co-citation** (safe, ~1 billable call) — re-fetches matched works as free
  singletons to pool `referenced_works`, ranks works cited by ≥ 4 of your
  references but absent from your list, and hydrates the top ~30 titles in one
  batched call. Finds missing **foundations**, never recent work. Each result says
  "cited by N of your references".
- **Forward-citation** (gated, N billable calls) — scans works that cite your set
  (`cites:…`) and ranks those citing ≥ 2 of your references ("cites N of your
  references"). Catches **adjacent work** of any year (the year is shown).

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
test).

**Never write an unverified field (v1.4.3).** Only two kinds of fill are written
automatically:
- every fill on a `matched-by-doi` entry whose own **`doi` field** identified the record
  and whose OpenAlex year is within 1 of yours (v1.4.6: a record found through an arXiv
  ID / PMID / a DOI in `url`, or dated 2+ years off, gets review items only);
- the **DOI** of a high-confidence title match: `matched-by-title`, title ≥ 0.95,
  first author and year (±1) confirmed, and not a different version (preprint vs
  published) (`isHighConfidenceTitleMatch`; `AUTO_DOI_TITLE_THRESHOLD`).

Everything else is a per-field **review** item, written only if you click Accept:
- the other fills of a title match;
- every fill of a lower-confidence or `uncertain` match;
- every value that **differs** from OpenAlex.

**v1.4.5 safety rules** (from a real-world audit):
- v1.4.6: never a placeholder or self-assigned DOI (ACM's `10.5555`, ResearchGate's
  `10.13140`), and never a title "correction" (differences are case, LaTeX or a
  "RETRACTED:" prefix).
- Every value written or proposed is **LaTeX-escaped** (`texEscape`: `&` `%` `$`
  `#` `_` → `\&` …; a bare `&` stops the LaTeX build). DOIs and URLs stay verbatim.
- A **`suspicious`** entry gets nothing: its DOI points to another work.
- A journal or DOI you wrote is never "corrected" (a different journal name, a
  preprint server or a merged record's DOI is not a fix). A year is proposed only
  when it is 1 off (online-first vs print); a bigger gap is an info note (reprint,
  digitisation). An arXiv DOI next to a named journal gets a note instead.
- Venue fills use cleaned names (`cleanVenue`: CVPR's doubled name collapsed,
  "Alzheimer s" → "Alzheimer's", PubMed / "… eBooks" / junk dropped); a preprint
  server is never written as a journal.
- Pages are `N`, never `N--N` (article numbers).
- If your DOI resolved to a **merged record** with another DOI (often the other
  version), its fills are review only. A DOI found in `url` / `note` is proposed
  as `doi = {…}` for review; the `url` is never touched.
- A **repeated cite key** gets a comment line above its 2nd copy
  (`% BibProfile: duplicate key — BibTeX will ignore this entry`); nothing is dropped.

DOIs are shown as `doi.org` links so they can be checked in one click. The diff
header states how many fields were written automatically and on what basis.
On the hard-titles regression set, all 92 automatic DOIs are the correct record
(asserted). Everything else is passed through untouched. Legend: green = applied,
blue = review.

**Preprint → published** (`src/lib/stats/preprints.ts`) — lives in the **Report**
tab (it's analysis, never written to the cleaned file). Detecting preprints is
**free**; resolving each one to its published version reuses the title-search path
plus a `type:!preprint` filter, which is a **billable** search (one per detected
preprint). It therefore runs only when the user presses the button — never
automatically, so it can't quietly spend the shared budget. Matches are
**suggestions only** — a preprint is often cited on purpose, so applying the swap is
left to the user. v1.4.5: a published version must have a title ≥ 0.9, the same
first author, a year no earlier than the preprint's, and not be a dataset or a
software package (Adam was once offered an R package on CRAN).

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

**Credits, never dollars (v1.5.4).** The UI counts **credits** so no visitor wonders
"am I paying?": 1 credit = one billable OpenAlex call (`SEARCH_CALL_COST_USD` =
$0.001), so the shared $1.00/day shows as 1,000 credits (`toCredits` / `credits` in
`rateLimit.ts`; the payload stays in USD). The bar shows what's **left** (red at ≤ 10 %).
Matching details, the Report cards and the exhaustion banner speak in credits too.

- **User key:** read directly from OpenAlex — *"Your OpenAlex key's credits today:
  950 of 1,000 left"*.
- **Shared pool:** read through the Worker, which serves `/rate-limit` with the key
  stripped — worded as a **pooled** figure (*"Free shared credits today: 780 of 1,000
  left · resets in 12h 9m"*), with a "What are credits?" explainer ("BibProfile is
  free — you never pay anything …").

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
- **Guide pages (v1.6.1)** — one page per task people search for, as plain static HTML
  (no React, no script, no build step; Cloudflare Pages serves `/<slug>/index.html`):
  `/check-hallucinated-references/`, `/find-retracted-papers/`,
  `/add-missing-dois-bibtex/`, `/preprint-published-version/`. Each has its own title,
  description, canonical URL and `FAQPage` JSON-LD matching the visible FAQ, the
  problem, how to do it with BibProfile, its limits, how to do it by hand, and a
  **"See it on an example"** button: `/?example=<references|retractions|dois|preprints>`
  loads the bundled example on the matching tab and card (`EXAMPLE_FOCUS` in
  `src/guides.ts`; the parameter is read once and removed from the address bar). Shared
  stylesheet `public/guides.css`. `src/guides.ts` is the list the app links from (a
  "Guides:" line under the pool footer); the pages are also in `sitemap.xml`,
  `llms.txt` and the static fallback in `index.html`. `test/guides.test.ts` keeps all
  of this consistent. To add a guide: write the page, add it to `GUIDES`, the sitemap,
  `llms.txt` and `index.html`; the test says what's missing.

Production builds strip `console.*` and `debugger` (`vite.config.ts`).

## Project layout

```
index.html               # SEO meta + JSON-LD + no-JS fallback + notranslate
public/                  # _headers, robots.txt, sitemap.xml, llms.txt, og-image.jpg, maintenance.html,
                         #   guides.css + one folder per guide page (v1.6.1)
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

`npm test` runs **271 tests** (plus 2 skipped: the opt-in recorders). Highlights: the v1.4.1
match-score signals and the hard-titles regression (offline; v1.4.5: the whole run,
the v1.5 ground-truth fields and invariants G1–G5); the v1.4.5 identifier extraction,
shared-DOI, same-work-duplicate and cleaned-`.bib` safety rules; parsing/DOI/title-clean/similarity
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

Bibliographic data from [OpenAlex](https://openalex.org). Reference lookup and
retraction data from [Crossref](https://www.crossref.org), including Retraction Watch. Built with React, Vite,
and `@retorquere/bibtex-parser`, with the assistance of Claude (Anthropic's AI).
Built by Florian David (ORCID: [0009-0001-7990-3186](https://orcid.org/0009-0001-7990-3186)).
