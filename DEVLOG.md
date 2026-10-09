# BibProfile — development log

> This is the **week-by-week history** of how BibProfile was built — every
> feature, fix, scope decision and reversal, in the order it happened. It's
> kept as a trace of the process. For the **current state** of the project,
> read **[README.md](./README.md)** instead.

---

# BibProfile — parse · match · profile

Browser-only tool that takes a BibTeX file and matches its reference list
against [OpenAlex](https://openalex.org), then profiles it: *upload your `.bib`,
see the shape of your bibliography in 30 seconds — and get a cleaned copy back.*

- **W1** built the core loop: parse a `.bib`, match entries to OpenAlex, and
  show the raw matched data in a sortable/filterable table with an honest
  match-rate summary and a JSON export.
- **W2** turned that data into a short **report** — analysis cards plus a
  copy-paste plain-text summary. The raw table stays, one toggle away, as the
  "show me the data" affordance. See **"Week 2 — the analysis report"** below.
- **W3** adds the features that give a reason to come back and, for the first
  time, a **file you keep**: three more cards (reference-list **shape**,
  **retractions**, missing-citation **gaps**) and a **cleaned `.bib` export**
  with an on-screen diff and a downloadable file. See **"Week 3"** below. The
  view toggle is now **Report / Cleaned .bib / Table**.

Everything is descriptive, never evaluative: the report tells you what your
reference list *is*, and passes no judgement on it (citation norms differ
legitimately between fields). The cleaned export is labelled "suggested fixes —
review before use", never "corrected".

## Architectural constraints (do not violate)

- **No backend, no server, no database, no auth, no persistence.** Nothing is
  stored (no `localStorage`) or transmitted anywhere except OpenAlex.
- The only network calls are from the browser to the configured OpenAlex base
  URL. See `src/config.ts`.
- Deploys as a **static site** — `npm run build` emits `/dist`, which drops
  straight onto Cloudflare Pages or Netlify.

## Stack

Vite + React + TypeScript · [`@retorquere/bibtex-parser`](https://www.npmjs.com/package/@retorquere/bibtex-parser)
for parsing · [Vitest](https://vitest.dev) for unit tests · no UI framework, no chart library, no state library · plain CSS.
The two W2 charts (year histogram, venue bar chart) are **hand-rolled inline SVG** —
~40 lines each, zero chart dependencies.

## Running it

Requires Node 18+.

```bash
npm install
cp .env.example .env      # then edit .env (see below)
npm run dev               # http://localhost:5173
```

Other scripts:

```bash
npm run build       # tsc typecheck + vite build -> /dist  (deploy this)
npm run typecheck   # types only
npm test            # vitest unit tests (regression suite for the W1 fixes)
npm run preview     # serve the built /dist locally
```

Click **Load sample** to run against the bundled neuroscience `.bib`
(`src/sample.bib`, ~40 entries: mixed DOI formats, LaTeX escapes, preprints,
and a few deliberately malformed blocks), or drop in your own `.bib`.

## Configuration — where the important constants live

Everything network-related lives in **`src/config.ts`**.

### The single network target (the W1→W2 swap point)

```ts
export const OPENALEX_BASE_URL = (import.meta.env.VITE_OPENALEX_BASE_URL
  ?? 'https://api.openalex.org').replace(/\/+$/, '')
```

This is the **one** place that decides where requests go. Requests are built as
`` `${OPENALEX_BASE_URL}/works/...` ``.

- **W1 (now):** leave it at `https://api.openalex.org` and provide your own key
  (below). Runs entirely in your browser.
- **W2 (next):** point `VITE_OPENALEX_BASE_URL` (or this constant) at a
  Cloudflare Worker proxy that injects the key server-side, and leave the key
  blank in the client. That is a **one-line change** — no other code moves.

### The API key (⚠ never ship it)

OpenAlex now **requires an API key** for meaningful rate limits (free tier:
~$1/day of usage *with* a key, ~$0.01/day without). Get a free key at
<https://openalex.org/settings/api>.

```
# .env  (gitignored; copied from .env.example)
VITE_OPENALEX_BASE_URL=https://api.openalex.org
VITE_OPENALEX_API_KEY=your_key_here      # W1/local only — leave blank in W2
VITE_OPENALEX_MAILTO=you@example.com     # optional, superseded by the key
```

**Vite inlines every `VITE_*` var into the client bundle at build time.** That
is fine for W1 (you run a local build with your own key). Do **not** deploy a
build that contains your key — in W2 the Worker holds it. `.env` is gitignored.

## Matching strategy

Per entry, after DOI normalisation (`src/lib/doi.ts` strips `https://doi.org/`,
`dx.doi.org`, `doi:`, braces, whitespace, a stray `\_`, and lowercases —
**without** touching interior `<...>`, which are part of legacy Wiley DOIs):

1. **De-duplicate first (querying only).** Entries sharing a normalised DOI —
   or, lacking a DOI, a normalised title — are queried once. Every original row
   is kept **in original .bib file order** (`sourceOffset`; sorting the table is
   a separate view-level concern) and duplicates are tagged `duplicateOf`.
2. **Has a DOI → free singleton lookup.** `GET /works/doi:10.xxxx/yyyy`. Free
   and unlimited. The returned `display_name` is scored against the `.bib` title;
   below `DOI_SUSPICIOUS_THRESHOLD` (**0.65**) the status is downgraded to
   `suspicious` (shown, never auto-rejected). The cutoff tightens to **0.75**
   whenever the year does **not positively agree** — i.e. it disagrees *or* is
   unverifiable (missing on either side). A DOI that resolves to nothing falls
   through to step 3.
3. **No usable DOI match → billable title search.** `GET /works?search=<title>`.
   **Query encoding:** the URL is built with `URLSearchParams` in
   `src/lib/openalex.ts` (`buildUrl` → `buildWorksSearchUrl`), so every query
   metacharacter (`|`, `?`, `$`, `^`, `:`) is percent-encoded; we never
   hand-concatenate a query string and never use the deprecated
   `filter=title.search:` syntax. This is asserted in `test/url.test.ts`.
   The searched title is **cleaned** first (`src/lib/titleClean.ts`): junk
   prefixes (`PEER REVIEW - `, `From the Cover: `) are dropped, pipe-delimited
   page titles collapse to their **longest segment** (handles `… | PNAS`,
   `Frontiers | …`, multi-pipe `… | Robotics | IEEE Xplore`, and multi-word
   sites like `ScienceDirect Topics`), and known-site dash suffixes
   (`… - PubMed`) are stripped — while legitimate `Title - a review` subtitles
   are left intact. The original title is kept for display and comparison.
   Results are fuzzy-matched (Dice) against the original title: below
   `TITLE_MATCH_THRESHOLD` (**0.7**) is `not-found`; an accepted match below
   `TITLE_SUSPICIOUS_THRESHOLD` (**0.85**) is flagged `suspicious`. Every search
   call is counted and its cost surfaced.
4. **Reclassify genuine misses.** A miss on something that isn't a scholarly
   work is reported as `not-indexable` rather than `not-found`. Detection
   (`looksNotIndexable`) is conservative and multi-signal — any one of: the
   title is a URL; the venue/journal/`howpublished` is a bare URL; or the entry
   is `@misc`/`@online` with no year and no DOI. The lookup is always still
   attempted; the flag only classifies the *result*.

Requests are **sequential**, ~4.5/sec (`REQUEST_DELAY_MS`), never parallel
bursts. Each request **retries once** with backoff on a transient failure
(network / 429 / 5xx); a `404` means "not in OpenAlex" and is not retried;
anything still failing after the retry is marked `error`.

> Threshold note: `DOI_SUSPICIOUS_THRESHOLD` (0.65) and
> `TITLE_SUSPICIOUS_THRESHOLD` (0.85) are tuned on only a handful of corpus data
> points. They are reasonable defaults for an advisory flag, not validated
> boundaries — adjust in `src/config.ts` if your corpus differs.
>
> Citation-gap floors/cap (W3.1), same framing — advisory defaults in
> `src/config.ts`, not validated boundaries: `GAPS_COCITATION_FLOOR` (**4** — a
> co-cited work needs ≥ 4 of your refs citing it), `GAPS_FORWARD_FLOOR` (**2** —
> a citing work needs to cite ≥ 2 of your refs), and `GAPS_TOP_CANDIDATES`
> (**30** — the shared display cap, also the co-citation hydration budget). The
> floors are **post-fetch quality filters, not cost reducers**: OpenAlex's
> `cites:` filter can't express "cites ≥ N of my seeds", so the calls are made
> regardless and the floor sharpens the *results*. The cost preview is unchanged.

### Match statuses

| Status | Meaning |
|---|---|
| `matched-by-doi` | DOI singleton resolved and the returned title clears the similarity bar. |
| `matched-by-title` | No usable DOI; a title search cleared **0.85**. |
| `suspicious` | A DOI match below 0.65 (0.75 when the year isn't confirmed) **or** a title match in [0.7, 0.85). **Shown, never auto-rejected** — often a wrong `.bib` DOI, sometimes a correct work with truncated upstream metadata. Judge it. |
| `not-found` | Looked up, nothing acceptable came back. |
| `not-indexable` | Not the kind of record OpenAlex indexes (dataset page, software library, bare-URL venue, URL-as-title). |
| `error` | Network / server failure after one retry. |
| `unparseable` | The `.bib` block could not be turned into a usable record (incl. empty entries). |

Rows carry `duplicateOf` (canonical cite key), and a **tri-state year check**:
`agree` (nothing shown), `disagree` (⚠ flag), or `unverified` (a `?` marker when
a year is missing on either side). `unverified` is never treated as agreement —
not in the suspicious logic, not in the display. The summary is deliberately
blunt about misses.

## OpenAlex fields — captured vs. ignored

We request a **narrow `select=`** (`src/config.ts` → `OPENALEX_SELECT_FIELDS`)
and keep only what the table and cards need (`src/lib/openalex.ts` →
`toOpenAlexWork`).

**Captured now** (see `OpenAlexWork` in `src/types.ts`):

| Our field        | OpenAlex path                              | Used by |
|------------------|--------------------------------------------|---------|
| `id`             | `id`                                       | table   |
| `doi`            | `doi`                                      | table   |
| `displayName`    | `display_name`                             | matching, all cards |
| `publicationYear`| `publication_year`                         | recency card |
| `hostVenue`      | `primary_location.source.display_name`     | venue card |
| `citedByCount`   | `cited_by_count`                           | table   |
| `isOa`           | `open_access.is_oa`                        | OA card |
| `type`           | `type`                                     | table   |
| `primaryTopic`   | `primary_topic.display_name`               | table   |
| `oaStatus` ⁽ᵂ²⁾  | `open_access.oa_status`                    | OA card |
| `sourceId` ⁽ᵂ²⁾  | `primary_location.source.id`               | venue grouping |
| `sourceType` ⁽ᵂ²⁾| `primary_location.source.type`             | venue card (journal vs. repository) |
| `authorships` ⁽ᵂ²⁾| `authorships[].author.{display_name, orcid}` | self-citation card |
| `isRetracted` ⁽ᵂ³⁾| `is_retracted`                            | retractions card |
| `biblio` ⁽ᵂ³⁾    | `biblio.{volume, issue, first_page, last_page}` | cleaned export |
| `referencedWorks` ⁽ᵂ³, conditional⁾ | `referenced_works` | gaps card **only** |

> Note: `host_venue` is **deprecated** — we read `primary_location.source`.
>
> **W2 select-field note.** `primary_location` and `open_access` were *already*
> requested as whole objects in W1, so `oa_status`, `source.id` and
> `source.type` came back for free — only the mapping in `toOpenAlexWork`
> changed. The one genuine addition to `OPENALEX_SELECT_FIELDS` is
> **`authorships`**, which the self-citation card needs and which meaningfully
> **increases response size** (a full author list + ORCIDs per work).
>
> **W3 select-field note.** `is_retracted` (tiny) and `biblio` (small) are added
> to the default select and requested **always**. `referenced_works` is a
> **large array per work** and is deliberately **NOT** in the default select: it
> is added only via `GAPS_SELECT_FIELDS`, a **conditional second request shape**
> used exclusively by the citation-gap path (`src/lib/gaps.ts`). A normal report
> run never requests it and never pays for it. On our shared API key that
> restraint is the difference between a cheap default and an inflated one —
> keep it.

**Still available but intentionally ignored** (add to `OPENALEX_SELECT_FIELDS`
when a future card needs them):

- **Recency:** `publication_date` (exact date). W2 uses `publication_year`;
  year resolution is sufficient for the histogram and the median.
- **Venue detail:** `primary_location.source.issn_l` / `.host_organization`.
- **Open-access detail:** `open_access.oa_url`, `best_oa_location`,
  `primary_location.license` / `.version` / `.pdf_url`.
- **Topic / field mix:** `primary_topic.subfield` / `.field` / `.domain` /
  `.score`, and the full `topics[]` list. (Needed by the deferred topic card.)
- **Impact / graph:** `counts_by_year`, `referenced_works_count`,
  `related_works`, `cited_by_percentile_year`.
- **Authorship detail:** institutions, countries, corresponding-author flags.
- **Bibliographic detail:** `language`, `indexed_in`. **Text:**
  `abstract_inverted_index`, `has_fulltext`.
- **Retraction detail (deliberately not shipped):** the Retraction Watch CSV
  (reason/date). W3 ships OpenAlex's `is_retracted` flag only — see the scope
  reversal in "Week 3" below. `is_paratext` remains out of scope.

## Week 2 — the analysis report

The report renders as a vertical scroll of cards below a **Report / Table**
toggle (the table is unchanged; it's the raw-data affordance that makes the
report trustworthy). Card order is deliberate — recency first, duplicates last.

### Denominator rules — these govern every card

Being honest about what's counted is what makes the numbers credible. Enforced
once in a shared helper (`src/lib/stats/denominator.ts` → `buildCohort`,
`subset`), never re-derived per card:

| Rule | How it's implemented |
|---|---|
| **Duplicates count once** | Rows carrying `duplicateOf` are excluded from every distribution; only the canonical entry counts. A paper cited four times is one work. |
| **`suspicious` included, but flagged** | Kept in the cohort and counted, with a running `flagged` tally so each card can footnote *"3 flagged as uncertain."* |
| **`not-indexable` excluded** | Removed from statistics and reported separately (a software library has no publication year). |
| **Every card shows its own n** | `subset()` re-filters the cohort to the works that actually carry the field the card needs, and returns `{ n, flagged, excluded: { reason: count } }`. The card footer prints it via `describeBasis`. |

### The five cards (`src/components/report/`)

1. **Recency profile** *(headline)* — median publication year + inter-quartile
   range, share from the last 5 / 10 years (inclusive window ending at the
   current year), the named oldest and newest reference, and a hand-rolled SVG
   histogram (`Histogram.tsx`, 1-year bins up to a 24-year span, else 2-year).
2. **Journal concentration** — top-10 venues (SVG bar chart), top-3 share,
   distinct-venue count, and the most-cited venue called out. Venues group by
   `source.id` (variant names collapse); preprint servers (arXiv, bioRxiv,
   medRxiv, …) are reported **separately** from journals.
3. **Self-citation** *(collapsed / optional — the only card needing input)* —
   a name and optional ORCID. ORCID → exact match on `authorships[].author.orcid`;
   name → surname + first initial against author display names, with **every
   matched reference shown** so the user can dismiss false positives. Works with
   no author data are reported separately, not counted as "no".
4. **Open access** — share OA over works with a *known* `is_oa`, a breakdown by
   `oa_status` (gold/green/hybrid/bronze/closed), and an **explicit unknown
   count** — unknown is never folded into "closed".
5. **Duplicates** — surfaces the de-duplication that already ran: each
   duplicated work with all its cite keys, and a flag when the same work appears
   under **different cite-key styles** (`todorov_optimality_2004` vs
   `todorov2004Optimality`) — the signature of two merged bibliographies. Quiet
   when the list is clean.

### Baselines — deliberately stubbed (`src/lib/baselines.ts`)

`getBaseline(fieldId)` returns `null` for now. Each card renders its comparison
line only `if (baseline)`, so field-level comparison ("typical for neuroscience
is …") slots in later by swapping one function. **No placeholder numbers, and 0
is never used as a stand-in** — a fake baseline that looks real is worse than
none.

### Export

- **Copy summary** — one descriptive plain-text paragraph for a methods section
  or email (`src/lib/stats/summaryText.ts`). Clauses drop out when their data is
  absent, so a sparse list still yields a truthful shorter sentence.
- **Export matched data (JSON)** — unchanged from W1.
- *(PNG card export is intentionally deferred — needs the visual design settled.)*

## Week 3 — freshness, provenance & the cleaned export

Three more report cards, plus the headline deliverable: a **cleaned `.bib`** on
its own tab. All new network logic still lives in `openalex.ts`; all computation
in pure, unit-tested `stats/` modules; no card calls `fetch`.

### The shared-key reality (governs the gaps card)

The tool runs on **one shared OpenAlex API key** — it asks the user for no
email, no account, nothing but a `.bib`. So every user's calls draw down **one
shared daily budget**. Two consequences, enforced in code and not to be
"optimised away":

- **`referenced_works` is conditional** (`GAPS_SELECT_FIELDS`). A normal report
  run never requests that large array; only the gaps card does.
- **Forward-citation is gated twice** — behind its own button, and it shows its
  projected cost before running. On the shared key it is **the one feature that
  can exhaust the daily budget.** Co-citation (≈1 billable call) is the safe
  default; forward-citation is the power-user extra.

### The three new cards

6. **Reference-list shape** (`stats/shape.ts`, `ShapeCard.tsx`) — **zero new
   network calls**; re-reads the recency years and reuses the venue
   concentration. Neutral, descriptive patterns only — stale tail, narrow
   window, a gap in the histogram, venue concentration — each a plain sentence
   pointing back at the histogram. **No scoring, no verdicts.** Gated behind a
   minimum n (`SHAPE_MIN_N` = 20): below the floor it surfaces nothing.
7. **Retractions** (`stats/retractions.ts`, `RetractionsCard.tsx`) — **no new
   calls**; filters the cohort on `is_retracted`. Quiet when clean; neutral when
   not ("marked retracted — verify, as you may be citing it deliberately"). See
   the scope reversal below.
8. **Missing citations** (`stats/coCitation.ts` + `lib/gaps.ts`, `GapsCard.tsx`)
   — **off until a button is pressed.** *Co-citation* (default) re-fetches each
   matched work as a **free singleton** to pool `referenced_works`, ranks works
   many of your references cite but you don't, and hydrates the top ~30 titles in
   **one** billable call — showing *which* of your works co-cite each candidate.
   It only finds missing **foundations**, never recent work (surfaced in the UI).
   *Forward-citation* (second, cost-gated button) scans works that cite your set
   (`filter=cites:…`, N billable calls) to catch **recent** adjacent work.

### Retraction check — a deliberate scope reversal

W1/W2 stated twice that retraction checking was "another tool's job." **W3
deliberately reverses that for a *light* version:** OpenAlex's `is_retracted`
flag only, surfaced for the user to verify — never an instruction to remove.
This is an intentional decision, not a contradiction. We still do **not** ship
the Retraction Watch CSV (reason/date) — that is a static-asset-with-monthly-
refresh commitment we are not making in v1; noted as a possible later upgrade.

### Preprint → published (feeds the cleaned export, not a card)

`stats/preprints.ts` detects preprints for **free** (DOI prefixes `10.48550/arXiv`,
`10.1101/`, SSRN, ChemRxiv, …; arXiv `eprint`/`archivePrefix` fields; the
`journal = {arXiv preprint …}` tell). Resolution to a published version
(`lib/preprintResolve.ts`) reuses the **existing** title-search path plus a
`type:!preprint` filter — no new fetch code — accepting a match only on high
title similarity **and** year ≥ preprint year. It is **billable and gated**, and
its results are **suggestions only** — people cite preprints on purpose.

### Cleaned `.bib` export (the deliverable) — `Cleaned .bib` tab

`stats/cleanBib.ts` (pure) + `lib/bibWriter.ts` (serialise). An on-screen diff
plus a client-side download. Labelled **"suggested fixes — review before use"**,
never "corrected".

**The LaTeX round-trip trap — investigated, then designed around.** The parser
(`@retorquere/bibtex-parser`) decodes LaTeX to Unicode on the way in, so
regenerating an entry from its AST would risk emitting `ö` for `\"{o}`, losing
`{DNA}` brace-caps and custom fields. We confirmed `entry.input` preserves the
**verbatim source**, so the cleaner is **additive-only and edits raw source
text**: it inserts missing fields before an entry's closing brace and touches
nothing else. `spliceCleaned` rebuilds the file from the original text, so
non-entry content (`@string`, comments, preamble) and every pass-through /
`unparseable` block are byte-identical.

Action is tiered by the match status (the confidence gradient we already
compute): `matched-by-doi` fills applied confidently; `matched-by-title` applied
but flagged; `suspicious` shown as a suggestion, **never written**;
`not-found`/`error`/`unparseable` pass through byte-identical; `not-indexable`
is **"left unchanged," never "broken."** **Cite keys and entry count are
invariant** — asserted by a test that compares the parsed key-set and count of
input vs output. Fields are only ever *added*, never overwritten or removed.

## Week 3.1 — patch release

A small, surgical follow-up: one bug fix and one threshold change. No new card,
network shape, or dependency. (A dual cleaned-`.bib` download was prototyped and
then removed by request — see Change 3.)

### 1. Billable results survive tab switches (the bug fix)

The gaps and preprint results are the **only** ones in the app whose recreation
costs real money against the **shared** OpenAlex budget. In W3 they lived in
`useState` inside the card/tab, so toggling the view unmounted the component and
**threw the results away** — re-pressing re-ran the paid calls. W3.1 lifts them
up: `App.tsx` (which owns the Report / Cleaned / Table toggle) now holds the
co-citation, forward-citation, and preprint-resolution results in-memory; the
cards/tabs are **presentational**, receiving results as props and calling
parent-owned handlers. Unmounting a tab now discards only its DOM. Results are
cleared on a **new upload only**, hung on the **same reset** as the core matched
data, so there is a single invalidation path. *(This is ordinary in-memory React
state, one level up — no `localStorage`, nothing persisted; it dies on reload
exactly as the rest of the report does.)*

### 2. Citation-gap floors and cap

`GAPS_COCITATION_FLOOR` = **4**, `GAPS_FORWARD_FLOOR` = **2**, shared cap
`GAPS_TOP_CANDIDATES` = **30** — single constants in `config.ts` (the old single
`GAPS_MIN_COCITATIONS` = 2, which covered both modes, was replaced). See the
threshold note above; the floors sharpen the lists but do **not** change the
billable cost.

### 3. Preprint check stays, applied-swaps download does not

The **Check preprints** button and the single **Download cleaned `.bib`**
(suggestions) are unchanged. A resolved preprint→published match is shown in the
diff as a **suggestion only** and is never written to the file — applying the
swap is left to the user (a preprint is often cited deliberately, and the
published DOI is right there in the suggestion to paste in).

> An earlier iteration added a second "download with preprint updates applied"
> button that rewrote the entry to the published version. It was removed by
> request: the tool suggests, the user decides. There is exactly one cleaned
> download, and it never crosses from suggest to auto-apply.

> **W3.1 testing note.** Changes 2 and 3 are covered by unit tests (the floors,
> the cap, and the guard that a resolved preprint is surfaced as a suggestion but
> never written into the cleaned file). Change 1 is a React mount/unmount
> behaviour; the suite has no DOM renderer (and W3.1 adds no dependency), so it is
> verified by a **manual check**: run the gaps card, toggle Report → Table →
> Cleaned → Report, confirm the results are still shown and **no** new calls fire;
> then load a new `.bib` and confirm they clear.

## Week 3.2 — input guard & three UI touches

One protective guard and three interface refinements. No new network call,
OpenAlex field, or dependency.

### 1. `.bib` size guard (`src/lib/validateBib.ts`, pure)

Two coarse gates reject a pathological upload **before any lookup fires**, so one
1,000-entry dump can't burn a large share of the **shared** budget. Framed as
scope, not scarcity — this is a per-paper tool, which is also true of the report's
statistics.

| Gate | Limit (`config.ts`) | Checked | Protects |
|---|---|---|---|
| File size | `MAX_BIB_BYTES` = **1 MB** | before parsing | the browser parser |
| Entry count | `MAX_BIB_ENTRIES` = **300** parsed entries | after parse, before matching | the shared budget |

Both gates live on the **one** upload path (`App.run`), so drag-drop, the picker,
and **Load sample** all pass through them. Rejection is clean — no partial run —
with an actionable message stating the figure and the limit ("This file is 3.2 MB.
BibProfile handles files up to 1 MB." / "This file has 482 entries. BibProfile is
built for single-paper bibliographies and handles up to 300 references."). The
count is of **parsed** entries (the unit that drives lookups), not raw `@`
occurrences. Pure client-side, so it survives the later move to a hosted static
site unchanged. Unit-tested: over-size rejects pre-parse, 301 parsed entries
reject, 300/`<`1 MB passes, and the bundled sample passes.

### 2. Open-access card — a hidden explainer

The OA card gains a collapsed **"What do these mean?"** disclosure (the existing
`<details>` pattern) with one plain-language line each for gold / green / hybrid /
bronze / closed, plus a neutral note that these are OpenAlex's categories
(describing *where* an article is available, not its quality). The card's default
view is unchanged; the explainer only appears when opened.

### 3. Cleaned `.bib` diff — a colour legend

A small legend above the changes list maps the colours the diff already uses
(same `.diff-tag` tokens, not new hex): **green = applied** (written into the
downloaded file) and **yellow = suggested, not applied** (suspicious matches and
resolved preprint→published versions — never auto-written, per W3.1). Those are
the only two states the changes list renders; pass-through / unchanged entries
don't appear in it, so the legend covers exactly what's shown.

### 4. File-picker robustness (`FileDrop.tsx`)

Drag-drop and the picker already funnel through one handler (`handleFile`), and
the input already reset its value after `onChange` — the classic "same file picked
twice fires no `change` event" cause. W3.2 hardens it further: the value is also
cleared **before** opening the picker (`openPicker`), and both buttons are
`type="button"` (no accidental form semantics). If the intermittent failure
persists it's likely environmental (OS file dialog), and drag-drop remains a
reliable fallback.

> **W3.2 manual checks** (DOM isn't unit-tested here): pick a file, pick the
> **same** file again → it re-loads; drag-drop still works; both an oversized file
> and a 300+‑entry file are rejected with the scope message before any lookup;
> open the OA explainer; read the diff legend.

## Week 4 — bring your own OpenAlex key (opt-in)

The shared pool stays the default and frictionless — no account, no email, just a
`.bib`. W4 adds an **optional escape hatch**: a user can paste their **own** free
OpenAlex key to run on **their own** budget when the shared pool is busy or they
have a lot to process. It changes nothing for anyone who never touches it.

This is the app's first **runtime** choice of network path. Build-time
`import.meta.env` can't carry a key that arrives at runtime, so the fetch layer
gained a **credential** argument. One module decides which credential is active
(`src/lib/credential.ts`); the fetch layer (`openalex.ts`) consumes it.

### Two independently-switchable paths

| Path | Base URL | Key | Where the key lives |
|---|---|---|---|
| **Shared** (default) | `OPENALEX_BASE_URL` — today `api.openalex.org`, **later** the Worker | our shared key | today inlined at build; later in the Worker |
| **User key** (opt-in) | **always** `OPENALEX_DIRECT_URL` = `api.openalex.org`, browser-direct | the user's key | **in memory, this session only** |

The user-key path uses `OPENALEX_DIRECT_URL` — a **separate constant** from
`OPENALEX_BASE_URL` on purpose. When the shared path later flips to the Worker
(a one-line env change), the user-key path is **not** dragged along: routing a
user's secret through our server would put their key on our infrastructure for
zero benefit. A unit test asserts exactly this — flipping the shared base leaves
the user-key path pointed straight at OpenAlex.

### The secret-handling rule (non-negotiable, the trust basis of the feature)

The user's key is held **in memory only** (`userKey` state in `App.tsx`), for the
session. It is **never** written to `localStorage`, `sessionStorage`, IndexedDB,
cookies, the URL, or logs, and is **never** sent anywhere except directly to
OpenAlex. `sessionStorage` was explicitly **rejected** — the re-paste friction is
accepted. A static test (`test/noPersistence.test.ts`) scans all of `src/` and
fails if any file references a storage API. The paste field is a plain-text input
with autocomplete off so the browser's password manager isn't prompted to save
it either.

### UX — quiet, never an ambush

A calm **"Use your own OpenAlex key"** link near the upload area (present
regardless of pool state — no modal springs open when the pool is low). Opening
it shows why + how (link to <https://openalex.org/settings/api>) and the
load-bearing trust line: *"Your key stays in your browser, is never stored, and
is sent only to OpenAlex. It's cleared when you reload the page."* Once set, a
small "Using your own key" indicator + **Clear** (which actually drops the
in-memory value). Framing is descriptive, not a paywall or a scare.

### Validation & failure

Client-side shape check only (`isPlausibleKey`) — no probe call; if the key is
wrong the first real request fails. An OpenAlex **401/403** becomes an
`OpenAlexAuthError` (thrown once, never retried, never swallowed into a per-row
error); with a user key active the UI says *"That key was rejected by OpenAlex.
Check it, or clear it to return to the shared pool."* with an inline **Clear** —
it does **not** silently fall back to the shared key. The retry/backoff and cost
surfacing are unchanged; only the base URL and auth differ.

### CORS

The shared path already makes authenticated browser requests to
`api.openalex.org` with an `api_key` query param, so the user-key path (same host,
same param shape) exercises the identical, already-working CORS behaviour — no new
cross-origin surface.

### Deferred to the Worker patch

The **shared-pool** credits display needs a `/rate-limit` read with the *shared*
key, which is only safe server-side in the Worker — so it's not here. **W4.1 ships
the *user-key* usage readout** (their key, their browser, nothing new exposed) and
keeps the shared-pool display deferred; see the W4.1 section below.

> **W4 manual checks** (DOM isn't unit-tested here): set a key → run → confirm
> matching works; open devtools → Application → confirm the key is absent from
> localStorage / sessionStorage / IndexedDB / cookies; reload → confirm the key is
> gone (you're back on the shared pool); paste a deliberately wrong key → confirm
> the "rejected by OpenAlex" message + inline Clear, and that it does **not** run
> on the shared pool instead.

## Week 4.1 — usage readout + graceful pool exhaustion

Two related additions, the last before hosting. Both key off the **active
credential** from `credential.ts` — the same seam W4 drew.

### User-key usage readout (`src/lib/rateLimit.ts`, `UsageIndicator.tsx`)

When a user key is active, a compact bar shows *"You've used $0.18 of your $1.00
daily budget (18%). Resets in 6h."* — read live from OpenAlex's
`GET /rate-limit?api_key=…`. Three states: **live bar** (user key, read OK),
**honest deferral line** (shared pool — no bar), **"unavailable" + Retry** (read
failed / unexpected shape — never a guessed 0 bar). It's fetched when a key is set
and after each run (matching, gaps, forward, preprints) — **never on a timer**
(polling a budget just spends more of it). A failed read never blocks matching.

**The load-bearing safety rule:** the usage fetcher **refuses to read the shared
key** — if the active credential isn't the user's own, it makes **no call at all**
and reports unavailable. That browser-side shared-key read is exactly what the
Worker exists to prevent. Unit-tested as the single most important assertion in
the patch (shared credential ⇒ `fetch` never called).

**Don't hard-code the pricing.** OpenAlex moved to usage-based, dollar-denominated
billing and the response shape has changed before, so `parseRateLimit` reads the
`_usd` figures and the reset **from the payload**, defensively (scans by meaning,
tolerates renames/nesting, derives a missing member of budget/used/remaining),
and returns `null` → "unavailable" when it can't find enough. The reset is shown
in UTC (`formatResetClockUtc`), not local midnight — do **not** reintroduce a
`$1/day` or midnight assumption.

> When the *shared-pool* figure eventually lands (Worker patch) it will be a
> **pooled** number across everyone using the site that day — word it "the shared
> pool is 60% used today", never as "your" usage. (A note to that effect lives in
> `UsageIndicator.tsx` where the deferral line renders.)

### Graceful shared-pool exhaustion + Resume

A budget/quota rejection (a 429 whose body reads as exhaustion) is now a distinct
`OpenAlexBudgetError` — separate from W4's `OpenAlexAuthError`. On the **shared**
pool it halts the run **cleanly**: every already-matched entry is kept, the rest
stay **`pending`** (paused, not failed), and an inline banner appears — *"The
shared daily pool is used up (resets [UTC time or 'tomorrow']). Enter your own
free OpenAlex key above to finish now."* — beside the existing W4 `KeyControl`.
After the user sets a key, **Resume** re-queries **only the pending entries** on
the new credential (via `runMatching` over the pending subset + `mergeRows`) — the
matched ones are never re-queried, so no wasted budget and no lost work. Gaps and
forward runs (which also spend) show the same banner and stop rather than
erroring. Two distinct signals: **auth failure** (a *user* key was rejected → no
fallback) vs. **budget exhaustion** (the *shared* pool is dry → offer the user
key). Unit-tested: budget → partial-kept + pending remainder + `exhausted`;
Resume resolves only the pending set; an auth failure still propagates separately.

> **W4.1 manual checks:** set a user key → run → the bar shows a real number +
> reset; clear the key → the bar is replaced by the deferral line; force a
> usage-read failure → "unavailable" + Retry, matching still works.

## Week 4.2 — clarity pass

UI-only, no behaviour change. Trimmed the header ("Step 1: …" gone), removed the
**Load sample** button, made the primary actions solid blue buttons (Choose file,
Use your own key, Find adjacent work), and dropped the optional email field from
the key box (polite-pool mailto is no longer collected). The usage bar is **green**,
turning **red at ≥ 90 %**. The Summary box now shows the uploaded **filename**.
Self-citation is **always open** and reworded to cover any author; the
Missing-citations card lost its scare/verbose lines. The Table gains a hidden
**status explainer**, and a new top-right **About** panel (`About.tsx`) describes
the tool, the shared-pool/key model, and credits.

## Hosting & v1.0 — Worker cutover, security headers, SEO (Aug 5–9)

- **Git + Cloudflare Pages.** The app went into its own repo (auto-deploys on push).
- **Worker cutover.** A separate repo, `bibprofile-worker`, is a Cloudflare Worker
  at `api.bibprofile.com`. It holds the shared OpenAlex key server-side and proxies
  only `/works*` and `/rate-limit`, with an origin allowlist and loose per-IP rate
  limits. The shared path's `VITE_OPENALEX_BASE_URL` now points at the Worker and
  the shared key is no longer in the client bundle. The user-key path stays direct
  to OpenAlex.
- **Shared-pool usage bar.** No longer deferred: the Worker serves `/rate-limit` with
  the key stripped, so the app shows a **pooled** usage bar on load and after each
  run. The browser still never reads the shared key's usage from OpenAlex directly
  (`fetchRateLimit` refuses when the shared base URL is `api.openalex.org`).
- **Security.** `public/_headers` (CSP report-only, X-Frame-Options, COOP/CORP,
  Permissions-Policy). Production builds drop `console.*`/`debugger`. The About
  privacy text was corrected to mention the proxy hop.
- **SEO.** Static meta + JSON-LD + a no-JS fallback in `index.html`, plus
  `robots.txt`, `sitemap.xml`, `llms.txt` and `og-image.jpg`.

## v1.1 — iOS, Google Translate, tabs, per-field review (Aug 14)

- **iOS upload fix.** The file input `accept` was widened so iOS lets `.bib` files be
  picked.
- **Four tabs.** About · Report · Cleaned .bib · Table are always visible, with About
  as the landing tab and placeholders until a `.bib` is analysed. Added a tagline,
  a version history (`src/versions.ts`) and a contact address in About.
- **Per-field mismatch review.** The cleaned export also shows fields you wrote that
  differ from OpenAlex, as blue "review" items. Each can be accepted per field
  (`readField`/`replaceFieldValue` in `bibWriter.ts`): only the value is replaced,
  in place, and only when accepted. Accept state is in-memory component state.
- **Google Translate white-screen fix.** `translate="no"`/`notranslate` on the page,
  dynamic text wrapped in spans, and a root `ErrorBoundary` with a reload fallback.

## v1.3 — report flow, exports, preprints in Report, maintenance (Aug 16)

- When an analysis finishes the app **jumps to Report** and **collapses the upload
  zone** ("↑ Upload a different .bib file" re-opens it).
- Added a collapsible **"?" explainer** for the shared pool in the usage line.
- **Exports:** CSV export of the current table view, and an in-page **View raw** of
  the cleaned `.bib`. The **JSON export was removed**.
- **Preprint → published moved from Cleaned .bib to the Report**
  (`PreprintsCard.tsx`). It is still billable and button-gated, uses title search
  with `type:!preprint`, and shows suggestions only, never written to the file.
- **Maintenance page** (`public/maintenance.html`), toggled by a Cloudflare Redirect
  Rule in the dashboard.
- **Metadata:** refreshed `llms.txt`, JSON-LD `@graph` (SoftwareApplication +
  Organization), a permissive app `robots.txt`, and a Worker `/robots.txt`
  (`Disallow: /`) so the API host isn't indexed.
- Test suite: **156 tests** (up from 146).

> The project-layout and test-count sections below describe the state as of W4.2.
> For the current layout, see README.md.

## Project layout

```
src/
  config.ts              # base URL, key, pacing, thresholds, cost, select fields, gap floors/cap, input-size guards
  types.ts               # shared pipeline types (+ W3 isRetracted, biblio, referencedWorks)
  App.tsx                # orchestration · toggle · exports · W4 active credential + auth handling
  sample.bib             # bundled sample (imported via ?raw)
  components/
    FileDrop.tsx  Progress.tsx  Summary.tsx  ResultsTable.tsx
    KeyControl.tsx       # W4 — the quiet "use your own OpenAlex key" affordance
    UsageIndicator.tsx   # W4.1 — usage bar / shared-pool deferral / unavailable+retry
    About.tsx            # W4.2 — the About panel (what it does, shared pool, credits)
    report/              # the analysis report + cleaned export
      ReportView.tsx     #   builds the shared cohort, renders the 8 cards in order
      CardShell.tsx  Histogram.tsx  BarChart.tsx  format.ts
      RecencyCard.tsx  ShapeCard.tsx  VenuesCard.tsx  SelfCitationCard.tsx
      OpenAccessCard.tsx  RetractionsCard.tsx  GapsCard.tsx  DuplicatesCard.tsx
      CleanedExport.tsx  #   W3 — the Cleaned .bib tab (diff + download + preprint resolve)
  lib/
    doi.ts  similarity.ts  titleClean.ts  parseBib.ts
    validateBib.ts       # W3.2 — pure size/entry-count input guards (pre-matching)
    credential.ts        # W4 — pure: shared vs. user-key resolution (the ONE active-credential decision)
    rateLimit.ts         # W4.1 — pure: defensive /rate-limit parse + usage% / reset formatting
    openalex.ts          # the ONLY fetch layer (…, W4 credential + OpenAlexAuthError, W4.1 fetchRateLimit + OpenAlexBudgetError)
    match.ts             # orchestration: dedup, DOI-first (free), then title
    gaps.ts              # W3 — citation-gap orchestration (co-citation + forward)
    preprintResolve.ts   # W3 — preprint→published resolution orchestration
    bibWriter.ts         # W3 — additive, round-trip-safe BibTeX serialisation
    baselines.ts         # field-baseline stub (returns null in v1)
    stats/               # PURE statistics, no React, no fetch, unit-tested
      denominator.ts     #   the shared cohort + subset helper (the four rules)
      recency.ts  venues.ts  openaccess.ts  selfCitation.ts  duplicates.ts  summaryText.ts
      shape.ts  retractions.ts  coCitation.ts  preprints.ts  cleanBib.ts   # W3
test/                    # vitest unit tests (pure functions; no network)
  stats/                 #   one file per statistic + shared fixtures.ts
```

Run `npm test` — the suite is **146 tests** (W1/W2 regressions + the W3
statistics: shape-pattern detection incl. the min-n floor; retraction filtering;
co-citation counting and the "already in set" exclusion; forward-citation tally;
preprint detection + published-match acceptance; the cleaned-export
key-set/count equality and LaTeX round-trip guards; the W3.1 gap floors/cap
plus the guard that a resolved preprint is suggested, never written; the W3.2
input-size gates; the W4 credential resolution + shared/user decoupling with a
static no-persistence guard over all of `src/`; and the W4.1 rate-limit parsing,
the shared-key "never call" safety invariant, and budget-exhaustion halt/Resume).

## Explicitly still out of scope

Field baselines (stubbed above) · topic/field-spread card · impact/citation
spread card · redundancy / similarity clustering · PNG export · accounts,
storage, `localStorage`, analytics · **Crossref or any second network host** ·
the **Retraction Watch CSV** · deeper (paginated) forward-citation · the
**shared-pool** usage display (still needs the Worker — the *user-key* usage
readout shipped in W4.1) · full reference *validation* (W3
checks retraction and suggests fixes; it does not claim to verify that references
are real).

Two earlier "out of scope" lines have been **deliberately reversed** and are no
longer excluded: **retraction checking** (a light, flag-only version — see the W3
scope reversal) and **per-user API keys** (now an **opt-in** feature — see W4).
What remains out of scope for keys is **requiring** a key or an account: the
shared, no-account path stays the default and primary experience.

Kept deliberately small — a single-page tool, not an architecture.
