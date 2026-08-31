'use strict';
/**
 * The intelligence desk, with a fake database behind it.
 *
 *   npm run preview:admin        → http://localhost:4174/admin/
 *
 * Serves docs/ and answers /api/admin from fixtures, so the dashboard can be opened,
 * clicked through and screenshotted without a Supabase project, credentials or a single
 * real record. Sign in with any email; the code is 000000.
 *
 * This exists because 1,200 lines of interface that nobody has looked at is not
 * finished work, and because the person who owns this site should be able to see what
 * the desk does before deciding to wire it up. It is a harness: it never talks to
 * Supabase, and nothing it returns has been near the real data.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs');
const PORT = Number(process.argv[2] || 4174);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

const now = Date.now();
const at = (h) => new Date(now - h * 3600e3).toISOString();

const TARGETS = [
  { table_name: 'public.transactions', label: 'Transaction', plural_label: 'Transactions',
    group_label: 'Real estate', description: 'A sale, portfolio acquisition, sale-leaseback or refranchising deal.',
    help_md: 'A price that was not disclosed goes in as is_price_disclosed = false, never as an estimate.',
    required_columns: ['kind', 'subject', 'date_label', 'source_id'], requires_source: true,
    supports_visibility: true, update_strategy: 'update', sort_order: 10,
    columns: [
      { name: 'kind', type: 'transaction_kind', ord: 1, required: true,
        enum_values: ['property_sale', 'portfolio_acquisition', 'ground_lease_sale', 'sale_leaseback'] },
      { name: 'subject', type: 'transaction_subject', ord: 2, required: true, enum_values: ['property', 'company'] },
      { name: 'date_label', type: 'text', ord: 3, required: true, comment: 'As published: "Aug 2026", "Q3 2026".' },
      { name: 'source_id', type: 'uuid', ord: 4, required: true, references_table: 'sources' },
      { name: 'price_usd', type: 'numeric(16,2)', ord: 5 },
      { name: 'cap_rate_pct', type: 'numeric(5,2)', ord: 6 },
      { name: 'is_price_disclosed', type: 'boolean', ord: 7 },
      { name: 'brand_id', type: 'uuid', ord: 8, references_table: 'brands' },
      { name: 'buyer_company_id', type: 'uuid', ord: 9, references_table: 'companies' },
      { name: 'location_label', type: 'text', ord: 10 },
      { name: 'detail_md', type: 'text', ord: 11 }] },
  { table_name: 'public.facts', label: 'Figure', plural_label: 'Figures', group_label: 'Data',
    description: 'One published number about one subject, for one period.',
    help_md: 'Corrections supersede rather than overwrite, so last quarter’s published figure survives.',
    required_columns: ['subject_type', 'subject_id', 'metric_key', 'unit', 'period_label', 'source_id'],
    requires_source: true, supports_visibility: true, update_strategy: 'supersede', sort_order: 110,
    columns: [
      { name: 'subject_type', type: 'subject_type', ord: 1, required: true, enum_values: ['brand', 'company', 'market', 'category'] },
      { name: 'subject_id', type: 'uuid', ord: 2, required: true, references_table: 'brands' },
      { name: 'metric_key', type: 'citext', ord: 3, required: true, references_table: 'metrics' },
      { name: 'unit', type: 'metric_unit', ord: 4, required: true, enum_values: ['usd', 'count', 'pct'] },
      { name: 'period_label', type: 'text', ord: 5, required: true },
      { name: 'source_id', type: 'uuid', ord: 6, required: true, references_table: 'sources' },
      { name: 'value_numeric', type: 'numeric(20,4)', ord: 7 },
      { name: 'derivation', type: 'derivation', ord: 8, enum_values: ['reported', 'derived', 'franchisee_reported'] },
      { name: 'note', type: 'text', ord: 9 }] },
  { table_name: 'public.properties', label: 'Property', plural_label: 'Properties',
    group_label: 'Real estate', description: 'A building or site.', requires_source: false,
    supports_visibility: true, update_strategy: 'update', required_columns: [], sort_order: 20,
    columns: [
      { name: 'address_line1', type: 'text', ord: 1 }, { name: 'city', type: 'text', ord: 2 },
      { name: 'state', type: 'text', ord: 3 }, { name: 'building_sqft', type: 'integer', ord: 4 },
      { name: 'status', type: 'property_status', ord: 5, enum_values: ['operating', 'dark', 'for_sale', 'sold'] },
      { name: 'is_second_generation', type: 'boolean', ord: 6 }] },
  { table_name: 'public.companies', label: 'Operator or company', plural_label: 'Companies',
    group_label: 'Entities', description: 'An operator, franchisor parent, investor or broker.',
    requires_source: false, supports_visibility: true, update_strategy: 'update',
    required_columns: ['slug', 'name', 'kind'], sort_order: 70,
    columns: [
      { name: 'slug', type: 'citext', ord: 1, required: true }, { name: 'name', type: 'text', ord: 2, required: true },
      { name: 'kind', type: 'company_kind', ord: 3, required: true, enum_values: ['operator', 'franchisor', 'reit', 'private_equity'] },
      { name: 'hq_city', type: 'text', ord: 4 }, { name: 'hq_state', type: 'text', ord: 5 }] },
  { table_name: 'public.entity_notes', label: 'Note', plural_label: 'Notes', group_label: 'Data',
    description: 'A sourced prose bullet attached to a brand, company or market.',
    requires_source: true, supports_visibility: true, update_strategy: 'update',
    required_columns: ['subject_type', 'subject_id', 'kind', 'body_md'], sort_order: 130,
    columns: [
      { name: 'subject_type', type: 'subject_type', ord: 1, required: true, enum_values: ['brand', 'company', 'market'] },
      { name: 'subject_id', type: 'uuid', ord: 2, required: true, references_table: 'brands' },
      { name: 'kind', type: 'note_kind', ord: 3, required: true, enum_values: ['pipeline', 'lease_intel', 'market_watch'] },
      { name: 'body_md', type: 'text', ord: 4, required: true }] },
  { table_name: 'public.leases', label: 'Lease', plural_label: 'Leases', group_label: 'Real estate',
    description: 'Lease structure, term, guarantee and rent.', requires_source: true,
    supports_visibility: true, update_strategy: 'update', required_columns: ['property_id'], sort_order: 40,
    columns: [
      { name: 'property_id', type: 'uuid', ord: 1, required: true, references_table: 'properties' },
      { name: 'structure', type: 'lease_structure', ord: 2, enum_values: ['ground_lease', 'absolute_nnn', 'nnn'] },
      { name: 'base_annual_rent_usd', type: 'numeric(14,2)', ord: 3 },
      { name: 'term_label', type: 'text', ord: 4 }] }
];

const ITEMS = [
  { id: 'i-1', title: 'Popeyes AUV, FY2026', target_table: 'public.facts', target_label: 'Figure',
    group_label: 'Data', operation: 'update', target_id: 'f-1', entity_label: 'Popeyes',
    status: 'pending', submitter_kind: 'agent', agent_name: 'Claude research',
    confidence: 'high', visibility: 'public', source_count: 1, open_match_count: 0,
    created_at: at(2), batch_id: 'b-1', batch_title: 'Q4 filings sweep',
    rationale: 'Restaurant Brands International states U.S. average restaurant sales of $1.81m in the Q4 release. The figure on file is a year old.',
    payload: { value_numeric: 1810000, period_label: 'FY2026', as_of: '2026-08-12' },
    baseline: { value_numeric: '1700000.0000', period_label: 'FY2025', as_of: '2025-08-01' } },
  { id: 'i-2', title: 'Ground lease sale, Tampa FL', target_table: 'public.transactions',
    target_label: 'Transaction', group_label: 'Real estate', operation: 'insert', target_id: null,
    entity_label: 'Popeyes', status: 'pending', submitter_kind: 'human',
    submitted_by_label: 'desk', confidence: 'medium', visibility: 'public', source_count: 1,
    open_match_count: 1, created_at: at(6),
    rationale: 'Boulder Group’s quarterly names the trade. Worth carrying because it is the second Popeyes ground lease inside 60 bps this quarter.',
    payload: { kind: 'ground_lease_sale', subject: 'property', date_label: 'Aug 2026',
               price_usd: 2450000, cap_rate_pct: 5.6, location_label: 'Tampa, FL',
               brand_id: '@brand:popeyes', source_id: '@source:1' } },
  { id: 'i-3', title: 'Rent on the Tampa box', target_table: 'public.leases', target_label: 'Lease',
    group_label: 'Real estate', operation: 'insert', entity_label: 'Popeyes', status: 'pending',
    submitter_kind: 'human', submitted_by_label: 'desk', confidence: 'confirmed',
    visibility: 'confidential', source_count: 1, open_match_count: 0, created_at: at(20),
    rationale: 'Abstract shared by the owner. Not for publication — it informs the cap rate read only.',
    payload: { property_id: '@property:tampa-dale-mabry', base_annual_rent_usd: 138000,
               term_label: '15-year absolute NNN, corporate guarantee' } },
  { id: 'i-4', title: 'Wingstop unit count, Q3 2026', target_table: 'public.facts',
    target_label: 'Figure', group_label: 'Data', operation: 'insert', entity_label: 'Wingstop',
    status: 'needs_verification', submitter_kind: 'agent', agent_name: 'Claude research',
    confidence: 'low', visibility: 'public', source_count: 0, open_match_count: 0, created_at: at(26),
    batch_id: 'b-1', batch_title: 'Q4 filings sweep',
    rationale: 'Seen in a summary; the primary filing could not be reached.',
    payload: { subject_type: 'brand', subject_id: '@brand:wingstop', metric_key: 'us_units',
               value_numeric: 2810, unit: 'count', period_label: 'Q3 2026' } },
  { id: 'i-5', title: 'New operator: Sun Holdings', target_table: 'public.companies',
    target_label: 'Operator or company', group_label: 'Entities', operation: 'insert',
    entity_label: 'Sun Holdings', status: 'applied', submitter_kind: 'human',
    submitted_by_label: 'desk', confidence: 'high', visibility: 'public', source_count: 1,
    open_match_count: 0, created_at: at(50), applied_at: at(49),
    payload: { slug: 'sun-holdings', name: 'Sun Holdings', kind: 'operator', hq_city: 'Dallas' } }
];

const SOURCES = {
  'i-1': [{ id: 's-1', ordinal: 1, publisher: 'Restaurant Brands International',
            title: 'Q4 2026 results', url: 'https://example.com/rbi-q4-2026', date_label: 'Q4 2026',
            quote: 'U.S. average restaurant sales of $1.81 million, up from $1.70 million.' }],
  'i-2': [{ id: 's-2', ordinal: 1, publisher: 'The Boulder Group',
            title: 'Net Lease Market Report Q3 2026', url: 'https://example.com/boulder-q3-2026',
            date_label: 'Q3 2026', quote: 'A Popeyes ground lease in Tampa traded at a 5.6% cap rate.' }],
  'i-3': [{ id: 's-3', ordinal: 1, publisher: 'Owner (confidential)', url: 'https://example.com/abstract' }],
  'i-4': [],
  'i-5': [{ id: 's-5', ordinal: 1, source_id: 'src-x',
            source: { id: 'src-x', key: 'nrn-top-operators-2026', publisher: 'Nation’s Restaurant News',
                      title: 'Top 200 franchisees', url: 'https://example.com/nrn', date_label: '2026' } }]
};

const MATCHES = {
  'i-2': [{ id: 'm-1', candidate_table: 'public.transactions', candidate_id: 't-9',
            candidate_label: 'Tampa, FL · Aug 2026', similarity: 0.86,
            reason: 'location_label is close to "Tampa, FL"', resolution: 'unresolved' }]
};

const CURRENT = {
  'f-1': { value_numeric: '1700000.0000', period_label: 'FY2025', as_of: '2025-08-01' }
};

const STATS = { pending: 3, needs_verification: 1, applied_7d: 6, rejected_7d: 1, open_matches: 1,
  agent_runs_7d: 2, open_batches: 1, new_leads: 2, leads_7d: 4, unverified_sources: 88,
  sources_total: 108, internal_records: 3, stale_figures: 5 };

const RECORDS = {
  'public.transactions': [
    { id: 't-9', label: 'Tampa, FL · Aug 2026',
      row: { id: 't-9', kind: 'ground_lease_sale', subject: 'property', date_label: 'Aug 2026',
             price_usd: '2390000.00', cap_rate_pct: '5.90', location_label: 'Tampa, FL',
             is_published: true, visibility: 'public', created_at: at(300) } },
    { id: 't-8', label: 'Four Corners portfolio · Jul 2026',
      row: { id: 't-8', kind: 'portfolio_acquisition', subject: 'property', date_label: 'Jul 2026',
             price_usd: '7100000.00', is_published: true, visibility: 'public', created_at: at(700) } }],
  'public.leases': [
    { id: 'l-1', label: '15-year absolute NNN',
      row: { id: 'l-1', structure: 'absolute_nnn', base_annual_rent_usd: '141000.00',
             visibility: 'confidential', created_at: at(900) } }]
};

const LOOKUPS = {
  brand: [{ id: 'b-1', ref: 'popeyes', label: 'Popeyes Louisiana Kitchen', detail: 'chicken' },
          { id: 'b-2', ref: 'wingstop', label: 'Wingstop', detail: 'chicken' },
          { id: 'b-3', ref: 'kfc', label: 'KFC U.S.', detail: 'chicken' }],
  company: [{ id: 'c-1', ref: 'kbp-brands', label: 'KBP Brands', detail: 'operator' },
            { id: 'c-2', ref: 'four-corners', label: 'Four Corners Property Trust', detail: 'reit' }],
  source: [{ id: 'src-x', ref: 'nrn-top-operators-2026', label: 'Nation’s Restaurant News — Top 200 franchisees', detail: '2026' },
           { id: 'src-y', ref: 'boulder-q3-2026', label: 'The Boulder Group — Net Lease Report', detail: 'Q3 2026' }],
  metric: [{ ref: 'auv_usd', label: 'Average unit volume', detail: 'usd' },
           { ref: 'us_units', label: 'U.S. units', detail: 'count' }],
  property: [{ id: 'p-1', ref: 'tampa-dale-mabry', label: '4412 W Dale Mabry Hwy, Tampa', detail: 'FL' }],
  market: [{ id: 'mk-1', ref: 'tampa', label: 'Tampa', detail: 'FL' }],
  transaction: []
};

const LEADS = [
  { id: 'l-1', form: 'sell_property', status: 'new', email: 'owner@example.com',
    full_name: 'A. Owner', phone: '813-555-0134', created_at: at(3),
    payload: { address: '4412 W Dale Mabry Hwy, Tampa FL', brand: 'Popeyes', rent: '$138,000' } },
  { id: 'l-2', form: 'buy_criteria', status: 'new', email: 'buyer@example.com',
    full_name: 'B. Buyer', created_at: at(18),
    payload: { price_range: '$1.5M – $4M', cap_rate: '5.5%+', geography: 'Southeast' } },
  { id: 'l-3', form: 'newsletter', status: 'triaged', email: 'reader@example.com', created_at: at(40),
    payload: { email: 'reader@example.com' } }
];

const BATCHES = [
  { id: 'b-1', title: 'Q4 filings sweep', kind: 'agent', status: 'submitted', agent_name: 'Claude research',
    model: 'claude-opus-5', started_at: at(2), finished_at: at(1),
    task_prompt: 'Read the Q4 releases for the tracked brands and propose any AUV, unit count or comps figure that differs from what CSW holds.',
    summary_md: 'Four figures proposed; one could not be traced to a primary document and is flagged.',
    items: [{ count: 2 }] },
  { id: 'b-2', title: 'Desk entry', kind: 'human', status: 'open', started_at: at(6), items: [{ count: 2 }] }
];

const ME = { user_id: 'u-preview', email: 'preview@chickensandwichwars.com', role: 'admin',
             full_name: 'Preview', is_staff: true, can_edit: true, is_admin: true,
             can_see_confidential: true };

function handleApi(op, args) {
  const item = (id) => ITEMS.find((i) => i.id === id);
  switch (op) {
    case 'me': return { me: ME };
    case 'stats': return { stats: STATS };
    case 'schema': return { targets: TARGETS };
    case 'queue': {
      const wanted = (args.status && args.status !== 'all') ? args.status.split(',') : null;
      let items = ITEMS.filter((i) => !wanted || wanted.includes(i.status));
      if (args.q) items = items.filter((i) => (i.title + i.entity_label).toLowerCase().includes(args.q.toLowerCase()));
      return { items };
    }
    case 'item': {
      const it = item(args.id);
      return { item: it, sources: SOURCES[args.id] || [], matches: MATCHES[args.id] || [],
               events: [{ at: it.created_at, action: 'submitted', actor_label: it.agent_name || 'desk' }],
               validation: { errors: [], warnings: (SOURCES[args.id] || []).length ? [] : ['no source cited'],
                             stale: [] },
               current: CURRENT[it.target_id] || null };
    }
    case 'decide': {
      const it = item(args.id);
      if (it) it.status = args.decision === 'approve' ? 'applied' : args.decision;
      return { result: { id: args.id, status: it && it.status } };
    }
    case 'decideMany': return { done: args.ids, failed: [] };
    case 'resolveMatch': return { ok: true };
    case 'submit': return { result: { batch_id: 'b-2', items: [{ id: 'i-2', accepted: true, status: 'pending', errors: [], warnings: [] }] } };
    case 'lookup': {
      const list = LOOKUPS[args.kind] || [];
      const q = (args.q || '').toLowerCase();
      return { results: list.filter((r) => (r.label + r.ref).toLowerCase().includes(q)) };
    }
    case 'batches': return { batches: BATCHES };
    case 'batch': return { batch: BATCHES.find((b) => b.id === args.id),
                           items: ITEMS.filter((i) => i.batch_id === args.id) };
    case 'records': {
      const list = RECORDS[args.table] || [];
      return { records: args.id ? list.filter((r) => r.id === args.id) : list };
    }
    case 'history': return { history: [{ id: 1, operation: 'UPDATE', changed_at: at(100), changed_by_name: 'Desk' }] };
    case 'leads': return { leads: args.status ? LEADS.filter((l) => l.status === args.status) : LEADS };
    case 'leadUpdate': return { lead: { id: args.id, status: args.status } };
    case 'staff': return { staff: [{ user_id: 'u-preview', role: 'admin', email: ME.email, full_name: 'Preview' }] };
    case 'grantStaff': return { granted: { email: args.email, role: args.role } };
    case 'agentKeys': return { keys: [{ id: 'k-1', name: 'Claude research', key_prefix: 'csw_ag_9Kd2',
      scopes: ['submit', 'lookup'], use_count: 12, last_used_at: at(2), created_at: at(300) }] };
    case 'agentKeyCreate': return { key: { id: 'k-2', name: args.name }, secret: 'csw_ag_PREVIEW_ONLY_not_a_real_key' };
    case 'agentKeyRevoke': return { ok: true };
    default: return { error: `preview has no fixture for "${op}"` };
  }
}

const json = (res, code, obj) => res.writeHead(code, { 'content-type': 'application/json' })
  .end(JSON.stringify(obj));

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (url === '/api/admin' && req.method === 'GET') {
    return json(res, 200, { ok: true, configured: true,
      url: `http://localhost:${PORT}/mockauth`, anonKey: 'preview-anon-key' });
  }
  /* GoTrue, faked: any address, and the code is always 000000. */
  if (url.startsWith('/mockauth/auth/v1/')) {
    let raw = ''; req.on('data', (c) => { raw += c; });
    return req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      if (url.endsWith('/otp')) return json(res, 200, {});
      return json(res, 200, { access_token: 'preview-token', refresh_token: 'preview-refresh',
        expires_in: 3600, user: { id: 'u-preview', email: b.email || ME.email } });
    });
  }
  if (url === '/api/admin' && req.method === 'POST') {
    let raw = ''; req.on('data', (c) => { raw += c; });
    return req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const out = handleApi(b.op, b);
      if (out.error) return json(res, 400, { ok: false, error: out.error });
      json(res, 200, { ok: true, ...out });
    });
  }
  /* The agent door, faked to the same shape, so scripts/agent-submit.js and the curl in
     db/AGENT_INTAKE.md can be exercised without a key or a database. */
  if (url === '/api/agent') {
    let raw = ''; req.on('data', (c) => { raw += c; });
    return req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!/^csw_ag_/.test(key)) {
        return json(res, 401, { ok: false, error: 'Send an agent key as "Authorization: Bearer csw_ag_...".' });
      }
      if (b.op === 'schema') return json(res, 200, { ok: true, targets: TARGETS });
      if (b.op === 'lookup') {
        const list = LOOKUPS[b.kind] || [];
        const q = (b.q || '').toLowerCase();
        return json(res, 200, { ok: true, results: list.filter((r) => (r.label + r.ref).toLowerCase().includes(q)) });
      }
      if (b.op === 'finish') return json(res, 200, { ok: true, batch_id: b.batch_id, status: 'submitted' });
      const items = (b.items || []).map((it, i) => ({
        id: `preview-${i + 1}`, title: it.title, accepted: true,
        status: (it.sources || []).length ? 'pending' : 'needs_verification',
        matches: 0, errors: [], warnings: (it.sources || []).length ? [] : ['no source cited'] }));
      return json(res, 200, { ok: true, batch_id: 'preview-run', accepted: items.length,
        rejected: 0, items, note: 'Nothing here is published. Every item waits for a human decision.' });
    });
  }

  let file = path.join(OUT, url);
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(buf);
  });
}).listen(PORT, () => {
  console.log(`CSW desk preview: http://localhost:${PORT}/admin/`);
  console.log('  fixtures only — no Supabase, no real records. Any email; the code is 000000.');
});
