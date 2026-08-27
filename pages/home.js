'use strict';
const C = require('../lib/components');
const { esc, usd, num, pct, fmtStat } = require('../lib/util');

module.exports = function home(ctx) {
  const { data, sources, ranking, brandBySlug } = ctx;
  const R = C.refs(sources);

  const top = ranking.rated.slice(0, 6);
  const rankRows = top.map((s) => [
    `<span class="rank">${s.rank}</span>`,
    `<a href="brands/${s.brand.slug}.html">${esc(s.brand.name)}</a>`,
    C.momentumBadge(s.brand.momentum),
    `<b>${s.score}</b>`
  ]);

  const growth = data.brands
    .filter((b) => b.metrics.unitGrowthPct != null)
    .sort((a, b) => b.metrics.unitGrowthPct - a.metrics.unitGrowthPct);
  const fastest = growth.slice(0, 5);
  const shrinking = growth.slice(-3).reverse();

  const news = data.news.slice(0, 8).map((n) => C.newsItem(n, R, {
    depth: 0, brandName: n.brand && brandBySlug[n.brand] ? brandBySlug[n.brand].name : null
  })).join('');

  const deals = data.transactions.property.slice(0, 4).map((t) => `<tr>
    <td class="name">${esc(t.brand)}${R.ref(t.src)}<div class="note">${esc(t.location)}</div></td>
    <td class="num">${usd(t.price)}</td>
    <td class="num">${t.capRate ? t.capRate.toFixed(2) + '%' : '—'}</td>
  </tr>`).join('');

  const expansion = data.expansion.slice(0, 6).map((e) => `<tr>
    <td class="name"><a href="brands/${e.brand}.html">${esc(e.brandName)}</a>${R.ref(e.src)}</td>
    <td>${esc(e.market)}</td>
    <td class="num">${esc(e.unitsLabel)}</td>
  </tr>`).join('');

  const body = `
<section class="hero"><div class="wrap">
  <div class="eyebrow">Independent industry intelligence</div>
  <h1>Who is winning the Chicken Sandwich Wars?</h1>
  <p class="dek">Chicken Sandwich Wars tracks the brands, operators, real estate and consumer trends shaping America's chicken restaurant industry — with every figure sourced, dated and attributed.</p>
  <div class="hero-stats">
    <div class="cell"><div class="v">+5.3%${R.ref('rbo-chicken-slows')}</div><div class="l">Chicken chain sales growth, 2025 — down from 9.1% in 2024</div></div>
    <div class="cell"><div class="v">102.8 lbs${R.ref('usda-ers-percapita')}</div><div class="l">Projected 2026 U.S. per-capita chicken availability — a record</div></div>
    <div class="cell"><div class="v">100 bps${R.ref('boulder-q2-2026')}</div><div class="l">Corporate vs. franchisee QSR cap rate spread, Q2 2026</div></div>
    <div class="cell"><div class="v">${data.brands.length} / ${data.operators.length}</div><div class="l">Brands and operators currently in the CSW database</div></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <h2>Chicken Power Rankings</h2>
    <span class="kicker">CSW Score — computed, not curated</span>
    <a class="more" href="rankings/">Full rankings and methodology →</a>
  </div>
  <div class="split">
    <div>
      ${C.table({ cols: ['#', 'Brand', 'Read', { label: 'CSW Score', num: true }], rows: rankRows })}
      <p class="note" style="margin-top:12px">Scores are calculated from published unit growth, systemwide sales growth, same-store sales, average unit volume and net-lease cap rates. Brands with fewer than three available components are left unrated rather than guessed at — ${ranking.unrated.length} brands currently sit in that bucket, which is itself a finding.</p>
    </div>
    <aside>
      <div class="panel">
        <div class="panel-head"><h3>Fastest growing by units</h3></div>
        <div class="panel-body">
          ${fastest.map((b) => `<div class="bar" style="grid-template-columns:1fr 60px;margin-bottom:8px">
            <div class="lbl"><a href="brands/${b.slug}.html">${esc(b.name)}</a></div>
            <div class="val up">${pct(b.metrics.unitGrowthPct)}</div></div>`).join('')}
        </div>
      </div>
      <div class="panel" style="margin-top:18px">
        <div class="panel-head"><h3>Losing ground</h3></div>
        <div class="panel-body">
          ${shrinking.map((b) => `<div class="bar" style="grid-template-columns:1fr 60px;margin-bottom:8px">
            <div class="lbl"><a href="brands/${b.slug}.html">${esc(b.name)}</a></div>
            <div class="val ${b.metrics.unitGrowthPct < 0 ? 'down' : 'flat'}">${pct(b.metrics.unitGrowthPct)}</div></div>`).join('')}
        </div>
      </div>
    </aside>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="split">
    <div>
      <div class="section-head"><h2>Latest intelligence</h2><a class="more" href="news/">All news →</a></div>
      ${news}
    </div>
    <aside>
      <div class="panel">
        <div class="panel-head"><h3>Recent property comps</h3><a class="more" style="margin-left:auto;font-size:12px" href="transactions/">All →</a></div>
        <table><tbody>${deals}</tbody></table>
      </div>

      <div class="panel" style="margin-top:18px">
        <div class="panel-head"><h3>Expansion tracker</h3><a class="more" style="margin-left:auto;font-size:12px" href="expansion/">All →</a></div>
        <table><tbody>${expansion}</tbody></table>
      </div>

      <div class="cta" style="margin-top:18px">
        <h3>The Chicken Wire</h3>
        <p class="note">The five things shaping the chicken restaurant industry this week — brands, operators, real estate.</p>
        <a class="btn" href="newsletter/">Subscribe</a>
      </div>

      <div class="panel" style="margin-top:18px">
        <div class="panel-head"><h3>Distress watch</h3></div>
        <div class="panel-body">
          <p class="note" style="margin:0 0 10px"><b>KFC</b> — 312 U.S. closures in twelve months${R.ref('thestreet-kfc-300')}</p>
          <p class="note" style="margin:0 0 10px"><b>Popeyes</b> — Sailormen Chapter 11; 97 restaurants sold for $16.55M, ~33 closed${R.ref('qsr-sailormen-97')}</p>
          <p class="note" style="margin:0 0 10px"><b>Hooters</b> — ~30 restaurants closed in a single day during restructuring${R.ref('rd-hooters')}</p>
          <p class="note" style="margin:0"><b>Jollibee</b> — 200+ group closures in H1 2026; opening target cut${R.ref('thestreet-jollibee')}</p>
          <p style="margin:14px 0 0"><a class="btn ghost" href="openings-closures/">Openings &amp; closures →</a></p>
        </div>
      </div>
    </aside>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head"><h2>Four databases, one industry</h2></div>
  <div class="grid g4">
    <a class="card" href="brands/"><div class="kicker">Brands</div><h3>${data.brands.length} chicken concepts</h3><p class="note">Units, systemwide sales, AUV, franchise structure, real estate profile and development pipeline — brand by brand.</p></a>
    <a class="card" href="operators/"><div class="kicker">Operators</div><h3>${data.operators.length} operator profiles</h3><p class="note">Who actually owns the restaurants: unit counts, geography, development agreements, acquisitions and distress.</p></a>
    <a class="card" href="real-estate/"><div class="kicker">Real Estate</div><h3>Cap rates &amp; comps</h3><p class="note">Brand-level cap rates, lease structures, verified transactions and the second-generation inventory closures are creating.</p></a>
    <a class="card" href="data/"><div class="kicker">Data Center</div><h3>${data.datacenter.length} chart series</h3><p class="note">AUV, unit counts, unit growth, comps, cap rates, commodity costs and per-capita consumption — all sourced.</p></a>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head"><h2>CSW Research</h2><a class="more" href="research/">All reports →</a></div>
  <div class="grid g4">
    ${data.research.map((r) => `<a class="card" href="research/${r.slug}.html">
      <div class="kicker">${esc(r.date)} · ${esc(r.readTime)}</div>
      <h3>${esc(r.title)}</h3>
      <p class="note">${esc(r.dek)}</p></a>`).join('')}
  </div>
</div></section>

<div class="wrap">${R.render()}</div>
`;

  return [{
    path: 'index.html', title: 'home', depth: 0, active: '', canonicalPath: '',
    description: 'Chicken Sandwich Wars tracks the brands, operators, real estate and consumer trends shaping America\'s chicken restaurant industry.',
    body,
    index: { t: 'Home — Chicken Sandwich Wars', s: 'Power rankings, latest intelligence and the four CSW databases', u: 'index.html', k: 'home chicken sandwich wars rankings news' }
  }];
};
