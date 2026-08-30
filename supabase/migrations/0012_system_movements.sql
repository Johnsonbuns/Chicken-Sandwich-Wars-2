-- 0012_system_movements.sql
--
-- Found while writing the import: every row in movement.json's closure feed is an
-- AGGREGATE - "KFC closed 312 U.S. restaurants in twelve months", "roughly 33 Popeyes
-- leases rejected in Florida and Georgia". Not one is a unit-level record. Three of the
-- ten openings are aggregates too ("Eight U.S. markets in one day", "National").
--
-- These do not fit `facts`: they carry a count AND a geographic scope AND a narrative,
-- and facts has nowhere to put the scope. They are not property_occupancies either -
-- there is no property. They are brand-level movement events, so they get a table.
--
-- Individually located events still create a property and an occupancy; this row then
-- points at that property. The two are different views of the same event, not duplicates:
-- system_movements is the published feed, property_occupancies is the property graph.

create type movement_direction as enum ('opening','closure');

create table public.system_movements (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid references public.brands(id),
  direction      movement_direction not null,
  date_label     text not null,              -- '2026-07', '2025-07 to 2026-07'
  occurred_on    date,
  period_start   date,
  period_end     date,
  unit_count     int,                        -- null for a single unit
  location_label text,                       -- 'United States', 'Florida and Georgia'
  detail_md      text,
  -- Set when the event is specific enough to be one identifiable box.
  property_id    uuid references public.properties(id),
  source_id      uuid not null references public.sources(id),
  ordinal        int not null default 0,
  is_published   boolean not null default true,
  created_at     timestamptz not null default now()
);
create index system_movements_feed on public.system_movements (direction, ordinal);
create index system_movements_brand on public.system_movements (brand_id, direction);

alter table public.system_movements enable row level security;

create policy staff_all on public.system_movements for all to authenticated
  using (public.is_staff()) with check (public.can_edit());
create policy anon_read on public.system_movements for select to anon, authenticated
  using (is_published);

create trigger audit_system_movements after insert or update or delete
  on public.system_movements for each row execute function audit.log_change();
