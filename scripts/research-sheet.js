#!/usr/bin/env node
/**
 * Builds the CSW Master Research Database as one CSV per tab, in `research/sheet/`.
 *
 * The sheet is *generated*, not hand-built, for three reasons:
 *   1. it can be re-seeded from live CSW data whenever production moves;
 *   2. the identity system (persistent operator/location ids) is code, not a convention
 *      somebody remembers — CLAUDE.md already documents where fuzzy matching silently
 *      fails today (`operatorsByBrand`), and that failure must not be re-imported here;
 *   3. the reverse trip — sheet rows shaped into a `POST /api/agent` payload — needs the
 *      same column names on both sides.
 *
 * Three zones, and the discipline is the whole point:
 *   A. IDENTITY   — the spine. Persistent ids everything else references.
 *   B. OBSERVED   — append-only. What a document actually said. Never edited in place.
 *   C. DERIVED    — computed from A+B. Never hand-edited; regenerating overwrites it.
 *
 * Humans and agents write to A and B. C is output.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'research', 'sheet');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const brands = read('brands.json');
const operators = read('operators.json');
const sources = read('sources.json');
const movement = read('movement.json');
const transactions = read('transactions.json');
const news = read('news.json');

const TODAY = new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------- csv ---- */

function csv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const pad = (n, w = 4) => String(n).padStart(w, '0');

const TABS = [];
function tab(name, zone, purpose, header, rows) {
  TABS.push({ name, zone, purpose, header, rows });
}

/* ------------------------------------------------------- A. identity ---- */
// Operator identity is the hardest problem in the whole dataset: "ABC Foods LLC" in a
// 2022 FDD and "ABC Foods, L.L.C." in 2024 are the same counterparty, and a longitudinal
// diff that misses that reports a phantom exit *and* a phantom entrant. So the canonical
// record and the alias ledger are separate tabs — every spelling ever seen keeps a row
// saying which document it came from and how it was matched.

const opRows = [];
const aliasRows = [];
let opN = 0;

function addOperator(name, extra = {}) {
  const existing = opRows.find((r) => r.canonical_name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const row = {
    op_id: 'OP-' + pad(++opN),
    canonical_name: name,
    legal_name: extra.legal_name || '',
    csw_company_slug: extra.slug || '',
    kind: extra.kind || 'operator',
    hq: extra.hq || '',
    status: extra.status || '',
    chicken_units_latest: extra.chickenUnits ?? '',
    total_units_latest: extra.totalUnits ?? '',
    brands_operated: (extra.brands || []).join('; '),
    geography: (extra.geography || []).join('; '),
    first_seen: extra.firstSeen || '',
    last_seen: extra.lastSeen || '',
    in_production_csw: extra.slug ? 'yes' : 'no',
    visibility: 'public',
    notes: extra.notes || ''
  };
  opRows.push(row);
  return row;
}

for (const o of operators) {
  addOperator(o.name, {
    slug: o.slug, hq: o.hq, status: o.status, brands: o.brands,
    geography: o.geography, chickenUnits: o.chickenUnits, totalUnits: o.totalUnits,
    lastSeen: '2026'
  });
}
// Counterparties that appear only in transactions are operators/investors CSW already
// knows about but does not carry an operator record for. They are exactly the entities a
// consolidation question is about, so they get ids now rather than on first collision.
for (const t of transactions.corporate) {
  if (t.acquirer) addOperator(t.acquirer, { kind: 'acquirer', notes: 'From transactions.json (corporate)', lastSeen: t.date });
  if (t.target && !/^[A-Z][a-z]+('s)? (Hot )?Chicken/.test(t.target)) { /* targets are usually brands */ }
}
for (const r of opRows) {
  aliasRows.push({
    alias_id: 'AL-' + pad(aliasRows.length + 1),
    alias_text: r.canonical_name,
    op_id: r.op_id,
    source_doc_id: r.in_production_csw === 'yes' ? 'csw:operators.json' : 'csw:transactions.json',
    match_method: 'canonical',
    match_confidence: 'confirmed',
    first_seen: TODAY,
    reviewed_by: '',
    notes: 'Seeded from production CSW data'
  });
}

tab('operators', 'A · IDENTITY',
  'One row per real-world company. Persistent op_id is the join key for every FDD year. Never renumber.',
  ['op_id', 'canonical_name', 'legal_name', 'csw_company_slug', 'kind', 'hq', 'status',
   'chicken_units_latest', 'total_units_latest', 'brands_operated', 'geography',
   'first_seen', 'last_seen', 'in_production_csw', 'visibility', 'notes'],
  opRows);

tab('operator_aliases', 'A · IDENTITY',
  'Every spelling of an operator name ever seen, and which document it came from. This is what lets a 2022 FDD match a 2026 one. Add a row rather than editing a name.',
  ['alias_id', 'alias_text', 'op_id', 'source_doc_id', 'match_method', 'match_confidence',
   'first_seen', 'reviewed_by', 'notes'],
  aliasRows);

const brandRows = brands.map((b) => ({
  brand_id: 'BR-' + b.slug,
  name: b.name,
  csw_brand_slug: b.slug,
  franchisor_legal_name: b.legalName || '',
  parent: b.parent || '',
  is_chicken: 'yes',
  is_ranked: b.metrics && Object.keys(b.metrics).length >= 3 ? 'check' : 'no',
  us_units_latest: b.stats && b.stats.usUnits ? b.stats.usUnits.v : '',
  fdd_registrant: '',
  fiscal_year_end: '',
  fdd_years_held: '',
  visibility: 'public',
  notes: ''
}));
tab('brands', 'A · IDENTITY',
  'Mirrors production brands plus the FDD-specific fields production has no column for (registrant, fiscal year end, which FDD years we hold).',
  ['brand_id', 'name', 'csw_brand_slug', 'franchisor_legal_name', 'parent', 'is_chicken',
   'is_ranked', 'us_units_latest', 'fdd_registrant', 'fiscal_year_end', 'fdd_years_held',
   'visibility', 'notes'],
  brandRows);

// Locations get ids now even though only a handful have street addresses, because the
// FDD franchisee lists arrive address-first and the diff needs somewhere to land them.
const locRows = [];
let locN = 0;
const normalize = (s) => (s || '').toLowerCase().replace(/[.,#]/g, '').replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|highway|hwy|suite|ste)\b/g, (m) => ({ street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', highway: 'hwy', suite: 'ste' }[m] || m)).replace(/\s+/g, ' ').trim();

for (const o of movement.openings) {
  locRows.push({
    loc_id: 'LOC-' + pad(++locN, 6),
    address_raw: o.location,
    address_normalized: normalize(o.location),
    city: '', state: '', postal_code: '',
    brand_id: 'BR-' + o.brand,
    op_id: '',
    csw_property_slug: '',
    status: 'operating',
    opened_date: o.date,
    closed_date: '',
    first_seen_doc: 'csw:movement.json',
    last_seen_doc: 'csw:movement.json',
    is_second_generation: '',
    verification: 'unverified',
    visibility: 'public',
    notes: o.detail || ''
  });
}
for (const t of transactions.property) {
  locRows.push({
    loc_id: 'LOC-' + pad(++locN, 6),
    address_raw: t.location,
    address_normalized: normalize(t.location),
    city: '', state: '', postal_code: '',
    brand_id: '', op_id: '', csw_property_slug: '',
    status: 'operating', opened_date: '', closed_date: '',
    first_seen_doc: 'csw:transactions.json', last_seen_doc: 'csw:transactions.json',
    is_second_generation: '', verification: 'unverified', visibility: 'public',
    notes: t.type + ' ' + t.date + (t.price ? ' $' + t.price : '')
  });
}
tab('locations', 'A · IDENTITY',
  'One row per physical box. Persistent loc_id survives a change of brand or operator — a former KFC reopening as a Dave\'s is the same location.',
  ['loc_id', 'address_raw', 'address_normalized', 'city', 'state', 'postal_code',
   'brand_id', 'op_id', 'csw_property_slug', 'status', 'opened_date', 'closed_date',
   'first_seen_doc', 'last_seen_doc', 'is_second_generation', 'verification',
   'visibility', 'notes'],
  locRows);

/* ---- sources: news articles and filings share one tab, as they do in production ---- */
const srcRows = Object.entries(sources).map(([key, s]) => ({
  source_id: 'SRC-' + key,
  doc_type: /10-K|10-Q|8-K/i.test(s.title || '') ? 'sec_filing' : 'trade_press',
  publisher: s.pub || '',
  title: s.title || '',
  url: s.url || '',
  date_label: s.date || '',
  brand_id: '',
  fdd_issue_date: '',
  fdd_fiscal_year: '',
  registration_state: '',
  file_held: '',
  file_location: '',
  item19_extracted: '',
  item20_extracted: '',
  roster_extracted: '',
  in_production_csw: 'yes',
  notes: ''
}));

// The five FDDs whose existence is proven and whose contents are not. These are the
// reason eight of the site's eleven overdue scoring inputs are stuck.
const KNOWN_FDDS = [
  ['zaxbys', "Zaxby's", 'Zaxby\'s SPE Franchisor LLC', '2026-04-24', 'WI', '641240'],
  ['bojangles', 'Bojangles', 'Bojangles Opco, LLC', '2026-04-20', 'WI', ''],
  ['chicken-salad-chick', 'Chicken Salad Chick', 'Simply Southern Restaurant Group, LLC', '2026-04-21', 'WI', ''],
  ['slim-chickens', 'Slim Chickens', "Slim Chicken's Development Company, LLC", '2026-04-29', 'WI', ''],
  ['daves-hot-chicken', "Dave's Hot Chicken", "Dave's Hot Chicken Franchise Co. SPV LLC", '2026-05-04', 'WI', '']
];
for (const [slug, name, registrant, eff, state, fileNo] of KNOWN_FDDS) {
  srcRows.push({
    source_id: 'DOC-' + slug + '-' + eff.slice(0, 4) + '-' + state,
    doc_type: 'fdd',
    publisher: registrant,
    title: name + ' Franchise Disclosure Document, effective ' + eff,
    url: 'https://apps.dfi.wi.gov/apps/FranchiseSearch/MainSearch.aspx',
    date_label: eff,
    brand_id: 'BR-' + slug,
    fdd_issue_date: eff,
    fdd_fiscal_year: String(Number(eff.slice(0, 4)) - 1),
    registration_state: state,
    file_held: 'no',
    file_location: '',
    item19_extracted: 'no',
    item20_extracted: 'no',
    roster_extracted: 'no',
    in_production_csw: 'no',
    notes: 'Registration confirmed ' + (fileNo ? 'WI file ' + fileNo + '; ' : '') + 'document not obtained. Supersedes the figure CSW currently shows.'
  });
}
tab('sources', 'A · IDENTITY',
  'Every citable thing, filings and articles alike. FDD-only columns stay blank for articles. A row here is what an observation cites.',
  ['source_id', 'doc_type', 'publisher', 'title', 'url', 'date_label', 'brand_id',
   'fdd_issue_date', 'fdd_fiscal_year', 'registration_state', 'file_held', 'file_location',
   'item19_extracted', 'item20_extracted', 'roster_extracted', 'in_production_csw', 'notes'],
  srcRows);

/* ------------------------------------------------------- B. observed ---- */
// The centrepiece, and the change that matters most: FDD franchisee data is a ROSTER,
// not an event stream. A roster is exhaustive as of a date — which is the only thing that
// makes a *disappearance* detectable. An event log can never answer "who exited", because
// absence of an event is not an event. Diff two rosters and the events fall out.

tab('fdd_roster', 'B · OBSERVED',
  'THE CENTREPIECE. One row per franchisee entry per FDD. roster_type=current is Item 20\'s franchisee list; roster_type=departed is the FTC-required list of franchisees who left in the last fiscal year (16 CFR 436.5(t)(3)) — the highest-value distress signal in the document. Exhaustive per document: that is what makes a diff meaningful.',
  ['roster_row_id', 'source_id', 'brand_id', 'as_of_date', 'fiscal_year', 'roster_type',
   'operator_name_raw', 'op_id', 'match_method', 'match_confidence',
   'address_raw', 'city', 'state', 'postal_code', 'phone', 'loc_id',
   'unit_count_stated', 'departure_reason', 'page_ref', 'raw_quote',
   'extracted_by', 'extracted_on', 'extraction_confidence', 'visibility', 'notes'],
  []);

tab('fdd_item20', 'B · OBSERVED',
  'Item 20 tables 1-5, one row per state per fiscal year. Table 3 (terminated / non-renewed / reacquired / ceased-other) and Table 2 (transfers) are where consolidation and distress show up as numbers.',
  ['item20_row_id', 'source_id', 'brand_id', 'table_no', 'table_name', 'fiscal_year',
   'state', 'outlet_type', 'outlets_at_start', 'opened', 'terminated', 'non_renewed',
   'reacquired_by_franchisor', 'ceased_other', 'outlets_at_end', 'transfers',
   'projected_openings', 'page_ref', 'extracted_by', 'extracted_on',
   'extraction_confidence', 'notes'],
  []);

tab('fdd_item19', 'B · OBSERVED',
  'Item 19 Financial Performance Representations. `basis` is load-bearing: an all-units mean and a top-quartile mean are different numbers and comparing them across years is the classic FDD error.',
  ['item19_row_id', 'source_id', 'brand_id', 'fiscal_year', 'metric', 'value_numeric',
   'unit', 'basis', 'n_units_in_basis', 'pct_units_meeting_or_exceeding', 'period_label',
   'page_ref', 'raw_quote', 'extracted_by', 'extracted_on', 'extraction_confidence',
   'maps_to_csw_metric', 'notes'],
  []);

/* observations: everything that is not FDD-shaped */
const obsRows = [];
let obsN = 0;
function addObs(o) {
  obsRows.push(Object.assign({
    obs_id: 'OBS-' + pad(++obsN), subject_type: '', subject_ref: '', metric_or_claim: '',
    value: '', unit: '', period_label: '', as_of: '', source_id: '', url: '', raw_quote: '',
    derivation: 'reported', confidence: 'medium', verification: 'unverified',
    found_by: '', found_on: TODAY, visibility: 'public', supersedes_obs_id: '',
    status: 'new', notes: ''
  }, o));
}
// Seeded deliberately with the *unresolved*, not with a mirror of production. The sheet's
// job is what is still open; duplicating settled figures would only create a second copy
// to drift out of date.
addObs({
  subject_type: 'brand', subject_ref: 'BR-kfc-us', metric_or_claim: 'comps_pct (MISATTRIBUTED)',
  value: '2', unit: 'pct', period_label: 'YE2025', as_of: '2025-12-31',
  source_id: 'SRC-thestreet-kfc-207',
  raw_quote: 'Yum publishes KFC Division same-store sales, not KFC U.S. The division is ~90% non-U.S. by units.',
  confidence: 'confirmed', verification: 'verified', status: 'blocked-on-decision',
  notes: 'Verified against Q2 2026 10-Q, FY2025 10-K and Q2 2026 release: no KFC U.S. comparable-sales figure is disclosed anywhere. See conflicts CFL-0001.'
});
for (const [slug, name, registrant, eff] of KNOWN_FDDS) {
  addObs({
    subject_type: 'brand', subject_ref: 'BR-' + slug, metric_or_claim: 'auv_usd (SUPERSEDED, unread)',
    value: '', unit: 'usd', period_label: eff.slice(0, 4) + ' FDD', as_of: eff,
    source_id: 'DOC-' + slug + '-' + eff.slice(0, 4) + '-WI',
    confidence: 'unknown', verification: 'unverified', status: 'blocked-on-document',
    notes: 'A newer FDD exists and is dated; Item 19 not readable. CSW keeps the old value and discloses its age, per the editorial rule.'
  });
}
tab('observations', 'B · OBSERVED',
  'Research findings that are not FDD-shaped. Append-only: a corrected figure is a NEW row pointing at the old one via supersedes_obs_id, exactly as production `facts` supersedes rather than updates.',
  ['obs_id', 'subject_type', 'subject_ref', 'metric_or_claim', 'value', 'unit',
   'period_label', 'as_of', 'source_id', 'url', 'raw_quote', 'derivation', 'confidence',
   'verification', 'found_by', 'found_on', 'visibility', 'supersedes_obs_id', 'status', 'notes'],
  obsRows);

/* conflicts: production `facts` supersedes, so it cannot hold two rivals side by side */
const conflictRows = [
  {
    conflict_id: 'CFL-0001', subject_type: 'brand', subject_ref: 'BR-kfc-us',
    metric: 'comps_pct', value_a: '2 (KFC Division, global)', source_a: 'SRC-thestreet-kfc-207',
    value_b: 'not published (KFC U.S.)', source_b: 'Yum Q2 2026 10-Q / FY2025 10-K / Q2 2026 release',
    spread: 'n/a — scope mismatch, not a value disagreement', severity: 'high',
    status: 'open', opened_on: '2026-09-01',
    resolution: '', resolved_by: '',
    notes: 'Not a staleness problem. Recommended fix is to drop the input so Consumer Demand renders "—". Consequence: weights renormalise and KFC may fall below three components and become unrated. Owner decision.'
  },
  {
    conflict_id: 'CFL-0002', subject_type: 'brand', subject_ref: 'BR-zaxbys',
    metric: 'auv_usd', value_a: '2847345', source_a: 'FDD aggregator site A',
    value_b: '2544354', source_b: 'FDD aggregator site B',
    spread: '$303,000 on a figure that decides a rank', severity: 'high',
    status: 'open', opened_on: '2026-09-01', resolution: '', resolved_by: '',
    notes: 'Neither is sourced. Resolve only by reading Item 19 of the 2026-04-24 FDD. Reachable is not sourced.'
  }
];
tab('conflicts', 'B · OBSERVED',
  'Two sources that disagree, held side by side. Production `facts` supersedes rather than storing rivals, so a live disagreement has nowhere to live there. Never resolve by deleting a row.',
  ['conflict_id', 'subject_type', 'subject_ref', 'metric', 'value_a', 'source_a',
   'value_b', 'source_b', 'spread', 'severity', 'status', 'opened_on', 'resolution',
   'resolved_by', 'notes'],
  conflictRows);

/* research queue, seeded from what is actually blocking the site today */
const queueRows = [];
let qN = 0;
const q = (o) => queueRows.push(Object.assign({
  task_id: 'Q-' + pad(++qN), priority: 'P2', task: '', subject_ref: '', why_valuable: '',
  blocked_on: '', owner: 'agent', effort: '', status: 'open', opened_on: TODAY,
  closed_on: '', notes: ''
}, o));

q({ priority: 'P0', task: 'Owner decision: drop KFC U.S. comps_pct, or relabel as KFC Division (global)',
    subject_ref: 'BR-kfc-us', why_valuable: 'A scoring input measures something other than what its label claims. Every day it stands, the rankings are wrong in a way no freshness check can see.',
    blocked_on: 'owner', owner: 'human', effort: '10 min', notes: 'See CFL-0001. Compute the renormalised score both ways before deciding.' });
q({ priority: 'P0', task: 'Obtain 2026 FDDs for Zaxby\'s, Bojangles, Chicken Salad Chick, Slim Chickens, Dave\'s Hot Chicken',
    subject_ref: 'multiple', why_valuable: 'Closes 8 of the site\'s 11 overdue scoring inputs in one pass. Largest single cause of stale data on the site.',
    blocked_on: 'owner — MN CARDS is blocked at this environment\'s proxy, not by the host, so retrying will not help', owner: 'human', effort: '30-45 min', notes: 'See the shopping list. One download session covers all five.' });
q({ priority: 'P1', task: 'Obtain Popeyes FDD series 2021-2026 (6 documents)',
    subject_ref: 'BR-popeyes', why_valuable: 'Proves the longitudinal roster diff end to end on the brand with the most CSW operator coverage (5 of 16 operators). Everything else scales from this.',
    blocked_on: 'owner', owner: 'human', effort: '45 min', notes: 'Item 20 franchisee list + departed list are the target, not Item 19.' });
q({ priority: 'P1', task: 'Refresh El Pollo Loco Consumer Demand (Q4 2025, 8 months overdue)',
    subject_ref: 'BR-el-pollo-loco', why_valuable: 'Self-serviceable now — EPL files with the SEC and data.sec.gov is reachable.',
    blocked_on: '', owner: 'agent', effort: '20 min', notes: 'IR host 503s; use the EDGAR 8-K exhibit instead.' });
q({ priority: 'P1', task: 'Pollo Campero (2024 FDD, 32mo) and Golden Chick (2023 FDD, 44mo) AUVs',
    subject_ref: 'multiple', why_valuable: 'Two brands entered the rankings already overdue. Golden Chick is the oldest figure on the site.',
    blocked_on: 'FDD access', owner: 'human', effort: '', notes: '' });
q({ priority: 'P2', task: 'Spike: can CA DFPI DOCQNET serve FDD documents programmatically?',
    subject_ref: '', why_valuable: 'If yes, it replaces the manual download loop entirely and the FDD programme becomes self-serve.',
    blocked_on: '', owner: 'agent', effort: '1-2 h', notes: 'docqnet.dfpi.ca.gov returns 200 from here (Dynamics/ADX portal, antiforgery tokens). Unproven that it exposes full FDDs — worth one timeboxed attempt, not more.' });
q({ priority: 'P2', task: 'Build scripts/roster-diff.js to compute roster_diff and signals from fdd_roster',
    subject_ref: '', why_valuable: 'Turns the roster tab into the questions the owner actually asked ("who shrank two years running").',
    blocked_on: 'at least two FDD years for one brand', owner: 'agent', effort: '3-4 h', notes: '' });
q({ priority: 'P3', task: 'Backfill street addresses and states for the 16 seeded locations',
    subject_ref: '', why_valuable: 'Location matching needs a normalised address; the seeded rows carry prose locations only.',
    blocked_on: '', owner: 'agent', effort: '', notes: '' });

tab('research_queue', 'B · OBSERVED',
  'What to do next, ordered by value to CSW rather than by ease. Seeded from what is actually blocking the live site today.',
  ['task_id', 'priority', 'task', 'subject_ref', 'why_valuable', 'blocked_on', 'owner',
   'effort', 'status', 'opened_on', 'closed_on', 'notes'],
  queueRows);

/* -------------------------------------------------------- C. derived ---- */

tab('roster_diff', 'C · DERIVED',
  'COMPUTED — do not hand-edit. Diff of two consecutive rosters for one brand. This tab is where "which operators disappeared" and "who is acquiring from whom" actually get answered.',
  ['diff_id', 'brand_id', 'op_id', 'operator_name', 'year_from', 'year_to',
   'units_from', 'units_to', 'delta', 'pct_change', 'event',
   'states_entered', 'states_exited', 'locations_gained', 'locations_lost',
   'likely_counterparty_op_id', 'confidence', 'evidence_source_ids', 'notes'],
  []);

tab('signals', 'C · DERIVED',
  'Derived from roster_diff and observations, plus manual entries for things no diff can see. This is the tab ChatGPT wanted as the primary input — it works far better as an output.',
  ['signal_id', 'signal_type', 'subject_type', 'subject_ref', 'direction', 'severity',
   'as_of', 'description', 'evidence_refs', 'confidence', 'verification',
   'derived_or_manual', 'visibility', 'status', 'notes'],
  [
    { signal_id: 'SIG-0001', signal_type: 'system_contraction', subject_type: 'brand',
      subject_ref: 'BR-kfc-us', direction: 'negative', severity: 'high', as_of: '2026-07',
      description: '312 U.S. restaurants permanently closed in twelve months — 7.64% of the American footprint.',
      evidence_refs: 'SRC-thestreet-kfc-300', confidence: 'confirmed', verification: 'verified',
      derived_or_manual: 'manual', visibility: 'public', status: 'active',
      notes: '312 second-generation boxes entering supply. KBP holds ~25% of the system and is both the largest buyer and the largest source of dispositions.' }
  ]);

tab('publish_candidates', 'C · DERIVED',
  'The bridge back to production. Rows promoted from OBSERVED, shaped so a script can emit a POST /api/agent findings file. Nothing here is live until the desk approves AND someone presses Publish to site.',
  ['candidate_id', 'source_obs_id', 'target_table', 'operation', 'entity_label',
   'dedupe_key', 'payload_json', 'sources_json', 'confidence', 'rationale',
   'ready_to_submit', 'submitted_on', 'batch_ref', 'review_outcome', 'notes'],
  []);

tab('fdd_tracker', 'C · DERIVED',
  'Acquisition status per brand per year — what we hold, what we have extracted, what is still a gap. Filter of `sources` where doc_type=fdd, kept as its own tab because it is the programme\'s worklist.',
  ['brand_id', 'brand_name', 'fdd_year', 'issue_date', 'registrant', 'registration_state',
   'source_id', 'file_held', 'item19_extracted', 'item20_extracted', 'roster_extracted',
   'roster_rows', 'priority', 'blocked_on', 'notes'],
  KNOWN_FDDS.map(([slug, name, registrant, eff, state]) => ({
    brand_id: 'BR-' + slug, brand_name: name, fdd_year: eff.slice(0, 4), issue_date: eff,
    registrant, registration_state: state,
    source_id: 'DOC-' + slug + '-' + eff.slice(0, 4) + '-' + state,
    file_held: 'no', item19_extracted: 'no', item20_extracted: 'no', roster_extracted: 'no',
    roster_rows: 0, priority: 'P0',
    blocked_on: 'document not obtainable from this environment',
    notes: 'Registration confirmed via WI DFI on 2026-09-01.'
  })));

/* ------------------------------------------------------------- write ---- */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const t of TABS) {
  const rows = [t.header, ...t.rows.map((r) => t.header.map((h) => r[h]))];
  fs.writeFileSync(path.join(OUT, t.name + '.csv'), csv(rows));
  manifest.push({ name: t.name, zone: t.zone, purpose: t.purpose, columns: t.header, rows: t.rows.length });
}
fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const w = process.stdout.write.bind(process.stdout);
w('research/sheet/ — ' + TABS.length + ' tabs\n');
for (const t of TABS) w('  ' + t.name.padEnd(20) + t.zone.padEnd(16) + String(t.rows.length).padStart(4) + ' rows · ' + t.header.length + ' cols\n');
