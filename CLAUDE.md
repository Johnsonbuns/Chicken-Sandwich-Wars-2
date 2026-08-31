# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test              # build, then the five checks — run before every push
npm run build         # data/ -> docs/  (76 pages, plus the /admin/ desk)
npm run serve         # build, then preview at http://localhost:4173
npm run preview:admin # the intelligence desk on fixtures, no Supabase needed
npm run check:mobile  # layout check at 393px; pass a width to use another
npm run db:validate   # migrations + supabase/tests/ against a throwaway Postgres
npm run clean         # rm -rf docs
```

`npm test` is not a unit-test suite; it is six integrity checks over the generated site,
each of which catches a failure this codebase has actually produced: unresolved internal
links, footnote superscripts with no matching anchor, near-empty pages, `undefined` /
`NaN` / `[object Object]` leaking into the HTML, `src` ids in `data/` that are absent
from `sources.json`, and a sitemap that has drifted from the page count. It exits
non-zero, so it is safe to chain.

`scripts/check-admin.js` is the ninth check, covering `api/admin.js` and `api/agent.js`.
It asserts the two properties that no amount of reading the code proves: that neither
endpoint ever sends the service-role key and that the dashboard forwards the signed-in
user's own token, and that the agent endpoint can reach nothing but four review RPCs. It
enumerates every request those handlers can be made to issue, so an edit that adds a table
read to the agent path fails it.

`./supabase/validate.sh` applies every migration to a throwaway local Postgres and then
runs `supabase/tests/*.sql` against the result — 80 assertions over the review queue,
confidentiality and the role model. It is not part of `npm test` because it needs a
Postgres server, but it is what to run after touching a migration.

`scripts/check-api.js` is the eighth check. It stubs `fetch` and exercises
`api/submit.js` without credentials, covering the things that are expensive to get wrong:
that the endpoint refuses what it should, that a raw IP address is never written, and that
submitting a valuation request does not quietly opt someone into the newsletter.

`scripts/mobile-check.js` is the seventh check and the only one that needs a browser,
so it skips with a notice rather than failing when there is no Chromium (Vercel's build
box has none). It asserts two things at a phone width: that no page scrolls horizontally,
and that no table hides content without showing something that says so. Both are
failures the site has actually shipped, and neither is visible to a static check — they
only exist once a viewport has a width.

For anything visual, render a page in the Chromium binary at
`/opt/pw-browsers/chromium-*/chrome-linux/chrome` with `--headless --screenshot`.
Playwright is not installed; the browser is. Note that headless clamps `--window-size`
at around 500px, well above any phone: to render at a real phone width, drive the
browser over the DevTools protocol and set the viewport with `Browser.setWindowBounds`.
`scripts/mobile-check.js` does exactly that in about 40 lines with no dependencies, and
is the shortest thing to copy from.

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

`admin/` is copied verbatim into `docs/admin/` rather than run through the page pipeline —
it is an application shell, not a page, and it is excluded from `check.js`, `mobile-check.js`
and the sitemap for that reason. `robots.txt` disallows it and the shell carries `noindex`.

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

## Mobile

Desktop is the base stylesheet; every mobile rule lives inside a media query, so the
desktop cascade never sees it. A mobile change must leave a 1280px render untouched —
that held through the whole mobile build and is worth keeping true. Check it with a
screenshot diff rather than by eye, and ignore the top 35px, where the ticker's
animation phase differs between runs. (The typography pass in the base stylesheet moved
the desktop render deliberately; it is the current baseline, not a regression.)

Four bands, largest first:

- **≤920px** — the table edge fade. Any table that scrolls shows it, at every width
  below the desktop layout.
- **761–920px** — an iPad in portrait is 810 or 820pt. The full masthead needs 903px, so
  this band tightens the logo and nav to fit rather than dropping to the drawer; a
  900px-wide laptop window should not grow a hamburger.
- **≤760px** — the phone layout: drawer instead of the primary nav, 44px tap targets,
  16px form inputs, single-column grids.
- **≤640px** — columns marked `hideSmall` step aside, with a checkbox to restore them.

Three things that will look like over-engineering and are not:

**`site.js` is `async`, not `defer`.** A classic script waits for every pending
stylesheet, `defer` included, and this page fetches one from `fonts.googleapis.com`.
With `defer` the menu, search, filters and form handling were all held until a
third party answered. `async` is not blocked by stylesheets; the script guards on DOM
readiness itself. Do not "fix" it back to `defer`.

**Nothing clips the overflow.** No `overflow-x:hidden` backstop on `body`, because it
would hide exactly what `check:mobile` exists to catch. Fix the cause instead — it is
almost always a flex or grid item at its default `min-width:auto`.

**Inline `min-width` has to be responsive at source.** An inline style outranks any
media query, so a hard `min-width:320px` in a page module cannot be overridden later.
Write `min-width:min(320px,100%)`; it is a no-op wherever the original value fits.

`C.table()` takes `{ label, num, hideSmall, id }` per column. `id` marks the identity
column — the one carrying the subject of the row — which gets a width floor on small
screens; without it the numeric columns hold their nowrap width and the name column
absorbs the entire shortfall, a word per line. The fallback picks the first column that
is not numeric, not `hideSmall` and not `#`, which is wrong whenever a table leads with
a date, so mark those explicitly.

## Type and spacing

The base stylesheet carries a spacing scale (`--sp-1` 4px … `--sp-7` 32px) and every gap
inside a boxed component comes from it. Two rules hold the boxed components together and
are what the pattern is for:

- **Leading is a function of size.** `h1`–`h4` each set their own `line-height` — 1.08 at
  display size up to 1.35 at 16px. A single value cannot serve both; 1.12 on a 17px card
  title that wraps put one line's descenders into the next line's ascenders.
- **Proximity encodes grouping.** A `.kicker` or `.eyebrow` sits closer to the heading it
  labels (6–12px) than the heading sits to its body copy, and a `.card .meta` footer sits
  further away than either. Both overlines set their own tight `line-height`, because with
  the 1.6 body leading the gap under them was whatever the line box happened to leave
  rather than a decision — which is what made the label read as touching the title.

Secondary body copy (`.note`) is 14px/1.55, not the heading's weight and not so small it
reads as a caption. Card padding is `--sp-5` and the grid gutter `--sp-6`, so the space
between two cards is always larger than the space inside one.

**Contrast is a constraint, not a preference.** `--ink-3` was #7C8590, which measured
4.80:1 on a card and 4.47:1 on a hovered one — under the 4.5:1 WCAG AA minimum, so every
card description, table header and date on the site failed the moment the pointer landed
on it. It is #98A2AE now: 6.94:1 on a card, 6.47:1 hovered, and the worst text/background
pair anywhere on the site. Check any new colour against the surface it sits on
(`#0A0B0D`, `#101216`, `#14171C`, and `#1A1E24` for `a.card:hover`) before adding it.

The overline is 12px — not 11px, which is under the floor every mainstream design system
sets — at weight 500, `.12em` tracking, and `--ink-2`. Uppercase and tracked text has
already given up the word shapes the eye reads by, so it cannot also be tiny, thin and
dim. It sits brighter than the description under it on purpose: a category label is
scanned, a deck is read.

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

## The intelligence desk

`/admin/` is the internal dashboard, and since it exists **nothing writes to canonical
data except one database function**. A person filling in a form and a Claude research run
reporting a finding produce the same kind of row in the same queue, and both wait for the
same approval.

```
human entry ─┐
             ├─→ review_items ─→ review_decide() ─→ review_apply() ─→ canonical tables ─→ site
agent run ───┘
```

`db/ADMIN.md` is the guide. `db/AGENT_INTAKE.md` is the contract to hand an agent — read
it before submitting research; it is written for you.

Five things about it that will look like over-engineering and are not:

**`public.review_targets` is a security boundary, not configuration.** `review_apply()`
builds dynamic SQL, so without a whitelist of tables and columns a proposal setting
`staff_profiles.role` would be indistinguishable from one setting a cap rate. Migration
`0019` seeds eighteen targets and asserts at migration time that every column it names
exists.

**Neither `api/admin.js` nor `api/agent.js` holds a privileged key.** The dashboard
forwards the signed-in user's own JWT, so Postgres evaluates `is_staff()`, `can_edit()`
and every RLS policy against the real person; the agent's key is checked *inside* the
database by `agent_for_key()`, so a request that reached PostgREST directly is refused by
the same code. The service-role key stays in `api/submit.js` and nowhere else. Do not
"simplify" either endpoint by giving it the service-role key and checking roles in
JavaScript — that turns every operation added later into a place to forget one.

**Corrections to `facts` supersede rather than update.** `review_targets.update_strategy`
carries this per table. Approving a corrected AUV closes the old observation and writes a
new one, and the old row must be closed *before* the new one is inserted — `facts_current_uniq`
is a partial unique index over rows where `superseded_at is null`.

**A proposal stores a baseline.** The record can move while a proposal waits, and applying
against a value the reviewer never saw is worse than not reviewing at all. `review_apply()`
refuses a stale proposal unless it is forced.

**Reference tokens, not uuids.** A payload says `"brand_id": "@brand:popeyes"` and
`"source_id": "@source:1"`, resolved at approval time. That is what lets an agent propose a
figure and the source record it cites in the same submission, and it keeps the diff a
reviewer reads legible.

## Public, internal, confidential

Seventeen tables carry `visibility` (`public` / `internal` / `confidential`), and a check
constraint means **a record that is not public cannot be flagged published**. Publishing
confidential intelligence is a database error rather than a thing to remember.

Two consequences worth knowing:

- `scripts/lib/csw-db.js` filters non-public rows out of every export read. RLS does not
  apply to psql or to the service-role key, and Phase 4 makes `data/*.json` generated by
  that path — without the filter the first confidential lease abstract would be committed
  and published.
- `v_current_facts` is now `security_invoker = true`. A view runs as its owner, so the RLS
  policy on `facts` never saw a query that arrived through the view; anonymous readers
  could read unpublished figures that way. That was a leak before `0016` and would have
  been a worse one after it. **Any new view over a table with RLS needs the same setting.**

## Known gaps

These are understood and deliberate-for-now, not oversights. Do not "fix" them by
inventing data or a stand-in.

**Forms are wired — but the fallback is load-bearing.** All five forms POST to
`api/submit.js`, which writes to the `intake` schema in Supabase. If that request fails
for any reason, `assets/js/site.js` falls back to the original clipboard-and-`mailto:`
behaviour, so an outage costs nothing. **Do not remove the fallback**: it is why a
misconfigured deploy cannot silently swallow a lead, and why the endpoint returns 503
rather than a cheerful 200 when credentials are missing.

`api/` has no dependencies and must keep none — `vercel.json` sets `installCommand` to a
no-op, so `node_modules` does not exist at runtime. Supabase is reached over PostgREST
with global `fetch`. `lib/supabase-rest.js` is shared by `api/admin.js` and `api/agent.js`
and lives outside `api/` on purpose: every `.js` file directly under `api/` becomes its own
serverless function, and Vercel's file tracing pulls this one in from either.

**An open question about `intake`.** `api/submit.js` reaches the form tables by sending
`Accept-Profile: intake`, and PostgREST only honours that header for a schema listed under
*Settings → API → Exposed schemas* — which contradicts the line below, and `0010`'s comment,
saying the schema is not exposed. Either it is exposed and those comments are wrong, or
every form submission has been failing and falling back to `mailto:` since Phase 3, which
looks like nothing being wrong. `db/PROVISIONING.md` §5 has the two ways to tell. Exposure
is not itself a risk: `0010` revokes every privilege on that schema from `anon` and
`authenticated`, so the service-role key remains the only thing that can read it. The desk
does not depend on the answer — it reads leads through a `security definer` function in
`public`.

The service-role key bypasses every RLS policy. It is read from the environment inside the
function and must never reach a browser, a build artifact or a commit. The `intake` schema
is not exposed to PostgREST, so this endpoint is the only door to it.

Submissions are stored but **nobody is notified unless `RESEND_API_KEY` and
`CSW_NOTIFY_EMAIL` are set**. A database nobody reads is worse than the `mailto:` it
replaced, so treat those two variables as part of shipping, not as a nice-to-have. The
desk's Leads screen is the other half of that: `db/SCHEMA.md` §12.4 offered an email
notification *or* an auth-gated view over `intake.submissions`, and this is the second one.

**Data freshness.** Figures are current to August 2026. Quarterly results from Popeyes,
Wingstop, KFC and El Pollo Loco move the rankings; stale rankings on a site whose product
is accuracy are worse than none.

## Working conventions

Develop on a branch, open a pull request against `main`, and let Vercel's preview build
be part of the review. Keep `docs/` out of commits (it is git-ignored). Run `npm test`
before pushing — a broken footnote anchor or an unresolvable source id is invisible in
review but obvious to the script. If you touched a migration, run `npm run db:validate`
too; it needs a local Postgres on port 5433 and it is the only thing that will tell you a
`security definer` function no longer does what its comment says.

**Adding data now means adding it through the queue**, not by editing `data/*.json` by
hand — either at `/admin/` or, for an agent, through `POST /api/agent`. `data/` is still
the build's source of truth until Phase 4 flips the direction, so a change approved in the
desk reaches the site when the exporter runs. Do not hand-edit a figure into `data/` and a
proposal into the queue for the same number.
