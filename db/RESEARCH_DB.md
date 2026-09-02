# The research database

`research/CSW-Research-Database.xlsx` — a standalone workbook for accumulating industry
research over years. It is **not** part of the site, not part of the build, and not
generated from `data/`. Once it exists it is the source of truth for itself.

```bash
pip install openpyxl
python3 scripts/research-db-init.py                       # create it — once
python3 scripts/research-db-sweep.py <file>               # report what is new
python3 scripts/research-db-sweep.py <file> --write       # ...and save a copy with » filled
```

`research-db-init.py` refuses to overwrite an existing workbook without `--force`. That is
deliberate: a year of hand-entered research must not be one careless script run from gone.

## The column ownership contract

> Columns prefixed `»` are the machine's. They are grey and sit at the far right of every
> tab. **A human never types in a `»` column; a sweep never writes outside one.**

`research-db-sweep.py --write` saves to a new file and touches only `»` cells. The
round-trip is asserted rather than assumed — a sweep over a workbook with five test rows
changed 13 cells, all of them machine-owned.

This is what lets a person and an agent work the same file for years without either
clobbering the other, and it is the reason the previous design was thrown away: a workbook
regenerated from `data/` on every run cannot hold anything the site does not already know,
which is the opposite of what a research database is for.

## Capture before structure

`INBOX` is where nearly everything is added, and every column in it is optional. A row
with a sentence and a link is a valid row. No id lookup, no tab decision, no duplicate
check at capture time — all three are resolution work, and demanding them up front is what
kills a database like this.

Resolution happens in the sweep instead:

- ids assigned to rows that lack them;
- operator and brand names matched against the known set **and its aliases** —
  `norm()` strips punctuation and entity suffixes, so `Sailormen Inc.` finds
  `Sailormen, Inc.` without a fuzzy match;
- a near-miss is *reported*, never applied. A fuzzy hit becomes real only when a human puts
  it in that operator's `aliases` cell. Silently applied fuzzy matching is exactly the
  defect `CLAUDE.md` documents in `operatorsByBrand`, and it is worse here: one
  unconfirmed match in a year-over-year roster diff invents a phantom exit *and* a phantom
  entrant from a single comma;
- values that contradict a published figure are flagged with both numbers;
- rows with no source are excluded from submission and listed, because a figure without a
  publisher cannot reach the site under the editorial rule.

## FDD rosters store whole lists

`FDD_ROSTER` takes complete franchisee lists, one row per franchisee per document,
including the uninteresting ones. A franchisee missing from this year's list is only
evidence of an exit if last year's list was exhaustive — completeness is the asset, and
capturing "just the interesting ones" destroys it.

`roster_type = departed` is the list of franchisees terminated, cancelled, not renewed or
which ceased operations in the last fiscal year, with contact details. Every franchisor
must publish it annually under the FTC Franchise Rule (16 CFR 436.5(t)). It is the single
highest-value page in the document.

## Getting to the site

```
INBOX → sweep → research/sweep-<date>.findings.json → node scripts/agent-submit.js → review queue → approve → Publish to site
```

The generated payload carries a `_needs_review` marker on every `payload` object: the
sweep can shape a row but cannot know the right `metric_key`, `subject_id` or period label,
and those are checked against the live schema at submit time. Approving is still not
publishing, and an agent still cannot write canonical data — its key reaches four review
RPCs and nothing else.
