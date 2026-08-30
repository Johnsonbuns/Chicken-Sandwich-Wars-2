-- 0014_import_corrections.sql
--
-- Corrections found by actually running the import against the schema. Each one is the
-- data telling us the model was slightly wrong, not the reverse.

-- 1. Ordering. The site renders news, research, rankings and events in file order, and
--    losing that order breaks the round-trip.
alter table public.articles           add column sort_index int not null default 0;
alter table public.published_rankings add column sort_order int not null default 0;

-- 2. Listings came from a transaction row of type 'Listing', which carries a brand, a
--    location, lease terms and a source. None of that had a home.
alter table public.listings add column brand_id       uuid references public.brands(id);
alter table public.listings add column source_id      uuid references public.sources(id);
alter table public.listings add column date_label     text;
alter table public.listings add column location_label text;
alter table public.listings add column term_label     text;

-- 3. expansion_agreements.operator is a mixed field. Some values are operator slugs
--    (eyas-capital, korpal-group), but others are descriptions that are not entities at
--    all: 'Company', 'Multiple franchisees', 'PizzaExpress (European master franchisee)'.
--    The label is what the site prints, so it has to survive whether or not it resolves.
alter table public.expansion_agreements add column operator_label text;

-- 4. Corporate transaction counterparties are descriptions, not companies:
--    'BOJ of WNC (120 Bojangles units, six states)', '28 KFC restaurants (NC/SC)',
--    'Five buyers', 'Two franchisee groups (Tampa- and Chicago-based)'. Requiring a
--    resolved company or brand was wrong; requiring that SOMETHING identifies the
--    subject is right.
alter table public.transactions add column target_label   text;
alter table public.transactions add column acquirer_label text;

alter table public.transactions drop constraint tx_corporate_has_target;
alter table public.transactions add constraint tx_corporate_has_target
  check (subject <> 'company'
         or target_company_id is not null
         or brand_id is not null
         or target_label is not null);

-- 5. Five brands publish a cap rate range with no source, and fifteen carry a written
--    real-estate note with none. Those are pre-existing gaps in data/, not import bugs:
--    per CLAUDE.md a stat whose src does not resolve renders silently without a
--    footnote, so they are invisible on the site today.
--
--    The schema must not invent a citation to satisfy a constraint, so the column
--    becomes nullable and the gap stays visible and queryable instead:
--
--      select b.slug from brand_cap_rates c join brands b on b.id = c.brand_id
--      where c.source_id is null;
--
--    The five are krispy-krunchy-chicken, bonchon, houston-tx-hot-chicken, hooters
--    and jollibee-us.
alter table public.brand_cap_rates alter column source_id drop not null;

-- A brand's real-estate note is CSW's own characterisation rather than a published
-- claim, so it joins market_watch as a kind that may stand without a citation.
alter table public.entity_notes drop constraint notes_need_source;
alter table public.entity_notes add constraint notes_need_source
  check (kind in ('market_watch','real_estate_note') or source_id is not null);

-- 6. Two rows in realestate.brandCapRates are not brands. "McDonald's (reference)" is a
--    comparison benchmark from outside the chicken category, and "Franchisee QSR (KFC,
--    Wingstop, Bojangles, Church's, Slim Chickens, Golden Chick and peers)" is an
--    aggregate across several. Both carry slug: null.
--
--    They belong in the desk's cap rate table regardless, so brand_id becomes optional
--    and the printed label is kept alongside it.
alter table public.brand_cap_rates alter column brand_id drop not null;
alter table public.brand_cap_rates add column brand_label text;
