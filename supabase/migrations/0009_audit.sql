-- 0009_audit.sql
-- On a site whose product is accuracy, "who changed this number and when" is not optional.

create schema if not exists audit;

create table audit.record_changes (
  id         bigserial primary key,
  table_name text not null,
  record_id  uuid,
  operation  text not null,
  changed_by uuid,
  diff       jsonb,
  changed_at timestamptz not null default now()
);
create index record_changes_lookup on audit.record_changes (table_name, record_id, changed_at desc);

create or replace function audit.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec_id uuid;
  payload jsonb;
begin
  if tg_op = 'DELETE' then
    rec_id  := (to_jsonb(old) ->> 'id')::uuid;
    payload := jsonb_build_object('old', to_jsonb(old));
  elsif tg_op = 'INSERT' then
    rec_id  := (to_jsonb(new) ->> 'id')::uuid;
    payload := jsonb_build_object('new', to_jsonb(new));
  else
    rec_id  := (to_jsonb(new) ->> 'id')::uuid;
    -- Only the columns that actually changed, so the log stays readable.
    payload := jsonb_build_object(
      'old', (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(old))
              where to_jsonb(new) -> key is distinct from value),
      'new', (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(new))
              where to_jsonb(old) -> key is distinct from value));
  end if;

  insert into audit.record_changes (table_name, record_id, operation, changed_by, diff)
  values (tg_table_schema || '.' || tg_table_name, rec_id, tg_op, auth.uid(), payload);

  return coalesce(new, old);
end $$;

-- Attached to the tables where a silent change would be most damaging.
create trigger audit_facts        after insert or update or delete on public.facts
  for each row execute function audit.log_change();
create trigger audit_sources      after insert or update or delete on public.sources
  for each row execute function audit.log_change();
create trigger audit_brands       after insert or update or delete on public.brands
  for each row execute function audit.log_change();
create trigger audit_properties   after insert or update or delete on public.properties
  for each row execute function audit.log_change();
create trigger audit_transactions after insert or update or delete on public.transactions
  for each row execute function audit.log_change();
create trigger audit_listings     after insert or update or delete on public.listings
  for each row execute function audit.log_change();
