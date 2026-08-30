-- 0001_extensions.sql
-- Extensions and shared helpers. Everything downstream depends on this file, so it
-- runs first. All of these ship with Supabase; none needs a dashboard toggle.

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists citext;        -- case-insensitive slugs and emails
create extension if not exists pg_trgm;       -- fuzzy name search
create extension if not exists btree_gist;    -- required by the occupancy exclusion constraint

-- PostGIS lives in its own schema on Supabase. Geography columns are qualified as
-- extensions.geography(...) so nothing depends on search_path.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- Keeps updated_at honest without every writer remembering to set it.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

comment on function public.set_updated_at() is
  'Trigger function: stamps updated_at on every UPDATE.';
