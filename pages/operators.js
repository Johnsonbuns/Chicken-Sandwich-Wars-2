'use strict';
const C = require('../lib/components');
const { esc, num, usd } = require('../lib/util');

module.exports = function operators(ctx) {
  const { data, sources, brandBySlug } = ctx;
  const out = [];
  const R = C.refs(sources);

  const rows = data.operators
    .slice()
    .sort((a, b) => (b.chickenUnits || 0) - (a.chickenUnits || 0))
    .map((o) => ({
      attrs: ` data-tags="${esc([...(o.brands || []), ...(o.geography || []), o.status].join(' '))}" data-name="${esc(o.name)}"`,
      cells: [
        `<a href="${o.slug}.html"><b>${esc(o.name)}</b></a><div class="note">${esc(o.hq)}</div>`,
        (o.chickenBrands || []).map((b) => C.badge(b)).join(' ') || '<span class="note">—</span>',
        o.chickenUnits != null ? num(o.chickenUnits) : '—',
        o.totalUnits != null ? num(o.totalUnits) : '—',
        esc((o.geography || []).join(', ')),
        C.badge(o.status, /Acquir|develop/i.test(o.status) ? 'good' : /Liquidat|Divest|Distress/i.test(o.status) ? 'bad' : 'mut')
      ]
    }));

  const brandFilters = [...new Set(data.operators.flatMap((o) => o.chickenBrands || []))];
  const stateFilters = ['Texas', 'Florida', 'Ohio', 'California', 'South Carolina', 'North Carolina', 'Multi-state', 'Multi-region'];

  const indexBody = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Database</div>
  <h1>Chicken Operators</h1>
  <p class="dek">Almost anyone can compile brand statistics. The harder question — and the more valuable one — is who actually owns the restaurants. This database tracks the franchisee groups, investment platforms and family operators behind America's chicken units.</p>

  <div class="filters" data-filter-group="tbody tr" style="margin-top:26px">
    <button class="chip on" data-filter="all">All</button>
    ${brandFilters.map((b) => `<button class="chip" data-filter="${esc(b)}">${esc(b)}</button>`).join('')}
    ${stateFilters.map((s) => `<button class="chip" data-filter="${esc(s)}">${esc(s)}</button>`).join('')}
    <input class="searchinput" data-filter-text placeholder="Filter operators…" style="margin-left:auto;max-width:240px">
  </div>

  ${C.table({
    cols: ['Operator', 'Chicken brands', { label: 'Chicken units', num: true }, { label: 'Total units', num: true }, 'Geography', 'Status'],
    rows
  }).replace('<table>', '<table data-sortable>')}

  <p class="note" style="margin-top:14px">Unit counts are the most recent published figure for each operator. Where an operator's total portfolio or chicken exposure has not been publicly reported, the cell shows “—” rather than an estimate.</p>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head"><h2>Why the operator layer matters</h2></div>
  <div class="grid g3">
    <div class="card"><div class="kicker">Case study</div><h3>120 restaurants changed hands. The brand's unit count did not move.</h3><p class="note">Eyas Capital acquired BOJ of WNC, Bojangles' largest franchise group, in a six-state portfolio deal${R.ref('rd-eyas-boj')}. Nothing in brand-level data would show you that — or the 40+ Ohio units the new owner immediately committed to.</p></div>
    <div class="card"><div class="kicker">Case study</div><h3>A 136-unit operator disappeared in eleven months.</h3><p class="note">Sailormen filed Chapter 11 in January 2026 with $233.5M of fiscal 2025 revenue${R.ref('qsr-sailormen-97')}, weeks after its franchisor disclosed average restaurant profit of roughly $235,000${R.ref('cnbc-rbi-q4-2025')}. The warning was in operator economics, not brand sales.</p></div>
    <div class="card"><div class="kicker">Case study</div><h3>One operator controls a quarter of a national system.</h3><p class="note">KBP Brands runs 831 KFC restaurants${R.ref('franchising-mb50-2026')} while the brand closes 300+ U.S. locations a year${R.ref('thestreet-kfc-300')} — making it simultaneously the biggest buyer and biggest potential seller of KFC assets in America.</p></div>
  </div>

  <div class="cta" style="margin-top:26px">
    <h3>Operate chicken restaurants?</h3>
    <p class="note" style="max-width:64ch">CSW builds this database from filings, primary reporting and direct submissions from operators. Add your group, correct a unit count, or tell us about a development agreement — entries are published with the source attached.</p>
    <a class="btn" href="../contact/">Submit an operator update</a>
  </div>
</div></section>

<div class="wrap">${R.render()}</div>`;

  out.push({
    path: 'operators/index.html', title: 'Chicken Operator Database', active: 'operators', depth: 1,
    canonicalPath: 'operators/',
    description: 'Who actually owns America\'s chicken restaurants — franchisee groups, investment platforms and family operators by brand, geography and unit count.',
    body: indexBody,
    index: { t: 'Chicken Operator Database', s: `${data.operators.length} franchisee groups and platforms by brand, units and geography`, u: 'operators/', k: 'operators franchisee database who owns restaurants units geography development' }
  });

  for (const o of data.operators) {
    const R2 = C.refs(sources);
    const relatedNews = data.news.filter((n) =>
      (n.means + ' ' + n.title).toLowerCase().includes(o.name.split(' ')[0].toLowerCase()) &&
      o.name.split(' ')[0].length > 3);
    const relatedExp = data.expansion.filter((e) => e.operator === o.slug);
    const deals = data.transactions.corporate.filter((t) =>
      (t.acquirer + ' ' + t.target + ' ' + t.detail).toLowerCase().includes(o.name.split(' ')[0].toLowerCase()) &&
      o.name.split(' ')[0].length > 3);

    const body = `
<section class="section" style="padding-bottom:20px"><div class="wrap">
  <div class="eyebrow">Operator profile</div>
  <h1 style="margin-bottom:10px">${esc(o.name)}</h1>
  <div class="tags" style="margin-bottom:16px">
    ${C.badge(o.status, /Acquir|develop/i.test(o.status) ? 'good' : /Liquidat|Divest/i.test(o.status) ? 'bad' : 'mut')}
    ${(o.brands || []).map((b) => C.badge(b)).join('')}
  </div>

  ${C.statGrid([
    { value: o.chickenUnits != null ? num(o.chickenUnits) : '—', label: 'Chicken units', note: o.chickenUnitsNote ? esc(o.chickenUnitsNote) : '' },
    { value: o.totalUnits != null ? num(o.totalUnits) : '—', label: 'Total units' },
    { value: esc(o.hq), label: 'Headquarters' },
    { value: (o.geography || []).length ? esc(o.geography[0]) : '—', label: 'Primary geography', note: esc((o.geography || []).slice(1).join(', ')) }
  ])}
</div></section>

<section class="section"><div class="wrap">
  <div class="split">
    <div>
      <h2>Known activity</h2>
      <div class="panel"><div class="panel-body">
        <ul class="bullets" style="margin:0">
          ${o.facts.map((f) => `<li>${esc(f.text)}${R2.ref(f.src)} <span class="asof">(${esc(f.asOf)})</span></li>`).join('')}
        </ul>
      </div></div>

      <div class="analysis" style="margin-top:24px">
        <div class="kicker">CSW Analysis</div>
        <p style="margin:0;font-size:16.5px;color:var(--ink-2)">${esc(o.analysis)}</p>
      </div>

      ${relatedExp.length ? `<h3 style="margin-top:28px">Development pipeline</h3>
      ${C.table({ cols: ['Brand', 'Market', 'Commitment', 'Timeline'], rows: relatedExp.map((e) => [
        `<a href="../brands/${e.brand}.html">${esc(e.brandName)}</a>`, esc(e.market) + R2.ref(e.src), esc(e.unitsLabel), esc(e.timeline || '—')
      ]) })}` : ''}

      ${deals.length ? `<h3 style="margin-top:28px">Transactions</h3>
      ${C.table({ cols: ['Date', 'Type', 'Detail', { label: 'Value', num: true }], rows: deals.map((t) => [
        esc(t.date), esc(t.type), `<b>${esc(t.target)}</b><div class="note">${esc(t.detail)}${R2.ref(t.src)}</div>`, t.value ? usd(t.value) : '—'
      ]) })}` : ''}
    </div>

    <aside>
      <div class="panel">
        <div class="panel-head"><h3>Brands operated</h3></div>
        <div class="panel-body">
          ${(o.chickenBrands || []).length ? (o.chickenBrands || []).map((b) => {
            const slug = Object.values(brandBySlug).find((x) => x.name.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(x.name.split(' ')[0].toLowerCase()));
            return `<p style="margin:0 0 8px">${slug ? `<a href="../brands/${slug.slug}.html">${esc(b)}</a>` : esc(b)}</p>`;
          }).join('') : '<p class="note" style="margin:0">No chicken brands recorded.</p>'}
          ${(o.brands || []).filter((b) => !(o.chickenBrands || []).includes(b)).length ? `<hr><div class="kicker" style="margin-bottom:8px">Other brands</div>
            <div class="tags">${(o.brands || []).filter((b) => !(o.chickenBrands || []).includes(b)).map((b) => C.badge(b)).join('')}</div>` : ''}
        </div>
      </div>

      <div class="cta" style="margin-top:18px">
        <h3>Correct or expand this profile</h3>
        <p class="note">CSW publishes operator updates with the source attached. Development agreements, acquisitions and unit counts welcome.</p>
        <a class="btn" href="../contact/">Submit an update</a>
      </div>
    </aside>
  </div>
</div></section>

${relatedNews.length ? `<section class="section"><div class="wrap">
  <h2>Related coverage</h2>
  ${relatedNews.map((n) => C.newsItem(n, R2, { depth: 1 })).join('')}
</div></section>` : ''}

<div class="wrap">${R2.render()}</div>`;

    out.push({
      path: `operators/${o.slug}.html`, title: o.name, active: 'operators', depth: 1,
      canonicalPath: `operators/${o.slug}.html`,
      description: `${o.name}: brands operated, unit count, geography, development pipeline and transaction history.`,
      breadcrumb: `<a href="../index.html">Home</a> / <a href="./">Operators</a> / ${esc(o.name)}`,
      body,
      index: { t: o.name, s: `Operator — ${(o.chickenBrands || []).join(', ') || 'multi-brand'} · ${(o.geography || []).join(', ')}`, u: `operators/${o.slug}.html`, k: `${o.name} ${(o.brands || []).join(' ')} ${(o.geography || []).join(' ')} operator franchisee` }
    });
  }

  return out;
};
