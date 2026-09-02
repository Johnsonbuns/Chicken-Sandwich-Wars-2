# Next session prompt

Copy everything below the line into a fresh Claude Code session on this repository.

Last updated 2026-09-01, at the end of the freshness re-run. The database phases this
file used to describe are all merged and shipped; nothing below refers to them.

---

## Where things stand

The site is live on Vercel, `main` deploys to production, and `npm test` passes on `main`
as of the last commit. Read `CLAUDE.md` in full first — the environment notes in it were
rewritten on 2026-09-01 and the old ones would send you down a wrong path.

The freshness check currently reports **11 overdue scoring inputs, 0 undated, 1 due for
review** across 15 ranked brands. Overdue is not a failure — it is the disclosure working.
`npm test` passing is the bar.

## The one thing worth doing first

**KFC U.S. is scored on a number Yum does not publish.** `metrics.compsPct` is `2`, which
is Yum's *KFC Division* same-store sales — a division that is 90% non-U.S. by units. It is
attached to a brand record whose every other figure is U.S.-scoped.

This was verified against three primary documents (Q2 2026 10-Q, FY2025 10-K, Q2 2026
earnings release); none of them discloses a KFC U.S. comparable-sales figure. Evidence and
exact quotes are in `db/findings/2026-09-01-freshness-rerun-primary-sources.json` under
`decisions`.

On 2026-09-01 the desk published an as-of date for it (`YE2025`, cited to
`thestreet-kfc-207`). That moved it from "undated" to "overdue" in the check and made it
look like an ordinary stale figure. **It is not stale, it is mislabelled**, and dating it
did not address that.

The recommended fix is to drop the input so Consumer Demand renders "—", per the editorial
rule. Before doing it, work out the consequence: the remaining weights renormalise, and if
KFC drops below three available components it becomes unrated. That is a real editorial
decision, so put the numbers in front of the owner rather than deciding it yourself.

If the desk would rather keep a number, the honest alternative is to relabel it as KFC
Division (global) and decide separately whether a global comp belongs in a U.S. brand's
score. That is the weaker option.

## What is still overdue, and why it is stuck

Five AUVs rest on FDD Item 19 figures that could not be read. Their superseding documents
exist and are dated — see `fdd_supersessions` in the same findings file:

| Brand | Current FDD effective |
|---|---|
| Bojangles | 2026-04-20 |
| Chicken Salad Chick | 2026-04-21 |
| Zaxby's | 2026-04-24 |
| Slim Chickens | 2026-04-29 |
| Dave's Hot Chicken | 2026-05-04 |

Wisconsin's registry publishes the filing metadata but not the document. Minnesota's CARDS
system, which does publish whole FDD PDFs, returns 403 from this environment. **If CARDS
ever becomes reachable, that is one pass that closes all five** — it is the single highest
-leverage thing on this list.

Do not fill these from FDD aggregator sites. Two of them put Zaxby's AUV at $2,847,345 and
$2,544,354 — a $303k spread on a figure that decides a rank. Reachable is not sourced.

Two more brands entered the rankings on 2026-09-01 and arrived overdue: Pollo Campero
(2024 FDD, 32 months) and Golden Chick (2023 FDD, 44 months).

## How to actually submit research

Use `www`, not the apex:

```bash
node scripts/agent-submit.js <findings.json> --dry-run
node scripts/agent-submit.js <findings.json>
```

The script defaults to `https://www.chickensandwichwars.com` since 2026-09-01. The apex
308-redirects to `www` and both `fetch` and `curl` drop the `Authorization` header across
a host change, so posting to the apex returns `401 — Send an agent key` with a perfectly
good key. If you see that 401, check the URL before you conclude the key is bad; that
mistake cost a session an hour.

`CSW_AGENT_KEY` is already set in this environment. `--dry-run` validates shape and
targets without queueing anything.

Only the `items` array is submittable. `decisions` and `fdd_supersessions` are for human
readers — the intake contract has only `insert` and `update`, so a removal or an unreadable
supersession cannot be expressed as a payload. Keep that separation.

## Two process facts that will otherwise cost you time

**Approving is not publishing.** The build reads `data/*.json` and never touches the
database. A figure reaches the site only when someone presses **Publish to site** in the
desk. If you tell the owner a number is live before that, you will be wrong.

**Pushing to `main` is allowed by this repo but may be refused by the harness.** `main`
carries no branch protection and `.claude/settings.json` allows the git commands, but on
2026-09-01 the auto-mode classifier refused `git push origin main` while allowing the
identical push to the session's own `claude/…` branch. Do not spend the session fighting
it — commit, push to the session branch, open a pull request, and say so. An unpushed
commit dies with the container; that is how an earlier run lost two commits outright.

## Environment

Direct page fetches work. `sec.gov` and `data.sec.gov` are the good path —
`data.sec.gov/submissions/CIK##########.json` lists every filing with form, date and
primary document. Send a real `User-Agent`. A 10-Q runs to 2MB, which is too much to hand
a summariser: `curl` it, strip tags, and grep the disclosure yourself. That is how the
El Pollo Loco and KFC findings were established, and it is the difference between
`confirmed` and `medium` confidence in a findings file.

`CLAUDE.md` has the full list of what is reachable and what is not. Check
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` before concluding the network is at fault —
a single 503 is one host refusing, not the proxy.
