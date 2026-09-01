# Handoff

Current state of the project for a session picking it up cold. `CLAUDE.md` is the
permanent knowledge; this file is only what is true *right now* and what to do next.

**Last updated:** the session that built the intelligence desk (PR #22, merged to `main`).

---

## Where things stand

The site is live on Vercel and **the desk is live and in use** at
`https://chickensandwichwars.com/admin/`. The full loop has been exercised end to end by
the owner: a brand was added through the form, reviewed, approved, published, and appeared
on the public site.

```
human entry ─┐
             ├─→ review_items ─→ review_decide() ─→ review_apply() ─→ canonical tables
agent run ───┘                                                              │
                                    api/publish.js ─→ data/*.json ─→ commit ┘─→ Vercel ─→ site
```

**Production database:** migrations `0001`–`0020` are applied, and the Phase 2 seed has
been loaded (108 sources, 21 chicken brands + 12 non-chicken, 16 companies, 184 facts,
13 transactions, 37 articles). Discovered mid-session: `0012`–`0015` had never been run
against production — the project was sitting at `0011` — so anything assuming the schema
was current was wrong until that was fixed.

**`data/*.json` is generated now.** Editing it by hand still works but the next publish
overwrites it from the database. Phase 4 of `db/SCHEMA.md` is effectively done.

---

## Decisions worth knowing (and why)

**No endpoint holds a privileged key except the one that must.** `api/admin.js` forwards
the signed-in user's own Supabase JWT, so Postgres evaluates `is_staff()`, `can_edit()`
and every RLS policy against the real person. The alternative — service-role plus role
checks in JavaScript — makes every operation added later a place to forget one.
`api/publish.js` is the sole exception (the exporter must read unpublished rows) and is a
separate function *so that* `/api/admin` can keep that property. `scripts/check-admin.js`
asserts all of this.

**Agents are constrained structurally, not by policy.** An agent key reaches four RPCs,
all of which write only to `review_*` tables. The key is verified *inside* Postgres by
`agent_for_key()`, so a request reaching PostgREST directly is refused by the same code —
which is what lets `api/agent.js` hold nothing but the publishable anon key.

**Sign-in is email + password, not the emailed code.** The code path exists behind *Email
me a code instead*, but Supabase gates editing the Magic Link template behind custom SMTP,
so on the built-in mailer the email sends a link and no code ever arrives. Passwords are
set on the account in the Supabase dashboard. Configure SMTP and the code path works.

**The first admin needs one line of SQL, deliberately.** Any function that could turn an
arbitrary signed-in user into an admin is a door, and it would be used exactly once. The
desk prints the exact statement when a signed-in user has no role.

**`review_targets` is a security boundary, not configuration.** `review_apply()` builds
dynamic SQL; the whitelist of 18 tables and their columns is the only thing between a
proposal and `staff_profiles.role`. Migration `0019` asserts at migration time that every
column it names exists.

---

## What changed in the codebase

New, all documented in `db/ADMIN.md` and `db/AGENT_INTAKE.md`:

| | |
|---|---|
| `supabase/migrations/0016`–`0020` | confidentiality, review queue, apply engine, target whitelist, desk functions |
| `supabase/tests/review_flow.sql` | 97 assertions, run by `./supabase/validate.sh` |
| `admin/` | the dashboard (copied verbatim to `docs/admin/`, excluded from site checks) |
| `api/admin.js`, `api/agent.js`, `api/publish.js` | dashboard, agent intake, publish |
| `lib/supabase-rest.js` | shared PostgREST/GoTrue helpers — lives outside `api/` on purpose |
| `scripts/check-admin.js`, `scripts/check-sparse.js` | wired into `npm test` |
| `scripts/admin-preview.js` | `npm run preview:admin` — the desk on fixtures, no database |
| `scripts/agent-submit.js` | CLI for research runs, with `--dry-run` |

Changed: `scripts/export-data.js` now exposes `buildDataFiles(db)` returning files in
memory (the CLI writes them, `api/publish.js` commits them — one implementation, because
two would drift past the round-trip gate). `build.js` defaults sparse record fields and
honours `CSW_DATA_DIR` / `CSW_OUT_DIR`. `scripts/lib/csw-db.js` filters non-public rows
out of every export read.

**Environment variables now required in Vercel:** `SUPABASE_ANON_KEY` (the desk needs it;
`api/submit.js` never did, so it can have been missing unnoticed) and `CSW_GITHUB_TOKEN`
(fine-grained, Contents: read+write, this repo only). Repo owner/slug come from Vercel's
system variables.

---

## Unverified, uncertain, or left undone

**~~Is the `intake` schema exposed?~~ Answered, and it was worse than the question.**
Every form submission from Phase 3 until 2026-09-01 failed into the `mailto:` fallback.
Two causes at once: the schema was not listed under *Settings → API → Exposed schemas*,
and — the half nobody had thought to check — nothing ever granted `service_role` any
privilege on it, so even once listed, the endpoint got *permission denied for schema
intake* and returned a 502. Migration `0021` grants it; `supabase/tests/intake_access.sql`
holds both halves in place. Exposure is safe on its own, because the grant is what decides
access. **The leads from that period are not recoverable from the database** — they went
out as `mailto:` drafts, so anything a visitor actually sent is in the desk's inbox.

**The existing dataset's provenance caveat still stands.** All 108 sources are flagged
`verified_against_primary = false`; the figures came from search-result summaries rather
than primary documents. The Overview screen surfaces this as a work queue that ticks down.
AUVs and same-store sales drive the rankings and are the ones worth re-verifying first.

**Publishing validates data, not renderability.** `api/publish.js` checks JSON validity,
non-empty files, resolvable `src` ids, and refuses a publish that shrinks a file by more
than a tenth. It does *not* prove the site will build — that is Vercel's job, and a failed
build leaves the previous deployment serving (this happened once and worked as designed).
`scripts/check-sparse.js` now catches the common cause before commit.

**Not tested against a live GitHub API.** The publish path's git-object hashing is pinned
against git's own well-known hashes, and the auth/leak properties are asserted, but the
Git Data API call sequence has only been exercised in production by the owner's one
successful publish. It worked; it has not been exercised twice.

**Never run against production:** `npm run db:import` / `db:export` / `db:check` from a
developer machine. The desk is the intended path now.

---

## Recommended next steps

1. **Set `RESEND_API_KEY` and `CSW_NOTIFY_EMAIL`.** Submissions insert now, which makes
   this the live gap: the desk's Leads screen is a pull, and `notify()` returns
   `"not configured"` without them. The endpoint reports `notified` in its 200 response,
   so one test submission proves it.
2. **Do a real research run.** Mint an agent key under Settings, hand a session
   `db/AGENT_INTAKE.md` and the key, and have it verify a handful of AUVs against primary
   documents. That exercises the agent path with real work and starts paying down the
   provenance debt at the same time. `scripts/agent-submit.js --dry-run` first.
3. **Watch the first real submission land.** The path has been exercised once, by a test.
4. **Consider a second admin or an editor account** before relying on the desk. There is
   currently one admin; the last-admin guard prevents removing them, but not losing them.
