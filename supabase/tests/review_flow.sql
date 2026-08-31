-- review_flow.sql — end to end exercise of the review queue.
--
-- Run by supabase/validate.sh after the migrations, against a throwaway database.
-- Every assertion here is a rule the design depends on, and each one is stated as a
-- question a reviewer would ask: does approving actually write the record? does a
-- correction preserve what was published before it? can a proposal touch a column
-- nobody allowed?
--
-- auth.uid() is a stub locally (validate.sh creates it). Redefining it is how this
-- script changes identity; on Supabase it reads the JWT and cannot be redefined.

\set ON_ERROR_STOP on
\timing off

create or replace function test_as(p uuid) returns void language plpgsql as $fn$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as
                  $q$ select %L::uuid $q$', p);
end $fn$;

create or replace function ok(cond boolean, what text) returns void language plpgsql as $fn$
begin
  if cond then raise notice '    ok    %', what;
  else raise exception 'ASSERTION FAILED: %', what; end if;
end $fn$;

-- Fails unless the statement raises. Used for the rules that must be impossible.
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
-- Fixtures
-- ---------------------------------------------------------------------------
-- 0011 already seeds the metric vocabulary, so the fixtures tolerate what is there.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'editor@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'outsider@example.com')
  on conflict do nothing;
insert into public.staff_profiles (user_id, role, full_name)
  values ('11111111-1111-1111-1111-111111111111', 'admin', 'Desk Editor')
  on conflict do nothing;

insert into public.sources (id, key, publisher, title, url)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'qsr-test-2026', 'QSR Magazine',
          'Test source', 'https://example.com/qsr')
  on conflict do nothing;
insert into public.metrics (key, json_key, label, unit)
  values ('auv_usd', 'auvUsd', 'Average unit volume', 'usd')
  on conflict do nothing;
insert into public.brands (id, slug, name, is_chicken, is_published)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'popeyes', 'Popeyes Louisiana Kitchen', true, true)
  on conflict do nothing;
insert into public.companies (id, slug, name, kind, is_published)
  values ('cccccccc-0000-0000-0000-000000000001', 'kbp-brands', 'KBP Brands', 'operator', true)
  on conflict do nothing;

do $$ begin perform test_as('11111111-1111-1111-1111-111111111111'); end $$;

-- ---------------------------------------------------------------------------
do $$
declare r jsonb; v_item uuid; rec_id uuid; n int; f1 uuid; f2 uuid;
begin
raise notice '  review queue';

-- 1. A proposal citing a URL that is not yet a source record.
r := public.review_submit(jsonb_build_object(
  'batch', jsonb_build_object('title', 'Desk entry', 'ref', 'test-run-1'),
  'items', jsonb_build_array(jsonb_build_object(
    'target_table', 'public.transactions',
    'title', 'Popeyes ground lease, Tampa FL',
    'entity_label', 'Popeyes',
    'rationale', 'Reported by the broker in this week''s net lease report.',
    'confidence', 'high',
    'payload', jsonb_build_object(
      'kind', 'ground_lease_sale', 'subject', 'property', 'date_label', 'Aug 2026',
      'price_usd', 2450000, 'cap_rate_pct', 5.6, 'location_label', 'Tampa, FL',
      'brand_id', '@brand:popeyes', 'source_id', '@source:1'),
    'sources', jsonb_build_array(jsonb_build_object(
      'publisher', 'The Boulder Group', 'title', 'Net Lease Market Report Q3 2026',
      'url', 'https://example.com/boulder-q3-2026', 'date_label', 'Q3 2026',
      'quote', 'A Popeyes ground lease in Tampa traded at a 5.6% cap.'))))));

v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
perform ok(v_item is not null, 'a proposal is accepted and returns its id');
perform ok((select status from public.review_items where id = v_item) = 'pending',
           'a sourced proposal lands in the pending lane');
perform ok((select count(*) from public.review_item_sources where item_id = v_item) = 1,
           'the cited source is stored with the proposal');
perform ok((select count(*) from public.sources where url = 'https://example.com/boulder-q3-2026') = 0,
           'an unapproved proposal does not create a source record');

-- 2. Approving writes canonical data, and only then.
rec_id := (public.review_decide(v_item, 'approve', 'Checked against the report.') ->> 'record_id')::uuid;
perform ok(rec_id is not null, 'approving returns the record it created');
perform ok((select price_usd from public.transactions where id = rec_id) = 2450000,
           'the transaction exists with the proposed price');
perform ok((select brand_id from public.transactions where id = rec_id)
           = 'bbbbbbbb-0000-0000-0000-000000000001',
           '@brand:popeyes resolved to the brand''s uuid');
perform ok((select count(*) from public.sources where url = 'https://example.com/boulder-q3-2026') = 1,
           'the proposed source became a real source record on approval');
perform ok((select source_id from public.transactions where id = rec_id)
           = (select id from public.sources where url = 'https://example.com/boulder-q3-2026'),
           '@source:1 resolved to the source that was just created');
perform ok((select status from public.review_items where id = v_item) = 'applied',
           'the proposal is marked applied');
perform ok((select count(*) from public.review_events where item_id = v_item) >= 2,
           'submission and approval are both in the history');

-- 3. A figure is superseded, never overwritten.
r := public.review_submit(jsonb_build_object('batch_id', (r ->> 'batch_id')::uuid,
  'items', jsonb_build_array(jsonb_build_object(
    'target_table', 'public.facts', 'title', 'Popeyes AUV FY2025',
    'payload', jsonb_build_object(
      'subject_type', 'brand', 'subject_id', '@brand:popeyes', 'metric_key', 'auv_usd',
      'value_numeric', 1700000, 'unit', 'usd', 'period_label', 'FY2025',
      'source_id', '@source:qsr-test-2026'),
    'sources', jsonb_build_array(jsonb_build_object('source_key', 'qsr-test-2026'))))));
f1 := (public.review_decide(((r -> 'items' -> 0) ->> 'id')::uuid, 'approve') ->> 'record_id')::uuid;
perform ok((select value_numeric from public.facts where id = f1) = 1700000, 'the figure is recorded');

r := public.review_submit(jsonb_build_object(
  'items', jsonb_build_array(jsonb_build_object(
    'target_table', 'public.facts', 'operation', 'update', 'target_id', f1,
    'title', 'Popeyes AUV FY2025 — corrected',
    'payload', jsonb_build_object('value_numeric', 1725000),
    'sources', jsonb_build_array(jsonb_build_object('source_key', 'qsr-test-2026'))))));
v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
perform ok((select baseline ->> 'value_numeric' from public.review_items where id = v_item) = '1700000.0000',
           'the proposal captured the value it is changing, for the diff');
f2 := (public.review_decide(v_item, 'approve') ->> 'record_id')::uuid;
perform ok(f2 <> f1, 'correcting a figure writes a new observation');
perform ok((select superseded_at from public.facts where id = f1) is not null,
           'the figure the site published is closed, not deleted');
perform ok((select superseded_by from public.facts where id = f1) = f2,
           'the old observation points at the one that replaced it');
perform ok((select value_numeric from public.facts where id = f2) = 1725000,
           'the correction carries the new value');
perform ok((select metric_key from public.facts where id = f2) = 'auv_usd',
           'and the columns the correction did not mention came forward unchanged');
perform ok((select count(*) from public.v_current_facts where metric_key = 'auv_usd') = 1,
           'only one observation is current');

-- 4. The whitelist is real.
-- A bad item is reported and dropped rather than killing a forty-item research run,
-- so this is a rejected item rather than a raised exception.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(
       jsonb_build_object('target_table', 'public.staff_profiles', 'title', 'escalate',
         'payload', jsonb_build_object('role', 'admin')))));
perform ok(((r -> 'items' -> 0) ->> 'accepted')::boolean = false,
           'a proposal naming a table outside the whitelist is refused');
perform ok((select count(*) from public.review_items where target_table = 'public.staff_profiles') = 0,
           'and never reaches the queue');

r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.brands', 'title', 'sneaky',
       'payload', jsonb_build_object('name', 'Test Brand', 'slug', 'test-brand',
                                     'analysis_md', 'x', 'created_at', '1999-01-01')))));
v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
perform ok(jsonb_array_length(public.review_validate(v_item) -> 'errors') > 0,
           'a column outside the whitelist is reported as an error');
perform refuses(format('select public.review_apply(%L::uuid)', v_item),
        'and cannot be applied');

-- 5. A proposal that went stale refuses to apply.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.companies', 'operation', 'update',
       'target_id', 'cccccccc-0000-0000-0000-000000000001',
       'title', 'KBP hq', 'payload', jsonb_build_object('hq_city', 'Overland Park')))));
v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
update public.companies set hq_city = 'Kansas City'
  where id = 'cccccccc-0000-0000-0000-000000000001';
perform ok(jsonb_array_length(public.review_validate(v_item) -> 'stale') = 1,
           'a record that moved under a proposal is detected as stale');
perform refuses(format('select public.review_apply(%L::uuid)', v_item),
        'a stale proposal will not apply');
perform ok(public.review_apply(v_item, true) is not null,
           'a reviewer who has looked at it can force it through');
perform ok((select hq_city from public.companies where id = 'cccccccc-0000-0000-0000-000000000001')
           = 'Overland Park', 'and the forced change lands');

-- 6. Possible duplicates are flagged, not merged.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.companies', 'title', 'KBP again',
       'payload', jsonb_build_object('slug', 'kbp-brands-inc', 'name', 'KBP Brands',
                                     'kind', 'operator')))));
v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
perform ok((select count(*) from public.review_item_matches where item_id = v_item) = 1,
           'a company that already exists under that name is flagged as a possible duplicate');
perform ok((select count(*) from public.companies where name = 'KBP Brands') = 1,
           'and nothing was created behind the reviewer''s back');
perform ok('possible duplicate not yet resolved' = any(
             array(select jsonb_array_elements_text(public.review_validate(v_item) -> 'warnings'))),
           'the unresolved match is surfaced as a warning');

-- 7. A compound identity: the same figure for the same period.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.facts', 'title', 'Popeyes AUV FY2025 again',
       'payload', jsonb_build_object(
         'subject_type', 'brand', 'subject_id', '@brand:popeyes', 'metric_key', 'auv_usd',
         'value_numeric', 1690000, 'unit', 'usd', 'period_label', 'FY2025',
         'source_id', '@source:qsr-test-2026'),
       'sources', jsonb_build_array(jsonb_build_object('source_key', 'qsr-test-2026'))))));
perform ok((select count(*) from public.review_item_matches
             where item_id = ((r -> 'items' -> 0) ->> 'id')::uuid) >= 1,
           'a second figure for the same subject, metric and period is flagged');

-- 8. Unsourced research goes to the verification lane by itself.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.transactions', 'title', 'Heard on a call',
       'payload', jsonb_build_object('kind', 'property_sale', 'subject', 'property',
                                     'date_label', 'Aug 2026',
                                     'source_id', 'aaaaaaaa-0000-0000-0000-000000000001')))));
perform ok(((r -> 'items' -> 0) ->> 'status') = 'needs_verification',
           'a proposal with no citation lands in needs-verification, not pending');

-- 9. Rejection leaves a reason and writes nothing.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.markets', 'title', 'Bad market',
       'payload', jsonb_build_object('slug', 'nowhere', 'name', 'Nowhere')))));
v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
perform public.review_decide(v_item, 'reject', 'Not a market we cover.');
perform ok((select status from public.review_items where id = v_item) = 'rejected',
           'a rejected proposal is closed');
perform ok((select count(*) from public.markets where slug = 'nowhere') = 0,
           'and wrote nothing');
perform ok((select review_note from public.review_items where id = v_item) = 'Not a market we cover.',
           'the reason is kept');

raise notice '  confidentiality';
-- 10. Confidential intelligence cannot be published, by construction.
perform refuses($q$ insert into public.properties (address_line1, city, state, visibility, is_published)
            values ('1 Confidential Way', 'Tampa', 'FL', 'confidential', true) $q$,
        'a confidential record cannot be flagged published');
insert into public.properties (address_line1, city, state, visibility, is_published)
  values ('1 Confidential Way', 'Tampa', 'FL', 'confidential', false);
perform ok(true, 'but it can be stored');

-- 11. Visibility rides from the proposal onto the record.
r := public.review_submit(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
       'target_table', 'public.leases', 'title', 'Rent on the Tampa box',
       'visibility', 'confidential',
       'payload', jsonb_build_object(
         'property_id', (select id from public.properties where address_line1 = '1 Confidential Way'),
         'base_annual_rent_usd', 138000, 'term_label', '15-year absolute NNN'),
       'sources', jsonb_build_array(jsonb_build_object(
         'publisher', 'Owner', 'url', 'https://example.com/lease-abstract'))))));
rec_id := (public.review_decide(((r -> 'items' -> 0) ->> 'id')::uuid, 'approve') ->> 'record_id')::uuid;
perform ok((select visibility from public.leases where id = rec_id) = 'confidential',
           'a proposal marked confidential produces a confidential record');

raise notice '  agents';
end $$;

-- ---------------------------------------------------------------------------
-- 12. Agent keys authenticate inside the database, not only at the HTTP edge.
-- ---------------------------------------------------------------------------
insert into public.agent_keys (name, key_prefix, key_hash, created_by)
  values ('Claude research', 'csw_ag_test',
          encode(sha256(convert_to('csw_ag_test_secret', 'utf8')), 'hex'),
          '11111111-1111-1111-1111-111111111111');

do $$ begin perform test_as(null); end $$;   -- no session at all, exactly like the serverless function

do $$
declare r jsonb; v_item uuid;
begin
  perform refuses($q$ select public.review_submit(jsonb_build_object('items', jsonb_build_array(
            jsonb_build_object('target_table', 'public.brands',
              'payload', jsonb_build_object('name', 'X', 'slug', 'x'))))) $q$,
          'an unauthenticated caller cannot submit');

  perform refuses($q$ select public.review_submit(jsonb_build_object('agent_key', 'wrong-key',
            'items', '[]'::jsonb)) $q$,
          'a bad agent key is refused');

  r := public.review_submit(jsonb_build_object(
    'agent_key', 'csw_ag_test_secret',
    'batch', jsonb_build_object('title', 'Q3 wing pricing sweep', 'model', 'claude-opus-5',
                                'task_prompt', 'Find published Q3 2026 chicken AUVs.'),
    'items', jsonb_build_array(jsonb_build_object(
      'target_table', 'public.facts', 'title', 'Popeyes AUV FY2026',
      'confidence', 'medium', 'dedupe_key', 'popeyes-auv-fy2026',
      'payload', jsonb_build_object(
        'subject_type', 'brand', 'subject_id', '@brand:popeyes', 'metric_key', 'auv_usd',
        'value_numeric', 1810000, 'unit', 'usd', 'period_label', 'FY2026',
        'source_id', '@source:1'),
      'sources', jsonb_build_array(jsonb_build_object(
        'publisher', 'RBI', 'title', 'Q4 2026 results', 'url', 'https://example.com/rbi-q4'))))));
  v_item := ((r -> 'items' -> 0) ->> 'id')::uuid;
  perform ok(v_item is not null, 'a valid agent key may submit');
  perform ok((select submitter_kind from public.review_items where id = v_item) = 'agent',
             'the proposal is marked as coming from an agent');
  perform ok((select kind from public.review_batches where id = (r ->> 'batch_id')::uuid) = 'agent',
             'and so is the research run');
  perform ok((select task_prompt from public.review_batches where id = (r ->> 'batch_id')::uuid)
             = 'Find published Q3 2026 chicken AUVs.',
             'the run records what the agent was asked to do');
  perform ok((select status from public.review_items where id = v_item) = 'pending',
             'an agent proposal waits for a human — it is not applied');
  perform ok((select count(*) from public.facts where value_numeric = 1810000) = 0,
             'and nothing it proposed reached canonical data');
  perform ok((select use_count from public.agent_keys where key_prefix = 'csw_ag_test') = 1,
             'the key''s use is recorded');

  -- Retried run: the same dedupe key must not double the queue.
  r := public.review_submit(jsonb_build_object('agent_key', 'csw_ag_test_secret',
    'batch', jsonb_build_object('ref', 'rerun'),
    'items', jsonb_build_array(jsonb_build_object(
      'target_table', 'public.facts', 'title', 'Popeyes AUV FY2026',
      'dedupe_key', 'popeyes-auv-fy2026',
      'payload', jsonb_build_object('subject_type', 'brand', 'subject_id', '@brand:popeyes',
        'metric_key', 'auv_usd', 'value_numeric', 1810000, 'unit', 'usd',
        'period_label', 'FY2026', 'source_id', '@source:1')))));
  perform ok(((r -> 'items' -> 0) ->> 'id')::uuid = v_item,
             'a retried run returns the proposal it already made');
  perform ok((select count(*) from public.review_items where dedupe_key = 'popeyes-auv-fy2026') = 1,
             'and does not queue it twice');

  -- A revoked key is a dead key.
  update public.agent_keys set revoked_at = now() where key_prefix = 'csw_ag_test';
  perform refuses($q$ select public.review_submit(jsonb_build_object('agent_key', 'csw_ag_test_secret',
            'items', '[]'::jsonb)) $q$, 'a revoked key is refused');
end $$;

-- 13. A signed-in user who is not staff has no access at all.
do $$ begin perform test_as('22222222-2222-2222-2222-222222222222'); end $$;
do $$
begin
  perform ok(public.is_staff() = false, 'a non-staff user is not staff');
  perform refuses($q$ select public.review_schema() $q$, 'and cannot even read what the queue writes to');
end $$;

do $$ begin perform test_as('11111111-1111-1111-1111-111111111111'); end $$;
do $$
begin
  perform ok(jsonb_array_length(public.review_schema()) = 18,
             'staff see all eighteen writable targets, described from the catalogue');
  perform ok(jsonb_array_length(public.review_lookup('brand', 'popey', 5)) = 1,
             'entity lookup finds a brand by partial name');
end $$;

-- ---------------------------------------------------------------------------
-- 14. The dashboard's own surfaces (0020).
-- ---------------------------------------------------------------------------
do $$
declare j jsonb; lead_id uuid;
begin
raise notice '  dashboard';
  perform ok((public.desk_stats() ->> 'pending')::int >= 1, 'the overview counts the queue');
  perform ok((public.desk_stats() ->> 'unverified_sources')::int >= 1,
             'and counts sources still to be checked against the primary document');

  j := public.desk_records('public.transactions', null, 10, 0);
  perform ok(jsonb_array_length(j) >= 1, 'canonical records can be browsed');
  perform ok((j -> 0 -> 'row') ? 'price_usd', 'with their full row for the detail panel');
  perform refuses($q$ select public.desk_records('public.staff_profiles') $q$,
                  'but only the tables the queue is allowed to write');

  perform ok(jsonb_array_length(public.record_history('public.transactions', null, 5)) >= 1,
             'the audit trail is readable from the dashboard');

  -- Leads reach the desk without exposing the intake schema to anything.
  insert into intake.contacts (email, full_name) values ('buyer@example.com', 'A Buyer');
  insert into intake.submissions (form, contact_id, payload)
    values ('sell_property', (select id from intake.contacts where email = 'buyer@example.com'),
            '{"address":"1 Main St"}'::jsonb)
    returning id into lead_id;
  j := public.lead_list(null, null, 10, 0);
  perform ok(jsonb_array_length(j) = 1, 'form submissions reach the dashboard');
  perform ok((j -> 0 ->> 'email') = 'buyer@example.com', 'with the contact joined in');
  perform ok((public.lead_update(lead_id, 'triaged', 'Called back.') ->> 'status') = 'triaged',
             'and can be triaged');
end $$;

do $$ begin perform test_as('22222222-2222-2222-2222-222222222222'); end $$;
do $$
begin
  perform refuses($q$ select public.lead_list() $q$,
                  'a non-staff user cannot read a single lead');
  perform refuses($q$ select public.desk_stats() $q$, 'or any desk figure');
  perform refuses($q$ select public.record_history('public.transactions', null) $q$,
                  'or the change log');
end $$;

do $$ begin perform test_as('11111111-1111-1111-1111-111111111111'); end $$;
do $$
declare j jsonb;
begin
raise notice '  agent lookup';
  insert into public.agent_keys (name, key_prefix, key_hash)
    values ('Lookup only', 'csw_ag_look',
            encode(sha256(convert_to('csw_ag_lookup_secret', 'utf8')), 'hex'));
  update public.agent_keys set scopes = array['lookup'] where key_prefix = 'csw_ag_look';
end $$;

do $$ begin perform test_as(null); end $$;
do $$
begin
  perform ok(jsonb_array_length(
    public.review_lookup('brand', 'popey', 5, 'csw_ag_lookup_secret')) = 1,
    'an agent can check what already exists before proposing it');
  perform ok(jsonb_array_length(public.review_schema('csw_ag_lookup_secret')) = 18,
    'and can read the shape of what it may propose');
  perform refuses($q$ select public.review_submit(jsonb_build_object(
      'agent_key', 'csw_ag_lookup_secret',
      'items', jsonb_build_array(jsonb_build_object('target_table','public.brands',
        'payload', jsonb_build_object('name','X','slug','x'))))) $q$,
    'but a lookup-only key cannot submit');
  perform refuses($q$ select public.review_lookup('brand', 'popey', 5) $q$,
    'and no key at all reads nothing');
end $$;

do $$ begin perform test_as('11111111-1111-1111-1111-111111111111'); end $$;
do $$
declare j jsonb;
begin
raise notice '  staff';
  perform ok(jsonb_array_length(public.staff_list()) = 1, 'staff can see the desk roster');
  j := public.grant_staff('outsider@example.com', 'analyst');
  perform ok((j ->> 'role') = 'analyst', 'an admin can grant desk access by email');
  perform refuses($q$ select public.grant_staff('nobody@example.com', 'analyst') $q$,
                  'but not to an address that has never signed in');
  perform refuses($q$ update public.staff_profiles set role = 'viewer'
                      where user_id = '11111111-1111-1111-1111-111111111111' $q$,
                  'and the last admin cannot demote themselves');
end $$;

do $$ begin perform test_as('22222222-2222-2222-2222-222222222222'); end $$;
do $$
begin
  perform ok(public.is_staff(), 'the newly granted analyst is staff');
  perform ok(public.can_edit() = false, 'but cannot edit canonical data');
  perform ok(public.can_see_confidential() = false, 'and cannot see confidential intelligence');
  perform ok((public.desk_me() ->> 'role') = 'analyst', 'desk_me reports their role');
  perform refuses($q$ select public.review_decide(
      (select id from public.review_items where status = 'pending' limit 1), 'approve') $q$,
    'an analyst can propose but cannot approve');
  perform refuses($q$ select public.grant_staff('x@example.com', 'admin') $q$,
    'and cannot grant themselves more');
end $$;
