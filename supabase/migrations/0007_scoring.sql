-- 0007_scoring.sql
-- The CSW Score as data rather than only as code.
--
-- lib/score.js hardcodes the formula, and CLAUDE.md warns that changing a weight means
-- updating /methodology/ and re-checking its prose. Versioned rows let the methodology
-- page render itself, and keep historical rankings reproducible instead of recomputed.

create table public.score_versions (
  version        int primary key,
  effective_from date not null,
  min_components int not null default 3,
  penalty_note   text,
  notes_md       text,
  is_current     boolean not null default false
);
create unique index score_versions_current on public.score_versions (is_current) where is_current;

create table public.score_components (
  version     int not null references public.score_versions(version) on delete cascade,
  key         citext not null,
  label       text not null,
  weight      numeric(5,2) not null,
  metric_key  citext not null references public.metrics(key),
  floor_value numeric not null,
  -- May be lower than floor_value: for cap rate, a lower number is stronger.
  ceil_value  numeric not null,
  floor_score numeric not null,
  ceil_score  numeric not null,
  description text not null,
  sort_order  int not null default 100,
  primary key (version, key)
);

create table public.score_adjustments (
  version    int not null references public.score_versions(version) on delete cascade,
  key        citext not null,
  label      text not null,
  metric_key citext references public.metrics(key),
  points     numeric(5,2) not null,
  condition  text not null,
  primary key (version, key)
);

create table public.brand_scores (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  version     int not null references public.score_versions(version),
  computed_at timestamptz not null default now(),
  as_of       date not null,
  rated       boolean not null,
  score       numeric(5,2),
  rank        int,
  coverage    int not null,
  penalty     numeric(5,2) not null default 0,
  unique (brand_id, version, as_of)
);
create index brand_scores_rank_idx on public.brand_scores (version, as_of, rank);

create table public.brand_score_components (
  brand_score_id uuid not null references public.brand_scores(id) on delete cascade,
  component_key  citext not null,
  raw_value      numeric,
  scaled_value   numeric(5,2) not null,
  weight         numeric(5,2) not null,
  primary key (brand_score_id, component_key)
);

comment on table public.brand_scores is
  'Snapshots, not a view. A brand with fewer than min_components available scores is
   not rated at all - that is the editorial rule in numeric form, not a data gap.';
