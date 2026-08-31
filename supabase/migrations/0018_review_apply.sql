-- 0018_review_apply.sql
--
-- The only path from a proposal to canonical data.
--
-- Everything here is security definer, because the whole point is that a caller who
-- cannot write to public.brands can approve a change that does. What keeps that safe is
-- not the role check alone but the whitelist: review_targets enumerates every table and
-- every column reachable, and a payload key outside it is an error, not a silent skip.
--
-- Every function here runs with search_path = public, extensions. Not the empty path
-- the rest of the schema uses, because these bodies name citext, the review_* enums and
-- pg_trgm's similarity(), and those live in different schemas on Supabase (extensions)
-- than they do on a stock Postgres (public) - which is what supabase/validate.sh runs.
-- Both schemas are owned by the database owner and neither is writable by anon or
-- authenticated, so nothing can be shadowed into the path.
--
-- Three rules the functions enforce that a reviewer should never have to remember:
--
--   1. A figure whose source does not exist yet gets its sources row created here, on
--      approval - never at submission time. Rejected research leaves no trace in the
--      source registry.
--   2. facts are superseded, not updated. A corrected AUV must not erase the number the
--      site published last quarter; the unique index on current facts and the whole
--      audit story depend on it. review_targets.update_strategy carries this per table.
--   3. A proposal that sat in the queue while the record moved underneath it is stale
--      and refuses to apply. Reviewing a diff against a value that is no longer there
--      is worse than no review at all.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.review_slugify(t text)
returns text language sql immutable set search_path = public, extensions as $$
  select trim(both '-' from regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Reads one row as jsonb.
--
-- This one and the two below come in pairs: a _raw function with no session check, and
-- a wrapper that requires staff. review_submit runs for agents, which have no session
-- at all - is_staff() is false and auth.uid() is null - so it calls the raw form, while
-- everything reachable from the dashboard goes through the wrapper. EXECUTE on the raw
-- forms is revoked at the bottom of this file, so the only callers are the security
-- definer functions here.
create or replace function public.review_row_json_raw(p_table text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare j jsonb;
begin
  if p_id is null then return null; end if;
  if not exists (select 1 from public.review_targets rt where rt.table_name = p_table) then
    raise exception 'unknown target table %', p_table using errcode = '22023';
  end if;
  execute format('select to_jsonb(t) from %I.%I t where t.id = $1',
                 split_part(p_table, '.', 1), split_part(p_table, '.', 2))
    into j using p_id;
  return j;
end $$;

create or replace function public.review_row_json(p_table text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  return public.review_row_json_raw(p_table, p_id);
end $$;

-- Reference tokens. A submitter - human or agent - writes @brand:popeyes, not a uuid.
-- The token survives into the stored payload, so the diff a reviewer reads says
-- "brand_id: @brand:popeyes" rather than a hex string with no meaning.
create or replace function public.review_resolve_ref(p_token text, p_item_id uuid)
returns uuid language plpgsql stable security definer set search_path = public, extensions as $$
declare kind text; ref text; out_id uuid;
begin
  kind := split_part(p_token, ':', 1);
  ref  := substring(p_token from position(':' in p_token) + 1);
  if ref = '' then raise exception 'reference % has no target', p_token using errcode = '22023'; end if;

  case kind
    when '@source' then
      if ref ~ '^[0-9]+$' then
        select coalesce(s.created_source_id, s.source_id) into out_id
          from public.review_item_sources s
         where s.item_id = p_item_id and s.ordinal = ref::int;
      else
        select s.id into out_id from public.sources s where s.key = ref::citext;
      end if;
    when '@brand'      then select b.id into out_id from public.brands b       where b.slug = ref::citext;
    when '@company'    then select c.id into out_id from public.companies c    where c.slug = ref::citext;
    when '@market'     then select m.id into out_id from public.markets m      where m.slug = ref::citext;
    when '@property'   then select p.id into out_id from public.properties p   where p.slug = ref::citext;
    when '@transaction' then select x.id into out_id from public.transactions x where x.slug = ref::citext;
    when '@article'    then select a.id into out_id from public.articles a     where a.slug = ref::citext;
    when '@metric'     then out_id := null;   -- metric keys are text, not uuids
    when '@item' then
      -- The applied record of another proposal, so a run can propose a property and the
      -- occupancy that sits on it in one submission.
      select i.applied_record_id into out_id from public.review_items i where i.id = ref::uuid;
    else raise exception 'unknown reference kind %', kind using errcode = '22023';
  end case;

  if out_id is null then
    raise exception 'reference % did not resolve', p_token using errcode = '23503';
  end if;
  return out_id;
end $$;

comment on function public.review_resolve_ref(text, uuid) is
  'Resolves @brand:popeyes / @source:1 / @item:<uuid> to a uuid at apply time.';

-- Payload with every reference token replaced by the uuid it names.
create or replace function public.review_resolved_payload(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare it public.review_items; k text; v jsonb; out_j jsonb := '{}'::jsonb; s text;
begin
  select * into it from public.review_items where id = p_item_id;
  if not found then raise exception 'no such proposal %', p_item_id using errcode = '02000'; end if;
  for k, v in select key, value from jsonb_each(it.payload) loop
    if jsonb_typeof(v) = 'string' then
      s := v #>> '{}';
      if left(s, 1) = '@' then
        out_j := out_j || jsonb_build_object(k, public.review_resolve_ref(s, it.id)::text);
        continue;
      end if;
    end if;
    out_j := out_j || jsonb_build_object(k, v);
  end loop;
  return out_j;
end $$;

-- ---------------------------------------------------------------------------
-- Validation. Returns what is wrong rather than raising, so the dashboard can show a
-- reviewer every problem at once and an agent gets an actionable reply.
-- ---------------------------------------------------------------------------
create or replace function public.review_validate_raw(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  it public.review_items; tgt public.review_targets;
  errors text[] := '{}'; warnings text[] := '{}'; stale text[] := '{}';
  k text; cols text[]; cur jsonb; missing text[];
begin
  select * into it from public.review_items where id = p_item_id;
  if not found then raise exception 'no such proposal %', p_item_id using errcode = '02000'; end if;
  select * into tgt from public.review_targets where table_name = it.target_table;
  if not found then
    return jsonb_build_object('errors', array['unknown target ' || it.target_table],
                              'warnings', '{}'::text[], 'stale', '{}'::text[]);
  end if;
  if not tgt.is_enabled then errors := errors || ('writes to ' || tgt.label || ' are disabled'); end if;

  -- Columns that actually exist on the table, intersected with the whitelist.
  select array_agg(a.attname::text) into cols
    from pg_attribute a
   where a.attrelid = it.target_table::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname::text = any(tgt.allowed_columns);

  for k in select jsonb_object_keys(it.payload) loop
    if not (k = any(coalesce(cols, '{}'))) then
      errors := errors || (k || ' is not a writable column of ' || tgt.label);
    end if;
  end loop;

  if it.operation = 'insert' then
    select array_agg(c) into missing from unnest(tgt.required_columns) c
     where not (it.payload ? c);
    if missing is not null then
      errors := errors || ('missing required: ' || array_to_string(missing, ', '));
    end if;
  else
    cur := public.review_row_json_raw(it.target_table, it.target_id);
    if cur is null then
      errors := errors || 'the record this proposal edits no longer exists'::text;
    elsif it.baseline is not null then
      -- The record moved while the proposal waited.
      for k in select jsonb_object_keys(it.baseline) loop
        if (cur -> k) is distinct from (it.baseline -> k) then
          stale := stale || (k || ': was ' || coalesce(it.baseline ->> k, 'null')
                               || ', now ' || coalesce(cur ->> k, 'null'));
        end if;
      end loop;
    end if;
  end if;

  if tgt.requires_source
     and not exists (select 1 from public.review_item_sources s where s.item_id = it.id) then
    warnings := warnings || 'no source cited'::text;
  end if;

  if exists (select 1 from public.review_item_matches m
              where m.item_id = it.id and m.resolution = 'unresolved') then
    warnings := warnings || 'possible duplicate not yet resolved'::text;
  end if;

  if it.visibility <> 'public' and (it.payload ->> 'is_published') = 'true' then
    errors := errors || ('cannot publish a record marked ' || it.visibility)::text;
  end if;

  return jsonb_build_object('errors', to_jsonb(errors), 'warnings', to_jsonb(warnings),
                            'stale', to_jsonb(stale));
end $$;

-- ---------------------------------------------------------------------------
-- Duplicate detection. Flags, never merges.
--
-- Note: the search_path list must be unquoted. 'public, extensions' in single quotes is
-- one schema NAMED "public, extensions", not two schemas, and every unqualified type in
-- the body then fails to resolve.
-- ---------------------------------------------------------------------------
create or replace function public.review_find_matches_raw(p_item_id uuid)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  it public.review_items; tgt public.review_targets; pay jsonb;
  col text; val text; n int := 0; r record; sch text; tab text;
  conds text[] := '{}'; all_present boolean := true;
begin
  select * into it from public.review_items where id = p_item_id;
  if not found then return 0; end if;
  select * into tgt from public.review_targets where table_name = it.target_table;
  if not found or cardinality(tgt.identity_columns) = 0 then return 0; end if;
  sch := split_part(it.target_table, '.', 1); tab := split_part(it.target_table, '.', 2);

  -- Reference tokens name entities that already exist, so match on what they resolve
  -- to. A proposal that fails to resolve is a validation problem, not a match problem.
  begin
    pay := public.review_resolved_payload(it.id);
  exception when others then
    pay := it.payload;
  end;

  -- A compound identity - subject + metric + period for a figure, property + brand +
  -- date for a tenancy - is only a duplicate when every part agrees. Exact, not fuzzy:
  -- "the same figure for the same period" is a yes-or-no question.
  if cardinality(tgt.identity_columns) > 1 then
    foreach col in array tgt.identity_columns loop
      if not (pay ? col) or (pay ->> col) is null then all_present := false; exit; end if;
      -- Literals rather than USING parameters: the number of identity columns varies
      -- per target, and EXECUTE rejects a USING list that does not match the
      -- placeholders. quote_literal via %L is what makes that safe.
      conds := conds || format('t.%I::text = %L', col, pay ->> col);
    end loop;
    if all_present then
      for r in execute format(
          'select t.id, %s as label from %I.%I t where %s and ($1::uuid is null or t.id <> $1) limit 5',
          tgt.label_expression, sch, tab, array_to_string(conds, ' and '))
        using it.target_id
      loop
        insert into public.review_item_matches (item_id, candidate_table, candidate_id,
                                                candidate_label, similarity, reason)
        values (it.id, it.target_table, r.id, r.label, 0.999,
                'already recorded for the same ' || array_to_string(tgt.identity_columns, ' + '))
        on conflict (item_id, candidate_table, candidate_id) do nothing;
        n := n + 1;
      end loop;
    end if;
    return n;
  end if;

  -- A single identity column is a name, an address or a headline. Those are written
  -- differently by different publishers, so this one is fuzzy - trigram similarity,
  -- surfaced for a human rather than acted on.
  foreach col in array tgt.identity_columns loop
    continue when not (pay ? col);
    val := pay ->> col;
    continue when val is null or length(val) < 3;
    continue when not exists (
      select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_type ty on ty.oid = a.atttypid
       where a.attrelid = it.target_table::regclass and a.attname = col and ty.typcategory = 'S');

    for r in execute format(
        'select t.id, %s as label, similarity(t.%I::text, $1) as sim
           from %I.%I t
          where t.%I is not null
            and (lower(t.%I::text) = lower($1) or t.%I::text %% $1)
            and ($2::uuid is null or t.id <> $2)
          order by sim desc limit 5',
        tgt.label_expression, col, sch, tab, col, col, col)
      using val, it.target_id
    loop
      insert into public.review_item_matches (item_id, candidate_table, candidate_id,
                                              candidate_label, similarity, reason)
      values (it.id, it.target_table, r.id, r.label, least(r.sim, 0.999),
              format('%s %s "%s"', col,
                     case when r.sim >= 0.999 then 'matches' else 'is close to' end, val))
      on conflict (item_id, candidate_table, candidate_id) do nothing;
      n := n + 1;
    end loop;
  end loop;

  return n;
end $$;

create or replace function public.review_validate(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  return public.review_validate_raw(p_item_id);
end $$;

create or replace function public.review_find_matches(p_item_id uuid)
returns int language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_staff() then raise exception 'not authorised' using errcode = '42501'; end if;
  return public.review_find_matches_raw(p_item_id);
end $$;

comment on function public.review_find_matches(uuid) is
  'Trigram and exact matching over the target table''s identity columns. Writes
   review_item_matches for a human to resolve. Never merges anything.';

-- ---------------------------------------------------------------------------
-- Agent authentication, in the database.
--
-- The key is checked here rather than only in api/agent.js, which is what lets the
-- endpoint hold nothing more privileged than the anon key: an unauthenticated caller
-- reaching the RPC directly is refused by the same code that refuses one reaching it
-- over HTTP. The raw key is never stored, only its sha256.
-- ---------------------------------------------------------------------------
create or replace function public.agent_for_key(p_key text, p_scope text)
returns public.agent_keys language plpgsql security definer set search_path = public, extensions as $$
declare a public.agent_keys;
begin
  if p_key is null or length(p_key) < 16 then
    raise exception 'invalid or revoked agent key' using errcode = '42501';
  end if;
  select * into a from public.agent_keys
   where key_hash = encode(pg_catalog.sha256(convert_to(p_key, 'utf8')), 'hex')
     and revoked_at is null;
  if not found then raise exception 'invalid or revoked agent key' using errcode = '42501'; end if;
  if not (p_scope = any(a.scopes)) then
    raise exception 'this key does not carry the % scope', p_scope using errcode = '42501';
  end if;
  update public.agent_keys set last_used_at = now(), use_count = use_count + 1 where id = a.id;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Submit. The one entry point, for the dashboard form and for a research agent.
--
-- An agent authenticates here rather than only at the HTTP edge: it passes its raw key
-- and this function checks the hash. Without that, any caller who can reach the RPC
-- could claim to be an agent by naming a key id.
-- ---------------------------------------------------------------------------
create or replace function public.review_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  agent public.agent_keys; is_agent boolean := false;
  b_id uuid; item jsonb; src jsonb; out_items jsonb := '[]'::jsonb;
  new_id uuid; tgt public.review_targets; v jsonb; probs jsonb; n int; ord int;
  t_id uuid; t_ref text; status_out review_status; seq int := 0; dedupe text;
  actor_label text;
begin
  if p ? 'agent_key' and (p ->> 'agent_key') is not null then
    agent := public.agent_for_key(p ->> 'agent_key', 'submit');
    is_agent := true;
  elsif not public.is_staff() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  actor_label := coalesce(p ->> 'submitted_by_label',
                          case when is_agent then agent.name else null end);

  -- Batch. A caller-supplied ref makes a retried run idempotent rather than doubled.
  if p ? 'batch_id' then
    b_id := (p ->> 'batch_id')::uuid;
  else
    if (p -> 'batch') ? 'ref' then
      select id into b_id from public.review_batches where ref = ((p -> 'batch') ->> 'ref')::citext;
    end if;
    if b_id is null then
      insert into public.review_batches (ref, title, kind, agent_name, agent_key_id, model,
                                         task_prompt, created_by)
      values (nullif((p -> 'batch') ->> 'ref', '')::citext,
              coalesce((p -> 'batch') ->> 'title',
                       case when is_agent then agent.name || ' research run'
                            else 'Desk entry' end),
              case when is_agent then 'agent' else 'human' end::submitter_kind,
              coalesce((p -> 'batch') ->> 'agent_name', case when is_agent then agent.name end),
              agent.id,
              (p -> 'batch') ->> 'model',
              (p -> 'batch') ->> 'task_prompt',
              auth.uid())
      returning id into b_id;
    end if;
  end if;

  select coalesce(max(i.seq), 0) into seq from public.review_items i where i.batch_id = b_id;

  for item in select value from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    seq := seq + 1;
    select * into tgt from public.review_targets where table_name = item ->> 'target_table';
    if not found or not tgt.is_enabled then
      out_items := out_items || jsonb_build_object(
        'title', item ->> 'title', 'accepted', false,
        'errors', jsonb_build_array(format('unknown or disabled target "%s"', item ->> 'target_table')));
      continue;
    end if;

    dedupe := nullif(item ->> 'dedupe_key', '');
    if dedupe is not null and exists (select 1 from public.review_items i where i.dedupe_key = dedupe) then
      select i.id into new_id from public.review_items i where i.dedupe_key = dedupe;
      out_items := out_items || jsonb_build_object('title', item ->> 'title', 'accepted', true,
        'id', new_id, 'status', 'duplicate_submission',
        'errors', '[]'::jsonb, 'warnings', jsonb_build_array('already submitted; existing proposal returned'));
      continue;
    end if;

    -- Update targets may be named by slug, so a caller never needs a uuid.
    t_id := nullif(item ->> 'target_id', '')::uuid;
    t_ref := nullif(item ->> 'target_ref', '');
    if t_id is null and t_ref is not null then
      begin
        t_id := public.review_resolve_ref(t_ref, null);
      exception when others then
        out_items := out_items || jsonb_build_object('title', item ->> 'title', 'accepted', false,
          'errors', jsonb_build_array(format('target_ref "%s" did not resolve', t_ref)));
        continue;
      end;
    end if;

    insert into public.review_items (
      batch_id, seq, target_table, operation, target_id, title, entity_label, summary,
      rationale, payload, confidence, confidence_pct, visibility, submitter_kind,
      submitted_by, submitted_by_label, agent_key_id, dedupe_key)
    values (
      b_id, seq, tgt.table_name,
      coalesce(nullif(item ->> 'operation','')::review_op,
               case when t_id is null then 'insert' else 'update' end::review_op),
      t_id,
      coalesce(nullif(item ->> 'title',''), tgt.label || ' change'),
      nullif(item ->> 'entity_label',''),
      nullif(item ->> 'summary',''),
      nullif(item ->> 'rationale',''),
      coalesce(item -> 'payload', '{}'::jsonb),
      coalesce(nullif(item ->> 'confidence','')::confidence_level, 'medium'),
      nullif(item ->> 'confidence_pct','')::numeric,
      coalesce(nullif(item ->> 'visibility','')::intel_visibility, 'public'),
      case when is_agent then 'agent' else 'human' end::submitter_kind,
      auth.uid(), actor_label, agent.id, dedupe)
    returning id into new_id;

    -- Provenance.
    ord := 0;
    for src in select value from jsonb_array_elements(coalesce(item -> 'sources', '[]'::jsonb)) loop
      ord := ord + 1;
      insert into public.review_item_sources (
        item_id, ordinal, source_id, proposed_key, publisher, title, url, date_label,
        published_on, source_type, quote, accessed_at)
      values (
        new_id, ord,
        coalesce(nullif(src ->> 'source_id','')::uuid,
                 (select s.id from public.sources s where s.key = nullif(src ->> 'source_key','')::citext)),
        nullif(src ->> 'source_key','')::citext,
        nullif(src ->> 'publisher',''), nullif(src ->> 'title',''), nullif(src ->> 'url',''),
        nullif(src ->> 'date_label',''), nullif(src ->> 'published_on','')::date,
        coalesce(nullif(src ->> 'source_type','')::source_type, 'trade_press'),
        nullif(src ->> 'quote',''), nullif(src ->> 'accessed_at','')::timestamptz);
    end loop;

    -- Baseline: the affected columns exactly as they stand right now.
    if t_id is not null then
      v := public.review_row_json_raw(tgt.table_name, t_id);
      if v is not null then
        update public.review_items i
           set baseline = (select jsonb_object_agg(k, coalesce(v -> k, 'null'::jsonb))
                             from jsonb_object_keys(i.payload) k)
         where i.id = new_id;
      end if;
    end if;

    n := public.review_find_matches_raw(new_id);
    probs := public.review_validate_raw(new_id);

    -- Unsourced research does not join the approve lane. It joins the verify lane.
    status_out := 'pending';
    if tgt.requires_source
       and not exists (select 1 from public.review_item_sources s where s.item_id = new_id) then
      status_out := 'needs_verification';
      update public.review_items set status = status_out where id = new_id;
    end if;

    insert into public.review_events (item_id, batch_id, action, to_status, actor, actor_label, detail)
    values (new_id, b_id, 'submitted', status_out, auth.uid(), actor_label,
            jsonb_build_object('matches', n, 'validation', probs));

    out_items := out_items || jsonb_build_object(
      'id', new_id, 'title', item ->> 'title', 'accepted', true, 'status', status_out,
      'matches', n, 'errors', probs -> 'errors', 'warnings', probs -> 'warnings');
  end loop;

  update public.review_batches set updated_at = now() where id = b_id;

  return jsonb_build_object('batch_id', b_id, 'items', out_items);
end $$;

comment on function public.review_submit(jsonb) is
  'The single entry point to the queue, for the dashboard and for research agents.
   Never writes canonical data - only review_* tables.';

-- ---------------------------------------------------------------------------
-- Apply. Runs inside the caller's transaction, so a failure anywhere leaves the
-- proposal pending and the canonical tables untouched.
-- ---------------------------------------------------------------------------
create or replace function public.review_apply(p_item_id uuid, p_force boolean default false)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  it public.review_items; tgt public.review_targets; probs jsonb;
  pay jsonb; merged jsonb; old_j jsonb; s record; src_id uuid;
  sch text; tab text; cols text; vals text; sets text; new_id uuid; k text;
begin
  if not public.can_edit() then raise exception 'not authorised to apply' using errcode = '42501'; end if;

  select * into it from public.review_items where id = p_item_id for update;
  if not found then raise exception 'no such proposal %', p_item_id using errcode = '02000'; end if;
  if it.status = 'applied' then return it.applied_record_id; end if;
  select * into tgt from public.review_targets where table_name = it.target_table;
  if not found then raise exception 'unknown target %', it.target_table using errcode = '22023'; end if;

  probs := public.review_validate_raw(p_item_id);
  if jsonb_array_length(probs -> 'errors') > 0 then
    raise exception 'proposal cannot be applied: %',
      array_to_string(array(select jsonb_array_elements_text(probs -> 'errors')), '; ')
      using errcode = '23514';
  end if;
  if jsonb_array_length(probs -> 'stale') > 0 and not p_force then
    raise exception 'the record changed since this was proposed: %',
      array_to_string(array(select jsonb_array_elements_text(probs -> 'stale')), '; ')
      using errcode = '40001';
  end if;

  -- 1. Proposed sources become real sources rows, now and not before.
  for s in select * from public.review_item_sources
            where item_id = it.id and source_id is null and created_source_id is null
            order by ordinal loop
    insert into public.sources (key, publisher, title, url, date_label, published_on,
                                source_type, accessed_at)
    values (
      coalesce(s.proposed_key::text,
               left(public.review_slugify(coalesce(s.publisher, 'source') || '-' ||
                                          coalesce(s.title, s.url)), 48)
               || '-' || left(encode(pg_catalog.sha256(convert_to(s.url, 'utf8')), 'hex'), 6))::citext,
      coalesce(s.publisher, 'Unattributed'),
      coalesce(s.title, s.url), s.url, s.date_label, s.published_on, s.source_type,
      coalesce(s.accessed_at, now()))
    on conflict (key) do update set updated_at = now()
    returning id into src_id;
    update public.review_item_sources set created_source_id = src_id where id = s.id;
  end loop;

  -- 2. Resolve @tokens now that the sources exist.
  pay := public.review_resolved_payload(it.id);

  -- 3. Visibility rides along, so intelligence entered as internal cannot be stored
  --    as public by omission.
  if tgt.supports_visibility and not (pay ? 'visibility') then
    pay := pay || jsonb_build_object('visibility', it.visibility::text);
  end if;

  -- Tables that record who wrote a row get the approver, not the service account.
  if auth.uid() is not null and not (pay ? 'created_by')
     and exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = tgt.table_name::regclass and a.attname = 'created_by'
                    and a.attnum > 0 and not a.attisdropped) then
    pay := pay || jsonb_build_object('created_by', auth.uid()::text);
  end if;

  sch := split_part(tgt.table_name, '.', 1);
  tab := split_part(tgt.table_name, '.', 2);

  if it.operation = 'insert' or tgt.update_strategy = 'supersede' then
    if tgt.update_strategy = 'supersede' and it.operation = 'update' then
      -- Carry the old row forward, overridden by the proposal. The new row is the
      -- current observation; the old one keeps its place in history.
      old_j := public.review_row_json_raw(tgt.table_name, it.target_id);
      merged := (old_j - 'id' - 'created_at' - 'superseded_at' - 'superseded_by') || pay;
      -- Close the old observation BEFORE writing the new one. facts_current_uniq is a
      -- partial unique index over the rows where superseded_at is null, so a subject,
      -- metric and period can only have one live figure at a time - inserting first
      -- collides with the row being replaced.
      execute format('update %I.%I set superseded_at = now() where id = $1', sch, tab)
        using it.target_id;
    else
      merged := pay;
    end if;

    select string_agg(quote_ident(key), ', '), string_agg(format('(r).%I', key), ', ')
      into cols, vals from jsonb_object_keys(merged) key;

    execute format('insert into %I.%I (%s) select %s from jsonb_populate_record(null::%I.%I, $1) r
                    returning id', sch, tab, cols, vals, sch, tab)
      into new_id using merged;

    -- facts records which row replaced it; brand_cap_rates only records that one did.
    if tgt.update_strategy = 'supersede' and it.operation = 'update'
       and exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = tgt.table_name::regclass and a.attname = 'superseded_by'
                      and a.attnum > 0 and not a.attisdropped) then
      execute format('update %I.%I set superseded_by = $1 where id = $2', sch, tab)
        using new_id, it.target_id;
    end if;
  else
    select string_agg(format('%I = (r).%I', key, key), ', ') into sets
      from jsonb_object_keys(pay) key;
    execute format('update %I.%I t set %s from jsonb_populate_record(null::%I.%I, $1) r
                    where t.id = $2 returning t.id', sch, tab, sets, sch, tab)
      into new_id using pay, it.target_id;
    if new_id is null then
      raise exception 'the record this proposal edits no longer exists' using errcode = '02000';
    end if;
  end if;

  update public.review_items
     set status = 'applied', applied_at = now(), applied_record_id = new_id,
         reviewed_by = coalesce(reviewed_by, auth.uid()),
         reviewed_at = coalesce(reviewed_at, now())
   where id = it.id;

  insert into public.review_events (item_id, batch_id, action, from_status, to_status, actor, detail)
  values (it.id, it.batch_id, 'applied', it.status, 'applied', auth.uid(),
          jsonb_build_object('record_id', new_id, 'table', tgt.table_name,
                             'strategy', tgt.update_strategy, 'payload', pay,
                             'forced', p_force, 'stale', probs -> 'stale'));

  return new_id;
end $$;

comment on function public.review_apply(uuid, boolean) is
  'Applies one approved proposal. Whitelisted columns only, sources materialised first,
   facts superseded rather than overwritten, stale proposals refused unless forced.';

-- ---------------------------------------------------------------------------
-- Decide. What the four buttons in the dashboard call.
-- ---------------------------------------------------------------------------
create or replace function public.review_decide(
  p_item_id uuid, p_decision text, p_note text default null,
  p_override jsonb default null, p_force boolean default false,
  p_duplicate_of uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare it public.review_items; new_id uuid; from_s review_status; to_s review_status;
begin
  if not public.can_edit() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into it from public.review_items where id = p_item_id for update;
  if not found then raise exception 'no such proposal %', p_item_id using errcode = '02000'; end if;
  from_s := it.status;

  -- Edit-and-approve: the reviewer's correction is merged into the payload and kept,
  -- so the queue records what was approved rather than what was proposed.
  if p_override is not null and p_override <> '{}'::jsonb then
    update public.review_items set payload = payload || p_override where id = p_item_id;
    insert into public.review_events (item_id, batch_id, action, actor, note, detail)
    values (p_item_id, it.batch_id, 'edited', auth.uid(), p_note,
            jsonb_build_object('before', it.payload, 'override', p_override));
    select * into it from public.review_items where id = p_item_id;
  end if;

  case p_decision
    when 'approve' then
      new_id := public.review_apply(p_item_id, p_force);
      to_s := 'applied';
    when 'reject' then
      to_s := 'rejected';
    when 'needs_verification' then
      to_s := 'needs_verification';
    when 'duplicate' then
      to_s := 'duplicate';
    when 'reopen' then
      to_s := 'pending';
    when 'withdraw' then
      to_s := 'withdrawn';
    else raise exception 'unknown decision %', p_decision using errcode = '22023';
  end case;

  if p_decision <> 'approve' then
    update public.review_items
       set status = to_s, reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = coalesce(p_note, review_note),
           duplicate_of_id = coalesce(p_duplicate_of, duplicate_of_id)
     where id = p_item_id;
  elsif p_note is not null then
    update public.review_items set review_note = p_note where id = p_item_id;
  end if;

  insert into public.review_events (item_id, batch_id, action, from_status, to_status, actor, note)
  values (p_item_id, it.batch_id, p_decision, from_s, to_s, auth.uid(), p_note);

  return jsonb_build_object('id', p_item_id, 'status', to_s, 'record_id', new_id);
end $$;

-- ---------------------------------------------------------------------------
-- What can be written, and in what shape. Read straight from the catalogue, so the
-- dashboard's Add Intelligence forms and an agent's idea of the schema are the same
-- thing and cannot drift from the database.
-- ---------------------------------------------------------------------------
create or replace function public.review_schema(p_agent_key text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare out_j jsonb;
begin
  if not public.is_staff() then perform public.agent_for_key(p_agent_key, 'lookup'); end if;
  select coalesce(jsonb_agg(x order by x.sort_order, x.label), '[]'::jsonb) into out_j from (
    select rt.table_name, rt.label, rt.plural_label, rt.group_label, rt.description,
           rt.help_md, rt.required_columns, rt.identity_columns, rt.update_strategy,
           rt.requires_source, rt.supports_visibility, rt.sort_order,
           (select coalesce(jsonb_agg(c order by c.ord), '[]'::jsonb) from (
              select a.attname::text as name,
                     pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
                     not a.attnotnull as nullable,
                     a.attnum as ord,
                     (select jsonb_agg(e.enumlabel order by e.enumsortorder)
                        from pg_catalog.pg_enum e where e.enumtypid = a.atttypid) as enum_values,
                     (select cl.relname::text
                        from pg_catalog.pg_constraint con
                        join pg_catalog.pg_class cl on cl.oid = con.confrelid
                       where con.conrelid = a.attrelid and con.contype = 'f'
                         and a.attnum = any(con.conkey) limit 1) as references_table,
                     pg_catalog.col_description(a.attrelid, a.attnum) as comment,
                     (a.attname::text = any(rt.required_columns)) as required
                from pg_catalog.pg_attribute a
               where a.attrelid = rt.table_name::regclass
                 and a.attnum > 0 and not a.attisdropped
                 and a.attname::text = any(rt.allowed_columns)
            ) c) as columns
      from public.review_targets rt
     where rt.is_enabled
  ) x;
  return out_j;
end $$;

-- Entity lookup for the dashboard's pickers and for an agent checking what exists
-- before it proposes something that already does.
create or replace function public.review_lookup(p_kind text, p_q text, p_limit int default 10,
                                                p_agent_key text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare out_j jsonb; q text;
begin
  -- An agent that can check what already exists proposes fewer duplicates, so lookup
  -- is the second scope a key can carry. It reads published identity, nothing more.
  if not public.is_staff() then perform public.agent_for_key(p_agent_key, 'lookup'); end if;
  q := '%' || coalesce(p_q, '') || '%';
  case p_kind
    when 'brand' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select b.id, b.slug::text as ref, b.name as label,
               case when b.is_chicken then 'chicken' else b.sector::text end as detail
          from public.brands b where b.name ilike q or b.slug::text ilike q
          order by b.is_chicken desc, similarity(b.name, coalesce(p_q,'')) desc limit p_limit) x;
    when 'company' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select c.id, c.slug::text as ref, c.name as label, c.kind::text as detail
          from public.companies c where c.name ilike q or c.slug::text ilike q
          order by similarity(c.name, coalesce(p_q,'')) desc limit p_limit) x;
    when 'market' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select m.id, m.slug::text as ref, m.name as label, m.state as detail
          from public.markets m where m.name ilike q limit p_limit) x;
    when 'property' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select p.id, p.slug::text as ref,
               coalesce(p.address_line1 || ', ' || p.city, p.location_label, p.slug::text) as label,
               p.state as detail
          from public.properties p
         where coalesce(p.address_line1,'') ilike q or coalesce(p.city,'') ilike q
            or coalesce(p.location_label,'') ilike q limit p_limit) x;
    when 'source' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select s.id, s.key::text as ref, s.publisher || ' — ' || s.title as label,
               coalesce(s.date_label, s.published_on::text) as detail
          from public.sources s
         where s.publisher ilike q or s.title ilike q or s.key::text ilike q
         order by s.created_at desc limit p_limit) x;
    when 'metric' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select null::uuid as id, m.key::text as ref, m.label, m.unit::text as detail
          from public.metrics m where m.key::text ilike q or m.label ilike q limit p_limit) x;
    when 'transaction' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out_j from (
        select t.id, t.slug::text as ref,
               coalesce(t.location_label, t.target_label, t.kind::text) as label,
               t.date_label as detail
          from public.transactions t
         where coalesce(t.location_label,'') ilike q or coalesce(t.target_label,'') ilike q
         limit p_limit) x;
    else raise exception 'unknown lookup kind %', p_kind using errcode = '22023';
  end case;
  return out_j;
end $$;

-- ---------------------------------------------------------------------------
-- The queue, ready to render. security_invoker so RLS on review_items decides who
-- sees what, rather than the view's owner - the mistake 0016 corrected on
-- v_current_facts.
-- ---------------------------------------------------------------------------
create view public.v_review_queue with (security_invoker = true) as
  select i.id, i.batch_id, i.seq, i.target_table, t.label as target_label,
         t.group_label, i.operation, i.target_id, i.title, i.entity_label, i.summary,
         i.rationale, i.payload, i.baseline, i.confidence, i.confidence_pct,
         i.visibility, i.status, i.submitter_kind, i.submitted_by, i.submitted_by_label,
         i.dedupe_key, i.reviewed_by, i.reviewed_at, i.review_note, i.applied_at,
         i.applied_record_id, i.created_at, i.updated_at,
         b.title as batch_title, b.ref as batch_ref, b.agent_name,
         (select count(*) from public.review_item_sources s where s.item_id = i.id) as source_count,
         (select count(*) from public.review_item_matches m
           where m.item_id = i.id and m.resolution = 'unresolved') as open_match_count
    from public.review_items i
    join public.review_targets t on t.table_name = i.target_table
    left join public.review_batches b on b.id = i.batch_id;

comment on view public.v_review_queue is
  'The review queue with its target label, batch and provenance counts joined in.';

-- ---------------------------------------------------------------------------
-- The raw helpers exist so review_submit can run for an agent, which has no session.
-- Nothing outside this file may call them: EXECUTE on a function is granted to PUBLIC
-- by default, and leaving it that way would let any caller read a row of any target
-- table straight out of review_row_json_raw.
-- ---------------------------------------------------------------------------
revoke execute on function public.review_row_json_raw(text, uuid) from public;
revoke execute on function public.review_validate_raw(uuid) from public;
revoke execute on function public.review_find_matches_raw(uuid) from public;
revoke execute on function public.review_resolve_ref(text, uuid) from public;
revoke execute on function public.review_resolved_payload(uuid) from public;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.review_row_json_raw(text, uuid) from %I', r);
      execute format('revoke execute on function public.review_validate_raw(uuid) from %I', r);
      execute format('revoke execute on function public.review_find_matches_raw(uuid) from %I', r);
      execute format('revoke execute on function public.review_resolve_ref(text, uuid) from %I', r);
      execute format('revoke execute on function public.review_resolved_payload(uuid) from %I', r);
    end if;
  end loop;
end $$;
