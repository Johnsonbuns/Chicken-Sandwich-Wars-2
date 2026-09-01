-- intake_access.sql — who can reach the form submissions, and who cannot.
--
-- Run by supabase/validate.sh after the migrations. The rules here are the ones that
-- decide whether a lead is stored or silently lost: the service-role key must reach
-- the intake tables, and nothing else may. Both halves failed in production at once —
-- the schema was not exposed to PostgREST, and even once it was, `service_role` held
-- no privilege on it (fixed in 0021).

\set ON_ERROR_STOP on
\timing off

create or replace function ok(cond boolean, what text) returns void language plpgsql as $fn$
begin
  if cond then raise notice '    ok    %', what;
  else raise exception 'ASSERTION FAILED: %', what; end if;
end $fn$;

create or replace function refuses(sql text, what text) returns void language plpgsql as $fn$
begin
  begin
    execute sql;
  exception when others then
    raise notice '    ok    % (%)', what, left(sqlerrm, 60);
    return;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', what;
end $fn$;

-- ---------------------------------------------------------------------------
-- The service-role key: the only door into intake, and it has to open.
-- ---------------------------------------------------------------------------
-- Rolled back: review_flow.sql asserts on the exact contents of the lead inbox, and
-- these tests share one database with it. Proving the write is allowed is the point;
-- keeping the row is not.
begin;
do $$
declare n bigint; new_id uuid;
begin
  set local role service_role;

  -- api/submit.js reads before it writes: the rate-limit check is a select on
  -- submissions, so a missing grant fails there first.
  select count(*) into n from intake.submissions;
  perform ok(true, 'the service-role key can read intake.submissions');

  insert into intake.contacts (email, full_name)
    values ('lead@example.com', 'A Reader') returning id into new_id;
  perform ok(new_id is not null, 'and upsert a contact');

  insert into intake.submissions (form, contact_id, payload)
    values ('contact', new_id, '{"message":"a tip"}'::jsonb) returning id into new_id;
  perform ok(new_id is not null, 'and store the submission it came with');

  insert into intake.subscriptions (contact_id, list_key, status)
    values ((select id from intake.contacts where email = 'lead@example.com'),
            'chicken-wire', 'pending');
  perform ok(true, 'and record a newsletter subscription');

  reset role;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- And nobody else. Exposing the schema to PostgREST does not change these.
-- ---------------------------------------------------------------------------
select refuses('set local role anon; select count(*) from intake.submissions',
               'anon cannot read a submission');
select refuses('set local role anon; insert into intake.contacts (email) values (''x@y.z'')',
               'anon cannot write a contact');
select refuses('set local role authenticated; select count(*) from intake.contacts',
               'a signed-in user cannot read contacts either');
reset role;

-- The desk reads leads through a security definer function in public precisely so it
-- does not need any of the above.
do $$
begin
  perform ok(
    (select p.prosecdef from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'lead_list'),
    'the desk still reads leads through a security definer function');
end $$;
