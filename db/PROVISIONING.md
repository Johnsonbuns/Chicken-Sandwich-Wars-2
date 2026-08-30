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
| Env vars set in Vercel | Phase 3 (`api/`) | **No — not until forms are built** |

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

## 3. Vercel environment variables (Phase 3 only)

Do this when the forms work starts, not before.

1. <https://vercel.com/dashboard> → select the Chicken Sandwich Wars project.
2. **Settings** tab → **Environment Variables** in the left menu.
3. Add three, each ticked for Production, Preview and Development:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL |
| `SUPABASE_ANON_KEY` | the publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret / service_role key — mark it **Sensitive** |

4. Redeploy. Vercel only injects environment variables at build and invocation time, so
   existing deployments will not see them.

There is also a Supabase integration under Vercel's **Integrations** that can sync these
automatically. The manual route above always works and is three fields; use the
integration only if you would rather it manage them.

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
