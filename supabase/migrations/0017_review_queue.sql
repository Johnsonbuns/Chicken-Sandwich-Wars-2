-- 0017_review_queue.sql
--
-- The review queue: one door into canonical data, for people and for agents alike.
--
-- Nothing writes to public.brands, public.facts or public.transactions directly any
-- more except the apply function in 0018. A human filling in the dashboard form and a
-- Claude research run reporting a finding produce the same kind of row here, and both
-- wait for the same decision. That is the whole design: the reviewer is the only path
-- from "someone believes this" to "the site says this".
--
-- Three properties this has to have, and the tables that give them:
--
--   provenance    review_item_sources - a citation per item, either an existing
--                 sources row or a proposed new one that gets created on approval.
--   reversibility review_events plus audit.record_changes - every state change and
--                 every canonical write is recorded, by whom, with the diff.
--   no silent duplicates  review_item_matches - a proposal that looks like an
--                 existing record is flagged for a human, never merged automatically.

create type review_status      as enum ('pending','needs_verification','approved','applied',
                                        'rejected','duplicate','withdrawn');
create type review_op          as enum ('insert','update');
create type submitter_kind     as enum ('human','agent','import');
create type confidence_level   as enum ('low','medium','high','confirmed');
create type review_batch_status as enum ('open','submitted','closed','abandoned');
create type match_resolution   as enum ('unresolved','same','different');

-- ---------------------------------------------------------------------------
-- Agent credentials.
--
-- An agent is not a Supabase user: it has no inbox, so it cannot hold a session, and
-- giving it one would put a canonical-write-capable identity in a script. It gets a
-- bearer key that can reach exactly two things - submit a proposal, and look up what
-- already exists. The raw key is shown once at creation and stored only as a hash.
-- ---------------------------------------------------------------------------
create table public.agent_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  key_prefix   text not null,                    -- first characters, for recognising it in a list
  key_hash     text not null unique,             -- sha256 of the full key, hex
  scopes       text[] not null default array['submit','lookup'],
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  use_count    bigint not null default 0,
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id)
);
create index agent_keys_active_idx on public.agent_keys (key_hash) where revoked_at is null;

comment on table public.agent_keys is
  'Bearer credentials for research agents. Scopes are deliberately tiny: submit and
   lookup. No key can reach canonical data - see api/agent.js and 0018.';

-- ---------------------------------------------------------------------------
-- What may be written, and which columns of it.
--
-- The apply function builds dynamic SQL. Without a whitelist that means "any column of
-- any table", which is a privilege escalation dressed as a feature: a proposal setting
-- staff_profiles.role would be indistinguishable from one setting a cap rate. Every
-- target and every column is enumerated in 0019 and nothing else is reachable.
-- ---------------------------------------------------------------------------
create table public.review_targets (
  table_name          text primary key,          -- schema-qualified: 'public.transactions'
  label               text not null,             -- 'Transaction'
  plural_label        text not null,
  group_label         text not null default 'Intelligence',
  description         text,
  help_md             text,
  allowed_columns     text[] not null,
  required_columns    text[] not null default '{}',
  -- Columns compared when looking for an existing record that already says this.
  identity_columns    text[] not null default '{}',
  -- A SQL expression over alias t producing a human label for a row of this table.
  label_expression    text not null default 't.id::text',
  -- 'update' rewrites the row. 'supersede' closes the old row and writes a new one,
  -- which is what facts requires: a corrected AUV must not erase the figure the site
  -- published last quarter.
  update_strategy     text not null default 'update'
                      check (update_strategy in ('update','supersede')),
  requires_source     boolean not null default true,
  supports_visibility boolean not null default true,
  is_enabled          boolean not null default true,
  sort_order          int not null default 100,
  constraint review_targets_qualified check (table_name like '%.%')
);

-- ---------------------------------------------------------------------------
-- A research run. One Claude task, or one sitting at the desk, produces many items.
-- ---------------------------------------------------------------------------
create table public.review_batches (
  id           uuid primary key default gen_random_uuid(),
  ref          citext unique,                    -- caller-supplied, so a retried run is idempotent
  title        text not null,
  kind         submitter_kind not null default 'human',
  status       review_batch_status not null default 'open',
  agent_name   text,
  agent_key_id uuid references public.agent_keys(id),
  model        text,
  task_prompt  text,
  summary_md   text,
  created_by   uuid references auth.users(id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index review_batches_recent on public.review_batches (started_at desc);
create trigger review_batches_updated before update on public.review_batches
  for each row execute function public.set_updated_at();

comment on column public.review_batches.task_prompt is
  'What the agent was asked to find. Without it a run of forty proposals is
   unreviewable: the reviewer cannot tell what was in scope.';

-- ---------------------------------------------------------------------------
-- The queue row.
-- ---------------------------------------------------------------------------
create table public.review_items (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid references public.review_batches(id) on delete set null,
  seq              int not null default 0,

  target_table     text not null references public.review_targets(table_name),
  operation        review_op not null,
  target_id        uuid,                          -- null for insert

  title            text not null,                 -- 'Popeyes AUV, FY2025'
  entity_label     text,                          -- 'Popeyes' - groups a run by subject
  summary          text,
  rationale        text,                          -- why the submitter believes this

  -- Column -> proposed value. String values beginning with '@' are reference tokens
  -- (@brand:popeyes, @source:1) resolved at apply time, so a submitter never needs a
  -- uuid and a proposal stays readable in the diff.
  payload          jsonb not null,
  -- The same columns as they stood when the proposal was made. Two jobs: it is the
  -- left-hand side of the before/after diff, and it is how apply detects that the
  -- record moved under a proposal that sat in the queue for a week.
  baseline         jsonb,

  confidence       confidence_level not null default 'medium',
  confidence_pct   numeric(4,3) check (confidence_pct is null
                                       or (confidence_pct >= 0 and confidence_pct <= 1)),
  visibility       intel_visibility not null default 'public',
  status           review_status not null default 'pending',

  submitter_kind   submitter_kind not null default 'human',
  submitted_by     uuid references auth.users(id),
  submitted_by_label text,
  agent_key_id     uuid references public.agent_keys(id),
  -- Caller-supplied idempotency key. A research run that is retried after a network
  -- failure must not double the queue.
  dedupe_key       text,

  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  review_note      text,
  applied_at       timestamptz,
  applied_record_id uuid,
  duplicate_of_id  uuid references public.review_items(id),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint review_items_target_id check (
    (operation = 'insert' and target_id is null) or
    (operation = 'update' and target_id is not null)),
  constraint review_items_payload check (
    jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb)
);
create unique index review_items_dedupe_uniq on public.review_items (dedupe_key)
  where dedupe_key is not null;
create index review_items_queue on public.review_items (status, created_at desc);
create index review_items_batch on public.review_items (batch_id, seq);
create index review_items_target on public.review_items (target_table, target_id);
create index review_items_entity_trgm on public.review_items using gin (entity_label gin_trgm_ops);
create trigger review_items_updated before update on public.review_items
  for each row execute function public.set_updated_at();

comment on table public.review_items is
  'One proposed change. Nothing reaches canonical data except through review_apply()
   in 0018, which reads this row.';

-- ---------------------------------------------------------------------------
-- Provenance, per proposal.
--
-- An agent citing a trade report has a URL and a publisher, not a sources.key - the
-- source record does not exist yet. Both cases live here: source_id for something
-- already in the registry, the loose fields for something new, which becomes a real
-- sources row on approval and never before. Rejected research does not pollute the
-- source registry.
-- ---------------------------------------------------------------------------
create table public.review_item_sources (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references public.review_items(id) on delete cascade,
  ordinal           int not null default 1,
  source_id         uuid references public.sources(id),
  proposed_key      citext,
  publisher         text,
  title             text,
  url               text,
  date_label        text,
  published_on      date,
  source_type       source_type not null default 'trade_press',
  -- The sentence the figure was read from. This is what makes desk verification a
  -- minute rather than an afternoon.
  quote             text,
  accessed_at       timestamptz,
  created_source_id uuid references public.sources(id),   -- filled in by apply
  unique (item_id, ordinal),
  constraint review_item_source_identified check (source_id is not null or url is not null)
);
create index review_item_sources_item on public.review_item_sources (item_id, ordinal);

-- ---------------------------------------------------------------------------
-- Possible duplicates. Flagged, never merged.
-- ---------------------------------------------------------------------------
create table public.review_item_matches (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.review_items(id) on delete cascade,
  candidate_table text not null,
  candidate_id    uuid not null,
  candidate_label text,
  similarity      numeric(4,3),
  reason          text not null,
  resolution      match_resolution not null default 'unresolved',
  resolved_by     uuid references auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (item_id, candidate_table, candidate_id)
);
create index review_item_matches_item on public.review_item_matches (item_id, similarity desc);

-- ---------------------------------------------------------------------------
-- History. audit.record_changes records what happened to the canonical row; this
-- records what happened to the proposal, including the decisions that produced no
-- canonical write at all. A rejection with a reason is the most useful row in here.
-- ---------------------------------------------------------------------------
create table public.review_events (
  id          bigserial primary key,
  item_id     uuid references public.review_items(id) on delete cascade,
  batch_id    uuid references public.review_batches(id) on delete cascade,
  action      text not null,
  from_status review_status,
  to_status   review_status,
  actor       uuid references auth.users(id),
  actor_label text,
  note        text,
  detail      jsonb,
  at          timestamptz not null default now()
);
create index review_events_item on public.review_events (item_id, at desc);
create index review_events_recent on public.review_events (at desc);

-- ---------------------------------------------------------------------------
-- RLS. None of this is anonymous, ever - not even the target whitelist, which
-- describes the shape of the desk's internal process.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agent_keys','review_targets','review_batches','review_items',
                           'review_item_sources','review_item_matches','review_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_read on public.%I for select to authenticated
                      using (public.is_staff())', t);
  end loop;
end $$;

-- Confidential proposals follow the same rule as confidential data.
drop policy staff_read on public.review_items;
create policy staff_read on public.review_items for select to authenticated
  using (public.is_staff()
         and (visibility <> 'confidential' or public.can_see_confidential()));

-- Anyone on staff may propose - an analyst who cannot edit canonical data can still
-- put a finding in the queue, which is the point of having a queue.
create policy staff_propose on public.review_items for insert to authenticated
  with check (public.is_staff());
create policy staff_propose on public.review_item_sources for insert to authenticated
  with check (public.is_staff());
create policy staff_propose on public.review_batches for insert to authenticated
  with check (public.is_staff());

-- Editing a queued proposal: the reviewer, or the person who wrote it.
create policy staff_amend on public.review_items for update to authenticated
  using (public.can_edit() or submitted_by = auth.uid())
  with check (public.can_edit() or submitted_by = auth.uid());
create policy staff_amend on public.review_item_sources for update to authenticated
  using (public.can_edit()) with check (public.can_edit());
create policy staff_amend on public.review_item_matches for update to authenticated
  using (public.can_edit()) with check (public.can_edit());
create policy staff_amend on public.review_batches for update to authenticated
  using (public.can_edit() or created_by = auth.uid())
  with check (public.can_edit() or created_by = auth.uid());

-- agent_keys and review_targets are admin surface: mint, revoke, extend the whitelist.
create policy admin_write on public.agent_keys for all to authenticated
  using (public.can_edit()) with check (public.can_edit());
create policy admin_write on public.review_targets for all to authenticated
  using (public.can_edit()) with check (public.can_edit());

comment on table public.review_targets is
  'The whitelist the apply function builds dynamic SQL from. Adding a row here widens
   what any proposal can write, so it is admin surface, not configuration.';
