-- 0006_content.sql
-- Editorial content. Becomes the Sanity mirror in Phase 5; Postgres stays canonical so
-- article_entities can be a real foreign key and footnote integrity stays enforceable.

create table public.articles (
  id                 uuid primary key default gen_random_uuid(),
  sanity_document_id text unique,
  slug               citext not null unique,
  kind               article_kind not null,
  category           text,
  title              text not null,
  dek                text,
  body               jsonb,
  body_md            text,
  means_md           text,
  read_minutes       int,
  date_label         text,
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
create index articles_pub_idx on public.articles (kind, published_at desc) where status = 'published';
create trigger articles_updated before update on public.articles
  for each row execute function public.set_updated_at();

comment on column public.articles.means_md is
  'The "what it means" analysis carried by every news item. Editorial, not reported.';

create table public.article_entities (
  article_id   uuid not null references public.articles(id) on delete cascade,
  subject_type subject_type not null,
  subject_id   uuid not null,
  relation     text not null default 'about',
  primary key (article_id, subject_type, subject_id)
);

create table public.article_sources (
  article_id uuid not null references public.articles(id) on delete cascade,
  source_id  uuid not null references public.sources(id),
  ordinal    int not null default 0,
  primary key (article_id, source_id)
);

create table public.chart_series (
  id                 uuid primary key default gen_random_uuid(),
  key                citext not null unique,
  title              text not null,
  chart_kind         chart_kind not null,
  unit               metric_unit not null,
  note_md            text,
  -- When set, points are computed from facts rather than stored, so a chart tracking a
  -- metric the database already holds does not duplicate it.
  derived_metric_key citext references public.metrics(key),
  is_published       boolean not null default true,
  sort_order         int not null default 100
);

create table public.chart_points (
  series_id uuid not null references public.chart_series(id) on delete cascade,
  ordinal   int not null,
  label     text not null,
  value     numeric not null,
  brand_id  uuid references public.brands(id),
  primary key (series_id, ordinal)
);

create table public.chart_sources (
  series_id uuid not null references public.chart_series(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  primary key (series_id, source_id)
);

-- Third-party rankings CSW reports but does not author.
create table public.published_rankings (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  source_id    uuid not null references public.sources(id),
  method_md    text,
  published_on date,
  date_label   text,
  is_published boolean not null default true
);

create table public.published_ranking_items (
  ranking_id uuid not null references public.published_rankings(id) on delete cascade,
  ordinal    int not null,
  label      text not null,
  brand_id   uuid references public.brands(id),
  primary key (ranking_id, ordinal)
);

create table public.industry_events (
  id           uuid primary key default gen_random_uuid(),
  slug         citext unique,
  name         text not null,
  starts_on    date,
  ends_on      date,
  date_label   text not null,
  city         text,
  state        text,
  location_label text,
  venue        text,
  url          text,
  why_md       text,
  source_id    uuid references public.sources(id),
  is_published boolean not null default true
);

-- The job board renders an empty state today. Modelled now so it needs no migration
-- the day a first role is posted; the empty state stays correct meanwhile.
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

create table public.newsletter_issues (
  id              uuid primary key default gen_random_uuid(),
  number          int unique,
  slug            citext unique,
  subject         text not null,
  article_id      uuid references public.articles(id),
  sent_at         timestamptz,
  recipient_count int,
  status          article_status not null default 'draft',
  created_at      timestamptz not null default now()
);
