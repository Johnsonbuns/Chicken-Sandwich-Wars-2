# Chicken Sandwich Wars — Database Schema

Target: **Postgres 15+ on Supabase**, with Sanity added later as the editorial authoring
layer. This document is the design of record. `db/NEXT_SESSION_PROMPT.md` is the
execution brief that turns it into migrations.

Written against `main` at 75 pages, with `/properties/` (marketplace) and `/newsletter/`
(The Chicken Wire) **retained** — both are modelled here as first-class features rather
than as pages to be deleted.

---

## 1. What this database is for

The site's product is stated in `CLAUDE.md` and it is the thing the schema has to protect:

> Every figure carries a publisher, a URL and an as-of date. Where a number has not been
> published, the site shows "—" rather than an estimate.

Three consequences drive every decision below.

**Provenance is per-field, not per-row.** A brand record is not "sourced." Its AUV is
sourced, its unit count is sourced separately, and the two can carry different publishers
and different as-of dates. A wide `brands` table cannot express that, which is why §4
puts figures in a `facts` table instead of columns.

**Absence is meaningful and must survive normalisation.** `NULL` here means "not
published," and the site renders it as an em dash. There is no default, no backfill and
no imputation. A `NOT NULL DEFAULT 0` on any published figure would silently destroy the
editorial rule.

**History matters because freshness is the product.** `CLAUDE.md` notes that quarterly
results from Popeyes, Wingstop, KFC and El Pollo Loco move the rankings. When Q3 lands,
the Q2 figure must not be overwritten — it becomes the previous observation. Facts are
therefore append-only and time-versioned (§4.3).

Beyond preserving what exists, the database exists to close the gap the docs call the most
consequential in the project: **lead capture**. Four forms currently copy to the clipboard
and open a `mailto:`. Nothing is stored. §9 is that fix.

---

## 2. Architecture, and how the site keeps working

### 2.1 The zero-dependency constraint is not negotiable

`CLAUDE.md`: *"The build has none and should keep none — `node build.js` runs on stock
Node (>=18)."* And `vercel.json` has **no install step**, so `node_modules` does not exist
on the Vercel build box at all. Any design that makes `build.js` import a Postgres driver
breaks the deploy.

The resolution is that **the build never talks to the database.**

```
Postgres (source of truth)
        │
        │  scripts/export-data.js      ← runs locally / in CI, never on Vercel
        │  (plain fetch → PostgREST)
        ▼
   data/*.json                          ← committed, same shapes as today
        │
        │  node build.js                ← unchanged, still zero-dependency
        ▼
     docs/  → Vercel
```

`data/*.json` stops being hand-edited and becomes a **generated artifact that stays
committed**. The build, `scripts/check.js` and `scripts/mobile-check.js` do not change at
all. This is what makes the migration safe: at every phase the site can be built and
shipped from the JSON exactly as it is today.

### 2.2 No dependencies anywhere, actually

Supabase exposes PostgREST over HTTPS. Node 18+ has global `fetch`. So both the export
script and the `api/` functions can talk to Postgres with **zero npm packages**:

```js
const r = await fetch(`${SUPABASE_URL}/rest/v1/brands?select=*&is_published=eq.true`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});
```

This matters more than it looks. `CLAUDE.md` permits runtime dependencies under `api/`,
but `vercel.json`'s missing install step means they would not be installed. Using `fetch`
sidesteps the conflict entirely and keeps the repo's best property intact. **Do not add
`pg` or `@supabase/supabase-js` unless a later requirement genuinely forces it** — and if
it does, re-enabling `installCommand` in `vercel.json` is part of that change, not an
afterthought.

### 2.3 Schemas and exposure

| Schema | Contents | PostgREST exposure |
|---|---|---|
| `public` | Entities, facts, content, listings — everything the site renders | Yes, anon read where `is_published` |
| `intake` | Form submissions, contacts, consent, buyer criteria — **all PII** | **No.** Service-role only, server-side |
| `audit` | Change log | No |

`intake` is deliberately not exposed to PostgREST. Browser code never touches it; writes
go through `POST /api/submit`, a Vercel Function holding the service-role key. This is
simpler to reason about than getting insert-only RLS right on a PII table, and it removes
a whole class of misconfiguration.

---

## 3. Entity model

The central correction over the current JSON, and the thing this design is built around:

> **A property is an entity. A transaction is an event.**

Properties exist before, between and after transactions. A newly built Chick-fil-A that
has never traded is a property. A dark KFC awaiting a second-generation tenant is a
property. Deriving property identity from transaction rows only works if every property
has traded — which is exactly the assumption that fails the moment the marketplace lists
a new build or the closure database tracks a dark box.

```
                 ┌────────────┐
                 │  sources   │◄──────────── referenced by nearly everything
                 └─────┬──────┘
                       │
   ┌───────────┐   ┌───┴─────┐   ┌───────────┐
   │ companies │──►│  facts  │◄──│  brands   │
   └─────┬─────┘   └─────────┘   └─────┬─────┘
         │                              │
         │  brand_operators             │
         └──────────────┬───────────────┘
                        │
              ┌─────────▼──────────┐
              │    properties      │  ← independent lifecycle
              └──┬────────┬────────┘
                 │        │
    property_occupancies  leases          (time-varying, per property)
                 │        │
              ┌──▼────────▼──┐   ┌──────────────┐
              │ transactions │◄──│   listings   │
              └──────────────┘   └──────────────┘
                 (events, M:N via transaction_properties)
```

### 3.1 Why `companies` instead of `operators`

The current `operators.json` is one shape, but the same real-world entities appear in four
different roles across the dataset:

- **KBP Brands** is an operator *and* the acquirer in a franchisee-portfolio transaction.
- **Roark Capital** is an investor, appearing only in `transactions.corporate`.
- **Four Corners Property Trust** is a REIT buying properties.
- **Yum! Brands** and **RBI** are franchisor parents *and* transaction counterparties.

Modelling these as one `companies` table with a `company_roles` join means Roark buying
Dave's and KBP operating 831 KFCs are the same kind of row, and a company gains a role
without a schema change. The operators page is then a view (`v_operators`).

It also fixes a defect `CLAUDE.md` explicitly warns about:

> `operatorsByBrand` … is built by fuzzy-matching operator `chickenBrands` strings against
> brand names, so a renamed brand can silently drop its operator list.

`brand_operators` is a foreign key. Renaming a brand cannot break it.

Non-chicken brands become real `brands` rows so operator portfolios are fully
expressible instead of half-modelled as a string array. Note that these are not all
restaurants — the 16 operators collectively run **Taco Bell, Arby's, Sonic, Subway, Burger
King, Little Caesars, Pizza Hut, 7 Brew, Au Bon Pain, 7-Eleven, Meineke and Take 5 Oil
Change**. Two of those are automotive service. So `brands` carries both `is_chicken` and a
`sector`, and the chicken dataset is a filtered view of a slightly wider one. That is the
honest shape of the data: a franchisee's exposure to chicken is only meaningful against
the rest of their portfolio.

### 3.2 Why tenancy is its own table

A former KFC that reopens as a Dave's Hot Chicken is **the same property with a different
occupant over time**. If `brand_id` were a column on `properties`, that would be
unrepresentable — and it is the site's central thesis. 312 KFC closures are 312
second-generation boxes entering supply; the schema has to be able to follow them.

`property_occupancies` carries `brand_id`, `operator_company_id` and a date range with a
GiST exclusion constraint preventing two overlapping tenants on one property.

### 3.3 Individual movement vs. system movement

`movement.json` mixes two genuinely different things:

- *"Zaxby's opened at 1267 First Avenue, Upper East Side"* — one property, one date.
- *"KFC closed 312 U.S. restaurants in twelve months"* — an aggregate with no property.

These must not share a table. Individual events are `property_occupancies` rows; aggregates
are `facts` rows against the brand (`closures_ttm`, `us_closures_2025`). The
openings-and-closures page unions the two, which is what it already does implicitly.

---

## 4. Provenance and facts

### 4.1 `sources`

Preserves the existing string keys (`qsr50-2026-chicken`) so footnotes, `check.js` and the
downloadable dataset keep working unchanged.

```sql
create type source_type as enum (
  'sec_filing','company_release','trade_press','data_provider',
  'brokerage_report','fdd','court_filing','government','other'
);

create table public.sources (
  id                        uuid primary key default gen_random_uuid(),
  key                       citext not null unique,        -- 'qsr50-2026-chicken'
  publisher                 text   not null,
  title                     text   not null,
  url                       text   not null,
  date_label                text,                          -- '2026', 'Q2 2026' — as displayed
  published_on              date,                          -- parsed where unambiguous
  source_type               source_type not null default 'trade_press',
  -- CLAUDE.md provenance caveat: the seed figures came from search-result summaries,
  -- not from reading the primary document. This flag tracks which have been re-read.
  verified_against_primary  boolean not null default false,
  verified_at               timestamptz,
  verified_by               uuid references auth.users(id),
  archive_url               text,                          -- Wayback snapshot
  accessed_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index on public.sources (source_type);
create index on public.sources (verified_against_primary) where verified_against_primary = false;
```

`verified_against_primary` turns a paragraph of documentation into a queryable work
queue. The AUV and same-store-sales figures that drive the rankings are the ones that
need it first.

### 4.2 `metrics` — a controlled vocabulary, not free-form EAV

The current `stats` object is extremely sparse: **33 distinct keys across 21 brands, an
average of 3.7 per brand, and 24 of those keys used by exactly one brand.** A wide table
would be 33 columns that are ~89% NULL, and every new figure would be a migration.

But an untyped key-value store is worse — nothing stops `auv`, `AUV` and `avg_unit_volume`
coexisting. `metrics` is the dimension table that makes the fact table safe:

```sql
create type metric_unit as enum (
  'usd','count','pct','bps','usd_per_sqft','sqft','acres','lb','years','ratio'
);

create table public.metrics (
  key              citext primary key,          -- 'auv', 'us_units', 'systemwide_sales'
  label            text not null,               -- 'Average unit volume'
  unit             metric_unit not null,
  display_format   text not null default 'auto',-- maps to lib/util.js: 'usd' | 'pct' | 'count'
  subject_types    text[] not null,             -- ['brand'] — which entities may carry it
  description      text,
  is_scoring_input boolean not null default false,
  sort_order       int not null default 100
);
```

Seed it with the 33 existing keys, normalised to snake_case, plus the derived metrics that
feed scoring (`auv_usd`, `unit_growth_pct`, `comps_pct`, `sales_growth_pct`,
`cap_rate_mid`).

### 4.3 `facts` — append-only, time-versioned, individually sourced

```sql
create type subject_type as enum (
  'brand','company','property','market','category','listing'
);

create type derivation as enum (
  'reported',            -- straight from the source
  'derived',             -- arithmetic from two published numbers (site labels these)
  'franchisee_reported', -- labelled as such per the editorial rule
  'company_guidance'     -- forward-looking target, not a result
);

create table public.facts (
  id              uuid primary key default gen_random_uuid(),
  subject_type    subject_type not null,
  subject_id      uuid not null,
  metric_key      citext not null references public.metrics(key),

  value_numeric   numeric(20,4),
  value_text      text,                     -- for figures published only as a range
  unit            metric_unit not null,

  -- Period. The label is preserved verbatim because the site displays it and the
  -- existing values are not parseable dates: 'FY2025', 'Jul 2025 – Jul 2026', '2025 FDD'.
  period_label    text not null,
  period_start    date,
  period_end      date,
  as_of           date,

  source_id       uuid not null references public.sources(id),
  derivation      derivation not null default 'reported',
  derivation_note text,
  note            text,                     -- renders as the stat's note today

  superseded_at   timestamptz,              -- null = current observation
  superseded_by   uuid references public.facts(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),

  constraint facts_has_value check (value_numeric is not null or value_text is not null)
);

-- Exactly one current observation per subject × metric × period.
create unique index facts_current_uniq
  on public.facts (subject_type, subject_id, metric_key, period_label)
  where superseded_at is null;

create index facts_subject_idx on public.facts (subject_type, subject_id) where superseded_at is null;
create index facts_metric_idx  on public.facts (metric_key, period_end desc);
create index facts_source_idx  on public.facts (source_id);
```

Superseding rather than updating means the Q2→Q3 transition keeps both observations, the
rankings can be recomputed as of any date, and a corrected figure leaves a trail.

`v_current_facts` (a view filtered to `superseded_at is null`) is what the export script
reads, so callers never think about versioning.

### 4.4 `entity_notes` — the sourced-bullet pattern, unified

Six separate arrays in the current data are structurally identical — prose plus a source,
attached to an entity:

| Current location | Shape |
|---|---|
| `brands[].pipeline[]` | `{ text, src }` |
| `operators[].facts[]` | `{ text, asOf, src }` |
| `markets[].activity[]` | `{ text, src }` |
| `realestate.leaseIntel[]` | `{ label, text, src }` |
| `realestate.supply[]` | `{ label, text, src }` |
| `consumer.context[]` | `{ text, src }` |

One table, one rendering component, one integrity check:

```sql
create type note_kind as enum (
  'pipeline','operator_fact','market_activity','market_watch',
  'lease_intel','supply','consumer_context','real_estate_note','risk'
);

create table public.entity_notes (
  id           uuid primary key default gen_random_uuid(),
  subject_type subject_type not null,
  subject_id   uuid not null,
  kind         note_kind not null,
  label        text,                    -- leaseIntel/supply carry one; others don't
  body_md      text not null,
  period_label text,
  as_of        date,
  source_id    uuid references public.sources(id),   -- null only for market_watch
  ordinal      int not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.entity_notes (subject_type, subject_id, kind, ordinal);
```

`market_watch` (the "what to watch" bullets) is the one kind with no source — those are
CSW's own open questions, not published claims, and the nullable `source_id` is
deliberate. Everything else should have one, and a check on `kind <> 'market_watch'`
requiring a source is worth adding once the data is clean.

**Tradeoff, stated:** this is a mild generalisation. It is justified because the six
arrays have identical shape, identical rendering and identical provenance requirements —
and because a seventh kind (say, `risk`) then costs an enum value rather than a table.
The line to hold: `entity_notes` is for *sourced prose bullets*. Anything numeric goes in
`facts`; anything long-form goes in `articles`.

---

## 5. Core entities

### 5.1 Editorial vocabularies as lookup tables

`momentum` has 13 values today and `CLAUDE.md` notes *"an unknown value falls back to a
neutral badge rather than erroring."* That fallback is a feature, and a Postgres `enum`
would make adding a value a migration. Volatile editorial vocabularies therefore get
lookup tables; stable structural sets (units, derivation, statuses with behaviour
attached) get enums.

```sql
create table public.momentum_states (
  key         citext primary key,      -- 'leader','hot','split','pressured','turnaround',
  label       text not null,           -- 'steady','expanding','stabilizing','rocket',
  badge_class text not null,           -- 'growing','emerging','distressed','mixed'
  sort_order  int not null default 100
);

create table public.tags (
  key   citext primary key,            -- 'hot chicken', 'wings', 'c-store'
  label text not null,
  kind  text not null default 'brand'
);
```

### 5.2 `companies`

```sql
create type company_kind as enum (
  'franchisor','operator','private_equity','reit','public_holding',
  'broker','lender','developer','supplier','other'
);

create type company_status as enum (
  'active','acquiring','divesting','refranchising','newly_formed',
  'stable','acquired','restructuring','liquidated'
);

create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  slug           citext not null unique,
  name           text not null,
  legal_name     text,
  hq_city        text,
  hq_state       text,
  hq_country     text not null default 'US',
  website        text,
  founded_year   int,
  kind           company_kind not null,
  status         company_status,
  status_note    text,                  -- 'Acquired by Eyas Capital' — display string
  geography      text[],                -- ['Midwest','Southeast','Multi-region']
  analysis_md    text,                  -- moves to Sanity in Phase 5 (§11)
  is_published   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.company_roles (
  company_id uuid not null references public.companies(id) on delete cascade,
  role       company_kind not null,
  primary key (company_id, role)
);
```

Unit counts (`chickenUnits`, `totalUnits`) are **not** columns — they are published,
dated, sourced figures, so they live in `facts` as `operator_chicken_units` and
`operator_total_units` against `subject_type = 'company'`. This is the rule the whole
schema follows: *if the site shows a number with a footnote, it is a fact row.*

### 5.3 `brands`

```sql
create type brand_sector as enum (
  'restaurant','convenience','automotive','retail','other'
);

create type ownership_type as enum (
  'private','public','public_parent','pe_owned','pe_controlled',
  'private_intl_parent','family_controlled','restructured'
);

create table public.brands (
  id                 uuid primary key default gen_random_uuid(),
  slug               citext not null unique,
  name               text not null,
  legal_name         text,
  is_chicken         boolean not null default true,
  sector             brand_sector not null default 'restaurant',  -- operators also run
                                                 -- automotive and convenience brands
  hq_city            text,
  hq_state           text,
  hq_country         text not null default 'US',
  founded_year       int,
  parent_company_id  uuid references public.companies(id),
  parent_label       text,          -- 'Chick-fil-A, Inc. (private, family-controlled)'
  ownership_type     ownership_type,
  franchise_model_md text,
  momentum           citext references public.momentum_states(key),
  analysis_md        text,          -- moves to Sanity in Phase 5
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.brand_tags (
  brand_id uuid not null references public.brands(id) on delete cascade,
  tag_key  citext not null references public.tags(key),
  primary key (brand_id, tag_key)
);

-- Replaces build.js fuzzy string matching with a foreign key.
create table public.brand_operators (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  unit_count   int,
  as_of        date,
  period_label text,
  source_id    uuid references public.sources(id),
  is_current   boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index brand_operators_current_uniq
  on public.brand_operators (brand_id, company_id) where is_current;
```

**Brand-level cap rate intelligence** (`realestate.brandCapRates`) attaches to the brand,
not to a property — it is the net-lease market's pricing of that tenant's credit:

```sql
create table public.brand_cap_rates (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands(id) on delete cascade,
  low_pct      numeric(5,2),
  high_pct     numeric(5,2),
  mid_pct      numeric(5,2),          -- feeds the CSW Score's realestate component
  range_label  text not null,         -- '4.20% – 4.50%' as published
  structure    text,                  -- '15-year ground lease, asking'
  basis        text,                  -- 'brand-specific asking range (Boulder Group)'
  period_label text,
  as_of        date,
  source_id    uuid not null references public.sources(id),
  superseded_at timestamptz
);
```

### 5.4 `markets`

```sql
create table public.markets (
  id           uuid primary key default gen_random_uuid(),
  slug         citext not null unique,
  name         text not null,             -- 'Houston, TX'
  state        text,
  cbsa_code    text,                      -- ties to Census metro data later
  thesis_md    text,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

Market `activity` and `watch` bullets are `entity_notes` rows
(`kind = 'market_activity'` / `'market_watch'`).

---

## 6. Properties — the independent entity

```sql
create type property_status as enum (
  'land','entitled','under_construction','operating','dark',
  'for_sale','under_contract','sold','demolished','converted'
);

create type record_source as enum ('editorial','user_submitted','imported','broker_feed');
create type verification_state as enum ('unverified','desk_reviewed','verified','rejected');

create table public.properties (
  id                 uuid primary key default gen_random_uuid(),
  slug               citext unique,

  -- Location
  address_line1      text,
  address_line2      text,
  city               text,
  state              text,
  postal_code        text,
  county             text,
  country            text not null default 'US',
  address_normalized text,                       -- for dedupe
  geog               geography(Point,4326),      -- PostGIS
  parcel_apn         text,                       -- assessor's parcel number
  market_id          uuid references public.markets(id),

  -- Physical
  building_sqft      int,
  lot_acres          numeric(10,3),
  year_built         int,
  year_renovated     int,
  drive_thru_lanes   int,
  seat_count         int,
  prototype_note     text,                       -- 'dual drive-thru, 5,000–6,000 SF'

  -- Lifecycle
  status             property_status not null default 'operating',
  is_second_generation boolean not null default false,
  prior_use          text,                       -- 'former KFC'

  -- Trust tier — user submissions must never enter the editorial dataset silently
  record_source      record_source not null default 'editorial',
  verification       verification_state not null default 'unverified',
  verified_at        timestamptz,
  verified_by        uuid references auth.users(id),
  is_published       boolean not null default false,

  source_id          uuid references public.sources(id),
  notes_md           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index properties_geog_idx   on public.properties using gist (geog);
create index properties_market_idx on public.properties (market_id);
create index properties_status_idx on public.properties (status) where is_published;
create index properties_apn_idx    on public.properties (state, parcel_apn) where parcel_apn is not null;
create unique index properties_addr_uniq
  on public.properties (address_normalized, city, state)
  where address_normalized is not null;
```

**Identity is the hard part.** Two rows are the same property when they are the same
parcel, not when their address strings match — and the seed data has strings like
`"5979 TN-153, Hixson (Chattanooga), TN"` and `"Not disclosed"`. Three defences:
`address_normalized` (uppercased, abbreviations expanded, unit stripped) with a partial
unique index; `parcel_apn` where obtainable, which is the only truly stable key; and
`geog` for proximity dedupe. Import must not invent a property for a transaction whose
location is undisclosed — it creates a transaction with **zero** linked properties (§7.1).

### 6.1 `property_occupancies` — who is in the box, and when

```sql
create type occupancy_status as enum ('announced','under_construction','open','closed');
create type closure_reason as enum (
  'lease_rejection','underperformance','relocation','franchisee_bankruptcy',
  'remodel','landlord_action','brand_exit','unknown'
);

create table public.property_occupancies (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties(id) on delete cascade,
  brand_id            uuid references public.brands(id),
  operator_company_id uuid references public.companies(id),
  status              occupancy_status not null default 'open',
  opened_on           date,
  closed_on           date,
  occupied            daterange generated always as (
                        daterange(opened_on, closed_on, '[)')
                      ) stored,
  closure_reason      closure_reason,
  detail_md           text,
  source_id           uuid references public.sources(id),
  created_at          timestamptz not null default now(),

  constraint occupancy_dates check (closed_on is null or opened_on is null or closed_on >= opened_on)
);

-- One tenant per property at a time.
alter table public.property_occupancies
  add constraint occupancy_no_overlap
  exclude using gist (property_id with =, occupied with &&)
  where (opened_on is not null);

create index on public.property_occupancies (brand_id, opened_on desc);
create index on public.property_occupancies (brand_id, closed_on desc) where closed_on is not null;
```

This one table answers the questions the site is built to answer: *which boxes went dark
this year, who was in them, and where are they.* The openings feed is
`status = 'open' order by opened_on desc`; the closure feed is `closed_on is not null`.

### 6.2 `leases`

Decomposes the free-text `term` field — today `"15-year corporate absolute-NNN ground
lease"` is four facts crammed into a string, and the site reasons about all four
separately (corporate 5.85% vs franchisee 6.85%).

```sql
create type lease_structure as enum (
  'ground_lease','absolute_nnn','nnn','double_net','modified_gross','gross'
);
create type lease_guarantee as enum (
  'corporate','franchisee','personal','unsecured','none','unknown'
);

create table public.leases (
  id                      uuid primary key default gen_random_uuid(),
  property_id             uuid not null references public.properties(id) on delete cascade,
  tenant_company_id       uuid references public.companies(id),
  brand_id                uuid references public.brands(id),
  structure               lease_structure,
  guarantee               lease_guarantee not null default 'unknown',
  commencement_on         date,
  expiration_on           date,
  initial_term_years      int,
  option_count            int,
  option_term_years       int,
  base_annual_rent_usd    numeric(14,2),
  escalation_pct          numeric(5,2),        -- 10.00
  escalation_years        int,                 -- every 5
  escalation_note         text,                -- free text where irregular
  rent_schedule           jsonb,               -- optional stepped schedule
  term_label              text,                -- original string, preserved for display
  source_id               uuid references public.sources(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on public.leases (property_id);
create index on public.leases (expiration_on);
```

`term_label` keeps the published phrasing so nothing is lost in decomposition — the site
can render the original while queries use the parsed columns.

---

## 7. Events: transactions, listings, agreements

### 7.1 `transactions`

One table, not two. The current split between `transactions.property` and
`transactions.corporate` blurs immediately — a franchisee portfolio deal is a corporate
transaction that conveys properties — and the site renders both in the same section.

```sql
create type transaction_kind as enum (
  'property_sale','portfolio_acquisition','ground_lease_sale','sale_leaseback','listing',
  'brand_acquisition','franchisee_portfolio','bankruptcy_sale','company_store_sale',
  'growth_investment','refranchising'
);
create type transaction_subject as enum ('property','company');

create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  slug                citext unique,
  kind                transaction_kind not null,
  subject             transaction_subject not null,

  announced_on        date,
  closed_on           date,
  date_label          text not null,          -- '2026-07', '2025' as published

  price_usd           numeric(16,2),
  is_price_disclosed  boolean not null default true,
  cap_rate_pct        numeric(5,2),
  noi_usd             numeric(14,2),
  unit_count          int,

  buyer_company_id    uuid references public.companies(id),
  seller_company_id   uuid references public.companies(id),
  target_company_id   uuid references public.companies(id),   -- corporate deals
  brand_id            uuid references public.brands(id),

  location_label      text,                   -- 'Naugatuck, CT' / 'Not disclosed'
  term_label          text,
  detail_md           text,
  source_id           uuid not null references public.sources(id),
  is_published        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint tx_corporate_has_target
    check (subject <> 'company' or target_company_id is not null or brand_id is not null)
);

-- Many-to-many: one transaction can convey many properties (FCPT bought two Popeyes in
-- a single deal), and a transaction may convey none we can identify ('Not disclosed').
create table public.transaction_properties (
  transaction_id      uuid not null references public.transactions(id) on delete cascade,
  property_id         uuid not null references public.properties(id) on delete cascade,
  allocated_price_usd numeric(14,2),
  primary key (transaction_id, property_id)
);
```

A plain `transactions.property_id` FK would have been wrong on both counts. The join table
is what lets `properties` stay independent while transactions remain first-class.

### 7.2 `listings` — the marketplace

Retained per your decision. The editorial rule that governs it is on the page today:
*"CSW does not list a property without the owner's written authorization."* That belongs
in the schema, not only in copy.

```sql
create type listing_status as enum (
  'draft','pending_authorization','active','under_contract','sold','withdrawn','expired'
);

create table public.listings (
  id                       uuid primary key default gen_random_uuid(),
  slug                     citext unique,
  headline                 text not null,
  summary_md               text,
  status                   listing_status not null default 'draft',

  asking_price_usd         numeric(14,2),
  cap_rate_pct             numeric(5,2),
  noi_usd                  numeric(14,2),
  is_price_on_request      boolean not null default false,

  broker_company_id        uuid references public.companies(id),
  authorization_on_file    boolean not null default false,
  authorization_received_on date,

  listed_on                date,
  expires_on               date,
  closed_transaction_id    uuid references public.transactions(id),

  origin_submission_id     uuid,          -- intake.submissions(id), soft ref across schemas
  published_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- A listing cannot go live without written authorization on file.
  constraint listing_requires_authorization
    check (status not in ('active','under_contract') or authorization_on_file)
);

create table public.listing_properties (
  listing_id  uuid not null references public.listings(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  primary key (listing_id, property_id)
);
```

The lifecycle closes cleanly: a `sell_property` submission becomes a `properties` row plus
a draft `listing`; authorization flips it active; a sale writes a `transactions` row and
sets `closed_transaction_id`. The empty state the page renders today is simply
`select … where status = 'active'` returning zero rows — it stays correct with no
special-casing.

### 7.3 `expansion_agreements`

```sql
create type agreement_status as enum ('announced','in_progress','complete','lapsed','unknown');

create table public.expansion_agreements (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id),
  operator_company_id uuid references public.companies(id),
  market_id           uuid references public.markets(id),
  market_label        text not null,        -- 'National + international'
  unit_count          int,
  units_label         text,                 -- '~1,000 in development'
  announced_on        date,
  announced_label     text not null,        -- '2026'
  timeline_note       text,
  status              agreement_status not null default 'announced',
  source_id           uuid not null references public.sources(id),
  is_published        boolean not null default true,
  created_at          timestamptz not null default now()
);
```

---

## 8. The CSW Score

`lib/score.js` currently hardcodes five components. `CLAUDE.md` warns that changing a
weight means updating `/methodology/` and re-checking its prose. Putting the definition in
the database makes the methodology page render itself, and makes historical scores
reproducible instead of recomputed-and-lost.

```sql
create table public.score_versions (
  version        int primary key,          -- 1 = the formula shipping today
  effective_from date not null,
  min_components int not null default 3,   -- fewer than three → unrated
  penalty_note   text,
  notes_md       text,
  is_current     boolean not null default false
);
create unique index on public.score_versions (is_current) where is_current;

create table public.score_components (
  version       int not null references public.score_versions(version) on delete cascade,
  key           citext not null,           -- 'demand','economics','expansion','realestate','momentum'
  label         text not null,
  weight        numeric(5,2) not null,
  metric_key    citext not null references public.metrics(key),
  floor_value   numeric not null,
  ceil_value    numeric not null,          -- may be < floor: cap rate, lower is stronger
  floor_score   numeric not null,
  ceil_score    numeric not null,
  description   text not null,
  sort_order    int not null default 100,
  primary key (version, key)
);

create table public.score_adjustments (
  version    int not null references public.score_versions(version) on delete cascade,
  key        citext not null,              -- 'net_unit_decline'
  label      text not null,
  metric_key citext references public.metrics(key),
  points     numeric(5,2) not null,        -- -4
  condition  text not null,                -- 'metrics.netClosures is true'
  primary key (version, key)
);

-- Computed snapshots, not a live view: rankings must be reproducible as of a date.
create table public.brand_scores (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  version       int not null references public.score_versions(version),
  computed_at   timestamptz not null default now(),
  as_of         date not null,
  rated         boolean not null,
  score         numeric(5,2),
  rank          int,
  coverage      int not null,              -- components available
  penalty       numeric(5,2) not null default 0,
  unique (brand_id, version, as_of)
);

create table public.brand_score_components (
  brand_score_id uuid not null references public.brand_scores(id) on delete cascade,
  component_key  citext not null,
  raw_value      numeric,
  scaled_value   numeric(5,2) not null,
  weight         numeric(5,2) not null,
  primary key (brand_score_id, component_key)
);
```

`lib/score.js` stays exactly as it is and keeps running on the exported JSON. The database
version is computed by a scheduled job that writes snapshots; the two must agree, and the
round-trip check in §13 enforces it. **The nine unrated brands must stay unrated** — the
`min_components = 3` rule is the editorial rule in numeric form, not a data gap to fix.

---

## 9. `intake` — forms, leads and PII

This is the reason the database exists. Four forms currently copy to the clipboard and
open a `mailto:`; nothing is stored.

```sql
create schema if not exists intake;

create type intake.form_kind as enum (
  'sell_property','buy_criteria','submit_deal','contact','newsletter'
);
create type intake.submission_status as enum (
  'new','triaged','contacted','qualified','converted','spam','closed'
);
create type intake.subscription_status as enum (
  'pending','subscribed','unsubscribed','bounced','complained'
);

create table intake.contacts (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  first_name        text,
  last_name         text,
  full_name         text,
  phone             text,
  company           text,
  role              text,
  -- Consent is tracked per purpose. Submitting a valuation request is not
  -- permission to send a newsletter.
  marketing_consent boolean not null default false,
  consent_at        timestamptz,
  consent_source    intake.form_kind,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  deleted_at        timestamptz               -- soft delete for erasure requests
);

create table intake.submissions (
  id             uuid primary key default gen_random_uuid(),
  form           intake.form_kind not null,
  contact_id     uuid references intake.contacts(id),
  payload        jsonb not null,            -- raw submission, exactly as received
  status         intake.submission_status not null default 'new',
  assigned_to    uuid references auth.users(id),
  internal_notes text,

  -- Request metadata for abuse handling. IP is hashed, never stored raw.
  ip_hash        text,
  user_agent     text,
  referer        text,
  utm            jsonb,
  spam_score     numeric(4,2),

  -- Where it went if it became something
  converted_property_id    uuid references public.properties(id),
  converted_listing_id     uuid references public.listings(id),
  converted_transaction_id uuid references public.transactions(id),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on intake.submissions (form, status, created_at desc);
create index on intake.submissions (contact_id);
create index on intake.submissions using gin (payload);

-- Typed projection of the buy form. jsonb alone cannot be indexed for matching,
-- and matching buyers to listings is the point of collecting it.
create table intake.buy_criteria (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references intake.submissions(id) on delete cascade,
  contact_id         uuid references intake.contacts(id),
  brand_ids          uuid[],
  brands_label       text,
  price_min_usd      numeric(14,2),
  price_max_usd      numeric(14,2),
  cap_rate_min_pct   numeric(5,2),
  geographies        text[],
  guarantee_required lease_guarantee,
  deadline_1031      date,
  capital_structure  text,
  asset_interests    text[],
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create index on intake.buy_criteria (is_active, price_max_usd, cap_rate_min_pct);

create table intake.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references intake.contacts(id) on delete cascade,
  list_key      citext not null default 'chicken-wire',
  status        intake.subscription_status not null default 'pending',
  confirmed_at  timestamptz,               -- double opt-in
  confirm_token text,
  unsubscribed_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (contact_id, list_key)
);
```

Three things this encodes deliberately:

**Consent is per-purpose.** Someone requesting a confidential valuation has not opted into
The Chicken Wire. `marketing_consent` plus a per-list `subscriptions` row keeps those
separate, which is both correct and the thing that keeps the newsletter deliverable.

**Double opt-in from day one.** `status = 'pending'` until `confirmed_at`. Retrofitting
this after a list exists is painful.

**Submissions are immutable raw records.** `payload` is stored exactly as received and
never edited; triage happens in `status` and the typed projections. If a form field is
renamed later, historical payloads still make sense.

> **Blocking dependency:** the site has no privacy policy. The moment `intake.submissions`
> receives its first row, the site is collecting names, emails, phone numbers and property
> addresses with no disclosure. `CLAUDE.md` already flags this. A `/privacy/` page ships
> in the *same* pull request as `POST /api/submit` — not after it.

---

## 10. Content

### 10.1 `articles`

Covers `news.json` and `research.json`, and becomes the Sanity mirror in Phase 5.

```sql
create type article_kind   as enum ('news','research','analysis','page','newsletter_issue');
create type article_status as enum ('draft','review','published','archived');

create table public.articles (
  id                 uuid primary key default gen_random_uuid(),
  sanity_document_id text unique,            -- null until Phase 5
  slug               citext not null unique,
  kind               article_kind not null,
  category           text,                   -- 'Brands','Real Estate','M&A' …
  title              text not null,
  dek                text,
  body               jsonb,                  -- Portable Text from Sanity
  body_md            text,                   -- pre-Sanity plain markdown
  means_md           text,                   -- news: the 'what it means' analysis
  read_minutes       int,
  date_label         text,                   -- '2026-08', 'August 2026' as displayed
  published_at       timestamptz,
  status             article_status not null default 'draft',
  primary_source_id  uuid references public.sources(id),
  search_tsv         tsvector generated always as (
                       to_tsvector('english',
                         coalesce(title,'') || ' ' || coalesce(dek,'') || ' ' || coalesce(means_md,''))
                     ) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index articles_search_idx on public.articles using gin (search_tsv);
create index articles_pub_idx    on public.articles (kind, published_at desc) where status = 'published';

create table public.article_entities (
  article_id   uuid not null references public.articles(id) on delete cascade,
  subject_type subject_type not null,
  subject_id   uuid not null,
  relation     text not null default 'about',   -- 'about' | 'mentions'
  primary key (article_id, subject_type, subject_id)
);

create table public.article_sources (
  article_id uuid not null references public.articles(id) on delete cascade,
  source_id  uuid not null references public.sources(id),
  ordinal    int not null default 0,
  primary key (article_id, source_id)
);
```

`article_sources` is what keeps footnote integrity enforceable. `scripts/check.js`
verifies every superscript has an anchor; the FK makes an unresolvable source id
impossible to save in the first place.

Research reports' `sections[]` (`{h, p, srcs}`) become Portable Text blocks with source
annotations in Sanity. Before that migration they can live in `body` as a jsonb array of
the same shape — no loss either way.

### 10.2 Charts, rankings, events

```sql
create type chart_kind as enum ('bar','line','area','stacked_bar');

create table public.chart_series (
  id            uuid primary key default gen_random_uuid(),
  key           citext not null unique,     -- 'category-growth'
  title         text not null,
  chart_kind    chart_kind not null,
  unit          metric_unit not null,
  note_md       text,
  -- When set, points are computed from facts rather than stored. Charts that
  -- track a metric already in `facts` should use this instead of duplicating it.
  derived_metric_key citext references public.metrics(key),
  is_published  boolean not null default true,
  sort_order    int not null default 100
);

create table public.chart_points (
  series_id uuid not null references public.chart_series(id) on delete cascade,
  ordinal   int not null,
  label     text not null,                  -- '2023', '2025 — all restaurants'
  value     numeric not null,
  brand_id  uuid references public.brands(id),   -- bar links to brand pages today
  primary key (series_id, ordinal)
);

create table public.chart_sources (
  series_id uuid not null references public.chart_series(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  primary key (series_id, source_id)
);

-- consumer.json: third-party published rankings CSW reports but does not author
create table public.published_rankings (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  source_id    uuid not null references public.sources(id),
  method_md    text,
  published_on date,
  is_published boolean not null default true
);

create table public.published_ranking_items (
  ranking_id uuid not null references public.published_rankings(id) on delete cascade,
  ordinal    int not null,
  label      text not null,                 -- 'Bojangles BLT Chicken'
  brand_id   uuid references public.brands(id),   -- resolved where identifiable
  primary key (ranking_id, ordinal)
);

create table public.industry_events (
  id           uuid primary key default gen_random_uuid(),
  slug         citext unique,
  name         text not null,
  starts_on    date,
  ends_on      date,
  date_label   text not null,               -- 'November 9–11, 2026'
  city         text,
  state        text,
  venue        text,
  url          text,
  why_md       text,
  source_id    uuid references public.sources(id),
  is_published boolean not null default true
);

-- The job board renders an empty state today. Modelled now so it does not need a
-- migration the day the first role is posted.
create table public.job_postings (
  id              uuid primary key default gen_random_uuid(),
  slug            citext unique,
  company_id      uuid references public.companies(id),
  brand_id        uuid references public.brands(id),
  title           text not null,
  market_id       uuid references public.markets(id),
  location_label  text,
  employment_type text,
  comp_min_usd    numeric(12,2),
  comp_max_usd    numeric(12,2),
  description_md  text,
  apply_url       text,
  posted_at       timestamptz,
  expires_on      date,
  status          listing_status not null default 'draft',
  created_at      timestamptz not null default now()
);

-- The Chicken Wire, retained.
create table public.newsletter_issues (
  id                 uuid primary key default gen_random_uuid(),
  number             int unique,
  slug               citext unique,
  subject            text not null,
  article_id         uuid references public.articles(id),
  sent_at            timestamptz,
  recipient_count    int,
  status             article_status not null default 'draft',
  created_at         timestamptz not null default now()
);
```

---

## 11. Sanity as the editorial layer

### 11.1 The boundary

The split is by *kind of truth*, not by convenience:

| Postgres owns | Sanity owns |
|---|---|
| Entities and their identity (slugs, FKs) | Long-form prose and its formatting |
| Every sourced figure (`facts`) | Editorial framing and narrative |
| Relationships (occupancies, transactions, agreements) | Article structure, images, pull quotes |
| `sources` — the canonical source registry | Which sources an article cites (by reference) |
| All PII and lead data | Nothing. Never PII. |

Postgres stays the **system of record**. Sanity is an *authoring surface* whose documents
are mirrored into `public.articles`. That direction matters: if Sanity were canonical for
articles, then `article_entities` could not be a foreign key and the footnote integrity
check would lose its teeth.

### 11.2 Document types

- `newsArticle` — title, dek, category, `means` analysis, brand/company references, sources
- `researchReport` — title, dek, Portable Text sections with inline source annotations
- `brandAnalysis` / `operatorAnalysis` / `marketThesis` — 1:1 with an entity, referenced by slug
- `newsletterIssue` — a Chicken Wire issue
- `staticPage` — about, methodology prose, privacy policy

### 11.3 Sources stay in Postgres

Writers must not be able to invent a source. A custom Sanity input fetches the source list
from Supabase and stores the **source key**; the sync resolves it to a `source_id` FK on
write. An unresolvable key fails the sync loudly rather than rendering a footnote that
links nowhere — which is precisely the failure `npm test` exists to catch.

### 11.4 Sync

```
Sanity publish → webhook → POST /api/sanity-webhook
    → verify signature
    → upsert public.articles by sanity_document_id
    → resolve source keys → article_sources
    → resolve entity slugs → article_entities
    → trigger Vercel Deploy Hook
        → export-data.js → data/*.json → build.js → docs/
```

Sanity Studio hosts on `sanity.studio` (`sanity deploy`), so this repo stays a static site
with no framework and no build dependencies. Do not embed the Studio here.

### 11.5 Ordering

**Sanity is Phase 5, and it is genuinely last.** Nothing about lead capture, properties or
transactions depends on it. Adding a CMS before the structured data is migrated means
doing the hardest integration twice.

---

## 12. Security

### 12.1 RLS

Enable RLS on **every** table in `public`. Anonymous reads see published rows only:

```sql
alter table public.brands enable row level security;

create policy "public reads published brands"
  on public.brands for select
  to anon, authenticated
  using (is_published);

-- Staff (authenticated with a profile row) read and write everything.
create policy "staff full access to brands"
  on public.brands for all
  to authenticated
  using (exists (select 1 from public.staff_profiles p
                 where p.user_id = auth.uid() and p.role in ('admin','editor')))
  with check (exists (select 1 from public.staff_profiles p
                      where p.user_id = auth.uid() and p.role in ('admin','editor')));
```

Repeat per table. `facts`, `entity_notes` and child tables gate on the parent's
`is_published` via an `exists` subquery, or carry their own flag where simpler.

```sql
create type staff_role as enum ('admin','editor','analyst','viewer');

create table public.staff_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       staff_role not null default 'viewer',
  full_name  text,
  created_at timestamptz not null default now()
);
```

### 12.2 `intake` is not exposed

Revoke everything from `anon` and `authenticated` on the `intake` schema and leave it out
of PostgREST's exposed schemas. Writes happen in `POST /api/submit` with the service-role
key, server-side only.

```sql
revoke all on schema intake from anon, authenticated;
revoke all on all tables in schema intake from anon, authenticated;
```

**The service-role key is never sent to the browser.** It lives in a Vercel environment
variable read only inside `api/`. The anon key may ship in the client.

### 12.3 `POST /api/submit`

Validate `form` against the enum and reject unknown fields. Rate-limit per IP hash.
Add a Turnstile or hCaptcha token check before this is publicly linked — an unprotected
public insert endpoint on a site about commercial real estate will be found and abused.
Hash IPs with a server-side salt; do not store raw addresses.

### 12.4 Reading submissions

`CLAUDE.md` is right that *"a database nobody checks is worse than the current `mailto:`."*
Ship at least one of these **with** Phase 3:

1. An email notification per submission (Resend/Postmark from the same function). Lowest effort, highest reliability.
2. A Supabase Auth–gated `/admin/` view over `intake.submissions`.

Option 1 first. Option 2 when volume justifies it.

### 12.5 Audit

```sql
create schema if not exists audit;

create table audit.record_changes (
  id          bigserial primary key,
  table_name  text not null,
  record_id   uuid,
  operation   text not null,             -- INSERT | UPDATE | DELETE
  changed_by  uuid references auth.users(id),
  diff        jsonb,
  changed_at  timestamptz not null default now()
);
create index on audit.record_changes (table_name, record_id, changed_at desc);
```

Attach a generic trigger to `facts`, `sources`, `brands`, `properties`, `transactions` and
`listings`. On a site whose product is accuracy, "who changed this number and when" is not
optional.

---

## 13. Mapping from the current JSON

| Current | Becomes |
|---|---|
| `sources.json` (108 entries) | `sources`, keyed by the same string |
| `brands[].{slug,name,hq,founded,parent,ownership,franchiseModel,momentum}` | `brands` columns |
| `brands[].tags[]` | `tags` + `brand_tags` |
| `brands[].stats{}` (33 sparse keys) | `facts` rows, `subject_type='brand'` |
| `brands[].metrics{}` | `facts` rows flagged `derivation='derived'` where `*Derived` is true |
| `brands[].realEstate{}` | `brand_cap_rates` + `entity_notes(kind='real_estate_note')` |
| `brands[].pipeline[]` | `entity_notes(kind='pipeline')` |
| `brands[].analysis` | `brands.analysis_md` → Sanity `brandAnalysis` in Phase 5 |
| `operators[]` | `companies` (`kind='operator'`) + `company_roles` |
| `operators[].chickenBrands[]` | `brand_operators` — **FK, replacing fuzzy matching** |
| `operators[].brands[]` (incl. non-chicken, non-restaurant) | `brands` rows with `is_chicken=false` and the right `sector` + `brand_operators` |
| `operators[].{chickenUnits,totalUnits}` | `facts` rows, `subject_type='company'` |
| `operators[].facts[]` | `entity_notes(kind='operator_fact')` |
| `markets[]` | `markets`; `activity[]`/`watch[]` → `entity_notes` |
| `news[]` | `articles(kind='news')` + `article_entities` + `article_sources` |
| `research[]` | `articles(kind='research')`, sections → `body` jsonb |
| `datacenter[]` | `chart_series` + `chart_points` + `chart_sources` |
| `consumer.publishedRankings[]` | `published_rankings` + `published_ranking_items` |
| `consumer.context[]` | `entity_notes(kind='consumer_context', subject_type='category')` |
| `events[]` | `industry_events` |
| `expansion[]` | `expansion_agreements` |
| `movement.openings[]` / `.closures[]` (individual) | `property_occupancies` + `properties` |
| `movement.closures[]` (aggregate, e.g. 312 KFC) | `facts` rows against the brand |
| `transactions.property[]` | `transactions(subject='property')` + `transaction_properties` |
| `transactions.corporate[]` | `transactions(subject='company')` |
| `transactions.property[]` where `type='Listing'` | `listings` |
| `realestate.benchmarks[]` | `facts`, `subject_type='category'` |
| `realestate.brandCapRates[]` | `brand_cap_rates` |
| `realestate.leaseIntel[]` / `.supply[]` / `.marketConditions[]` | `entity_notes` |
| Form definitions in `pages/*.js` | `intake.submissions` + typed projections |

### 13.1 The round-trip gate

**This is the mechanism that guarantees the site does not break.**

```
data/*.json  →  scripts/db-import.js  →  Postgres  →  scripts/export-data.js  →  data/*.json
```

`scripts/db-roundtrip-check.js` runs the loop and deep-compares before and after,
key-order-insensitive. It must report **zero differences** other than an explicitly
allowed list (e.g. snake_case metric keys, which the exporter maps back).

The migration does not proceed past Phase 2 until:

- `db-roundtrip-check.js` passes clean
- `npm test` still reports **75 pages**, links resolving, footnotes anchored, sitemap complete
- `git diff --stat data/` after a full export is **empty**

That last one is the strongest possible statement: the database reproduces the current
dataset byte-for-byte. Until it does, the database is not ready to be upstream.

---

## 14. Migration phases

Each phase is independently shippable and leaves the site working.

**Phase 0 — Provision.** Create the Supabase project. No Vercel CLI step is needed: the
repository is already connected to Vercel, and Supabase is provisioned on its own rather
than through the Vercel Marketplace, so there is nothing to `vercel link`.

Extensions are enabled in SQL, so they are part of migration `0001` rather than a console
task. The only genuinely manual step is adding `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` to the Vercel project's environment variables — and that is
**not needed until Phase 3**, when `api/` first reads them. Phases 1 and 2 need no Vercel
change at all.

*Requires the account owner. See `db/PROVISIONING.md` for the click-by-click.*

**Phase 1 — Schema.** `supabase/migrations/0001_init.sql` … `0007_rls.sql`. Nothing reads
it. Site untouched. Verify: migrations apply to a clean database and `supabase db reset`
succeeds.

**Phase 2 — Import and round-trip.** `scripts/db-import.js`, `scripts/export-data.js`,
`scripts/db-roundtrip-check.js`. Gate as §13.1. Site still builds from committed JSON.
**Highest-value phase and the one to get exactly right.**

**Phase 3 — Forms.** `api/submit.js`, `intake` tables, `/privacy/` page, email
notification. Update `assets/js/site.js` to `POST` and fall back to the existing `mailto:`
behaviour if the request fails, so a function outage degrades to today's behaviour rather
than losing a lead. **This is the phase that closes the real gap.**

**Phase 4 — Flip the direction.** `data/*.json` becomes generated-and-committed; editing
moves to the database. Add `npm run db:export`. Document in `CLAUDE.md` that `data/` is no
longer hand-edited.

**Phase 5 — Sanity.** Studio, document types, `api/sanity-webhook.js`, deploy hook.

**Phase 6 — Product on top.** Marketplace listings served from `listings`; buyer matching
against `intake.buy_criteria`; job board; newsletter issues; saved searches and alerts.

---

## 15. Designed for, not yet built

Modelled or trivially extensible, so none of these needs a schema rewrite:

- **Marketplace listings** — `listings`, `listing_properties` (Phase 6, tables exist)
- **Buyer matching** — `intake.buy_criteria` is typed and indexed for exactly this
- **Job board** — `job_postings` exists; the empty state stays correct meanwhile
- **Newsletter** — `newsletter_issues` + `intake.subscriptions` with double opt-in
- **Saved searches / alerts** — a `watchlists` table keyed to contacts and a filter jsonb
- **Portfolio and franchisee-level analytics** — `brand_operators` + `facts` already support "which operators are exposed to KFC"
- **Geographic analysis** — `properties.geog` (PostGIS) plus `markets.cbsa_code`
- **Time series and back-testing** — `facts` supersession plus `brand_scores` snapshots
- **Site search** — `search_tsv` on `articles`; extend to entities to replace `assets/search-index.json`
- **Public API / data licensing** — PostgREST is already there; `/advertise/` lists "Data access" as inventory

Deliberately **not** modelled: menu items and pricing, store-level sales, franchise
disclosure document economics, and consumer survey panels. Each is a real dataset with its
own sourcing problem, and speculative tables for them would be the bloat this exercise is
meant to avoid.

---

## 16. Open decisions for the owner

1. **Supabase region** — `us-east-1` unless there is a reason otherwise.
2. **Should `data/*.json` stay committed after Phase 4?** Recommended yes: it keeps the Vercel build dependency-free and offline-reproducible, and gives a git history of every data change for free.
3. **Property geocoding provider** — needed to populate `geog`. Census Geocoder is free and adequate for US addresses.
4. **Email provider for notifications and the newsletter** — Resend is the lightest fit.
5. **Turnstile vs hCaptcha** on public forms. Cloudflare Turnstile if the domain is already on Cloudflare.
