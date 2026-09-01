# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test              # build, then the checks — run before every push
npm run build         # data/ -> docs/  (77 pages today, plus the /admin/ desk)
npm run serve         # build, then preview at http://localhost:4173
npm run preview:admin # the intelligence desk on fixtures, no Supabase needed
npm run check:mobile  # layout check at 393px; pass a width to use another
npm run check:sparse  # does the build survive a record with almost nothing in it
npm run check:freshness # how old are the figures behind the rankings
npm run check:freshness:strict # ...and fail if any of them is overdue
npm run db:validate   # migrations + supabase/tests/ against a throwaway Postgres
npm run clean         # rm -rf docs
```

`npm test` is not a unit-test suite; it is six integrity checks over the generated site,
each of which catches a failure this codebase has actually produced: unresolved internal
links, footnote superscripts with no matching anchor, near-empty pages, `undefined` /
`NaN` / `[object Object]` leaking into the HTML, `src` ids in `data/` that are absent
from `sources.json`, and a sitemap that has drifted from the page count. It exits
non-zero, so it is safe to chain.

`scripts/check-sparse.js` is the seventh check, and it exists because **`data/` is
generated now and the database has no opinion about which optional fields a record has.**
A brand added through the desk with a name and a slug exports as
`{slug, name, stats:{}, metrics:{}}`, and six page modules called `.join()`, `.map()` or
`.split()` straight on fields that were always present when `data/` was hand-written. The
first brand anyone added through the desk failed the Vercel deploy. Defaults are applied
once in `build.js` rather than at each call site, because the seventh call site is the
problem; this check builds the whole site against a deliberately minimal brand, operator,
transaction and news item so the next page module cannot reintroduce it. It found a second
crash on its first run (`t.brand.toLowerCase()` on a transaction with no brand), which is
the kind of thing the desk can create the moment someone records an undisclosed deal.

`scripts/mobile-check.js` is the eighth check and the only one that needs a browser,
so it skips with a notice rather than failing when there is no Chromium (Vercel's build
box has none). It asserts two things at a phone width: that no page scrolls horizontally,
and that no table hides content without showing something that says so. Both are
failures the site has actually shipped, and neither is visible to a static check — they
only exist once a viewport has a width.

`scripts/check-api.js` is the ninth check. It stubs `fetch` and exercises
`api/submit.js` without credentials, covering the things that are expensive to get wrong:
that the endpoint refuses what it should, that a raw IP address is never written, and that
submitting a valuation request does not quietly opt someone into the newsletter.

`scripts/check-admin.js` is the tenth, covering `api/admin.js`, `api/agent.js` and
`api/publish.js`. It asserts the properties that no amount of reading the code proves:
that the dashboard forwards the signed-in user's own token and holds no privileged key,
that the agent endpoint can reach nothing but four review RPCs, and that the service-role
key `api/publish.js` does hold reaches Supabase and never GitHub. It enumerates every
request those handlers can be made to issue, so an edit that adds a table read to the
agent path fails it.

`scripts/check-freshness.js` is the eleventh, and it exists because **the five figures
that decide the rankings were the only numbers on the site with no as-of date.** Every
rendered stat carries a publisher, a URL and a period; `brand.metrics` carried a bare
number, so a brand could hold its seat on a comp two quarters out of date and nothing
would say so. `lib/freshness.js` resolves the date behind each scoring input — from an
explicit `metricsMeta` entry where the exporter wrote one, otherwise along the same
metric-to-stat correspondence `scripts/db-import.js` uses to write the fact in the first
place — and the check asserts that the resolution still works and that the rankings page
publishes what it finds. It fails on a period label the parser cannot read, a provenance
mirror that stopped matching, and an overdue figure the page does not disclose. It does
*not* fail on old data: taking the whole site down over one aged figure is not the site's
answer to an aged figure, and the answer it does have — say how old the number is — is
already rendered. `--strict` turns staleness into a failure, which is the gate to run
before a release.

`./supabase/validate.sh` applies every migration to a throwaway local Postgres and then
runs `supabase/tests/*.sql` against the result — 97 assertions over the review queue,
confidentiality and the role model. It is not part of `npm test` because it needs a
Postgres server, but it is what to run after touching a migration.

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

- 10 of 22 brands are **unrated** in the rankings because fewer than three scoring
  components have been published for them. Do not fill the gap. (The count moves every
  time the desk publishes — the rule is what is fixed, not the number.)
- The properties marketplace and job board render **empty states**, not sample listings.
- Figures derived arithmetically from two published numbers are marked *derived*;
  franchisee-reported figures are labelled as such.
- A figure past its review window keeps its published value and is marked overdue rather
  than being rolled forward, and a figure whose as-of date was never recorded is treated
  as overdue rather than as current. Defaulting an undated number to fresh would be an
  estimate, and this is the one page that cannot make one.

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
`metricsMeta`, `realEstate`, `pipeline`, `tags`, `momentum` and a written `analysis`.

`metrics` holds bare numbers on purpose — `lib/score.js` reads them arithmetically — so
`metricsMeta` carries the period, source and derivation for each scoring input alongside
it: `{ auvUsd: { asOf: 'FY2025', on: '2025-12-31', src: 'qsr50-2026-chicken' } }`. It is
written by `scripts/export-data.js` off the fact the figure came from. Until the next
publish writes it, `lib/freshness.js` infers the same dates from the matching stat and
the site is dated either way; the round-trip check reports `metricsMeta` as added in the
meantime, which is this schema addition rather than drift. The momentum
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
             ├─→ review_items ─→ review_decide() ─→ review_apply() ─→ canonical tables
agent run ───┘                                                              │
                                    api/publish.js ─→ data/*.json ─→ commit ┘─→ Vercel ─→ site
```

**Approving does not publish.** The build reads `data/*.json` and never touches the
database, so canonical data reaches the site only when someone presses **Publish to site**
— which re-exports every data file through `buildDataFiles()` (the same function the
Phase 2 round-trip gate exercises, imported rather than reimplemented) and commits the
ones that changed. Anything in the desk that implies otherwise is a bug; one shipped, and
sent the owner looking for a brand on a page that could not have had it.

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

**Reaching `intake` takes two things, and it took both.** The open question from earlier
sessions is settled: form submissions *were* failing into the `mailto:` fallback, from
Phase 3 until 2026-09-01. `api/submit.js` sends `Accept-Profile: intake`, and that needs

1. `intake` listed under *Settings → API → Exposed schemas*, or PostgREST refuses to
   address the schema at all; and
2. `service_role` holding privileges on it — which nothing granted. `0008` creates the
   schema and `0010` revokes everything from `anon` and `authenticated`, but a schema a
   migration creates does not inherit the default privileges Supabase sets up for
   `public`, so the one role meant to write there got *permission denied for schema
   intake*. Migration `0021` grants it, and `supabase/tests/intake_access.sql` asserts
   both halves: the service-role key reads and writes, `anon` and `authenticated` still
   cannot touch it.

Exposure alone grants nobody anything, which is why (2) is the half that is easy to miss.
The endpoint reports either failure as a 503/502 and `assets/js/site.js` falls back to
`mailto:` — so the symptom of both was a site that looked perfectly healthy.

The service-role key bypasses every RLS policy. It is read from the environment inside the
function and must never reach a browser, a build artifact or a commit. It is the only role
with any privilege on `intake`, so this endpoint remains the only door to it.

Submissions are stored but **nobody is notified unless `RESEND_API_KEY` and
`CSW_NOTIFY_EMAIL` are set**. A database nobody reads is worse than the `mailto:` it
replaced, so treat those two variables as part of shipping, not as a nice-to-have. The
desk's Leads screen is the other half of that: `db/SCHEMA.md` §12.4 offered an email
notification *or* an auth-gated view over `intake.submissions`, and this is the second one.

**Data freshness.** The site now measures this rather than asserting it. Run
`npm run check:freshness` for the current list; as of 2026-09-01 it reports seven overdue
scoring inputs across five of the twelve ranked brands and two carried with no as-of date
at all (Dave's AUV, which is franchisee-reported with no period attached, and KFC's U.S.
comps). Review windows live in `POLICY` in `lib/freshness.js` and are published on
/methodology/; they follow how often the publisher restates the figure, so a comp is
overdue in eight months and an AUV in twenty.

The rule is that an overdue figure keeps its published value and says how old it is.
Rolling a number forward, interpolating it or borrowing a peer's would be the same
estimate the editorial rule refuses everywhere else — the disclosure *is* the fix, and
the actual refresh goes through the queue like any other figure.

`db/findings/` holds research proposals prepared for `POST /api/agent` but not yet
submitted — read the batch summary before submitting one, because it records how far the
run got and what it could not verify.

## Working conventions

Pushing straight to `main` is allowed. A branch and pull request are optional now —
worth it when a change is large enough to want Vercel's preview build in front of it, or
when someone else should see it before it is live, but a routine change can be committed
to `main` and pushed. Keep `docs/` out of commits (it is git-ignored).

**The checks carry more weight now that they may be the only reader.** A push to `main`
deploys to production, so `npm test` before pushing is not a formality — a broken
footnote anchor or an unresolvable source id is invisible in review and there may be no
review; the script is what catches it. If you touched a migration, run
`npm run db:validate` too; it needs a local Postgres on port 5433 and it is the only
thing that will tell you a `security definer` function no longer does what its comment
says. If either fails, fix it before pushing rather than after — on `main` the failure is
already live.

**Two Postgres details that will cost an hour each if rediscovered.** A `search_path`
list must be unquoted — `set search_path = public, extensions`, because
`set search_path = 'public, extensions'` is one schema *named* `public, extensions` and
every unqualified type in the body then fails to resolve at `create function` time. And a
bare string literal appended to a `text[]` is parsed as an array literal, not an element:
`errors := errors || 'no source cited'` raises *malformed array literal* and needs an
explicit `::text`.

**Adding data now means adding it through the queue**, not by editing `data/*.json` by
hand — either at `/admin/` or, for an agent, through `POST /api/agent`. Approving writes
to Postgres; the desk's **Publish to site** button then re-exports `data/` and commits it,
which is what reaches the build. `data/*.json` is therefore generated now: a hand edit
survives only until the next publish overwrites it. Never hand-edit a figure into `data/`
and put a proposal for the same number in the queue.
