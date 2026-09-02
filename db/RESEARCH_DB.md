# The research database

**The live copy is a Google Sheet in the owner's Drive.**

| | |
|---|---|
| Title | `CSWResearchDatabase` |
| File id | `1zePMXe4EW_-uw9kMIzSWSb62RTrHUx5ddrULk5JSa20` |
| Link | https://docs.google.com/spreadsheets/d/1zePMXe4EW_-uw9kMIzSWSb62RTrHUx5ddrULk5JSa20/edit |
| Read it | Google Drive connector, `read_file_content` with that id |

`research/CSW-Research-Database.xlsx` in this repo is the **seed** used to create it. It is
stale the moment anyone types into the Sheet. Never treat it as current, and never
regenerate the Sheet from it.

---

## The point, in one paragraph

ChickenSandwichWars.com is deliberately strict: every figure needs a publisher, a URL and
an as-of date, and it refuses anything less. That strictness is the product — it is why the
site can be trusted. But it makes CSW a terrible place to *collect* research. You cannot
drop in a half-sourced number, a broker's rumour, or a "check this again in April" and come
back to it. The Sheet has no such rule. A figure can sit there at low confidence for eight
months until somebody nails the source down, and then it graduates. **CSW is published
truth. The Sheet is the notebook. The arrow only ever runs notebook → site.**

## The long-term goal

Two things, and the second is the valuable one.

**1. Stop re-researching.** Every fact ever found lives in one place with its source. A
year from now a session is asked for an update and reads the Sheet instead of crawling the
internet from scratch. Research compounds instead of evaporating when a session ends.

**2. Build a dataset nobody else has.** Every franchisor must file a Franchise Disclosure
Document annually, and Item 20 contains a complete list of every franchisee *and* — under
FTC Rule 16 CFR 436.5(t)(3) — a list of every franchisee who left in the last fiscal year,
with contact details. Collect several years of these for the same brand, line them up, and
you can answer questions no public source answers:

- which operators gained units each year, and which lost them
- who appears for the first time; who quietly disappears
- which specific locations opened, closed, or changed hands
- who entered or exited a state
- who is consistently shrinking — the earliest distress signal there is
- who is buying units from the shrinking ones

Minnesota CARDS publishes those documents free, and several years are already on file per
brand. **That comparison is the proprietary asset. Everything else in the Sheet is
supporting cast.**

## Why a spreadsheet, and why this one

**It is the only place sloppiness is safe.** Capture friction is what kills research
databases. If adding a row means looking up an ID, deciding which table it belongs in, and
checking for duplicates first, you stop adding rows. All three of those are *resolution*
work, and resolution can happen later, in bulk, by a machine. So `INBOX` has no required
fields. A sentence and a link is a valid row.

**It survives sessions; a conversation does not.** Anything learned in a chat dies with it.
Anything written to the Sheet is there in a year.

**It is legible to both a human and an agent.** The owner can sort, filter and eyeball it
on a phone. A Claude session can read the whole thing in one call. Neither has to translate.

**Google Sheets specifically** because a session reads it live through the Drive connector —
no download-and-reupload loop, no two versions of the file, free revision history, and it
works from a phone, which is where a news alert actually gets logged.

## How it works — three ideas, and that is all

**1. Zones.** Blue tabs are identity (`OPERATORS`, `BRANDS`, `LOCATIONS`, `PEOPLE`).
Green is captured observation (`INBOX`, `EVENTS`, `FDD_ROSTER`, `FDD_UNITS`, `SOURCES`,
`CONFLICTS`, `QUEUE`). Amber is derived. People write to the first two; the third is
computed output.

**2. The `»` column contract.** Columns starting with `»` are the machine's — grey, at the
far right of every tab. **A human never types in a `»` column; a sweep never writes outside
one.** That single rule is what lets a person and an agent share one file for years without
either clobbering the other.

**3. The `ready` gate.** Nothing is promoted toward CSW unless the owner sets `ready = yes`.
Never inferred from confidence, never from having a URL. The whole value of a notebook is
that being sloppy in it is safe, and a rule that promotes *confident* sloppiness breaks
exactly that.

## The tabs

| Tab | Holds |
|---|---|
| **INBOX** | Anything, in any state of certainty. Where ~90% of adds go. |
| OPERATORS | Franchisee groups, PE firms, REITs, landlords. `aliases` is pipe-separated. |
| BRANDS | Chicken chains and the non-chicken brands operators also run. |
| LOCATIONS | Individual restaurants. The row survives a change of brand or operator. |
| PEOPLE | Executives and decision makers. A departure is often the earliest sell signal. |
| EVENTS | Dated things that happened: deals, closures, filings, sale-leasebacks. |
| SOURCES | Documents and links. An FDD held is a row here. |
| **FDD_ROSTER** | Franchisee lists out of FDDs. One row per franchisee per document. |
| FDD_UNITS | Item 20 unit-count tables, per state per fiscal year. |
| CONFLICTS | Two sources that disagree. Never resolved by deleting a row. |
| QUEUE | What to look into next. |
| » CSW_LOG | Machine-owned. What has been submitted and what came back. |

## How to feed it

**The owner.** Open `INBOX`, add a row, fill in what you know, leave the rest blank. Do not
look anything up. Leave `ready` blank unless you want it submitted. That is the entire
procedure.

**A Claude session.** Same destination, more volume. When a session reads FDDs, filings or
trade press, the extracted rows go into the Sheet — `FDD_ROSTER` and `FDD_UNITS` for
document data, `INBOX` or `EVENTS` for everything else. **Never straight to the website.**
A run that reads five FDDs and files five proposals into the CSW review queue has done the
wrong job.

Because the Drive connector reads but cannot write cells, a session adding bulk rows either
hands the owner a block to paste or the Apps Script gets built. That choice is still open —
ask, do not assume.

**One rule for FDD rosters: paste whole lists, including the boring rows.** A franchisee
missing from this year's list only proves an exit if last year's list was complete.
Completeness is the asset; capturing "just the interesting ones" destroys it.

## The sweep — how the Sheet reaches CSW

A sweep is a command: *"sweep the research database."* Concretely:

```bash
# 1. the session reads the Sheet (Drive connector) or a downloaded copy
python3 scripts/research-db-sweep.py <workbook.xlsx>

# 2. review the generated payload, then dry-run it against the live schema
node scripts/agent-submit.js research/sweep-<date>.findings.json --dry-run

# 3. submit for real — this only queues, it publishes nothing
node scripts/agent-submit.js research/sweep-<date>.findings.json
```

What the sweep actually does:

1. **assigns ids** to rows that lack them
2. **matches operator and brand names** against the known set and its aliases — `norm()`
   strips punctuation and entity suffixes, so `Sailormen Inc.` finds `Sailormen, Inc.`
   without a fuzzy match
3. **reports near-misses, never applies them.** A fuzzy hit becomes real only when a human
   puts it in that operator's `aliases` cell. One unconfirmed match in a year-over-year
   roster diff invents a phantom exit *and* a phantom entrant from a single comma
4. **flags contradictions** — a value that disagrees with a figure CSW already publishes is
   surfaced with both numbers side by side
5. **excludes unsourced rows**, listing them, because a figure with no publisher cannot
   reach the site under the editorial rule
6. **shapes the `ready` rows** into a findings file for the review queue

## The gates — five of them, all human

Nothing reaches the public site by accident:

```
row in Sheet
  → owner marks ready = yes          ← gate 1
  → sweep shapes it (unsourced rows excluded)
  → someone runs agent-submit         ← gate 2
  → --dry-run validates against schema ← gate 3
  → lands in review_items, not canonical data
  → a human approves it in /admin/    ← gate 4
  → someone presses Publish to site   ← gate 5
  → data/*.json → Vercel → live
```

**Approving is not publishing.** The build reads `data/*.json` and never touches the
database. Even an approved figure is invisible until Publish is pressed.

**An agent cannot write canonical data at all.** Its key reaches four review RPCs and
nothing else, enforced inside Postgres by `agent_for_key()`, not by JavaScript.

## Rules that must not be broken

1. **`»` columns are the machine's.** Humans never type in them; sweeps never write outside them.
2. **`ready` is opt-in.** Never infer intent from confidence. Never reintroduce a heuristic.
3. **FDD contents go to the Sheet, not the website.**
4. **Append, never overwrite.** A correction is a new row pointing at the old one, the same
   way production `facts` supersedes rather than updates.
5. **Never resolve a conflict by deleting a row.** The spread is often the finding — two
   aggregators put Zaxby's AUV $303k apart and the primary document showed both were wrong.
6. **Never hand-edit `data/*.json`.** It is generated; a hand edit survives until the next publish.
7. **Paste whole FDD rosters.** Completeness is what makes a disappearance detectable.
8. **The repo `.xlsx` is a seed, not the data.** The Sheet is the live copy.
