# The Master Research Database

The staging and intelligence layer that sits *before* the review queue. Research
accumulates here; nothing here is on the site.

Generated, not hand-built:

```bash
node scripts/research-sheet.js          # re-seed research/sheet/*.csv from live CSW data
pip install openpyxl                    # the packer's only dependency, outside the build
python3 scripts/research-sheet-xlsx.py  # pack into research/CSW-Master-Research-Database.xlsx
```

The CSVs are the dependency-free artefact and the structural source of truth. The `.xlsx`
adds only what a spreadsheet needs to be usable by a person: frozen headers, a purpose
line per tab, zone colouring, and dropdowns on the columns where free text would break
reconciliation. Google Sheets imports it as-is.

## Why this exists when a review queue already does

`review_items → review_decide() → review_apply()` is a *proposal* queue. It holds things
you already believe and want a second pair of eyes on. It cannot hold:

- a half-verified finding,
- two sources that disagree (`facts` supersedes; it has no room for rivals),
- a document you know exists and have not read,
- an exhaustive roster whose value is that it is exhaustive,
- a research task.

Those five gaps are the entire remit. **Anything the sheet duplicates from production will
drift and become a liar**, so the sheet deliberately does not mirror settled figures — it
is seeded with what is unresolved.

## Three zones

| Zone | Tabs | Rule |
|---|---|---|
| **A · IDENTITY** | `operators`, `operator_aliases`, `brands`, `locations`, `sources` | Persistent ids. Never renumber. A changed name is a new `operator_aliases` row, not an edit. |
| **B · OBSERVED** | `fdd_roster`, `fdd_item20`, `fdd_item19`, `observations`, `conflicts`, `research_queue` | Append-only. A correction is a new row pointing at the old via `supersedes_obs_id` — the same discipline `facts` uses in Postgres. |
| **C · DERIVED** | `roster_diff`, `signals`, `publish_candidates`, `fdd_tracker` | Computed from A + B. Never hand-edited; regenerating overwrites. |

People and agents write to A and B. C is output. That split is what stops the usual
spreadsheet failure where nobody can say which cell is the truth.

## The design decision that matters most

**FDD franchisee data is a roster, not an event stream.**

A roster is exhaustive as of a date, and that exhaustiveness is the whole asset: it is the
only thing that makes a *disappearance* detectable. An event log cannot answer "which
operators exited", because the absence of an event is not an event. So `fdd_roster` stores
complete lists and `roster_diff` computes the events. **Roster in, events out.**

The highest-value page in any FDD is the departed-franchisee list — franchisees terminated,
cancelled, not renewed, or which ceased operations in the last fiscal year, with contact
details. The FTC Franchise Rule (16 CFR 436.5(t)) requires it annually, per brand. Capture
it as `roster_type = departed`.

## Vocabularies are production's

`verification`, `derivation`, `visibility`, `doc_type`, `kind`, `status` all take the enum
values from `supabase/migrations/0002_enums.sql`. A sheet that invents its own word for
"verified" turns reconciliation into a translation project. The dropdowns enforce it.

`visibility` is on every tab that can carry a person's name, address or phone. Seventeen
production tables carry it and a check constraint means a non-public record cannot be
flagged published. The sheet has no such constraint, so the column is a discipline rather
than a guarantee — but without it the first export leaks.

## Identity resolution

`operator_aliases` is the ledger that makes the longitudinal diff possible: every spelling
ever seen, which document it came from, and how it was matched (`exact` / `normalized` /
`fuzzy` / `manual` / `unresolved`). "ABC Foods LLC" in a 2022 FDD and "ABC Foods, L.L.C."
in 2024 are one `op_id` with two alias rows.

A diff that gets this wrong reports a phantom exit *and* a phantom entrant from a single
punctuation change — which is the same class of failure `CLAUDE.md` already documents in
`operatorsByBrand`, where fuzzy-matching operator strings against brand names lets a
renamed brand silently drop its operator list. Fuzzy matches must land in the ledger with
`match_confidence` set, never be applied silently.

## Getting a row back to the site

```
observations → publish_candidates → POST /api/agent → review queue → approve → Publish to site → data/*.json → Vercel
```

`publish_candidates` carries `payload_json` and `sources_json` already shaped for the
intake contract, so a script can emit a findings file without a human retyping anything.

Two things worth restating because they are easy to get wrong: **approving is not
publishing**, and an agent cannot write canonical data at all — its key reaches four review
RPCs and nothing else, enforced in Postgres rather than by convention.
