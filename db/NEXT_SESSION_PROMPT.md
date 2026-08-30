# Next session prompt — implement the database

Copy everything below the line into a fresh Claude Code session on this repository.

---

## Task

Implement the Postgres/Supabase backend described in `db/SCHEMA.md`. **Read that document
in full before writing anything** — it is the design of record, and the reasoning in it
matters as much as the DDL.

**Phase 1 is complete.** Your scope is **Phase 2 only** — import, export and the
round-trip gate. Do not start Phase 3 (forms) until the Phase 2 gate passes, and do not
touch Phase 5 (Sanity) at all.

Branch: continue on `claude/database-schema-design` (pull request #16), or cut
`claude/database-phase-2` from it. Do not branch from `main` — the migrations are not
merged yet.

Provisioning that only the owner can do is in `db/PROVISIONING.md`. Phase 1 needs no
credentials — migrations are `.sql` files run in the Supabase SQL Editor. Never ask for or
accept a `service_role` / secret key in the conversation; if Phase 2 needs one, have the
owner run the import themselves.

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

## Phase 1 — Schema ✅ already done

`supabase/migrations/0001_extensions.sql` … `0011_seed_vocab.sql` exist and are validated.
43 tables (38 `public`, 4 `intake`, 1 `audit`), 27 enums, 76 RLS policies. Read them before
writing the import — they are the contract.

`./supabase/validate.sh` applies the whole set to a throwaway local Postgres and exercises
the constraints that carry design weight. It passes. Re-run it after any migration change.

Two things it does not cover, both stated in the script: PostGIS is usually absent locally,
so the two `extensions.geography` lines are substituted; and it stubs Supabase's `anon`,
`authenticated`, `service_role` roles and `auth` schema. Neither has been executed against
a real Supabase project yet — **the first person to run these against Supabase should
report what happens**, since that is the one untested surface.

`0011_seed_vocab.sql` is generated from `data/*.json` and `lib/score.js`. Regenerate it
rather than hand-editing if the vocabularies change.

## Phase 2 — Import, export, round-trip ✅ already done

`scripts/db-import.js` (JSON → idempotent SQL seed), `scripts/export-data.js` (DB → JSON,
via psql locally or PostgREST against Supabase), `scripts/db-roundtrip-check.js` (the
gate). Wired as `npm run db:import`, `db:export`, `db:check`.

The gate passes: all thirteen files round-trip clean, `npm test` still builds 75 pages,
scores recompute identically (12 rated, 9 unrated), and `data/` is untouched. Verified
against a database seeded exactly the way production was.

Migrations `0012`–`0015` all came out of writing the import — the data correcting the
model. Read their headers; each explains what broke and why.

## Your scope: Phase 3 — forms

`api/submit.js`, the `intake` tables (already created), a `/privacy/` page, and an email
notification. Update `assets/js/site.js` to POST and fall back to the existing `mailto:`
if the request fails, so a function outage degrades to today's behaviour rather than
losing a lead.

The privacy policy ships in the SAME pull request as the endpoint, not after it — the
moment the first submission lands the site is collecting names, emails, phone numbers and
property addresses with no disclosure.

Remember `vercel.json` has no install step: use global `fetch` against PostgREST, add no
dependencies, and never put the service-role key anywhere the browser can see it.

## Import details that will bite

- **`asOf` is not a date.** Values include `FY2025`, `Jul 2025 – Jul 2026`, `2025 FDD`,
  `YE2025 target`. Store the string in `period_label` verbatim; populate `period_start` /
  `period_end` only where unambiguous. Round-trip fidelity depends on the label.
- **`stats` is sparse.** 33 distinct keys across 21 brands, 24 used exactly once. Every one
  becomes a `facts` row. Do not drop the rare ones.
- **Use `metrics.json_key`, never a snake_case algorithm.** snake_case is not reversible:
  `closuresTTM` → `closures_ttm` → `closuresTtm`. Every metric row stores the exact key it
  had in `data/*.json`; the exporter must round-trip through that column.
- **`metrics.*Derived` flags** (`unitGrowthDerived`, `salesGrowthDerived`) map to
  `derivation = 'derived'`. The site labels these; losing the flag breaks the editorial rule.
- **Three `metrics` fields are not metrics.** `capRateBasis` → `brand_cap_rates.basis`;
  `auvNote` and `salesGrowthNote` → the `note` column on their respective fact row.
  `netClosures` is the boolean gating the −4 penalty and is stored as metric
  `net_unit_decline` with value 1 or 0.
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
