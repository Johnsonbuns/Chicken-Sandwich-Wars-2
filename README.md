# ChickenSandwichWars.com

An independent intelligence platform tracking the brands, operators, real estate and
consumer trends shaping America's chicken restaurant industry.

The site is a static build generated from a sourced dataset — `node build.js` turns
`data/` into `docs/` with no dependencies and no CMS. Behind it sits a Postgres database
on Supabase, and `/admin/` — an internal intelligence desk where new data is entered,
research from AI agents is reviewed, and nothing reaches the site without a person
approving it.

```bash
npm test            # build, then the five checks — run before pushing
npm run build       # data/ -> docs/  (77 pages today, no dependencies)
npm run serve       # build, then preview at http://localhost:4173
npm run preview:admin  # the intelligence desk on fixtures — no database needed
```

## The sourcing standard

This is the rule the whole project is built around:

> **Every figure carries a publisher, a URL and an as-of date. Where a number has not
> been published, the site shows “—” rather than an estimate.**

In practice that means:

- Each stat in `data/` references a `src` key resolved against `data/sources.json`, and
  renders on the page as a numbered footnote linking to the original publisher.
- Figures calculated from two published numbers — a growth rate derived from a
  start-of-year and end-of-year unit count, say — are marked **derived**.
- Figures reported by franchisees rather than disclosed by a franchisor are labelled
  **franchisee-reported**.
- Brands missing too much published data are left **unrated** in the rankings instead of
  being filled in. Nine of twenty-one brands currently sit in that bucket; the gap is
  treated as a finding, not something to paper over.
- The property marketplace and job board ship empty rather than with placeholder
  listings.

Sources currently in use include SEC filings (Wingstop, Restaurant Brands International,
Yum! Brands, El Pollo Loco, Four Corners Property Trust), the QSR 50, Technomic Top 500,
Franchise Times Top 400, Circana, Placer.ai, The Boulder Group's net lease research,
USDA ERS, and the trade press covering each event.

## Layout

```
data/          the dataset — the single source of truth
  sources.json      108 cited sources keyed by id
  brands.json       22 chicken brands: units, sales, AUV, comps, real estate, analysis
  operators.json    16 franchisee groups and investment platforms
  news.json         33 sourced briefs, each with a "what it means" analysis
  transactions.json property comps + corporate/franchise portfolio deals
  realestate.json   cap rate benchmarks, lease structures, closure inventory
  expansion.json    announced development agreements and pipelines
  movement.json     openings and closures
  markets.json      8 metro market profiles
  research.json     4 long-form CSW reports
  datacenter.json   9 chart series
  consumer.json     published rankings, category context
  events.json       industry events with organiser-published dates

lib/
  score.js       the CSW Score — scaling, weights, renormalisation, unrated rule
  components.js  footnote tracker, tables, charts, stat blocks, forms
  layout.js      page shell, navigation, footer
  util.js        formatting

pages/           one module per site section, each returning page descriptors
admin/           the intelligence desk — copied to docs/admin/, not a site page
api/             serverless functions: form intake, the desk, the agent door
supabase/        migrations, and the tests that hold the review queue to its promises
db/              SCHEMA.md, ADMIN.md, AGENT_INTAKE.md, PROVISIONING.md
build.js         orchestrates everything, writes docs/ + search index + sitemap
docs/            generated output — git-ignored, rebuilt by Vercel on every deploy
```

The counts above are what is in `data/` today, not fixed sizes: `data/*.json` is exported
from the database now, so every publish from the desk moves them.

## The CSW Score

Computed in `lib/score.js`, never hand-set. Five components, each scaled linearly
between a published floor and ceiling and clamped to 0–100:

| Component | Weight | Input |
|---|---:|---|
| Unit Economics | 30% | average unit volume |
| Consumer Demand | 25% | most recent same-store sales |
| Expansion | 18% | unit growth, latest reported year |
| Real Estate Strength | 15% | cap rate on the brand's net-lease product (lower is stronger) |
| System Momentum | 12% | systemwide sales growth |

Weights renormalise over whichever components a brand has published. Fewer than three
available components means no score. One uniform adjustment is applied afterwards: a
system in net unit decline carries a four-point penalty, applied identically to every
brand that qualifies. The full methodology, including known limitations, is published
on `/methodology/`.

## The intelligence desk

`/admin/` is where data is added and reviewed. Human entry and AI research go into the
same queue and get the same treatment:

```
human entry ─┐
             ├─→ review queue ─→ approve / edit / reject / needs verification ─→ database ─→ site, if public
agent run ───┘
```

Nothing published skips that queue — not an editor's own entry, and certainly not an
agent's. A proposal carries its citation, its confidence, who made it and why; the
reviewer sees the current value beside the proposed one, any record that looks like a
duplicate, and the sentence the figure was read from.

It also holds intelligence the site will never show. Every record carries a visibility of
public, internal or confidential, and a database constraint makes publishing a non-public
one impossible rather than merely discouraged — so a rent roll shared in confidence can
inform the analysis without any risk of appearing in it.

Research agents submit through `POST /api/agent` with a key minted in the dashboard. That
door reaches four functions, all of which write to the review tables; **no agent can write
to canonical data, approve anything, or read a lead.** `db/AGENT_INTAKE.md` is the
contract, `db/ADMIN.md` is the guide, and `npm run preview:admin` shows the whole thing
running on fixtures without a database.

## Adding or correcting data

Through the desk: `/admin/` → **+ Add Intelligence**, or *Propose an edit* on any existing
record. Cite the source as you go — a URL and a publisher is enough, and the source record
is created when the proposal is approved.

`data/` is still the build's source of truth until the database becomes upstream of it, so
a direct edit works too:

1. Edit the relevant file in `data/`.
2. If you are citing something new, add it to `data/sources.json` first and reference
   its key. A stat without a resolvable `src` renders without a footnote — treat that
   as a build smell.
3. `npm run build` and check the page.

The build fails loudly on malformed JSON but silently drops unknown source ids — that
is what `npm test` is for. It checks that every `src` in `data/` resolves, that every
footnote superscript has its anchor, that internal links resolve, and that no page came
out empty or with `undefined` in it.

## Deployment

The site is hosted on **Vercel**. `vercel.json` tells it there is nothing to install,
`node build.js` is the build, and `docs/` is the output — the same command that runs
locally.

The recommended setup is importing the GitHub repository in the Vercel dashboard, which
deploys every push to `main` automatically and gives every pull request a preview URL.
The CLI alternative, from a local clone, is `vercel login` then `vercel --prod`.

Canonical URLs and `sitemap.xml` follow the deployment: the build reads Vercel's
`VERCEL_PROJECT_PRODUCTION_URL`, so attaching a custom domain is enough to move them.
Set `CSW_SITE_ORIGIN` to override. Preview deployments canonicalise at production and
ship `noindex`, so they never compete with the live site in search.

**Web Analytics has to be switched on in the dashboard** (Project → Analytics → Enable).
The script tag is already in the root layout and ships on every page, but
`/_vercel/insights/script.js` returns 404 until analytics is enabled on the project — so
"the tag is there" is not the same as "analytics is recording".

`docs/` is also self-contained and carries a `.nojekyll` marker, so it can be served by
any static host without a build step. Google Fonts are the only external request;
everything else is local.
