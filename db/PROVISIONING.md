# Provisioning — what the owner has to click

Everything an agent cannot do. Nothing here changes the repository.

**There is no `vercel link` step.** The repo is already connected to Vercel, and Supabase
was provisioned on its own rather than through the Vercel Marketplace, so there is nothing
to link. An earlier draft of `db/SCHEMA.md` said otherwise; it was wrong.

---

## What is needed, and when

| Step | Needed for | Needed now? |
|---|---|---|
| Supabase project exists | everything | ✅ done |
| Run migrations in the SQL Editor | Phase 1 | Yes, when Phase 1 lands |
| Project URL + keys available to whoever runs the import | Phase 2 | Yes, when Phase 2 lands |
| Env vars set in Vercel | Phase 3 (`api/`) | **Yes — the forms are built and need them** |
| `RESEND_API_KEY` + `CSW_NOTIFY_EMAIL` | being told a lead arrived | Yes, or submissions land unread |
| Migrations `0016`–`0020` | the intelligence desk | **Yes — `/admin/` is built** |
| A Supabase user for yourself, and one line of SQL | signing in to the desk | Yes, once |
| Confirm `intake` is in **Exposed schemas** | `POST /api/submit` working at all | **Worth checking now — see §5** |

**Phase 1 needs no credentials from you at all.** Migrations are `.sql` files; you paste
them into the Supabase SQL Editor and press Run. Nothing has to leave the dashboard.

---

## 1. Finding the project URL and keys (Supabase)

1. Open <https://supabase.com/dashboard> and select the project.
2. Left sidebar, bottom: **Project Settings** (the gear).
3. Click **API Keys** (on some projects this is just **API**).

You want three values:

- **Project URL** — `https://<project-ref>.supabase.co`. Not secret.
- **Publishable / anon key** — safe to ship in a browser. Labelled `anon` `public` on
  older projects, `sb_publishable_...` on newer ones.
- **Secret / service_role key** — **bypasses every RLS policy.** Treat it like a root
  password. Labelled `service_role` `secret` on older projects, `sb_secret_...` on newer
  ones. It sits behind a *Reveal* button.

If the sidebar looks different from this, say what you actually see rather than hunting —
Supabase moves this page around and the labels above are the stable part.

## 2. Running migrations (Phase 1)

1. Left sidebar: **SQL Editor**.
2. **New query**.
3. Paste one migration file, press **Run**, confirm success, move to the next. In order,
   `0001` first — it enables the extensions everything else depends on.

Two things to check afterwards, both in the dashboard:

- **Database → Extensions** should show `postgis`, `citext`, `pg_trgm` and `btree_gist` enabled.
- **Table Editor** should list the new tables, and the `intake` schema should appear in
  the schema dropdown.

## 3. Vercel environment variables — needed now

The forms are wired. Until these are set, `POST /api/submit` returns 503 and the site
falls back to the old clipboard-and-`mailto:` behaviour, so nothing breaks — but nothing
is stored either.

1. <https://vercel.com/dashboard> → select the Chicken Sandwich Wars project.
2. **Settings** tab → **Environment Variables** in the left menu.
3. Add three, each ticked for Production, Preview and Development:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL |
| `SUPABASE_ANON_KEY` | the publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret / service_role key — mark it **Sensitive** |
| `CSW_IP_SALT` | any long random string; it is what makes stored IP hashes irreversible |
| `RESEND_API_KEY` | optional, from resend.com — without it submissions are stored but nobody is emailed |
| `CSW_NOTIFY_EMAIL` | optional; where those notifications go |

4. Redeploy. Vercel only injects environment variables at build and invocation time, so
   existing deployments will not see them.

There is also a Supabase integration under Vercel's **Integrations** that can sync these
automatically. The manual route above always works and is three fields; use the
integration only if you would rather it manage them.

---

## 4. The intelligence desk (`/admin/`)

The dashboard needs migrations `0016`–`0020` and an account. Nothing else.

1. **SQL Editor → New query.** Paste the output of `./supabase/bundle.sh 0016` — that is
   migrations `0016` and later in one transaction — and press Run. If any statement
   fails, the whole thing rolls back and there is nothing to clean up.

2. **Authentication → Users → Add user.** Use your own email, **set a password**, and
   tick *Auto Confirm User* so there is no invitation email to wait for.

   The password is how you sign in. The desk also offers an emailed six-digit code, but
   that needs `{{ .Token }}` in the Magic Link email template and Supabase only allows
   editing templates once custom SMTP is configured — so on the built-in mailer the
   email sends a link and the code never arrives. The password needs no mail at all.

   The desk's sign-in form sends `create_user: false`, so this is the only way an account
   comes into existence — someone who finds the URL cannot sign themselves up. Under
   **Authentication → Providers → Email**, confirm *Enable email signups* is off as well:
   that closes the same door at the project level.

3. **Open `https://<your-site>/admin/`** and sign in with that email and password.

4. You will be told you have no desk access, and shown one line of SQL with your own user
   id already in it. Paste it into the SQL editor. Reload. You are an admin.

   This step is deliberately manual and happens exactly once. Everyone after you is added
   from **Settings → Desk access** in the dashboard itself.

5. **Settings → Agent keys → Mint a key** when you want a research agent to start
   submitting. The key is shown once and stored only as a hash. Hand it to the agent
   along with `db/AGENT_INTAKE.md`.

Nothing else needs an environment variable. The desk uses `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, both of which are already on the list above — but note that
`api/submit.js` never read the anon key, so if it was skipped the forms would have kept
working and you would not have known.

## 5. One thing worth checking: is `intake` exposed?

`api/submit.js` reaches the form-submission tables by sending PostgREST an
`Accept-Profile: intake` header. That header only works if `intake` is listed under
**Settings → API → Exposed schemas**. `db/SCHEMA.md` and `CLAUDE.md` both say the schema
is *not* exposed, which — if true — means every form submission since Phase 3 has been
failing and falling back to the old `mailto:` behaviour. That failure is invisible: the
fallback works, so nothing looks broken.

Two ways to tell, either is fine:

- Open the desk's **Leads** screen. If submissions are listed, the endpoint is working.
  If it says the schema is not exposed, it is not.
- **Table Editor → schema dropdown → intake → submissions.** An empty table on a site
  that has had traffic is the same answer.

If it is not exposed, add `intake` to the exposed schemas list. It is safe: every
privilege on that schema is revoked from `anon` and `authenticated` by migration `0010`,
so exposure alone grants nobody anything — the service-role key in `api/submit.js` is
still the only thing that can read or write it.

The desk itself is unaffected either way. It reads leads through a `security definer`
function in `public`, precisely so it does not depend on the answer.

---

## Handling the secret key

**Do not paste the service_role / secret key into a chat session.** It bypasses RLS
entirely — anyone holding it can read every submission, every contact email and every
phone number in `intake`, and can drop tables. Pasting it into a conversation puts it in
that transcript permanently.

The three ways to run Phase 2's import without that happening, best first:

1. **Run it yourself.** `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:import`
   in your own terminal. The agent writes the script; you supply the key. Nothing sensitive
   crosses the conversation.
2. **Use the SQL Editor.** For a one-off seed, the import can emit a `.sql` file you paste
   in, exactly like the migrations.
3. **Accept the exposure deliberately** — only on a throwaway project holding no real
   submissions, and rotate the key afterwards under
   **Project Settings → API Keys → Rotate**.

The publishable / anon key is a different matter: it is designed to ship in browsers and
is safe to share. It just cannot write past RLS, which is why the import needs the other one.

---

## Not yet decided

- **Region** — `us-east-1` unless there is a reason otherwise. Set at project creation and
  awkward to change later, so worth confirming now.
- **Email provider** for submission notifications and the newsletter (Resend is the lightest fit).
- **Turnstile or hCaptcha** on the public forms, before `POST /api/submit` is linked from a live page.
