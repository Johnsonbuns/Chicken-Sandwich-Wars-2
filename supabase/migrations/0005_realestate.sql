-- 0005_realestate.sql
-- Properties, and the events that touch them.
--
-- The organising idea: a property is an ENTITY, a transaction is an EVENT. Properties
-- exist before, between and after transactions. A newly built store that has never
-- traded is a property; a dark box awaiting a second-generation tenant is a property.
-- Deriving property identity from transaction rows only works if everything has traded.

create table public.properties (
  id                   uuid primary key default gen_random_uuid(),
  slug                 citext unique,

  address_line1        text,
  address_line2        text,
  city                 text,
  state                text,
  postal_code          text,
  county               text,
  country              text not null default 'US',
  address_normalized   text,
  geog                 extensions.geography(Point,4326),
  parcel_apn           text,
  market_id            uuid references public.markets(id),
  location_label       text,

  building_sqft        int,
  lot_acres            numeric(10,3),
  year_built           int,
  year_renovated       int,
  drive_thru_lanes     int,
  seat_count           int,
  prototype_note       text,

  status               property_status not null default 'operating',
  is_second_generation boolean not null default false,
  prior_use            text,

  -- A property submitted through the sell form is not the same kind of record as one
  -- the desk sourced. Without this split, form submissions silently contaminate the
  -- editorial dataset the whole site's credibility rests on.
  record_source        record_source not null default 'editorial',
  verification         verification_state not null default 'unverified',
  verified_at          timestamptz,
  verified_by          uuid,
  is_published         boolean not null default false,

  source_id            uuid references public.sources(id),
  notes_md             text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index properties_geog_idx   on public.properties using gist (geog);
create index properties_market_idx on public.properties (market_id);
create index properties_status_idx on public.properties (status) where is_published;
create index properties_apn_idx    on public.properties (state, parcel_apn) where parcel_apn is not null;
create unique index properties_addr_uniq
  on public.properties (address_normalized, city, state)
  where address_normalized is not null;
create trigger properties_updated before update on public.properties
  for each row execute function public.set_updated_at();

comment on column public.properties.address_normalized is
  'Uppercased, abbreviations expanded, unit stripped. Two rows are the same property
   when they are the same parcel, not when their address strings match - and the seed
   data contains values like "Not disclosed".';

-- Tenancy over time. A former KFC reopening as a Dave's is the SAME property with a
-- new occupant; if brand_id were a column on properties, the second-generation story
-- the site is built on would be unrepresentable.
create table public.property_occupancies (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties(id) on delete cascade,
  brand_id            uuid references public.brands(id),
  operator_company_id uuid references public.companies(id),
  status              occupancy_status not null default 'open',
  opened_on           date,
  closed_on           date,
  occupied            daterange generated always as (daterange(opened_on, closed_on, '[)')) stored,
  closure_reason      closure_reason,
  detail_md           text,
  date_label          text,
  source_id           uuid references public.sources(id),
  created_at          timestamptz not null default now(),

  constraint occupancy_dates check (closed_on is null or opened_on is null or closed_on >= opened_on)
);

-- One tenant per property at a time. Needs btree_gist for the uuid equality operator.
alter table public.property_occupancies
  add constraint occupancy_no_overlap
  exclude using gist (property_id with =, occupied with &&)
  where (opened_on is not null);

create index occupancies_openings on public.property_occupancies (brand_id, opened_on desc);
create index occupancies_closures on public.property_occupancies (brand_id, closed_on desc)
  where closed_on is not null;

comment on table public.property_occupancies is
  'Individually located openings and closures only. Aggregates ("KFC closed 312 U.S.
   restaurants") are facts rows against the brand - they have no property and must not
   be invented one.';

-- Decomposes the free-text term field: "15-year corporate absolute-NNN ground lease"
-- is four separate facts, and the site reasons about all four independently.
create table public.leases (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties(id) on delete cascade,
  tenant_company_id    uuid references public.companies(id),
  brand_id             uuid references public.brands(id),
  structure            lease_structure,
  guarantee            lease_guarantee not null default 'unknown',
  commencement_on      date,
  expiration_on        date,
  initial_term_years   int,
  option_count         int,
  option_term_years    int,
  base_annual_rent_usd numeric(14,2),
  escalation_pct       numeric(5,2),
  escalation_years     int,
  escalation_note      text,
  rent_schedule        jsonb,
  term_label           text,
  source_id            uuid references public.sources(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index leases_property_idx on public.leases (property_id);
create index leases_expiry_idx   on public.leases (expiration_on);
create trigger leases_updated before update on public.leases
  for each row execute function public.set_updated_at();

comment on column public.leases.term_label is
  'The published phrasing, kept so nothing is lost in decomposition. The site can render
   the original while queries use the parsed columns.';

-- One table, not the current property/corporate split. A franchisee portfolio deal is a
-- corporate transaction that conveys properties, and the site renders both together.
create table public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  slug               citext unique,
  kind               transaction_kind not null,
  subject            transaction_subject not null,

  announced_on       date,
  closed_on          date,
  date_label         text not null,

  price_usd          numeric(16,2),
  is_price_disclosed boolean not null default true,
  cap_rate_pct       numeric(5,2),
  noi_usd            numeric(14,2),
  unit_count         int,

  buyer_company_id   uuid references public.companies(id),
  seller_company_id  uuid references public.companies(id),
  target_company_id  uuid references public.companies(id),
  brand_id           uuid references public.brands(id),

  location_label     text,
  term_label         text,
  detail_md          text,
  source_id          uuid not null references public.sources(id),
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint tx_corporate_has_target
    check (subject <> 'company' or target_company_id is not null or brand_id is not null)
);
create index transactions_kind_idx on public.transactions (kind, closed_on desc nulls last);
create index transactions_brand_idx on public.transactions (brand_id);
create trigger transactions_updated before update on public.transactions
  for each row execute function public.set_updated_at();

-- Many-to-many, and both directions are already exercised by the seed data: one row is
-- a Four Corners portfolio buy of two Popeyes properties, and two more have undisclosed
-- locations, so they link to zero properties rather than a fabricated one.
create table public.transaction_properties (
  transaction_id      uuid not null references public.transactions(id) on delete cascade,
  property_id         uuid not null references public.properties(id) on delete cascade,
  allocated_price_usd numeric(14,2),
  primary key (transaction_id, property_id)
);

create table public.listings (
  id                        uuid primary key default gen_random_uuid(),
  slug                      citext unique,
  headline                  text not null,
  summary_md                text,
  status                    listing_status not null default 'draft',

  asking_price_usd          numeric(14,2),
  cap_rate_pct              numeric(5,2),
  noi_usd                   numeric(14,2),
  is_price_on_request       boolean not null default false,

  broker_company_id         uuid references public.companies(id),
  authorization_on_file     boolean not null default false,
  authorization_received_on date,

  listed_on                 date,
  expires_on                date,
  closed_transaction_id     uuid references public.transactions(id),
  origin_submission_id      uuid,

  published_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- "CSW does not list a property without the owner's written authorization" is on the
  -- page today. It belongs in the schema, not only in the copy.
  constraint listing_requires_authorization
    check (status not in ('active','under_contract') or authorization_on_file)
);
create index listings_status_idx on public.listings (status, listed_on desc);
create trigger listings_updated before update on public.listings
  for each row execute function public.set_updated_at();

create table public.listing_properties (
  listing_id  uuid not null references public.listings(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  primary key (listing_id, property_id)
);

create table public.expansion_agreements (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id),
  operator_company_id uuid references public.companies(id),
  market_id           uuid references public.markets(id),
  market_label        text not null,
  unit_count          int,
  units_label         text,
  announced_on        date,
  announced_label     text not null,
  timeline_note       text,
  status              agreement_status not null default 'announced',
  source_id           uuid not null references public.sources(id),
  is_published        boolean not null default true,
  created_at          timestamptz not null default now()
);
create index expansion_brand_idx on public.expansion_agreements (brand_id);
