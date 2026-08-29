'use strict';
const C = require('../lib/components');
const { esc, usd, num, pct, fmtStat } = require('../lib/util');

const FILTERS = ['chicken sandwich', 'wings', 'tenders', 'fried chicken', 'hot chicken', 'national', 'regional', 'emerging', 'franchised', 'corporate', 'growing', 'declining', 'distressed', 'public'];

function primaryUnits(b) {
  const s = b.stats;
  const st = s.usUnits || s.usCanadaUnits || s.globalUnits || s.currentUnits || s.companyUnitsSold;
  return st;
}

module.exports = function brands(ctx) {
  const { data, sources, ranking, scoreBySlug, operatorsByBrand } = ctx;
  const out = [];

  /* ---------------- index ---------------- */
  const R = C.refs(sources);
  const rows = data.brands
    .slice()
    .sort((a, b) => {
      const av = primaryUnits(a), bv = primaryUnits(b);
      return (bv ? bv.v : 0) - (av ? av.v : 0);
    })
    .map((b) => {
      const units = primaryUnits(b);
      const sc = scoreBySlug[b.slug];
      const sales = b.stats.systemwideSales || b.stats.globalSales || b.stats.systemwideSales2024;
      const auv = b.metrics.auvUsd;
      const g = b.metrics.unitGrowthPct;
      return {
        attrs: ` data-tags="${esc(b.tags.join(' '))}" data-name="${esc(b.name)}"`,
        cells: [
          `<a href="${b.slug}.html"><b>${esc(b.name)}</b></a><div class="note">${esc(b.hq)}</div>`,
          units ? `${num(units.v)}${R.ref(units.src)}<div class="note">${esc(units.asOf)}</div>` : '—',
          sales ? `${usd(sales.v)}${R.ref(sales.src)}` : '—',
          auv ? usd(auv) : '—',
          g == null ? '—' : `<span class="${g > 0.5 ? 'up' : g < -0.5 ? 'down' : 'flat'}">${pct(g)}</span>`,
          C.momentumBadge(b.momentum),
          sc && sc.rated ? `<b>${sc.score}</b>` : '<span class="note">Unrated</span>'
        ]
      };
    });

  const filterChips = FILTERS.map((f) => `<button class="chip" data-filter="${esc(f)}">${esc(f)}</button>`).join('');

  const indexBody = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Database</div>
  <h1>Chicken Brands</h1>
  <p class="dek">Every U.S. chicken concept CSW tracks, with unit counts, systemwide sales, average unit volumes and growth — each figure carrying the publisher it came from and the period it covers.</p>

  <div class="filters" data-filter-group="tbody tr" style="margin-top:26px">
    <button class="chip on" data-filter="all">All</button>
    ${filterChips}
    <input class="searchinput" data-filter-text placeholder="Filter by brand name…" style="margin-left:auto;max-width:260px">
  </div>

  ${C.table({
    cols: ['Brand', { label: 'U.S. units', num: true }, { label: 'Systemwide sales', num: true, hideSmall: true }, { label: 'AUV', num: true }, { label: 'Unit growth', num: true }, { label: 'Read', hideSmall: true }, { label: 'CSW Score', num: true }],
    rows,
    cls: 'sortable'
  }).replace('<table>', '<table data-sortable>')}

  <p class="note" style="margin-top:14px">Unit counts are the most recent published figure for each brand and are not all as of the same date — the as-of period is shown under each number. Popeyes is reported by its parent on a combined U.S. and Canada basis. Systemwide sales are U.S. unless the brand only publishes a global figure. Sort any column by clicking its header.</p>
</div></section>

<section class="section"><div class="wrap">
  <div class="grid g3">
    <div class="card"><div class="kicker">What this database is for</div><h3>Unit counts are a lagging indicator</h3><p class="note">A brand's footprint can be flat while every restaurant inside it changes hands. That is why CSW pairs this database with an <a href="../operators/">operator database</a> — the ownership layer brand data never shows.</p></div>
    <div class="card"><div class="kicker">Coverage gaps are findings</div><h3>${ranking.unrated.length} brands are unrated</h3><p class="note">Not because they are unimportant, but because fewer than three of the five scoring components have been published. Those gaps are exactly where proprietary intelligence gets built.</p></div>
    <div class="card"><div class="kicker">Corrections</div><h3>Own one of these brands?</h3><p class="note">If a figure here is out of date or a franchise structure has changed, <a href="../contact/">send the desk a correction</a>. Updates are published with the source attached.</p></div>
  </div>
</div></section>

<div class="wrap">${R.render()}</div>`;

  out.push({
    path: 'brands/index.html', title: 'Chicken Brands Database', active: 'brands', depth: 1,
    canonicalPath: 'brands/',
    description: 'The definitive database of U.S. chicken restaurant concepts — units, AUV, systemwide sales, growth and momentum.',
    body: indexBody,
    index: { t: 'Chicken Brands Database', s: `${data.brands.length} U.S. chicken concepts with units, AUV and growth`, u: 'brands/', k: 'brands database units auv systemwide sales chicken chains' }
  });

  /* ---------------- profiles ---------------- */
  for (const b of data.brands) {
    const R2 = C.refs(sources);
    const sc = scoreBySlug[b.slug];
    const statCells = [];
    const push = (key, label) => {
      const s = C.brandStat(b.stats[key], label, R2);
      if (s) statCells.push(s);
    };
    push('usUnits', 'U.S. units'); push('usCanadaUnits', 'U.S. & Canada units');
    push('globalUnits', 'Global units'); push('currentUnits', 'Current locations');
    push('systemwideSales', 'Systemwide sales'); push('globalSales', 'Global system sales');
    push('systemwideSales2024', 'Systemwide sales (2024)');
    push('auv', 'Average unit volume'); push('blendedAuv', 'Blended AUV');
    push('unitChange', 'Net unit change'); push('openings2025', 'Openings');
    push('compsFY', 'Comparable sales (FY)'); push('compsLatest', 'Comparable sales (latest)');
    push('franchiseeProfit', 'Franchisee restaurant profit');
    push('usClosures2025', 'U.S. closures 2025'); push('closures15mo', 'Closures, 15 months');
    push('closuresTTM', 'Closures, trailing 12 months');
    push('unitsPrior', 'Prior-year units'); push('units2024', 'Units (2024)'); push('units2025', 'Units (2025 target)');
    push('salesGrowth2025', 'Sales growth 2025'); push('agreements2025', 'Development agreements 2025');
    push('pipelineUnits', 'Committed pipeline'); push('commitments', 'Franchise commitments');
    push('dealValue', 'Transaction value'); push('openings2024', 'Openings (2024)');
    push('companyUnitsSold', 'Company restaurants sold'); push('closures', 'Closures');
    push('debt', 'Debt at filing'); push('closuresH1', 'Closures (H1 2026)');
    push('openingTarget', 'Opening target'); push('openings', 'Openings');

    const ops = (operatorsByBrand[b.slug] || []);
    const opRows = ops.map((o) => [
      `<a href="../operators/${o.slug}.html"><b>${esc(o.name)}</b></a>`,
      o.chickenUnits != null ? num(o.chickenUnits) + (o.chickenUnitsNote ? `<div class="note">${esc(o.chickenUnitsNote)}</div>` : '') : '—',
      esc((o.geography || []).join(', ')),
      C.badge(o.status, /Acquir|develop/i.test(o.status) ? 'good' : /Liquidat|Divest/i.test(o.status) ? 'bad' : 'mut')
    ]);

    const brandNews = data.news.filter((n) => n.brand === b.slug);
    const brandExp = data.expansion.filter((e) => e.brand === b.slug);
    const brandOpen = data.movement.openings.filter((m) => m.brand === b.slug);
    const brandClose = data.movement.closures.filter((m) => m.brand === b.slug);
    const brandProps = data.transactions.property.filter((t) => t.brand.toLowerCase().includes(b.name.split(' ')[0].toLowerCase()));

    const body = `
<section class="section" style="padding-bottom:20px"><div class="wrap">
  <div class="eyebrow">Brand profile</div>
  <div style="display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
    <div style="flex:1;min-width:min(280px,100%)">
      <h1 style="margin-bottom:10px">${esc(b.name)}</h1>
      <div class="tags" style="margin-bottom:14px">${C.momentumBadge(b.momentum)}${b.tags.map((t) => C.badge(t)).join('')}</div>
      <p class="dek">${esc(b.franchiseModel)}</p>
    </div>
    ${sc && sc.rated ? `<div class="panel" style="min-width:min(320px,100%);flex:0 1 380px">
      <div class="panel-head"><h3>CSW Score</h3><a class="more" style="margin-left:auto;font-size:12px" href="../methodology/">Methodology →</a></div>
      <div class="panel-body">
        <div class="scorebox" style="margin-bottom:14px">
          <div class="scorenum">${sc.score}</div>
          <div class="note">Rank #${sc.rank} of ${ranking.rated.length} rated brands<br>${sc.coverage} of 5 components available${sc.penalty ? `<br>Includes a ${sc.penalty}-point net-closure adjustment` : ''}</div>
        </div>
        ${C.scoreBars(sc.parts)}
      </div>
    </div>` : `<div class="panel" style="min-width:min(280px,100%);flex:0 1 340px"><div class="panel-head"><h3>CSW Score</h3></div><div class="panel-body"><p class="note" style="margin:0">Unrated. Fewer than three of the five scoring components have been published for this brand. CSW does not fill that gap with an estimate.</p></div></div>`}
  </div>

  <div class="stats" style="margin-top:26px">
    ${statCells.map((s) => `<div class="stat"><div class="v">${s.value}</div><div class="l">${esc(s.label)}</div>${s.note ? `<div class="n">${s.note}</div>` : ''}</div>`).join('')}
  </div>

  <div class="grid g4" style="margin-top:20px">
    <div class="card tight"><div class="kicker">Headquarters</div><div>${esc(b.hq)}</div></div>
    <div class="card tight"><div class="kicker">Founded</div><div>${b.founded ? esc(b.founded) : '—'}</div></div>
    <div class="card tight"><div class="kicker">Parent / ownership</div><div>${esc(b.parent)}</div></div>
    <div class="card tight"><div class="kicker">Structure</div><div>${esc(b.ownership)}</div></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="analysis">
    <div class="kicker">CSW Analysis</div>
    <p style="margin:0;font-size:16.5px;color:var(--ink-2)">${esc(b.analysis)}</p>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="split">
    <div>
      <h2>Real estate profile</h2>
      <div class="panel"><div class="panel-body">
        <p><span class="kicker">Cap rate</span><br><b>${esc(b.realEstate.capRate)}</b>${R2.refAll(b.realEstate.capSrc)}</p>
        <p class="note" style="margin-bottom:0">${esc(b.realEstate.notes)}${R2.refAll(b.realEstate.notesSrc)}</p>
      </div></div>

      ${brandProps.length ? `<h3 style="margin-top:26px">Verified transactions</h3>
      ${C.table({ cols: ['Date', { label: 'Location', id: true }, { label: 'Price', num: true }, { label: 'Cap', num: true }, 'Terms'], rows: brandProps.map((t) => [
        esc(t.date), esc(t.location) + R2.ref(t.src), usd(t.price), t.capRate ? t.capRate.toFixed(2) + '%' : '—', esc(t.term || '—')
      ]) })}` : ''}

      ${brandExp.length ? `<h3 style="margin-top:26px">Development pipeline</h3>
      ${C.table({ cols: ['Announced', { label: 'Market', id: true }, 'Commitment', 'Timeline'], rows: brandExp.map((e) => [
        esc(e.announced), esc(e.market) + R2.ref(e.src), esc(e.unitsLabel), esc(e.timeline || '—')
      ]) })}` : ''}

      ${(brandOpen.length || brandClose.length) ? `<h3 style="margin-top:26px">Unit movement</h3>
      ${C.table({ cols: ['Date', 'Type', { label: 'Detail', id: true }], rows: [
        ...brandOpen.map((m) => [esc(m.date), C.badge('Opening', 'good'), `<b>${esc(m.location)}</b> — ${esc(m.detail)}${R2.ref(m.src)}`]),
        ...brandClose.map((m) => [esc(m.date), C.badge('Closure', 'bad'), `<b>${esc(m.location)}</b>${m.count ? ` (${num(m.count)})` : ''} — ${esc(m.detail)}${R2.ref(m.src)}`])
      ] })}` : ''}
    </div>

    <aside>
      ${b.pipeline && b.pipeline.length ? `<div class="panel">
        <div class="panel-head"><h3>Announced plans</h3></div>
        <div class="panel-body"><ul class="bullets" style="margin:0">${b.pipeline.map((p) => `<li class="note">${esc(p.text)}${R2.ref(p.src)}</li>`).join('')}</ul></div>
      </div>` : ''}

      ${opRows.length ? `<div class="panel" style="margin-top:18px">
        <div class="panel-head"><h3>Operators tracked</h3></div>
        <table><tbody>${opRows.map((r) => `<tr><td>${r[0]}<div class="note">${r[2]}</div></td><td class="num">${r[1]}</td></tr>`).join('')}</tbody></table>
        <div class="pad"><a class="btn ghost" href="../operators/">Operator database →</a></div>
      </div>` : `<div class="panel" style="margin-top:18px">
        <div class="panel-head"><h3>Operators tracked</h3></div>
        <div class="panel-body"><p class="note" style="margin:0">No ${esc(b.name)} operators are in the CSW database yet. If you operate this brand, <a href="../contact/">tell the desk</a> — operator coverage is built from primary reporting, filings and direct submissions.</p></div>
      </div>`}

      <div class="cta" style="margin-top:18px">
        <h3>Own ${esc(b.name)} real estate?</h3>
        <p class="note">CSW tracks chicken property transactions and can arrange a confidential valuation.</p>
        <a class="btn" href="../sell/">Request a valuation</a>
      </div>
    </aside>
  </div>
</div></section>

${brandNews.length ? `<section class="section"><div class="wrap">
  <h2>${esc(b.name)} in the news</h2>
  ${brandNews.map((n) => C.newsItem(n, R2, { depth: 1 })).join('')}
</div></section>` : ''}

<div class="wrap">${R2.render()}</div>`;

    out.push({
      path: `brands/${b.slug}.html`, title: b.name, active: 'brands', depth: 1,
      canonicalPath: `brands/${b.slug}.html`,
      description: `${b.name}: units, AUV, systemwide sales, real estate profile, operators, development pipeline and CSW analysis.`,
      breadcrumb: `<a href="../index.html">Home</a> / <a href="./">Brands</a> / ${esc(b.name)}`,
      body,
      index: { t: b.name, s: `Brand profile — ${b.tags.join(', ')}`, u: `brands/${b.slug}.html`, k: `${b.name} ${b.tags.join(' ')} ${b.hq} brand profile auv units` }
    });
  }

  return out;
};
