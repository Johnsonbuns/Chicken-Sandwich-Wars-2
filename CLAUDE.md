# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build     # data/ -> docs/  (77 pages)
npm run serve     # build, then preview at http://localhost:4173
npm run clean     # rm -rf docs
```

There is no test suite, no linter and no dependencies — `node build.js` runs on stock
Node (>=18). Do not add a package unless it earns its place; a previous attempt to add
`@vercel/analytics` was reverted because every one of its entry points needs a bundler
this project does not have.

Verification is the build plus three checks worth re-running after structural changes
(no committed script — write them ad hoc):

1. Every internal `href`/`src` in `docs/` resolves to a real file. Skip `/_vercel/*`,
   which is served by Vercel's edge and does not exist in the repo.
2. Every `href="#src-N"` has a matching `id="src-N"` on the same page (see footnotes
   below — this is the invariant most easily broken).
3. Render a few pages in Chromium at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`
   with `--headless --screenshot`. Playwright is not installed; the binary is.

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
A stat whose `src` does not resolve renders silently without a footnote.

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
