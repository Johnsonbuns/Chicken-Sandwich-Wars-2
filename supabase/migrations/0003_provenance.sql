-- 0003_provenance.sql
-- The provenance layer. Every figure on the site resolves through here.
--
-- The editorial rule is that every figure carries a publisher, a URL and an as-of date,
-- and that an unpublished number renders as an em dash rather than an estimate. That
-- makes provenance per-field, not per-row: a brand's AUV and its unit count come from
-- different publishers with different as-of dates. Hence facts rather than columns.

create table public.sources (
  id                       uuid primary key default gen_random_uuid(),
  key                      citext not null unique,
  publisher                text not null,
  title                    text not null,
  url                      text not null,
  date_label               text,
  published_on             date,
  source_type              source_type not null default 'trade_press',
  -- The seed figures were gathered where search worked but page fetches were blocked,
  -- so they came from search-result summaries rather than the primary documents. This
  -- flag turns that caveat into a work queue.
  verified_against_primary boolean not null default false,
  verified_at              timestamptz,
  verified_by              uuid,
  archive_url              text,
  accessed_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index sources_type_idx on public.sources (source_type);
create index sources_unverified_idx on public.sources (key) where verified_against_primary = false;
create trigger sources_updated before update on public.sources
  for each row execute function public.set_updated_at();

comment on column public.sources.key is
  'Stable string id (e.g. qsr50-2026-chicken). Footnotes, scripts/check.js and the
   downloadable dataset all depend on these, so they are preserved verbatim.';

-- Controlled vocabulary for facts. Without it, `auv`, `AUV` and `avg_unit_volume` all
-- coexist; with it, an unknown metric fails on the foreign key.
create table public.metrics (
  key              citext primary key,
  -- The exact key this metric had in data/*.json. Round-trip fidelity depends on a
  -- lookup, not a naming algorithm: snake_case cannot be reversed unambiguously
  -- (closuresTTM -> closures_ttm -> closuresTtm), so the original is stored.
  json_key         text unique,
  label            text not null,
  unit             metric_unit not null,
  display_format   text not null default 'auto',
  subject_types    text[] not null default '{brand}',
  description      text,
  is_scoring_input boolean not null default false,
  sort_order       int not null default 100
);

create table public.facts (
  id              uuid primary key default gen_random_uuid(),
  subject_type    subject_type not null,
  subject_id      uuid not null,
  metric_key      citext not null references public.metrics(key),

  value_numeric   numeric(20,4),
  value_text      text,
  unit            metric_unit not null,

  -- Period labels are preserved verbatim because the published values are not dates:
  -- 'FY2025', 'Jul 2025 - Jul 2026', '2025 FDD', 'YE2025 target'. Round-trip fidelity
  -- back to data/*.json depends on this column, not on the parsed dates beside it.
  period_label    text not null,
  period_start    date,
  period_end      date,
  as_of           date,

  source_id       uuid not null references public.sources(id),
  derivation      derivation not null default 'reported',
  derivation_note text,
  note            text,

  superseded_at   timestamptz,
  superseded_by   uuid references public.facts(id),
  created_at      timestamptz not null default now(),
  created_by      uuid,

  constraint facts_has_value check (value_numeric is not null or value_text is not null)
);

-- One current observation per subject x metric x period. Superseding rather than
-- updating means Q3 does not erase Q2 and a correction leaves a trail.
create unique index facts_current_uniq
  on public.facts (subject_type, subject_id, metric_key, period_label)
  where superseded_at is null;
create index facts_subject_idx on public.facts (subject_type, subject_id) where superseded_at is null;
create index facts_metric_idx  on public.facts (metric_key, period_end desc nulls last);
create index facts_source_idx  on public.facts (source_id);

create view public.v_current_facts as
  select * from public.facts where superseded_at is null;

comment on view public.v_current_facts is
  'Facts filtered to the current observation. Read this, not facts, unless you need history.';

-- Six structurally identical arrays in the current JSON collapse here: brand pipeline,
-- operator facts, market activity, lease intel, supply notes and consumer context are
-- all sourced prose bullets attached to an entity.
create table public.entity_notes (
  id           uuid primary key default gen_random_uuid(),
  subject_type subject_type not null,
  subject_id   uuid not null,
  kind         note_kind not null,
  label        text,
  body_md      text not null,
  period_label text,
  as_of        date,
  -- Nullable only for market_watch: those are CSW's own open questions, not
  -- published claims, and are the one kind with nothing to cite.
  source_id    uuid references public.sources(id),
  ordinal      int not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint notes_need_source check (kind = 'market_watch' or source_id is not null)
);
create index entity_notes_subject_idx on public.entity_notes (subject_type, subject_id, kind, ordinal);
create trigger entity_notes_updated before update on public.entity_notes
  for each row execute function public.set_updated_at();
