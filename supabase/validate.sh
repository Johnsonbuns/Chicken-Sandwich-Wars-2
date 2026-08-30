#!/bin/bash
#
# Applies every migration to a throwaway local Postgres, so a syntax error or a broken
# constraint is caught before anything touches Supabase.
#
# Needs a Postgres 16 server on port 5433 (see db/PROVISIONING.md). Supabase provides
# `anon`, `authenticated`, `service_role` and the `auth` schema; those are stubbed here.
# PostGIS is usually absent locally, so the two geography lines are substituted - they
# are plain PostGIS and Supabase ships it, but note that they are the one part this
# script does not actually exercise.
#
#   ./supabase/validate.sh
#
set -u
PSQL="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
psql -h /tmp -p 5433 -U postgres -q -c "drop database if exists cswtest;" -c "create database cswtest;" >/dev/null 2>&1

# Supabase provides these roles and the auth schema; stub them so the migrations
# can be applied exactly as they will run in production.
psql -h /tmp -p 5433 -U postgres -q -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end \$\$;" >/dev/null 2>&1
$PSQL -d cswtest -c "
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as \$\$ select null::uuid \$\$;
  create or replace function auth.role() returns text language sql stable as \$\$ select 'authenticated'::text \$\$;
" >/dev/null 2>&1

FAIL=0
for f in supabase/migrations/*.sql; do
  sed -e '/create extension if not exists postgis/d' \
      -e 's/extensions\.geography(Point,4326)/text/' \
      -e '/using gist (geog)/d' "$f" > /tmp/mig.sql
  OUT=$($PSQL -d cswtest -f /tmp/mig.sql 2>&1)
  if [ $? -eq 0 ]; then
    echo "  ok    $(basename $f)"
  else
    echo "  FAIL  $(basename $f)"
    echo "$OUT" | grep -E "^psql:|ERROR|DETAIL|HINT" | head -6 | sed 's/^/          /'
    FAIL=1
  fi
done
exit $FAIL
