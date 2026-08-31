# The intelligence desk

`/admin/` — the internal dashboard. Everything the site knows, one queue to change it,
and one door for research agents.

```
human entry ─┐
             ├─→ review queue ─→ approve / edit / reject / needs verification ─→ canonical data ─→ site, if public
agent run ───┘
```

Nothing writes to `public.brands`, `public.facts` or `public.transactions` except
`review_apply()`, and it only writes what `review_targets` allows. That is the design in
one sentence.

---

## Getting in

**Sign-in is a six-digit code by email.** There is no password. The dashboard holds a
normal Supabase user session and nothing more privileged; every request carries that
token and Postgres decides what comes back.

Desk accounts are created in the Supabase dashboard under **Authentication → Users**, not
by signing up — the sign-in form sends `create_user: false`, so an outsider who finds the
URL cannot even create an account. Once someone has signed in once, an admin grants them
a role from **Settings → Desk access**.

**The first admin** is the one thing that needs SQL, deliberately: any function that could
turn an arbitrary signed-in user into an admin would be a door, and this is used exactly
once. Sign in, and the screen prints the line to paste into the Supabase SQL editor:

```sql
insert into public.staff_profiles (user_id, role, full_name)
values ('<the uuid the screen shows you>', 'admin', 'Your Name');
```

### Roles

| Role | Can |
|---|---|
| `admin` | Everything, including granting access and minting agent keys |
| `editor` | Approve, edit and reject; see confidential intelligence |
| `analyst` | Propose and read; **cannot** approve, **cannot** see confidential records |
| `viewer` | Read |

The split that matters is `analyst`: someone can add findings all day without being able
to publish one.

---

## The screens

**Overview** — what is waiting, what was approved this week, how many sources still need
checking against their primary document, how many records are held back from the site.

**Review queue** — every proposal, from the desk and from agents, in one list. Open one
and you get: what changes, with the current value beside the proposed one; the citation,
with the sentence it was read from; any record that looks like a duplicate; and the four
decisions. `j`/`k` move, `a` approves, `r` rejects, `v` asks for verification.

*Approve* applies the change in a single database transaction. *Edit & approve* merges
your corrections into the proposal first and keeps a record of what you changed. *Reject*
and *Needs verification* both want a reason, and the reason is kept.

**Add intelligence** — a form per record type, generated from the database's own column
metadata. It cannot drift from the schema: add a column to a target's `allowed_columns`
and it appears here with its type, its enum values and its foreign key already understood.
Your own entries go through the queue like everyone else's.

**Research runs** — one run is one task. It carries the prompt the agent was given, which
is what makes forty proposals reviewable: without it you cannot tell what was in scope.

**Intelligence** — the canonical records, published and withheld, each with its change
history and a *Propose an edit* that lands back in the queue.

**Leads** — the site's five forms. Read and triaged here rather than in the database.

**Settings** — agent keys and desk access.

---

## Public, internal, confidential

Three states on every record that carries intelligence:

| | Means |
|---|---|
| `public` | May appear on the site, once `is_published` says so |
| `internal` | Staff-wide. Informs analysis, never rendered |
| `confidential` | Admin and editor only. Under NDA or personally sourced |

The important part is not the label. It is the check constraint under it: a record that is
not `public` **cannot** be flagged published. Publishing confidential intelligence is a
database error rather than a thing to remember. The export path filters on it too, so a
withheld figure cannot reach `data/*.json` when Phase 4 makes that file generated.

---

## Agent keys

Minted under **Settings**, shown once, stored only as a sha256. A key can do two things:
put a proposal in the queue, and look up what already exists. It cannot read a lead, see a
confidential record, approve anything, or write to a single canonical table — and that is
structural, not policy. `db/AGENT_INTAKE.md` is the contract; give it to the agent.

Revoke a key the moment it is not in use. The desk shows when each one was last used.

---

## What can be written, and where that list lives

`public.review_targets` — eighteen tables, each with the exact columns a proposal may set.
It is the security boundary for the whole apply path, which builds dynamic SQL: without
it, "any column of any table" would make a proposal setting `staff_profiles.role`
indistinguishable from one setting a cap rate.

Adding a target or widening one is an admin action and a deliberate one. Migration `0019`
seeds the list and asserts, at migration time, that every column it names exists — a
whitelist naming a column that is not there is a proposal that fails at the moment of
approval, which is the worst time to find out.

Two rules carried per target:

- **`update_strategy = 'supersede'`** on `facts` and `brand_cap_rates`. A correction writes
  a new observation and closes the old one, so the figure the site published last quarter
  survives.
- **`requires_source`** routes an uncited proposal to needs-verification instead of the
  approval queue.

---

## Security, in one place

- The dashboard endpoint holds only the **publishable anon key**. Every request carries the
  signed-in user's JWT and is forwarded with it, so RLS and the role functions are
  evaluated against the real person by Postgres — not by JavaScript that a future
  operation could forget to call.
- The agent endpoint holds no privileged key either. The agent's key is verified **inside
  the database**, so a request that reached PostgREST directly is refused by the same code.
- The service-role key stays where it already was: `api/submit.js`, writing form
  submissions into a schema no browser role can reach. Nothing in the desk reads it.
- `intake` (PII) and `audit` (the change log) are never exposed to PostgREST. The desk
  reaches both through `security definer` functions that check `is_staff()` first.
- Every canonical write is recorded twice: in `audit.record_changes` with the diff and the
  user, and in `review_events` with the decision and the reason.

`scripts/check-admin.js` asserts the first three by enumerating every request the two
endpoints can be made to issue. `supabase/tests/review_flow.sql` asserts the rest against
a throwaway database, and both run in `npm test` / `./supabase/validate.sh`.

---

## Looking at it without a database

```bash
npm run preview:admin        # http://localhost:4174/admin/
```

Serves the dashboard from fixtures — no Supabase, no credentials, no real records. Any
email; the code is `000000`. Useful for seeing what the desk does before wiring it up, and
for working on the interface without touching production.

---

## Setting it up

1. Apply migrations `0016`–`0020` (`./supabase/bundle.sh 0016` produces one paste).
2. Check `SUPABASE_ANON_KEY` is set in Vercel. It is on the list in `db/PROVISIONING.md`
   already, but `api/submit.js` never read it, so a deployment can have been working
   without it.
3. Create your account under **Authentication → Users** in Supabase.
4. Open `/admin/`, sign in, and run the one line of SQL the screen gives you.
5. Mint an agent key under Settings when you want a research agent to start submitting.

`db/PROVISIONING.md` has the click-by-click.
