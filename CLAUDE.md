# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test          # build, then scripts/check.js — run this before every push
npm run build     # data/ -> docs/  (77 pages)
npm run serve     # build, then preview at http://localhost:4173
npm run clean     # rm -rf docs
```

`npm test` is not a unit-test suite; it is six integrity checks over the generated site,
each of which catches a failure this codebase has actually produced: unresolved internal
links, footnote superscripts with no matching anchor, near-empty pages, `undefined` /
`NaN` / `[object Object]` leaking into the HTML, `src` ids in `data/` that are absent
from `sources.json`, and a sitemap that has drifted from the page count. It exits
non-zero, so it is safe to chain.

For anything visual, render a page in the Chromium binary at
`/opt/pw-browsers/chromium-*/chrome-linux/chrome` with `--headless --screenshot`.
Playwright is not installed; the browser is.

**Dependencies.** The build has none and should keep none — `node build.js` runs on
stock Node (>=18). An attempt to add `@vercel/analytics` was reverted because all of its
entry points need a bundler this project does not have; the analytics tag is a plain
script instead. Runtime dependencies for serverless functions under `api/` are a
different category and may be justified — but they must never leak into the build path.

## The editorial rule that shapes the code

> Every figure carries a publisher, a URL and an as-of date. Where a number has not been
> published, the site shows "—" rather than an estimate.

This is not a style preference — it is the product. Consequences that will look like
bugs but are deliberate:

- 9 of 21 brands are **unrated** in the rankings because fewer than three scoring
  components have been published for them. Do not fill the gap.
- The properties marketplace and job board render **empty states**, not sample listings.
- Polls store votes in `localStorage` and publish **no aggregate totals**.
- Figures derived arithmetically from two published numbers are marked *derived*;
  franchisee-reported figures are labelled as such.

If asked to add data, add the source to `data/sources.json` first and reference its key.
A stat whose `src` does not resolve renders silently without a footnote — `npm test`
catches that, nothing else will.

**Provenance caveat on the existing dataset.** The figures were gathered in an
environment where web search worked but direct page fetches were blocked by an egress
proxy. Every one is attributed to a real publisher and URL, but the values came from
search-result summaries of those sources rather than from reading the primary documents.
Treat the high-stakes figures — AUVs and same-store sales, which drive the rankings — as
worth re-verifying against the original filing or report before they are relied on
publicly. New data added from now on should be read off the primary source.

## Architecture

`data/` is the single source of truth. `build.js` loads it, derives a shared `ctx`, runs
each module in `pages/`, wraps the result in `lib/layout.js`, and writes `docs/`
(git-ignored — Vercel rebuilds it on every deploy, so never commit it).

**Page modules** (`pages/*.js`) each export `(ctx) => [pageDescriptor]`. A descriptor is:

```js
{ path, title, description, depth, active, canonicalPath, body, breadcrumb?, index }
```

`build.js` spreads it into `layout.page()` and writes `body` into the shell. `index`
entries become `assets/search-index.json`, which powers both the `/` quick-search overlay
and `/search/`.

**`depth` drives every URL.** `layout.js` builds `u(path)` as `'../'.repeat(depth)`, so
the home page is `depth: 0` and everything else is `depth: 1`. Getting it wrong silently
breaks every link and asset on the page. Note that `lib/components.js` hardcodes `../`
in two places (chart bar links and news brand badges) — those components assume depth 1.

**`ctx`** carries `data`, `sources`, `ranking`, `scoreBySlug`, `brandBySlug` and
`operatorsByBrand` (the last is built by fuzzy-matching operator `chickenBrands` strings
against brand names, so a renamed brand can silently drop its operator list).

## Footnotes

`C.refs(sources)` returns a per-page tracker. `R.ref(id)` emits a numbered superscript
and records the source in first-use order; `R.refAll(ids)` does several. **Every page
that calls `R.ref()` must render `R.render()` in its body**, normally as
`<div class="wrap">${R.render()}</div>` at the bottom — otherwise the superscripts link
to anchors that do not exist. Pages that build several independent sections create
several trackers (`R`, `R2`) and each must render its own list.

## The CSW Score

`lib/score.js` is the whole ranking and is short. Five components, each scaled linearly
between a published floor and ceiling and clamped to 0–100: Unit Economics 30%, Consumer
Demand 25%, Expansion 18%, Real Estate Strength 15%, System Momentum 12%. Weights
renormalise over whichever components a brand actually has; **fewer than three available
components means no score at all**. One uniform post-adjustment: a system in net unit
decline takes a four-point penalty, applied identically to everything that qualifies.

Inputs come from `brand.metrics`, which must contain only sourced or
arithmetically-derived values — never a filled-in estimate. `/methodology/` publishes
this formula, so changing a weight means updating that page's rendered table (it reads
`COMPONENTS`, so it follows automatically) and re-checking the prose around it.

## Data shapes

A stat is `{ v, fmt?, asOf, src, note? }` where `fmt` is `'usd'`, `'pct'` or absent
(count). `lib/util.js` formats it; `usd()` deliberately keeps one decimal on M/B figures
because `$2.0M` vs `$2.1M` is a meaningful AUV distinction that `$2M` hides.

Brand records carry `stats` (rendered, sourced), `metrics` (numeric, feeds scoring),
`realEstate`, `pipeline`, `tags`, `momentum` and a written `analysis`. The momentum
vocabulary is enumerated in `MOMENTUM` in `lib/components.js`; an unknown value falls
back to a neutral badge rather than erroring.

## Hosting

Vercel, configured by `vercel.json`: no install step, `node build.js`, output `docs/`.
`cleanUrls` is deliberately omitted — enabling it would 308-redirect the ~40 brand and
market pages that are linked with explicit `.html` paths.

Canonical URLs and `sitemap.xml` are built from `SITE_ORIGIN` in `build.js`, which reads
`CSW_SITE_ORIGIN` if set, else Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (the stable
production domain — deliberately *not* `VERCEL_URL`, which is unique per deployment),
else falls back to `https://chickensandwichwars.com`. Preview builds canonicalise at
production and emit `noindex` plus a disallow-all `robots.txt`, so a preview never
competes with the live site in search.

The Vercel Web Analytics tag lives in `lib/layout.js` as a plain
`<script defer src="/_vercel/insights/script.js">`. It is the only root-absolute path in
the output; everything else is relative so the site can be served from any subpath. The
tag 404s harmlessly off Vercel, and also 404s *on* Vercel until Web Analytics is enabled
in the project dashboard.

**Current state:** the site is live on Vercel with Web Analytics enabled and verified.
The repository is connected to Vercel, so a merge to `main` deploys and every pull
request gets a preview. GitHub Pages served the site briefly and has been retired — if
you find a reference to it anywhere, it is stale. (`docs/.nojekyll` is still written, but
only so the output stays servable by any plain static host.)

## Known gaps

These are understood and deliberate-for-now, not oversights. Do not "fix" them by
inventing data or a stand-in.

**Forms have no backend.** Every form — newsletter, sell, buy, submit-deal, contact —
is handled by `assets/js/site.js`, which copies the fields to the clipboard and opens a
`mailto:` draft. The visitor still has to press send. Nothing is stored. This is the
single most consequential gap in the project: lead capture is what the whole site exists
to do.

**Polls have no backend.** Votes live in the visitor's own `localStorage`, so no
aggregate exists and none is published. The stated goal was longitudinal consumer
preference data, which needs one row per vote with a timestamp — not a counter.

The agreed shape for both, not yet built: an `api/` directory of Vercel Functions
(`POST /api/submit`, `POST /api/vote`, `GET /api/poll?id=`) over a single Neon Postgres
from the Vercel Marketplace — a `submissions` table keyed by form name with a `jsonb`
payload, and a `votes` table with a salted `voter_hash` under a unique index per poll per
day for ballot-stuffing control. One integration rather than adding Upstash alongside it.
Provisioning needs the account owner: `vercel link`, then `vercel integration add neon`.

Two things that must land with that work: a **privacy policy** page, since the forms will
start collecting names, emails, phone numbers and property addresses and the site has no
disclosure today; and **somewhere to read submissions** — an email notification or a
protected view — because a database nobody checks is worse than the current `mailto:`,
which at least reaches an inbox.

**Data freshness.** Figures are current to August 2026. Quarterly results from Popeyes,
Wingstop, KFC and El Pollo Loco move the rankings; stale rankings on a site whose product
is accuracy are worse than none.

## Working conventions

Develop on a branch, open a pull request against `main`, and let Vercel's preview build
be part of the review. Keep `docs/` out of commits (it is git-ignored). Run `npm test`
before pushing — a broken footnote anchor or an unresolvable source id is invisible in
review but obvious to the script.
