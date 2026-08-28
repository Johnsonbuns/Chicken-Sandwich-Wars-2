# ChickenSandwichWars.com

An independent intelligence platform tracking the brands, operators, real estate and
consumer trends shaping America's chicken restaurant industry.

The site is a static build generated from a sourced dataset. There is no database, no
CMS and no runtime dependency — `node build.js` turns `data/` into `docs/`.

```bash
npm run build     # data/ -> docs/  (77 pages, no dependencies)
npm run serve     # build, then preview at http://localhost:4173
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
- Consumer polls record votes in the visitor's own browser and publish no aggregate
  totals until the ballot runs server-side. Inventing vote counts is exactly the thing
  the site exists not to do.
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
  brands.json       21 chicken brands: units, sales, AUV, comps, real estate, analysis
  operators.json    16 franchisee groups and investment platforms
  news.json         33 sourced briefs, each with a "what it means" analysis
  transactions.json property comps + corporate/franchise portfolio deals
  realestate.json   cap rate benchmarks, lease structures, closure inventory
  expansion.json    announced development agreements and pipelines
  movement.json     openings and closures
  markets.json      8 metro market profiles
  research.json     4 long-form CSW reports
  datacenter.json   9 chart series
  consumer.json     published rankings, category context, poll definitions
  events.json       industry events with organiser-published dates

lib/
  score.js       the CSW Score — scaling, weights, renormalisation, unrated rule
  components.js  footnote tracker, tables, charts, stat blocks, forms
  layout.js      page shell, navigation, footer
  util.js        formatting

pages/           one module per site section, each returning page descriptors
build.js         orchestrates everything, writes docs/ + search index + sitemap
docs/            generated output (GitHub Pages serves from here)
```

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

## Adding or correcting data

1. Edit the relevant file in `data/`.
2. If you are citing something new, add it to `data/sources.json` first and reference
   its key. A stat without a resolvable `src` renders without a footnote — treat that
   as a build smell.
3. `npm run build` and check the page.

The build fails loudly on malformed JSON and silently drops unknown source ids, so a
quick `grep` for the new key in `docs/` after building confirms it rendered.

## Deployment

The site is hosted on **Vercel**. `vercel.json` tells it there is nothing to install,
`node build.js` is the build, and `docs/` is the output — the same command that runs
locally.

The recommended setup is importing the GitHub repository in the Vercel dashboard, which
deploys every push to `main` automatically and gives every pull request a preview URL.
The CLI alternative, from a local clone, is `vercel login` then `vercel --prod`.

**Web Analytics has to be switched on in the dashboard** (Project → Analytics → Enable).
The script tag is already in the root layout and ships on all 77 pages, but
`/_vercel/insights/script.js` returns 404 until analytics is enabled on the project — so
"the tag is there" is not the same as "analytics is recording".

`docs/` is also self-contained and carries a `.nojekyll` marker, so it can be served by
any static host without a build step. Google Fonts are the only external request;
everything else is local.
