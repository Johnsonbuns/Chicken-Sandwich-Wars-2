# Giving a research run access to primary documents

**Read this before a data run.** It is the difference between a batch of `medium`
confidence proposals and a batch of `confirmed` ones.

## The problem

`CLAUDE.md` carries a provenance caveat: the original dataset was gathered in an
environment where web *search* worked but direct page *fetches* were blocked, so figures
came from search-result summaries rather than from the documents themselves. That is still
true by default, and it is not a limitation of the model — it is the cloud environment's
network policy.

Verified on 2026-09-01 from a cloud session: `sec.gov`, `ir.wingstop.com`,
`investor.elpolloloco.com`, `prnewswire.com`, `qsrmagazine.com`, `bouldergroup.com` and
every other primary host returned `EGRESS_BLOCKED`. Search still returned real figures,
which is why research is possible at all — but a figure read off a search summary cannot
honestly be submitted as `confirmed`, which `db/AGENT_INTAKE.md` reserves for a primary
document actually read.

That matters most exactly where the stakes are highest. A low-confidence AUV read from a
trade summary is enough to seat a brand at #4 in the rankings; it is not enough to *keep*
it there.

## The fix

Network access is a property of the **cloud environment**, not of the session, so this is
set once and every future run inherits it.

1. Open [claude.ai/code](https://claude.ai/code) and edit the environment this repository's
   sessions use (onboarding creates one named **Default**).
2. Set the **Network access** field. It takes one of four levels — **None**, **Trusted**,
   **Full**, **Custom**.

**Simplest, and what the research task actually wants: choose `Full`.** Any domain, no
list to maintain, and no run ever stalls because a publisher moved a PDF to a CDN nobody
allowlisted. Given that the job is "read whatever primary document the figure lives in",
this is the honest match.

**If you would rather scope it: choose `Custom`**, tick *Also include default list of
common package managers* so the toolchain keeps working, and paste the list below into
**Allowed domains**, one per line. A leading `*.` matches every subdomain.

```text
# Regulatory filings — EDGAR, full-text search, the JSON API
*.sec.gov

# Investor relations. q4cdn/q4web host the earnings PDFs for most restaurant issuers.
*.q4cdn.com
*.q4web.com
ir.wingstop.com
investor.elpolloloco.com
*.yum.com
*.rbi.com
*.jollibeegroup.com

# Newswires — where a release is published verbatim, often before the 8-K posts
*.prnewswire.com
*.globenewswire.com
*.businesswire.com
*.accesswire.com
*.stocktitan.net

# Franchise disclosure documents. Item 19 is where a private brand's AUV actually
# lives, and the state portals are the primary copy — everything else quotes them.
docqnet.dfpi.ca.gov
*.dfi.wi.gov
*.commerce.state.mn.us
*.franchiseregistry.com
*.franchisedisclosures.com
*.frandata.com
*.franchisegrade.com

# Industry data providers and trade press
*.technomic.com
*.circana.com
*.placer.ai
*.qsrmagazine.com
*.nrn.com
*.restaurantbusinessonline.com
*.restaurantdive.com
*.franchisetimes.com
*.1851franchise.com
*.fastcasual.com
*.franchising.com
*.franchise.org
*.wattagnet.com
*.qsrweb.com

# Net-lease research — the cap rate component
*.bouldergroup.com
*.cbre.com
*.marcusmillichap.com
*.jll.com
*.crexi.com

# General financial press and commodity data
*.cnbc.com
*.reuters.com
*.fool.com
finance.yahoo.com
*.usda.gov
```

GitHub reaches the session through its own proxy and is unaffected by this setting either
way, so widening it does not widen repository access.

## What changes for the next run

With fetches unblocked, a run can open the 8-K, the FDD or the Boulder Group report it is
citing, quote the sentence the figure sits in, and submit at `confirmed`. That is also the
point at which the provenance caveat in `CLAUDE.md` can start being retired figure by
figure — the AUVs and same-store sales it flags as worth re-verifying are exactly the
inputs `npm run check:freshness` reports on, so the freshness list doubles as the
re-verification worklist.
