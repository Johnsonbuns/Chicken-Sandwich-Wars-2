-- 0008_intake.sql
-- Form submissions, leads and consent. All PII lives here and nowhere else.
--
-- This schema is deliberately NOT exposed to PostgREST (see 0010). Browser code never
-- touches it; writes go through POST /api/submit holding the service-role key
-- server-side. That is easier to reason about than insert-only RLS on a PII table.

create schema if not exists intake;

create type intake.form_kind as enum ('sell_property','buy_criteria','submit_deal','contact','newsletter');

create type intake.submission_status as enum ('new','triaged','contacted','qualified','converted','spam','closed');

create type intake.subscription_status as enum ('pending','subscribed','unsubscribed','bounced','complained');

create table intake.contacts (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  first_name        text,
  last_name         text,
  full_name         text,
  phone             text,
  company           text,
  role              text,
  -- Consent is per purpose. Requesting a confidential valuation is not permission to
  -- send a newsletter; that distinction is what keeps the list deliverable.
  marketing_consent boolean not null default false,
  consent_at        timestamptz,
  consent_source    intake.form_kind,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  deleted_at        timestamptz
);
create index contacts_active_idx on intake.contacts (email) where deleted_at is null;

create table intake.submissions (
  id             uuid primary key default gen_random_uuid(),
  form           intake.form_kind not null,
  contact_id     uuid references intake.contacts(id),
  -- Stored exactly as received and never edited. Triage happens in status and the
  -- typed projections, so renaming a form field later cannot corrupt history.
  payload        jsonb not null,
  status         intake.submission_status not null default 'new',
  assigned_to    uuid references auth.users(id),
  internal_notes text,

  -- Request metadata for abuse handling. The IP is hashed with a server-side salt;
  -- the raw address is never stored.
  ip_hash        text,
  user_agent     text,
  referer        text,
  utm            jsonb,
  spam_score     numeric(4,2),

  converted_property_id    uuid references public.properties(id),
  converted_listing_id     uuid references public.listings(id),
  converted_transaction_id uuid references public.transactions(id),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index submissions_triage_idx on intake.submissions (form, status, created_at desc);
create index submissions_contact_idx on intake.submissions (contact_id);
create index submissions_payload_idx on intake.submissions using gin (payload);
create trigger submissions_updated before update on intake.submissions
  for each row execute function public.set_updated_at();

-- Typed projection of the buy form. jsonb alone cannot be indexed for matching, and
-- matching buyers to listings is the entire point of collecting this.
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
create index buy_criteria_match_idx on intake.buy_criteria (price_max_usd, cap_rate_min_pct)
  where is_active;

create table intake.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references intake.contacts(id) on delete cascade,
  list_key        citext not null default 'chicken-wire',
  -- Double opt-in from the first row. Retrofitting it once a list exists is painful.
  status          intake.subscription_status not null default 'pending',
  confirmed_at    timestamptz,
  confirm_token   text,
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (contact_id, list_key)
);
