# Next session prompt — implement the database

Copy everything below the line into a fresh Claude Code session on this repository.

---

## Task

Implement the Postgres/Supabase backend described in `db/SCHEMA.md`. **Read that document
in full before writing anything** — it is the design of record, and the reasoning in it
matters as much as the DDL.

Work through **Phase 1 and Phase 2 only** in this session. Do not start Phase 3 (forms)
until the Phase 2 gate passes, and do not touch Phase 5 (Sanity) at all.

Branch: `claude/database-phase-1-2`, cut from `main`.

## Non-negotiable constraints

These are the things that will quietly ruin the project if you get them wrong.

1. **`node build.js` must keep running on stock Node with zero dependencies.**
   `vercel.json` has no install step, so `node_modules` does not exist on the Vercel build
   box. The build must never import a database driver. Talk to Supabase over PostgREST
   with global `fetch`. Do not add `pg` or `@supabase/supabase-js`. Do not add an install
   step to `vercel.json`.

2. **The site must build identically at every commit.** `npm test` must report **75
   pages**, links resolving, footnotes anchored, sitemap complete. Run it before every
   push. It is not a unit-test suite; it is six integrity checks that each catch a failure
   this codebase has actually shipped.

3. **Never invent, estimate or backfill a figure.** `NULL` means "not published" and the
   site renders an em dash. If an import cannot resolve a value, leave it null and report
   it. The nine unrated brands stay unrated — that is the editorial rule, not a data gap.

4. **Keep `data/*.json` unchanged in this session.** Phase 2 proves the database can
   reproduce it; Phase 4 (a later session) flips the direction. `git diff data/` must be
   empty when you finish.

5. **Do not commit `docs/`.** It is git-ignored and Vercel rebuilds it.

## Phase 1 — Schema

Create `supabase/migrations/`, numbered and individually applicable:

| File | Contents |
|---|---|
| `0001_extensions.sql` | `citext`, `postgis`, `pg_trgm`, `btree_gist` (needed for the occupancy exclusion constraint) |
| `0002_enums.sql` | Every enum type in `db/SCHEMA.md` |
| `0003_provenance.sql` | `sources`, `metrics`, `facts`, `entity_notes`, plus `v_current_facts` |
| `0004_entities.sql` | `momentum_states`, `tags`, `companies`, `company_roles`, `brands`, `brand_tags`, `brand_operators`, `brand_cap_rates`, `markets` |
| `0005_realestate.sql` | `properties`, `property_occupancies`, `leases`, `transactions`, `transaction_properties`, `listings`, `listing_properties`, `expansion_agreements` |
| `0006_content.sql` | `articles`, `article_entities`, `article_sources`, `chart_*`, `published_ranking*`, `industry_events`, `job_postings`, `newsletter_issues` |
| `0007_scoring.sql` | `score_versions`, `score_components`, `score_adjustments`, `brand_scores`, `brand_score_components` |
| `0008_intake.sql` | `intake` schema, `contacts`, `submissions`, `buy_criteria`, `subscriptions` |
| `0009_audit.sql` | `audit.record_changes` + the generic trigger function |
| `0010_rls.sql` | RLS on every `public` table; revoke `intake` from `anon`/`authenticated` |
| `0011_seed_vocab.sql` | `momentum_states` (13 rows), `tags`, `metrics` (33 keys + derived), `score_versions` v1 matching `lib/score.js` exactly |

Verify: migrations apply cleanly to an empty database, and re-applying from scratch
(`supabase db reset`) succeeds. If the Supabase CLI is unavailable in the session, still
write the migrations and verify the SQL parses — say plainly that you could not execute
them rather than implying you did.

`0011` must reproduce `lib/score.js` exactly: five components with weights 30/25/18/15/12,
their floors and ceilings (including the inverted cap-rate component, ceiling 4.2 below
floor 7.5), `min_components = 3`, and the uniform −4 net-unit-decline adjustment.

## Phase 2 — Import, export, round-trip

Three scripts, all dependency-free, all using `fetch`:

- **`scripts/db-import.js`** — reads `data/*.json`, writes to Supabase. Idempotent: safe
  to run repeatedly. Resolve every `src` id to a `sources.id` FK and **fail loudly** on an
  unresolvable one. Follow the mapping table in `db/SCHEMA.md` §13.
- **`scripts/export-data.js`** — reads Supabase, writes the same JSON shapes back.
- **`scripts/db-roundtrip-check.js`** — runs import then export into a temp directory and
  deep-compares against `data/`, key-order-insensitive. Exits non-zero on any difference.

Wire up `npm run db:import`, `npm run db:export`, `npm run db:check`.

### The gate

Do not report Phase 2 complete until all four hold:

- [ ] `npm run db:check` reports zero differences
- [ ] `npm test` reports 75 pages, all checks passing
- [ ] `git diff --stat data/` is empty
- [ ] Brand scores computed from the database match `lib/score.js` for all 21 brands — 12 rated with identical scores and ranks, 9 unrated

If the round-trip cannot be made clean, **stop and report exactly which fields differ and
why**. A near-miss is a finding, not a pass. Do not adjust `data/*.json` to make the
comparison succeed.

## Import details that will bite

- **`asOf` is not a date.** Values include `FY2025`, `Jul 2025 – Jul 2026`, `2025 FDD`,
  `YE2025 target`. Store the string in `period_label` verbatim; populate `period_start` /
  `period_end` only where unambiguous. Round-trip fidelity depends on the label.
- **`stats` is sparse.** 33 distinct keys across 21 brands, 24 used exactly once. Every one
  becomes a `facts` row. Do not drop the rare ones.
- **`metrics.*Derived` flags** (`unitGrowthDerived`, `salesGrowthDerived`) map to
  `derivation = 'derived'`. The site labels these; losing the flag breaks the editorial rule.
- **Operator `brands[]` includes 12 non-chicken brands, and not all are restaurants.**
  Taco Bell, Arby's, Sonic, Subway, Burger King, Little Caesars, Pizza Hut, 7 Brew, Au Bon
  Pain, 7-Eleven, Meineke, Take 5 Oil Change. Create them as `brands` rows with
  `is_chicken = false` and the correct `sector` (Meineke and Take 5 are `automotive`,
  7-Eleven is `convenience`) so `brand_operators` is a real FK. `chickenBrands[]` is the
  subset where `is_chicken = true`. Only chicken brands are `is_published`.
- **`news[].brand` is a slug and is sometimes `null`.** Null means no single subject.
- **Aggregate closures are not properties.** `{brand: 'kfc', location: 'United States',
  count: 312}` is a `facts` row, not a `property_occupancies` row. Only individually
  located events become occupancies with a property.
- **Transactions with `location: "Not disclosed"`** get zero rows in
  `transaction_properties`. Do not fabricate a property to satisfy a join.
- **The FCPT row is a portfolio of two Popeyes properties in one transaction** — the
  many-to-many case the join table exists for.
- **`transactions.property[]` with `type: 'Listing'`** belongs in `listings`, not
  `transactions`. Round-trip it back into the property array on export.
- **`realestate.benchmarks[]`** are category-level facts (`subject_type = 'category'`),
  with a single synthetic category subject row.
- **Sources are keyed by string** (`qsr50-2026-chicken`). Preserve those keys exactly —
  footnotes, `check.js` and the downloadable dataset all depend on them.

## What to report back

1. Whether the migrations applied, and whether you could actually execute them.
2. The round-trip result: clean, or precisely what differs.
3. Any place the existing data contradicts the schema's assumptions — those are findings
   about the data, and worth more than a silent workaround.
4. Anything you deliberately left for a later phase.

Commit in logical units, push to `claude/database-phase-1-2`, and do not open a pull
request unless asked.
