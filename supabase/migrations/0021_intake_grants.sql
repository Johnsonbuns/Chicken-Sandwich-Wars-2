-- 0021_intake_grants.sql
-- The grant that makes POST /api/submit possible.
--
-- 0008 creates the intake schema and 0010 revokes every privilege on it from `anon`
-- and `authenticated` — but nothing ever granted anything to `service_role`, and a
-- schema created by a migration does not inherit Supabase's default privileges the
-- way `public` does. So the one role that is supposed to reach these tables could
-- not: `permission denied for schema intake`, which api/submit.js reports as a 502
-- and assets/js/site.js turns into the clipboard-and-mailto fallback. Every form
-- submission since Phase 3 took that path, and because the fallback works, nothing
-- looked broken.
--
-- Exposing `intake` under Settings → API is the other half and is not enough on its
-- own: PostgREST has to be allowed to address the schema *and* the key it is holding
-- has to be allowed to read it.
--
-- `service_role` only. It bypasses RLS by design, never leaves the server, and is
-- read from the environment inside the function — which is exactly the boundary 0010
-- describes. anon and authenticated stay revoked, and supabase/tests/intake_access.sql
-- asserts that they still are.

grant usage on schema intake to service_role;
grant all privileges on all tables in schema intake to service_role;
grant all privileges on all sequences in schema intake to service_role;

-- Tables added to intake later must not reintroduce the same silent failure.
alter default privileges in schema intake grant all on tables to service_role;
alter default privileges in schema intake grant all on sequences to service_role;

comment on schema intake is
  'PII. Reached only server-side with the service-role key, which is granted usage
   here by 0021; anon and authenticated hold no privilege on it at all. Listing the
   schema under Settings → API → Exposed schemas is required for that key to address
   it over PostgREST and grants nobody else anything.';
