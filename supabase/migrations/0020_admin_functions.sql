-- 0020_admin_functions.sql
--
-- What the dashboard reads that RLS alone cannot give it.
--
-- The design rule for api/admin.js is that it holds no key more privileged than the
-- publishable anon key: every request carries the signed-in user's own JWT, so Postgres
-- decides what they may see. Two things sit outside that - intake (PII, revoked from
-- every browser role and deliberately not exposed to PostgREST) and audit (the change
-- log). Rather than exposing either schema, they are reached through security definer
-- functions in public that check is_staff() first. The schema stays closed; the desk
-- still gets its inbox and its history.
--
-- This is also the answer to the gap db/SCHEMA.md left open in 12.4: "an email
-- notification per submission, or a Supabase Auth-gated /admin/ view over
-- intake.submissions. Option 1 first. Option 2 when volume justifies it." This is
-- option 2, and it does not widen the PII surface by one row.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_profiles p
                  where p.user_id = auth.uid() and p.role = 'admin');
$$;

-- Staff need to see each other: "reviewed by" is a name, not a uuid.
create policy staff_read_all on public.staff_profiles for select to authenticated
  using (public.is_staff());

-- Onboarding the second person should not require the SQL editor. Only an admin, and
-- an admin cannot remove their own admin rights by accident - the last one is pinned.
create policy admin_manage_staff on public.staff_profiles for insert to authenticated
  with check (public.is_admin());
create policy admin_update_staff on public.staff_profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.staff_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE' or new.role <> 'admin') and old.role = 'admin'
     and (select count(*) from public.staff_profiles where role = 'admin') <= 1 then
    raise exception 'the last admin cannot be removed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger staff_profiles_guard before update or delete on public.staff_profiles
  for each row execute function public.staff_guard();

-- ---------------------------------------------------------------------------
-- Leads: the intake inbox, read without exposing the schema that holds it.
-- ---------------------------------------------------------------------------
create or replace function public.lead_list(
  p_status text default null, p_form text default null,
  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out_j jsonb;
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into out_j from (
    select s.id, s.form::text, s.status::text, s.payload, s.created_at, s.internal_notes,
           s.referer, s.utm, c.email::text as email, c.full_name, c.phone, c.company
      from intake.submissions s
      left join intake.contacts c on c.id = s.contact_id
     where (p_status is null or s.status::text = p_status)
       and (p_form is null or s.form::text = p_form)
     order by s.created_at desc
     limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)) x;
  return out_j;
end $$;

create or replace function public.lead_update(p_id uuid, p_status text default null,
                                              p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare out_j jsonb;
begin
  if not public.can_edit() then raise exception 'not authorised' using errcode = '42501'; end if;
  update intake.submissions
     set status = coalesce(p_status::intake.submission_status, status),
         internal_notes = coalesce(p_note, internal_notes)
   where id = p_id
  returning jsonb_build_object('id', id, 'status', status::text) into out_j;
  if out_j is null then raise exception 'no such submission' using errcode = '02000'; end if;
  return out_j;
end $$;

-- ---------------------------------------------------------------------------
-- History. audit.record_changes answers "who changed this number and when"; without a
-- way to read it from the dashboard that promise is only theoretical.
-- ---------------------------------------------------------------------------
create or replace function public.record_history(p_table text, p_id uuid, p_limit int default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out_j jsonb;
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x.changed_at desc), '[]'::jsonb) into out_j from (
    select c.id, c.operation, c.diff, c.changed_at, c.changed_by,
           p.full_name as changed_by_name
      from audit.record_changes c
      left join public.staff_profiles p on p.user_id = c.changed_by
     where c.table_name = p_table and (p_id is null or c.record_id = p_id)
     order by c.changed_at desc limit greatest(1, least(p_limit, 200))) x;
  return out_j;
end $$;

-- ---------------------------------------------------------------------------
-- The overview screen, as one round trip. Seven counts over five tables is a lot of
-- HTTP for a page that has to feel instant.
-- ---------------------------------------------------------------------------
create or replace function public.desk_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pending',        (select count(*) from public.review_items where status = 'pending'),
    'needs_verification', (select count(*) from public.review_items where status = 'needs_verification'),
    'applied_7d',     (select count(*) from public.review_items
                        where status = 'applied' and applied_at > now() - interval '7 days'),
    'rejected_7d',    (select count(*) from public.review_items
                        where status = 'rejected' and reviewed_at > now() - interval '7 days'),
    'open_matches',   (select count(distinct item_id) from public.review_item_matches m
                        where m.resolution = 'unresolved'
                          and exists (select 1 from public.review_items i
                                       where i.id = m.item_id
                                         and i.status in ('pending','needs_verification'))),
    'agent_runs_7d',  (select count(*) from public.review_batches
                        where kind = 'agent' and started_at > now() - interval '7 days'),
    'open_batches',   (select count(*) from public.review_batches where status = 'open'),
    'new_leads',      (select count(*) from intake.submissions where status = 'new'),
    'leads_7d',       (select count(*) from intake.submissions
                        where created_at > now() - interval '7 days'),
    -- The provenance caveat in CLAUDE.md, as a number that can go down.
    'unverified_sources', (select count(*) from public.sources where not verified_against_primary),
    'sources_total',  (select count(*) from public.sources),
    'internal_records', (select count(*) from public.facts where visibility <> 'public')
                        + (select count(*) from public.properties where visibility <> 'public')
                        + (select count(*) from public.leases where visibility <> 'public')
                        + (select count(*) from public.transactions where visibility <> 'public'),
    'stale_figures',  (select count(*) from public.facts
                        where superseded_at is null and as_of < current_date - interval '400 days')
  );
end $$;

comment on function public.desk_stats() is
  'Everything the overview screen shows, in one call.';

-- ---------------------------------------------------------------------------
-- Browsing canonical data. Whitelisted through review_targets exactly like writing is,
-- so the dashboard cannot read a table the queue cannot write - one list, not two.
-- ---------------------------------------------------------------------------
create or replace function public.desk_records(
  p_table text, p_q text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare tgt public.review_targets; out_j jsonb; where_sql text := 'true'; label_col text;
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into tgt from public.review_targets where table_name = p_table;
  if not found then raise exception 'unknown table %', p_table using errcode = '22023'; end if;

  -- Confidential rows stay behind can_see_confidential(), the same rule RLS applies.
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = p_table::regclass and a.attname = 'visibility'
                and a.attnum > 0 and not a.attisdropped)
     and not public.can_see_confidential() then
    where_sql := 't.visibility <> ''confidential''';
  end if;

  if p_q is not null and length(p_q) > 0 then
    label_col := coalesce(tgt.identity_columns[1], 'id');
    where_sql := where_sql || format(' and (%s) ilike %L', tgt.label_expression, '%' || p_q || '%');
  end if;

  execute format(
    'select coalesce(jsonb_agg(x order by x.ord), ''[]''::jsonb) from (
       select t.id, %s as label, to_jsonb(t) as row,
              row_number() over (order by t.%s desc nulls last) as ord
         from %I.%I t where %s
        order by t.%s desc nulls last limit %s offset %s) x',
    tgt.label_expression,
    case when exists (select 1 from pg_catalog.pg_attribute a
                       where a.attrelid = p_table::regclass and a.attname = 'created_at'
                         and a.attnum > 0 and not a.attisdropped)
         then 'created_at' else 'id' end,
    split_part(p_table, '.', 1), split_part(p_table, '.', 2), where_sql,
    case when exists (select 1 from pg_catalog.pg_attribute a
                       where a.attrelid = p_table::regclass and a.attname = 'created_at'
                         and a.attnum > 0 and not a.attisdropped)
         then 'created_at' else 'id' end,
    greatest(1, least(p_limit, 200)), greatest(0, p_offset))
  into out_j;
  return out_j;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding a colleague.
--
-- auth.users is not readable from a browser role and should not be, so granting desk
-- access by email happens here. The person has to have signed in once - that is what
-- creates the auth.users row - and an admin then grants them a role.
--
-- There is deliberately no function that makes the FIRST admin. Anything that turns an
-- arbitrary signed-in user into an admin is a door, however narrow, and this project
-- has exactly one moment where it would be used. The dashboard prints the one line of
-- SQL to run instead; db/ADMIN.md has it too.
-- ---------------------------------------------------------------------------
create or replace function public.staff_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out_j jsonb;
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into out_j from (
    select p.user_id, p.role::text, p.full_name, p.created_at, u.email::text as email,
           u.last_sign_in_at
      from public.staff_profiles p join auth.users u on u.id = p.user_id) x;
  return out_j;
end $$;

create or replace function public.grant_staff(p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'no account for % — they need to sign in once first', p_email
      using errcode = '02000';
  end if;
  insert into public.staff_profiles (user_id, role)
  values (uid, p_role::public.staff_role)
  on conflict (user_id) do update set role = excluded.role;
  return jsonb_build_object('user_id', uid, 'email', p_email, 'role', p_role);
end $$;

-- Who am I, and what may I do. One call, so the dashboard can decide what to render
-- before it draws anything.
create or replace function public.desk_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.staff_profiles;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.staff_profiles where user_id = auth.uid();
  return jsonb_build_object(
    'user_id', auth.uid(),
    'email', coalesce(auth.jwt() ->> 'email', ''),
    'role', coalesce(p.role::text, null),
    'full_name', p.full_name,
    'is_staff', public.is_staff(),
    'can_edit', public.can_edit(),
    'is_admin', public.is_admin(),
    'can_see_confidential', public.can_see_confidential());
end $$;

comment on function public.desk_me() is
  'Identity and capability in one call. Returns role null for a signed-in user with no
   desk access, which is what the dashboard shows the "ask an admin" screen for.';
