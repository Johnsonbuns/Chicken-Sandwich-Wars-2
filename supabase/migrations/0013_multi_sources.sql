-- 0013_multi_sources.sql
--
-- Also found while writing the import: two fields cite more than one publisher.
-- brands[].realEstate.capSrc and .notesSrc are arrays - Chick-fil-A's cap rate range
-- cites both Boulder Group quarterlies, and its real-estate note cites two trade reports.
-- A single source_id column silently drops the second, which is precisely the kind of
-- provenance loss the editorial rule exists to prevent.
--
-- Modelled the same way article_sources already handles it: a small join table with real
-- foreign keys, ordered for display. The parent keeps source_id as its first citation so
-- the existing not-null and check constraints still hold.

create table public.note_sources (
  note_id   uuid not null references public.entity_notes(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  ordinal   int not null default 0,
  primary key (note_id, source_id)
);

create table public.cap_rate_sources (
  cap_rate_id uuid not null references public.brand_cap_rates(id) on delete cascade,
  source_id   uuid not null references public.sources(id),
  ordinal     int not null default 0,
  primary key (cap_rate_id, source_id)
);

alter table public.note_sources     enable row level security;
alter table public.cap_rate_sources enable row level security;

create policy staff_all on public.note_sources for all to authenticated
  using (public.is_staff()) with check (public.can_edit());
create policy staff_all on public.cap_rate_sources for all to authenticated
  using (public.is_staff()) with check (public.can_edit());

create policy anon_read on public.note_sources for select to anon, authenticated
  using (exists (select 1 from public.entity_notes n where n.id = note_id and n.is_published));
create policy anon_read on public.cap_rate_sources for select to anon, authenticated
  using (exists (select 1 from public.brand_cap_rates c join public.brands b on b.id = c.brand_id
                 where c.id = cap_rate_id and b.is_published));
