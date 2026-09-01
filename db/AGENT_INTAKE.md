# Submitting research to CSW

**For an agent — a Claude Code session, a scheduled script, anything that is not a
person sitting at the desk.**

You cannot write to this site's data. Nothing you send is published, and nothing you
send changes a number the site is already showing. What you can do is put a finding, with
its citation, in front of a human, who decides. That is the whole contract, and it is
enforced in the database rather than by convention: your key reaches four functions, all
of which write to the review tables and none of which touch a brand, a figure or a
transaction.

Read this before a run. An agent that skips `schema` proposes columns that do not exist;
an agent that skips `lookup` proposes records that are already there. Both are
recoverable — every reply tells you exactly what was wrong — but each one costs a
reviewer an evening.

---

## The endpoint

**Post to `www`, not the apex.** `chickensandwichwars.com` 308-redirects to
`www.chickensandwichwars.com`, and both `fetch` and `curl` drop the `Authorization`
header when a redirect changes host. The request therefore arrives with no key and comes
back `401 — Send an agent key`, which reads as a revoked or malformed key and sends you
looking in the wrong place. This document named the apex until 2026-09-01 and cost a run
exactly that detour.

```
POST https://www.chickensandwichwars.com/api/agent
Authorization: Bearer csw_ag_...
Content-Type: application/json
```

Keys are minted in the desk under **Settings → Agent keys** and shown once. Give each
agent its own, so one can be revoked without stopping the others. `CSW_AGENT_KEY` is the
environment variable the CLI reads.

Four operations. There are no others.

| `op` | What it does |
|---|---|
| `schema` | Every target you may propose, its columns, its enum values, what is required |
| `lookup` | Search existing brands, companies, markets, properties, sources, metrics |
| `submit` | Put one or more findings in the review queue |
| `finish` | Close a research run with a summary |

## Before you propose anything

```bash
CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js --schema
CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js --lookup brand popeyes
```

`schema` is read from the database catalogue at the moment you ask, so it is never out of
date. It tells you the exact column names, which are required, and which values an enum
accepts. Do not guess a column name; a proposal naming a column outside the whitelist is
rejected whole.

`lookup` tells you whether something already exists. **It is not a duplicate check you can
skip** — the queue runs its own, and a proposal that looks like an existing record is
flagged for a human rather than merged — but a run that checks first proposes better
things.

## Submitting

```bash
CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js findings.json --dry-run
CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js findings.json
```

`--dry-run` validates the whole file against the live schema and submits nothing. Use it.

```json
{
  "batch": {
    "ref": "q4-2026-auv-sweep",
    "title": "Q4 2026 AUV sweep",
    "model": "claude-opus-5",
    "task_prompt": "Read the Q4 releases for the tracked brands and propose any AUV, unit count or comps figure that differs from what CSW holds.",
    "summary": "Four figures proposed; one could not be traced to a primary document."
  },
  "items": [
    {
      "target_table": "public.facts",
      "title": "Popeyes AUV, FY2026",
      "entity_label": "Popeyes",
      "operation": "insert",
      "confidence": "high",
      "dedupe_key": "popeyes-auv-fy2026",
      "rationale": "Stated in RBI's Q4 release. The figure on file is a year old.",
      "payload": {
        "subject_type": "brand",
        "subject_id": "@brand:popeyes",
        "metric_key": "auv_usd",
        "value_numeric": 1810000,
        "unit": "usd",
        "period_label": "FY2026",
        "as_of": "2026-08-12",
        "source_id": "@source:1"
      },
      "sources": [
        {
          "publisher": "Restaurant Brands International",
          "title": "Q4 2026 results",
          "url": "https://example.com/rbi-q4-2026",
          "date_label": "Q4 2026",
          "quote": "U.S. average restaurant sales of $1.81 million, up from $1.70 million."
        }
      ]
    }
  ]
}
```

### The fields that matter

**`payload`** is column → value, and only columns the target allows.

**Reference tokens.** You do not know uuids and should not have to. Write `@brand:popeyes`,
`@company:kbp-brands`, `@market:tampa`, `@property:<slug>`, `@source:<key>`, and they are
resolved when the proposal is approved. `@source:1` means "the first source I cited on this
item" — which is how you point a figure at a source record that does not exist yet.

**`sources`** is the citation, and it is the point. Either `source_key` for something
already in the registry, or `publisher` + `url` + `date_label` for something new; a new
one becomes a real `sources` row **only if the proposal is approved**, so rejected research
leaves no trace. Always include `quote` — the sentence you read the figure from. It is the
difference between a reviewer checking your work in a minute and checking it in an
afternoon.

A target that requires a source and gets none does not fail. It lands in
**needs verification** instead of the approval queue, which is where an unsourced claim
belongs.

**`confidence`** is `low`, `medium`, `high` or `confirmed`. Be honest: `low` is a useful
signal, not an admission. `confirmed` means you read the primary document.

**`rationale`** is for the human. Say why this is worth adding and what you are unsure
about. "The 10-K says 1,810 units; the press release says 1,807, and I took the filing" is
worth more than a clean number.

**`dedupe_key`** makes a retried run idempotent. A run that dies halfway and is restarted
must not double the queue.

**`operation`** is `insert` unless you are correcting something, in which case send
`"operation": "update"` with either `target_id` or `target_ref` (`"@brand:popeyes"`), and a
payload of only the fields that change. The queue captures the current values for the
reviewer's before-and-after.

**`visibility`** is `public` unless the finding is not for publication. `internal` and
`confidential` are for figures shared with the desk in confidence; the database refuses to
publish either.

### What comes back

```json
{ "ok": true, "batch_id": "…", "accepted": 3, "rejected": 1,
  "items": [
    { "id": "…", "title": "Popeyes AUV, FY2026", "accepted": true, "status": "pending",
      "matches": 0, "errors": [], "warnings": [] },
    { "title": "Wingstop units", "accepted": false,
      "errors": ["unit_count is not a writable column of Figure"] }
  ] }
```

Read it. `matches` is how many existing records look like this one — worth checking before
your next run. `warnings` carries "no source cited" and "possible duplicate not yet
resolved". A rejected item tells you exactly what to fix.

Close the run when you are done:

```json
{ "op": "finish", "batch_id": "…", "summary": "Four figures proposed; one unverifiable." }
```

The summary is what the reviewer reads first. Say what you did not find as well as what
you did — "Church's has published nothing since FY2024" is a finding.

---

## The rules that are not negotiable

These are the site's editorial rules, and the reason a human sits between you and the
data. A proposal that breaks one is a proposal that wastes someone's time.

1. **Never estimate.** If a number has not been published, it does not exist. Leave the
   field out; the site renders an em dash. Do not infer, interpolate, or average.
2. **Every figure carries a publisher, a URL and an as-of date.** No exceptions, and
   "widely reported" is not a publisher.
3. **Read the primary document.** A search-result summary is a pointer to a source, not
   a source. If you could only reach the summary, say so in `rationale` and mark the
   confidence `low` — the desk would rather have that than a confident guess. The existing
   dataset was gathered this way and is flagged in `CLAUDE.md` as needing re-verification;
   do not add to the pile.
4. **A derived figure is labelled.** Arithmetic on two published numbers is
   `"derivation": "derived"`. A franchisee-reported figure is `franchisee_reported`.
5. **Corrections supersede.** Correcting a figure writes a new observation and closes the
   old one; the number the site published last quarter survives. That happens
   automatically — just send the update.

## What you cannot do, structurally

Not by policy — by construction, so you do not have to be trusted:

- Your key reaches `review_schema`, `review_lookup`, `review_submit` and
  `review_finish_batch`. There is no fifth function and no table access.
- `review_submit` writes to `review_items`, `review_item_sources`, `review_item_matches`,
  `review_batches` and `review_events`. Nothing else.
- Approving is `review_decide`, which requires a signed-in human with an editor or admin
  role. No agent key can call it.
- You cannot read a lead, a contact, an email address or a phone number. The `intake`
  schema is revoked from every role your key could reach.
- `lookup` returns identity — names, slugs, keys. It does not return confidential
  intelligence.

If you find yourself wanting to work around any of this, the answer is to write it in
`rationale` and let a person decide.
