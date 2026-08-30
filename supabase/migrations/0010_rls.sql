-- 0010_rls.sql
-- Row level security.
--
-- Two audiences: anonymous readers, who see published rows only, and staff, who see and
-- write everything. The intake schema has no anonymous access at all and is not exposed
-- to PostgREST - writes reach it only through a server-side function holding the
-- service-role key, which bypasses RLS by design.

create table public.staff_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       staff_role not null default 'viewer',
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles p
    where p.user_id = auth.uid() and p.role in ('admin','editor','analyst')
  );
$$;

create or replace function public.can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles p
    where p.user_id = auth.uid() and p.role in ('admin','editor')
  );
$$;

-- facts and entity_notes are polymorphic, so their visibility follows whichever entity
-- they describe rather than a flag of their own.
create or replace function public.subject_is_published(st subject_type, sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case st
    when 'brand'    then exists (select 1 from public.brands     b where b.id = sid and b.is_published)
    when 'company'  then exists (select 1 from public.companies  c where c.id = sid and c.is_published)
    when 'property' then exists (select 1 from public.properties p where p.id = sid and p.is_published)
    when 'market'   then exists (select 1 from public.markets    m where m.id = sid and m.is_published)
    when 'listing'  then exists (select 1 from public.listings   l where l.id = sid and l.status = 'active')
    when 'category' then true   -- category-level figures are industry aggregates
    else false
  end;
$$;

-- 1. RLS on for every table in public. Default-deny until a policy says otherwise.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 2. Staff may do anything, on every table.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format($f$
      create policy staff_all on public.%I for all to authenticated
        using (public.is_staff()) with check (public.can_edit())
    $f$, t);
  end loop;
end $$;

-- 3. Anonymous reads, table by table.

-- Reference vocabularies and the source registry: public by nature. Footnotes cite
-- sources on every page, so an unreadable sources table breaks the editorial rule.
do $$
declare t text;
begin
  foreach t in array array['sources','metrics','tags','momentum_states',
                           'score_versions','score_components','score_adjustments']
  loop
    execute format('create policy anon_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Entities carrying their own flag.
do $$
declare t text;
begin
  foreach t in array array['brands','companies','markets','properties','transactions',
                           'chart_series','published_rankings','industry_events',
                           'expansion_agreements']
  loop
    execute format('create policy anon_read on public.%I for select to anon, authenticated using (is_published)', t);
  end loop;
end $$;

-- Status-gated tables.
create policy anon_read on public.articles for select to anon, authenticated
  using (status = 'published');
create policy anon_read on public.listings for select to anon, authenticated
  using (status in ('active','under_contract'));
create policy anon_read on public.job_postings for select to anon, authenticated
  using (status = 'active');
create policy anon_read on public.newsletter_issues for select to anon, authenticated
  using (status = 'published');

-- Polymorphic children.
create policy anon_read on public.facts for select to anon, authenticated
  using (superseded_at is null and public.subject_is_published(subject_type, subject_id));
create policy anon_read on public.entity_notes for select to anon, authenticated
  using (is_published and public.subject_is_published(subject_type, subject_id));

-- Children gated on their parent.
create policy anon_read on public.company_roles for select to anon, authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.is_published));
create policy anon_read on public.brand_tags for select to anon, authenticated
  using (exists (select 1 from public.brands b where b.id = brand_id and b.is_published));
create policy anon_read on public.brand_operators for select to anon, authenticated
  using (exists (select 1 from public.brands b where b.id = brand_id and b.is_published));
create policy anon_read on public.brand_cap_rates for select to anon, authenticated
  using (exists (select 1 from public.brands b where b.id = brand_id and b.is_published));
create policy anon_read on public.property_occupancies for select to anon, authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.is_published));
create policy anon_read on public.leases for select to anon, authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.is_published));
create policy anon_read on public.transaction_properties for select to anon, authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and t.is_published));
create policy anon_read on public.listing_properties for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.status in ('active','under_contract')));
create policy anon_read on public.article_entities for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_id and a.status = 'published'));
create policy anon_read on public.article_sources for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_id and a.status = 'published'));
create policy anon_read on public.chart_points for select to anon, authenticated
  using (exists (select 1 from public.chart_series s where s.id = series_id and s.is_published));
create policy anon_read on public.chart_sources for select to anon, authenticated
  using (exists (select 1 from public.chart_series s where s.id = series_id and s.is_published));
create policy anon_read on public.published_ranking_items for select to anon, authenticated
  using (exists (select 1 from public.published_rankings r where r.id = ranking_id and r.is_published));
create policy anon_read on public.brand_scores for select to anon, authenticated
  using (exists (select 1 from public.brands b where b.id = brand_id and b.is_published));
create policy anon_read on public.brand_score_components for select to anon, authenticated
  using (exists (select 1 from public.brand_scores s join public.brands b on b.id = s.brand_id
                 where s.id = brand_score_id and b.is_published));

-- staff_profiles: a user may read their own row; nothing is anonymous.
create policy own_profile on public.staff_profiles for select to authenticated
  using (user_id = auth.uid());

-- 4. intake: no anonymous or authenticated access whatsoever. The service-role key
--    bypasses RLS, which is exactly and only how POST /api/submit reaches these tables.
revoke all on schema intake from anon, authenticated;
revoke all on all tables in schema intake from anon, authenticated;
revoke all on all sequences in schema intake from anon, authenticated;
revoke all on all functions in schema intake from anon, authenticated;
alter default privileges in schema intake revoke all on tables from anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'intake'
  loop
    execute format('alter table intake.%I enable row level security', t);
  end loop;
end $$;

revoke all on schema audit from anon, authenticated;
revoke all on all tables in schema audit from anon, authenticated;
alter table audit.record_changes enable row level security;

comment on schema intake is
  'PII. Not exposed to PostgREST - keep it out of the API "Exposed schemas" setting.
   Reached only server-side with the service-role key.';
