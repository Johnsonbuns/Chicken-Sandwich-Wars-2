-- 0016_confidentiality.sql
--
-- Public vs internal intelligence.
--
-- The site's editorial rule is about provenance, not secrecy: every published figure
-- carries a publisher, a URL and an as-of date. But a desk that talks to brokers and
-- operators accumulates figures it may hold and must not print - a rent roll shared in
-- confidence, an off-market asking price, a franchisee's own numbers. Today the only
-- switch is is_published, which conflates "not ready" with "never".
--
-- Three states, in increasing restriction:
--
--   public       may appear on the site once is_published / status says so
--   internal     staff-wide, informs analysis, never rendered
--   confidential restricted to admin and editor - under NDA or personally sourced
--
-- The important part is not the column, it is the constraint under it: a row that is
-- not public CANNOT be flagged published. Publication of confidential intelligence
-- becomes a database error rather than a thing to remember.

create type intel_visibility as enum ('public','internal','confidential');

comment on type intel_visibility is
  'public: publishable. internal: staff-wide, never rendered. confidential: admin/editor only.';

-- 1. The column, on every table that carries intelligence about the world. Reference
--    vocabularies (metrics, tags, momentum_states) and the source registry stay out:
--    a source citation is public by definition, and a metric key is not intelligence.
do $$
declare t text;
begin
  foreach t in array array['brands','companies','markets','properties','transactions',
                           'listings','leases','facts','entity_notes','system_movements',
                           'expansion_agreements','brand_cap_rates','property_occupancies',
                           'brand_operators','articles','industry_events','job_postings']
  loop
    execute format(
      'alter table public.%I add column visibility intel_visibility not null default ''public''', t);
    -- Partial: the overwhelming majority of rows are public, and the queries that care
    -- are "show me what is being withheld".
    execute format(
      'create index %I on public.%I (visibility) where visibility <> ''public''',
      t || '_visibility_idx', t);
  end loop;
end $$;

-- 2. Publication is impossible for anything not public. This is the load-bearing line.
do $$
declare t text;
begin
  foreach t in array array['brands','companies','markets','properties','transactions',
                           'system_movements','expansion_agreements','industry_events']
  loop
    execute format(
      'alter table public.%I add constraint %I check (not (is_published and visibility <> ''public''))',
      t, t || '_public_visibility');
  end loop;
end $$;

-- The status-gated tables say the same thing in their own vocabulary.
alter table public.listings add constraint listings_public_visibility
  check (status not in ('active','under_contract') or visibility = 'public');
alter table public.articles add constraint articles_public_visibility
  check (status <> 'published' or visibility = 'public');
alter table public.job_postings add constraint job_postings_public_visibility
  check (status <> 'active' or visibility = 'public');

-- entity_notes and facts have no is_published pair of their own for facts, and notes
-- carry one; both are read anonymously through a policy, tightened in step 4.

-- 3. Who may see confidential rows. Deliberately a separate function from can_edit()
--    even though the role list matches today: "may correct a figure" and "may read a
--    number given in confidence" are different questions and will diverge.
create or replace function public.can_see_confidential()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles p
    where p.user_id = auth.uid() and p.role in ('admin','editor')
  );
$$;

-- 4. Anonymous reads: every existing anon_read policy on a table that now carries a
--    visibility column gains "and visibility = 'public'", keeping whatever qualifier it
--    already had. Rewriting them from pg_get_expr rather than by hand means the tables
--    gated on a parent's is_published keep that gate exactly as written.
do $$
declare r record;
begin
  for r in
    select c.relname as tbl, pg_get_expr(p.polqual, p.polrelid) as qual
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and p.polname = 'anon_read'
      and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'visibility'
                    and a.attnum > 0 and not a.attisdropped)
  loop
    execute format('drop policy anon_read on public.%I', r.tbl);
    execute format(
      'create policy anon_read on public.%I for select to anon, authenticated
         using ((%s) and visibility = ''public'')', r.tbl, r.qual);
  end loop;
end $$;

-- 5. Staff reads: an analyst sees internal, not confidential.
do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'visibility'
                       and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format($f$
      create policy staff_all on public.%I for all to authenticated
        using (public.is_staff()
               and (visibility <> 'confidential' or public.can_see_confidential()))
        with check (public.can_edit()
               and (visibility <> 'confidential' or public.can_see_confidential()))
    $f$, t);
  end loop;
end $$;

-- 6. A view runs with its owner's rights, so RLS on the table underneath it does not
--    apply to the caller. v_current_facts is owned by the migration runner and exposed
--    through PostgREST like any other relation, which means an anonymous request for it
--    has been able to read unpublished facts since 0003 - the RLS policy on facts never
--    saw the query. security_invoker pushes the check back onto the caller.
--
--    This was a leak before this migration. It would be a much worse one after it.
alter view public.v_current_facts set (security_invoker = true);

comment on view public.v_current_facts is
  'Facts filtered to the current observation. Read this, not facts, unless you need
   history. security_invoker: RLS is evaluated as the caller, not the view owner.';
