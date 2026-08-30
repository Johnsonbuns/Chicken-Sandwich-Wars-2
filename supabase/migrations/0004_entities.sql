-- 0004_entities.sql
-- Identity and the relationships between entities.

-- Editorial vocabularies as rows, not enums: an unknown momentum value falls back to a
-- neutral badge on the site rather than erroring, and a new one should not need a migration.
create table public.momentum_states (
  key         citext primary key,
  label       text not null,
  badge_class text not null default 'neutral',
  sort_order  int not null default 100
);

create table public.tags (
  key   citext primary key,
  label text not null,
  kind  text not null default 'brand'
);

-- One companies table rather than an operators table, because the same real-world
-- entities appear in several roles: KBP operates 831 KFCs and acquires portfolios,
-- Roark is an investor, Four Corners is a REIT buyer, Yum! and RBI are franchisor
-- parents and transaction counterparties both.
create table public.companies (
  id           uuid primary key default gen_random_uuid(),
  slug         citext not null unique,
  name         text not null,
  legal_name   text,
  hq_city      text,
  hq_state     text,
  hq_country   text not null default 'US',
  hq_label     text,
  website      text,
  founded_year int,
  kind         company_kind not null,
  status       company_status,
  status_note  text,
  geography    text[],
  analysis_md  text,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index companies_kind_idx on public.companies (kind);
create index companies_name_trgm on public.companies using gin (name gin_trgm_ops);
create trigger companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

create table public.company_roles (
  company_id uuid not null references public.companies(id) on delete cascade,
  role       company_kind not null,
  primary key (company_id, role)
);

create table public.brands (
  id                 uuid primary key default gen_random_uuid(),
  slug               citext not null unique,
  name               text not null,
  legal_name         text,
  is_chicken         boolean not null default true,
  sector             brand_sector not null default 'restaurant',
  hq_city            text,
  hq_state           text,
  hq_country         text not null default 'US',
  hq_label           text,
  founded_year       int,
  parent_company_id  uuid references public.companies(id),
  parent_label       text,
  ownership_type     ownership_type,
  ownership_label    text,
  franchise_model_md text,
  momentum           citext references public.momentum_states(key),
  analysis_md        text,
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index brands_chicken_idx on public.brands (is_chicken) where is_published;
create index brands_name_trgm on public.brands using gin (name gin_trgm_ops);
create trigger brands_updated before update on public.brands
  for each row execute function public.set_updated_at();

comment on column public.brands.is_chicken is
  'False for the non-chicken brands operators also run (Taco Bell, Subway, 7-Eleven,
   Meineke, Take 5 Oil Change). Those exist so brand_operators can be a real foreign
   key; only chicken brands are published.';

create table public.brand_tags (
  brand_id uuid not null references public.brands(id) on delete cascade,
  tag_key  citext not null references public.tags(key),
  primary key (brand_id, tag_key)
);

-- Replaces the fuzzy string matching in build.js, which CLAUDE.md flags as fragile:
-- a renamed brand could silently drop its operator list. A foreign key cannot.
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

-- Cap rate intelligence attaches to the brand, not a property: it is the net-lease
-- market's pricing of that tenant's credit.
create table public.brand_cap_rates (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  low_pct       numeric(5,2),
  high_pct      numeric(5,2),
  mid_pct       numeric(5,2),
  range_label   text not null,
  structure     text,
  basis         text,
  period_label  text,
  as_of         date,
  source_id     uuid not null references public.sources(id),
  superseded_at timestamptz,
  created_at    timestamptz not null default now()
);
create index brand_cap_rates_current on public.brand_cap_rates (brand_id) where superseded_at is null;

create table public.markets (
  id           uuid primary key default gen_random_uuid(),
  slug         citext not null unique,
  name         text not null,
  state        text,
  cbsa_code    text,
  thesis_md    text,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger markets_updated before update on public.markets
  for each row execute function public.set_updated_at();
