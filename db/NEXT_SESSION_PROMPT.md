# Next session prompt

Copy everything below the line into a fresh Claude Code session on this repository.

Last updated 2026-09-02. The previous version of this file told you Minnesota CARDS was
unreachable. That was wrong, and everything downstream of it was wrong too — see below.

---

## Read first

`CLAUDE.md` in full. Then this. Then `db/RESEARCH_DB.md` if you are touching the research
workbook.

The site is live on Vercel, `main` deploys to production, `npm test` passes.

## The correction that changes the plan

**Minnesota CARDS works. It always did.** The host is
`www.cards.commerce.state.mn.us` — without the `www.` it is NXDOMAIN, which two earlier
runs recorded first as "403" and then as a proxy policy block. On the strength of that,
five AUVs were written up as unobtainable and sat overdue for twenty months.

`scripts/fdd-fetch.py` now drives it:

```bash
python3 scripts/fdd-fetch.py --list "Bojangles"
python3 scripts/fdd-fetch.py --get "Bojangles" --year 2025 --out research/fdd/
```

Marked FDDs on file as of 2026-09-02: Bojangles 7 years, Dave's Hot Chicken 7,
Slim Chickens 6, Chicken Salad Chick 5, Popeyes 4, Pollo Campero 4, Zaxby's 2.
Golden Chick none. **Several years per brand means the longitudinal roster comparison —
who grew, who shrank, who disappeared — is buildable now, not after a document hunt.**

CARDS lags state registration: a franchisor registered in Wisconsin as of 2026-04 may only
have its 2025 edition here. Normal. The older edition is still the primary source for its
own fiscal year.

The general lesson, which is worth more than the URL: **a "blocked" note in `CLAUDE.md` is
a hypothesis, not a finding.** Re-test before planning around it. One missing subdomain
cost this project two quarters of stale data and a whole fabricated shopping list.

## Where the FDDs live: nowhere, on purpose

**No FDD is stored in this repo and none is waiting for you.** One Zaxby's FDD was
downloaded to a scratch directory to prove the path works; that directory is ephemeral and
is gone. `research/fdd/` is git-ignored.

That is deliberate, not an oversight. The documents are ~4MB each and there are dozens of
brand-years; committing them would bloat the repo for files that `scripts/fdd-fetch.py`
re-fetches in seconds. **Re-download what you need, when you need it.**

What *does* survive is the extracted evidence:
`db/findings/2026-09-02-zaxbys-item19-cards.json` carries the full Item 19 table, the
quartiles, the document id and the verbatim quote. Do the same for every FDD you read —
the PDF is disposable, the extraction is not.

## THE RULE FOR EVERYTHING YOU PULL OUT OF AN FDD

> **FDD contents go into the Google Sheet. They do NOT go into the website.**

This is the owner's explicit instruction and it is the point of the whole setup. A run that
reads five FDDs and files five proposals into the CSW review queue has done the wrong job.

- Franchisee lists, unit counts by state, transfers, terminations, openings, closures,
  addresses, phone numbers, operator names → **`FDD_ROSTER` and `FDD_UNITS` in the Google
  Sheet.** All of it, including the boring rows.
- Only a figure the owner later marks `ready` goes anywhere near CSW, and even then it
  goes through the review queue, not into `data/`.

The Sheet is where research accumulates over years. The website is a small, strict,
published subset of it. Do not invert that.

The live workbook is a native Google Sheet in the owner's Drive:

| | |
|---|---|
| Title | `CSWResearchDatabase` |
| File id | `1zePMXe4EW_-uw9kMIzSWSb62RTrHUx5ddrULk5JSa20` |
| Link | https://docs.google.com/spreadsheets/d/1zePMXe4EW_-uw9kMIzSWSb62RTrHUx5ddrULk5JSa20/edit |

Readable through the Google Drive connector (`read_file_content` with that id) — verified
2026-09-02, all 13 tabs intact. **The connector reads but cannot write cells.** So to add
extracted rows you either hand the owner a block to paste, or build the Apps Script that
runs the sweep inside the Sheet. Ask before assuming which; the owner has not chosen yet.

The repo copy at `research/CSW-Research-Database.xlsx` is the SEED, not the live data. Once
the owner has typed into the Sheet, the repo copy is stale by definition — never treat it
as current and never regenerate the Sheet from it.

## Where the work stands

**Zaxby's Item 19 is read.** From the 2025 FDD (FY2024, 776 measured franchised
restaurants, period 2024-01-01 to 2024-12-29):

| | |
|---|---|
| Average Gross Revenues, all measured | **$2,782,488** |
| Median | $2,710,374 |
| Top quartile average | $3,889,984 |
| Bottom quartile average | $1,810,336 |

Two findings fall out and **neither has been submitted yet**:

1. The site shows `auvUsd 2710000` for Zaxby's, which is the **median**, not the average,
   labelled as AUV. Same document, same period, wrong statistic. Decide whether CSW's AUV
   means mean or median, apply it consistently, then correct the figure.
2. The two aggregator sites that disagreed by $303k gave $2,847,345 and $2,544,354.
   **Both are wrong** — neither is the mean or the median. `CONFLICTS` row CF-0001 in the
   workbook can be closed, and "reachable is not sourced" now has a worked example.

**KFC U.S. — decided by the owner: US-only, so the input goes.** `metrics.compsPct = 2` is
Yum's KFC *Division* figure (~90% non-U.S. by units) and Yum publishes no KFC U.S. comp at
all. Dropping it takes KFC from score 48 / rank 8 to **score 31 / rank 15 of 15**, still
rated on exactly three components; no other brand changes rating. The +2% was scoring
83/100 and single-handedly holding a brand that closed 312 U.S. restaurants eight places up
the table. **Not yet applied.** `facts` supersedes and the intake contract has only
insert/update, so there is no way to express a removal as a proposal — this is a desk
action against the fact, then Publish.

## The research database

The owner's notebook for accumulating research over years. It is **not** part of the build
and nothing regenerates it. The live copy is the native Google Sheet linked above; the repo
copy is only the seed.

Two rules that are the whole design:

- **`»` columns are the machine's**, grey, far right of every tab. A human never types in
  one; a sweep never writes outside one.
- **`ready` is opt-in.** Nothing is promoted toward CSW unless the owner marked it. Do not
  reintroduce a heuristic that infers intent from confidence.

`scripts/research-db-sweep.py <file>` reports what is new, matches operator names against
aliases, flags contradictions with published figures, and emits a findings file for
`scripts/agent-submit.js`. Fuzzy matches are reported, never applied.

## What to do next, in order

1. **Pull the FDDs and read Item 19 for the four other stuck brands** — Bojangles,
   Chicken Salad Chick, Slim Chickens, Dave's Hot Chicken. This closes most of the eleven
   overdue scoring inputs and it is now a scripted download, not a favour to ask.
   Watch the basis: Zaxby's publishes mean *and* median by quartile, and picking the wrong
   one is how the current Zaxby's figure went wrong.
2. **Settle mean-vs-median for `auvUsd`**, document it on /methodology/, and correct
   Zaxby's. This is a definition question, not a data question, and every other Item 19
   figure depends on the answer.
3. **Apply the KFC removal** at the desk, then Publish.
4. **El Pollo Loco Q4 comps** — overdue, self-serviceable from EDGAR, no blockers.
5. **Build the roster extractor — this is the real work, and it targets the Sheet.**
   Item 20 carries a complete franchisee list and, under 16 CFR 436.5(t)(3), a list of
   franchisees who left in the last fiscal year with contact details. Several years per
   brand are already downloadable. Load whole lists into `FDD_ROSTER` — a name missing this
   year only means an exit if last year's list was complete — then diff across years to get
   who grew, who shrank, who vanished, and who bought their units. Everything above this
   line is maintenance; this is the proprietary dataset.
   **Output goes to the Google Sheet, not to CSW.** See the rule above.
6. **Golden Chick** (2023 FDD, 44 months, oldest figure on the site) is not in CARDS. Needs
   another state, or it stays overdue and disclosed.

## Process facts that still hold

**Approving is not publishing.** The build reads `data/*.json` and never touches the
database. A figure reaches the site only when someone presses **Publish to site**.

**Never hand-edit `data/*.json`.** It is generated. Additions go through the queue, at
`/admin/` or via `POST /api/agent`.

**Post to `www`, not the apex**, for `api/agent` too — the apex 308-redirects and both
`fetch` and `curl` drop the `Authorization` header across a host change, giving a 401 with
a perfectly good key. `scripts/agent-submit.js` already defaults correctly.

**Push to the session branch, not `main`.** The repo allows `main`; the harness classifier
has refused it. Commit, push to `claude/…`, open a PR, say so. An unpushed commit dies with
the container.

**`npm test` before every push.** On `main` a failure is already live.
