'use strict';
/**
 * Postgres  ->  data/*.json
 *
 *   node scripts/export-data.js [outDir]
 *
 * The inverse of db-import.js, and the half that proves the model is lossless. Until
 * this reproduces data/ exactly, the database is not ready to be upstream of the build.
 *
 * Reads through scripts/lib/csw-db.js, which speaks either psql (local, CI) or
 * PostgREST over global fetch (Supabase). No dependencies either way.
 */
const fs = require('fs');
const path = require('path');
const { makeClient } = require('./lib/csw-db');

const outDir = process.argv[2] || path.join(__dirname, '..', 'data');
const db = makeClient();

/* Drop keys whose value is undefined, so an absent field stays absent rather than
   becoming an explicit null. "Not published" is meaningful here. */
const clean = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r;
};
const byOrd = (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0);
const num = (v) => (v === null || v === undefined ? undefined : Number(v));

async function main() {
  const [sources, brands, tags, companies, bOps, capRates, capSrcs, markets, facts, notes,
         noteSrcs, metrics, props, occ, moves, txs, txProps, listings, expansion,
         articles, artEnt, artSrc, charts, points, chartSrcs, rankings, rankItems, events] =
    await Promise.all([
      db.rows('sources'), db.rows('brands'), db.rows('brand_tags'), db.rows('companies'),
      db.rows('brand_operators'), db.rows('brand_cap_rates'), db.rows('cap_rate_sources'),
      db.rows('markets'), db.rows('facts'), db.rows('entity_notes'), db.rows('note_sources'),
      db.rows('metrics'), db.rows('properties'), db.rows('property_occupancies'),
      db.rows('system_movements'), db.rows('transactions'), db.rows('transaction_properties'),
      db.rows('listings'), db.rows('expansion_agreements'), db.rows('articles'),
      db.rows('article_entities'), db.rows('article_sources'), db.rows('chart_series'),
      db.rows('chart_points'), db.rows('chart_sources'), db.rows('published_rankings'),
      db.rows('published_ranking_items'), db.rows('industry_events')
    ]);

  const srcKey = new Map(sources.map((s) => [s.id, s.key]));
  const jsonKey = new Map(metrics.map((m) => [m.key.toLowerCase(), m.json_key]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const coById = new Map(companies.map((c) => [c.id, c]));
  const K = (id) => srcKey.get(id);

  /* Formatting.
   *
   * data/*.json is hand-formatted today, and each file has its own layout - including
   * arbitrary key groupings in markets, datacenter and research that no general rule
   * reproduces. Matching all thirteen byte-for-byte would mean thirteen bespoke
   * serializers encoding cosmetic choices, so instead the exporter emits one consistent
   * house style that mirrors the dominant existing shape: record arrays get one compact
   * object per line, deeply nested records stay pretty-printed.
   *
   * The round-trip check compares parsed values, not bytes, so this does not weaken the
   * gate. The files are reformatted exactly once, when Phase 4 makes data/ generated;
   * after that every data change is a small readable diff.
   */
  const PRETTY = new Set(['brands.json', 'operators.json', 'consumer.json',
                          'markets.json', 'datacenter.json', 'research.json']);
  const line = (o) => JSON.stringify(o);
  const fmt = (f, v) => {
    if (PRETTY.has(f)) return JSON.stringify(v, null, 2);
    if (f === 'sources.json')
      return '{\n' + Object.entries(v).map(([k, o]) =>
        `  ${JSON.stringify(k)}: ${JSON.stringify(o).replace(/^\{/, '{ ').replace(/\}$/, ' }')}`)
        .join(',\n') + '\n}';
    if (Array.isArray(v)) return '[\n' + v.map(line).join(',\n') + '\n]';
    return '{\n' + Object.entries(v).map(([k, arr]) =>
      `  ${JSON.stringify(k)}: [\n${arr.map((r) => '    ' + line(r)).join(',\n')}\n  ]`)
      .join(',\n') + '\n}';
  };
  const write = (f, v) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, f), fmt(f, v) + '\n');
  };

  /* ---------------------------------------------------------------- sources */
  const srcOut = {};
  for (const s of sources.slice().sort((a, b) => a.key.localeCompare(b.key)))
    srcOut[s.key] = clean({ pub: s.publisher, title: s.title, url: s.url, date: s.date_label ?? undefined });
  write('sources.json', srcOut);

  /* ----------------------------------------------------------------- brands */
  const tagsByBrand = new Map();
  for (const t of tags) (tagsByBrand.get(t.brand_id) || tagsByBrand.set(t.brand_id, []).get(t.brand_id)).push(t.tag_key);
  const factsBySubject = new Map();
  for (const f of facts) {
    const k = `${f.subject_type}:${f.subject_id}`;
    (factsBySubject.get(k) || factsBySubject.set(k, []).get(k)).push(f);
  }
  const notesBy = new Map();
  for (const n of notes) {
    const k = `${n.subject_type}:${n.subject_id}:${n.kind}`;
    (notesBy.get(k) || notesBy.set(k, []).get(k)).push(n);
  }
  const noteSrcBy = new Map();
  for (const r of noteSrcs) (noteSrcBy.get(r.note_id) || noteSrcBy.set(r.note_id, []).get(r.note_id)).push(r);
  const capSrcBy = new Map();
  for (const r of capSrcs) (capSrcBy.get(r.cap_rate_id) || capSrcBy.set(r.cap_rate_id, []).get(r.cap_rate_id)).push(r);

  const SCORING = new Set(['auv_usd','unit_growth_pct','sales_growth_pct','comps_pct','cap_rate_mid','net_unit_decline']);
  const OWN_BACK = {}; // ownership_label is stored verbatim, so nothing to invert

  const brandsOut = brands.filter((b) => b.is_chicken).map((b) => {
    const mine = factsBySubject.get(`brand:${b.id}`) || [];
    const stats = {};
    for (const f of mine.filter((f) => !SCORING.has(f.metric_key.toLowerCase()))) {
      const jk = jsonKey.get(f.metric_key.toLowerCase()) || f.metric_key;
      stats[jk] = clean({
        v: num(f.value_numeric),
        fmt: f.unit === 'usd' ? 'usd' : f.unit === 'pct' ? 'pct' : undefined,
        asOf: f.period_label, src: K(f.source_id), note: f.note ?? undefined
      });
    }
    const metricsOut = {};
    const get = (k) => mine.find((f) => f.metric_key.toLowerCase() === k);
    const ug = get('unit_growth_pct'), sg = get('sales_growth_pct'), av = get('auv_usd'),
          cp = get('comps_pct'), cr = get('cap_rate_mid'), nc = get('net_unit_decline');
    if (ug) { metricsOut.unitGrowthPct = num(ug.value_numeric); if (ug.derivation === 'derived') metricsOut.unitGrowthDerived = true; }
    if (sg) { metricsOut.salesGrowthPct = num(sg.value_numeric); if (sg.derivation === 'derived') metricsOut.salesGrowthDerived = true; }
    if (av) metricsOut.auvUsd = num(av.value_numeric);
    const capRow = capRates.find((c) => c.brand_id === b.id && c.basis !== null);
    if (cr) metricsOut.capRateMid = num(cr.value_numeric);
    else if (capRow) metricsOut.capRateMid = null;   // published range, no sourced midpoint
    if (cp) metricsOut.compsPct = num(cp.value_numeric);
    if (nc) metricsOut.netClosures = Number(nc.value_numeric) === 1;
    if (av && av.note) metricsOut.auvNote = av.note;
    if (sg && sg.note) metricsOut.salesGrowthNote = sg.note;
    if (cr && cr.note) metricsOut.capRateBasis = cr.note;

    const cap = capRow;
    const reNote = (notesBy.get(`brand:${b.id}:real_estate_note`) || [])[0];
    const realEstate = clean({
      capRate: cap ? cap.range_label : undefined,
      capSrc: cap ? (capSrcBy.get(cap.id) || []).sort(byOrd).map((r) => K(r.source_id)) : undefined,
      notes: reNote ? reNote.body_md : undefined,
      notesSrc: reNote ? (noteSrcBy.get(reNote.id) || []).sort(byOrd).map((r) => K(r.source_id)) : undefined
    });
    if (realEstate.capSrc && !realEstate.capSrc.length) delete realEstate.capSrc;
    if (realEstate.notesSrc && !realEstate.notesSrc.length) delete realEstate.notesSrc;

    return clean({
      slug: b.slug, name: b.name, tags: tagsByBrand.get(b.id),
      hq: b.hq_label ?? undefined, founded: b.founded_year ?? undefined,
      parent: b.parent_label ?? undefined, ownership: b.ownership_label ?? undefined,
      franchiseModel: b.franchise_model_md ?? undefined,
      stats, metrics: metricsOut, realEstate,
      pipeline: (notesBy.get(`brand:${b.id}:pipeline`) || []).sort(byOrd)
        .map((n) => clean({ text: n.body_md, src: K(n.source_id) })),
      momentum: b.momentum ?? undefined, analysis: b.analysis_md ?? undefined
    });
  });
  write('brands.json', brandsOut);

  /* -------------------------------------------------------------- operators */
  const opsByCo = new Map();
  for (const r of bOps) (opsByCo.get(r.company_id) || opsByCo.set(r.company_id, []).get(r.company_id)).push(r);
  write('operators.json', companies.map((c) => {
    const mine = factsBySubject.get(`company:${c.id}`) || [];
    const ck = mine.find((f) => f.metric_key.toLowerCase() === 'operator_chicken_units');
    const tk = mine.find((f) => f.metric_key.toLowerCase() === 'operator_total_units');
    const rows = (opsByCo.get(c.id) || []);
    return clean({
      slug: c.slug, name: c.name, hq: c.hq_label ?? undefined,
      brands: rows.map((r) => r.brand_label || brandById.get(r.brand_id).name),
      chickenBrands: rows.filter((r) => brandById.get(r.brand_id).is_chicken)
        .map((r) => r.brand_label || brandById.get(r.brand_id).name),
      chickenUnits: ck ? num(ck.value_numeric) : null,
      chickenUnitsNote: ck && ck.note ? ck.note : undefined,
      totalUnits: tk ? num(tk.value_numeric) : null,
      geography: c.geography ?? undefined, status: c.status_note ?? undefined,
      facts: (notesBy.get(`company:${c.id}:operator_fact`) || []).sort(byOrd)
        .map((n) => clean({ text: n.body_md, asOf: n.period_label ?? undefined, src: K(n.source_id) })),
      analysis: c.analysis_md ?? undefined
    });
  }));

  /* ---------------------------------------------------------------- markets */
  write('markets.json', markets.filter((m) => m.is_published).map((m) => clean({
    slug: m.slug, name: m.name, state: m.state ?? undefined, thesis: m.thesis_md ?? undefined,
    activity: (notesBy.get(`market:${m.id}:market_activity`) || []).sort(byOrd)
      .map((n) => clean({ text: n.body_md, src: K(n.source_id) })),
    watch: (notesBy.get(`market:${m.id}:market_watch`) || []).sort(byOrd).map((n) => n.body_md)
  })));

  /* ------------------------------------------------------------- realestate */
  const catId = markets.find((m) => m.slug === 'us-chicken-category').id;
  const catFacts = factsBySubject.get(`category:${catId}`) || [];
  const BENCH = [['cap_rate_corporate_qsr','Corporate-guaranteed QSR'],
    ['cap_rate_franchisee_qsr','Franchisee-guaranteed QSR'],
    ['cap_rate_all_net_lease','All single-tenant net lease'],
    ['cap_rate_single_tenant_retail','Single-tenant retail'],
    ['cap_rate_premium_ground_lease',"Premium QSR ground lease (McDonald's / Chick-fil-A)"]];
  const catNotes = (kind) => (notesBy.get(`category:${catId}:${kind}`) || []).sort(byOrd);
  write('realestate.json', {
    benchmarks: BENCH.map(([k, label]) => {
      const f = catFacts.find((x) => x.metric_key.toLowerCase() === k);
      return clean({ label, value: `${Number(f.value_numeric).toFixed(2)}%`,
        change: f.note ?? undefined, asOf: f.period_label, src: K(f.source_id) });
    }),
    brandCapRates: capRates.filter((c) => c.structure !== null).map((c) => clean({
      brand: c.brand_label || (c.brand_id ? brandById.get(c.brand_id).name : undefined),
      slug: c.brand_id ? brandById.get(c.brand_id).slug : null,
      range: c.range_label, structure: c.structure, src: K(c.source_id)
    })),
    leaseIntel: catNotes('lease_intel').map((n) => clean({ label: n.label, text: n.body_md, src: K(n.source_id) })),
    supply: catNotes('supply').map((n) => clean({ label: n.label, text: n.body_md, src: K(n.source_id) })),
    marketConditions: catNotes('real_estate_note').map((n) => clean({ text: n.body_md, src: K(n.source_id) }))
  });

  /* ------------------------------------------------------------- transactions */
  const propById = new Map(props.map((p) => [p.id, p]));
  const TXK_BACK = { property_sale:'Property sale', portfolio_acquisition:'Portfolio acquisition',
    brand_acquisition:'Brand acquisition', franchisee_portfolio:'Franchisee portfolio',
    bankruptcy_sale:'Bankruptcy sale', company_store_sale:'Chapter 11 / company-store sale',
    growth_investment:'Growth investment' };
  const propTx = txs.filter((t) => t.subject === 'property');
  const listOut = listings.map((l) => ({ sort_index: l.sort_index, row: clean({
    date: l.date_label, type: 'Listing',
    brand: l.brand_label || (l.brand_id ? brandById.get(l.brand_id).name : undefined),
    location: l.location_label, price: num(l.asking_price_usd) ?? null,
    capRate: num(l.cap_rate_pct) ?? null, term: l.term_label ?? null,
    detail: l.summary_md, src: K(l.source_id)
  }) }));
  write('transactions.json', {
    property: [...propTx.map((t) => ({ sort_index: t.sort_index, row: clean({
      date: t.date_label, type: TXK_BACK[t.kind] || t.kind,
      brand: t.brand_label || (t.brand_id ? brandById.get(t.brand_id).name : undefined),
      location: t.location_label, price: num(t.price_usd) ?? null,
      capRate: num(t.cap_rate_pct) ?? null, term: t.term_label ?? null,
      detail: t.detail_md, src: K(t.source_id)
    }) })), ...listOut].sort((a, b) => a.sort_index - b.sort_index).map((x) => x.row),
    corporate: txs.filter((t) => t.subject === 'company').sort((a, b) => a.sort_index - b.sort_index).map((t) => clean({
      date: t.date_label, type: TXK_BACK[t.kind] || t.kind, target: t.target_label,
      acquirer: t.acquirer_label, value: num(t.price_usd) ?? null,
      detail: t.detail_md, src: K(t.source_id)
    }))
  });

  /* ---------------------------------------------------------------- movement */
  const mv = (dir) => moves.filter((m) => m.direction === dir).sort(byOrd).map((m) => clean({
    date: m.date_label, brand: brandById.get(m.brand_id).slug,
    brandName: m.brand_label || brandById.get(m.brand_id).name, location: m.location_label,
    count: m.unit_count ?? undefined, detail: m.detail_md, src: K(m.source_id)
  }));
  write('movement.json', { openings: mv('opening'), closures: mv('closure') });

  /* --------------------------------------------------------------- expansion */
  write('expansion.json', expansion.slice().sort((a, b) => a.sort_index - b.sort_index).map((e) => clean({
    announced: e.announced_label, brand: brandById.get(e.brand_id).slug,
    brandName: e.brand_label || brandById.get(e.brand_id).name, operator: e.operator_label ?? null,
    market: e.market_label, units: e.unit_count ?? null, unitsLabel: e.units_label ?? undefined,
    timeline: e.timeline_note ?? undefined, src: K(e.source_id)
  })));

  /* ---------------------------------------------------------- news, research */
  const entByArt = new Map();
  for (const e of artEnt) (entByArt.get(e.article_id) || entByArt.set(e.article_id, []).get(e.article_id)).push(e);
  write('news.json', articles.filter((a) => a.kind === 'news').sort((a, b) => a.sort_index - b.sort_index)
    .map((a) => {
      const ent = (entByArt.get(a.id) || [])[0];
      return clean({ date: a.date_label, cat: a.category,
        brand: ent ? brandById.get(ent.subject_id).slug : undefined,
        title: a.title, src: K(a.primary_source_id), means: a.means_md });
    }));
  write('research.json', articles.filter((a) => a.kind === 'research').sort((a, b) => a.sort_index - b.sort_index)
    .map((a) => clean({ slug: a.slug, title: a.title, dek: a.dek, date: a.date_label,
      readTime: `${a.read_minutes} min`, sections: a.body })));

  /* ----------------------------------------------------- charts, rankings, events */
  const ptsBy = new Map();
  for (const p of points) (ptsBy.get(p.series_id) || ptsBy.set(p.series_id, []).get(p.series_id)).push(p);
  const cSrcBy = new Map();
  for (const s of chartSrcs) (cSrcBy.get(s.series_id) || cSrcBy.set(s.series_id, []).get(s.series_id)).push(s);
  write('datacenter.json', charts.slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => clean({
    id: c.key, title: c.title, type: c.chart_kind, unit: c.unit_label || c.unit,
    note: c.note_md ?? undefined,
    series: (ptsBy.get(c.id) || []).sort((a, b) => a.ordinal - b.ordinal)
      .map((p) => clean({ label: p.label, value: num(p.value),
        slug: p.brand_id ? brandById.get(p.brand_id).slug : undefined })),
    srcs: (cSrcBy.get(c.id) || []).map((s) => K(s.source_id))
  })));

  const itemsBy = new Map();
  for (const i of rankItems) (itemsBy.get(i.ranking_id) || itemsBy.set(i.ranking_id, []).get(i.ranking_id)).push(i);
  write('consumer.json', {
    publishedRankings: rankings.slice().sort((a, b) => a.sort_order - b.sort_order).map((r) => clean({
      title: r.title,
      publisher: r.publisher_label || sources.find((s) => s.id === r.source_id).publisher,
      src: K(r.source_id), method: r.method_md,
      items: (itemsBy.get(r.id) || []).sort((a, b) => a.ordinal - b.ordinal).map((i) => i.label)
    })),
    context: catNotes('consumer_context').map((n) => clean({ text: n.body_md, src: K(n.source_id) }))
  });

  write('events.json', events.slice().sort((a, b) => a.sort_order - b.sort_order).map((e) => clean({
    name: e.name, date: e.date_label, location: e.location_label, why: e.why_md, src: K(e.source_id)
  })));

  console.error(`exported 13 files -> ${outDir}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
