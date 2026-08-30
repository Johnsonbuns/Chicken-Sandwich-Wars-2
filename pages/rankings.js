'use strict';
const C = require('../lib/components');
const { esc, pct, usd, num } = require('../lib/util');
const { COMPONENTS } = require('../lib/score');

module.exports = function rankings(ctx) {
  const { data, sources, ranking } = ctx;
  const out = [];
  const R = C.refs(sources);

  const cards = ranking.rated.map((s) => {
    const b = s.brand;
    return `<div class="panel" style="margin-bottom:18px">
      <div class="panel-head">
        <h3 style="font-family:var(--display);font-size:20px">#${s.rank} ${esc(b.name)}</h3>
        ${C.momentumBadge(b.momentum)}
        <span style="margin-left:auto;font-family:var(--display);font-size:30px;font-weight:800">${s.score}</span>
      </div>
      <div class="panel-body">
        <div class="split" style="gap:24px">
          <div>${C.scoreBars(s.parts)}
            <p class="note" style="margin:14px 0 0">${s.coverage} of 5 components published${s.penalty ? ` · ${s.penalty}-point net-closure adjustment applied` : ''} · <a href="../brands/${b.slug}.html">Full brand profile →</a></p>
          </div>
          <div><p class="note" style="margin:0">${esc(b.analysis.split('. ').slice(0, 2).join('. ') + '.')}</p></div>
        </div>
      </div>
    </div>`;
  }).join('');

  const body = `
<section class="section"><div class="wrap">
  <div class="eyebrow">The signature product</div>
  <h1>Chicken Power Rankings</h1>
  <p class="dek">The CSW Score answers the question the whole category is built on — who is winning? — using only published figures. Every component comes from a company disclosure, a regulatory filing or an industry data provider. Nothing here is a vibe.</p>

  <div class="callout" style="margin-top:24px">
    These rankings will not match the ones people expect, and that is the point. Wingstop, the category's development champion, sits mid-table because domestic same-store sales fell 7.5% in Q2 2026${R.ref('wing-q2-2026')}. KFC ranks ahead of Popeyes despite closing more than 300 U.S. restaurants${R.ref('thestreet-kfc-300')}, because its comps have turned positive${R.ref('cnbc-kfc-menu')} while Popeyes has posted six consecutive negative quarters${R.ref('rd-bk-popeyes-q2')}.
  </div>

  ${C.table({
    cols: ['#', 'Brand', { label: 'CSW Score', num: true }, { label: 'Demand', num: true, hideSmall: true }, { label: 'Economics', num: true, hideSmall: true }, { label: 'Expansion', num: true, hideSmall: true }, { label: 'Real estate', num: true, hideSmall: true }, { label: 'Momentum', num: true, hideSmall: true }],
    rows: ranking.rated.map((s) => {
      const by = Object.fromEntries(s.parts.map((p) => [p.key, p.value]));
      const cell = (k) => (by[k] == null ? '<span class="note">—</span>' : by[k]);
      return [
        `<span class="rank">${s.rank}</span>`,
        `<a href="../brands/${s.brand.slug}.html"><b>${esc(s.brand.name)}</b></a>`,
        `<b>${s.score}</b>`, cell('demand'), cell('economics'), cell('expansion'), cell('realestate'), cell('momentum')
      ];
    })
  }).replace('<table>', '<table data-sortable>')}
  <p class="note" style="margin-top:12px">A dash means the component has not been published for that brand. Weights are renormalised over available components, so a brand is never penalised for a disclosure it does not control — but it is also never credited for a number nobody has published.</p>
</div></section>

<section class="section"><div class="wrap">
  <h2>Brand by brand</h2>
  ${cards}
</div></section>

<section class="section"><div class="wrap">
  <h2>Unrated brands</h2>
  <p class="note" style="max-width:74ch">These ${ranking.unrated.length} brands are tracked in the database but not scored: fewer than three of the five components have been published. CSW does not fill those gaps with estimates. Several of them — Layne's, Golden Chick, Huey Magoo's, Houston TX Hot Chicken — are among the fastest-growing concepts in the country, which is precisely why the disclosure gap is worth closing.</p>
  <div class="grid g3" style="margin-top:18px">
    ${ranking.unrated.map((s) => `<a class="card" href="../brands/${s.brand.slug}.html">
      <h3>${esc(s.brand.name)}</h3>
      <p class="note" style="margin:0">${s.parts.length} of 5 components published — ${s.parts.length ? s.parts.map((p) => esc(p.label)).join(', ') : 'none'}.</p>
    </a>`).join('')}
  </div>
</div></section>

<div class="wrap">${R.render()}</div>`;

  out.push({
    path: 'rankings/index.html', title: 'Chicken Power Rankings', active: 'rankings', depth: 1,
    canonicalPath: 'rankings/',
    description: 'The CSW Score — a computed ranking of U.S. chicken brands built only from published unit growth, sales growth, comps, AUV and cap rates.',
    body,
    index: { t: 'Chicken Power Rankings', s: 'The CSW Score — who is winning the Chicken Sandwich Wars', u: 'rankings/', k: 'rankings power rankings csw score who is winning best chicken brand' }
  });

  /* ---------------- methodology ---------------- */
  const R2 = C.refs(sources);
  const methodBody = `
<section class="section"><div class="wrap">
  <div class="eyebrow">How CSW works</div>
  <h1>Methodology</h1>
  <p class="dek">CSW publishes numbers other people can check. This page explains exactly how the CSW Score is calculated, what counts as a source, and what CSW does when a figure does not exist.</p>

  <h2 style="margin-top:40px">The CSW Score</h2>
  <p class="note" style="max-width:74ch">Each component is scaled linearly between a published floor and ceiling and clamped to 0–100. The weighted average is taken across whichever components are available for that brand, with weights renormalised. A brand with fewer than three available components is not scored.</p>

  ${C.table({
    cols: ['Component', { label: 'Weight', num: true }, 'Input', 'Scale'],
    rows: COMPONENTS.map((c) => [
      `<b>${esc(c.label)}</b><div class="note">${esc(c.desc)}</div>`,
      `${c.weight}%`,
      `<span class="mono">${esc(c.from)}</span>`,
      `<span class="note">${c.from === 'auvUsd' ? `${usd(c.floor)} → ${c.floorScore} · ${usd(c.ceil)} → ${c.ceilScore}`
        : c.from === 'capRateMid' ? `${c.floor}% → ${c.floorScore} · ${c.ceil}% → ${c.ceilScore} (lower cap rate scores higher)`
        : `${c.floor}% → ${c.floorScore} · ${c.ceil}% → ${c.ceilScore}`}</span>`
    ])
  })}

  <p class="note" style="margin-top:16px">One uniform adjustment is applied after the weighted average: a system in net unit decline carries a four-point penalty. It is applied identically to every brand that qualifies, with no discretion.</p>

  <h2 style="margin-top:40px">What counts as a source</h2>
  <ul class="bullets" style="max-width:74ch">
    <li>Company disclosures — earnings releases, franchise disclosure documents, brand press releases.</li>
    <li>Regulatory filings — SEC 10-K, 10-Q and 8-K documents.</li>
    <li>Industry data providers — Technomic, Circana, Placer.ai, The Boulder Group, USDA.</li>
    <li>Established trade press reporting a figure attributable to one of the above.</li>
  </ul>

  <h2 style="margin-top:36px">What CSW does when a number does not exist</h2>
  <p class="note" style="max-width:74ch">It shows “—”. It does not interpolate, model, or borrow a peer's figure. Where a number is calculated from two published figures — a growth rate derived from a start-of-year and end-of-year unit count, for example — it is marked as derived. Where a figure is reported by franchisees rather than disclosed by the franchisor, it is labelled franchisee-reported.</p>

  <h2 style="margin-top:36px">Known limitations</h2>
  <ul class="bullets" style="max-width:74ch">
    <li>Brands report on different fiscal calendars and to different definitions. Unit counts on the brand index are the latest published figure for each brand and are not all as of the same date; every one carries its own as-of period.</li>
    <li>Popeyes is reported by its parent on a combined U.S. and Canada basis. KFC's global figures include markets where the brand is growing while the U.S. shrinks.</li>
    <li>Where a brand has no independently published cap rate series, CSW uses the applicable corporate or franchisee QSR benchmark. That component therefore does not discriminate between franchisee-credit brands.</li>
    <li>AUV definitions vary — freestanding comp store, blended including licensed units, company-operated only. Each figure states which.</li>
  </ul>

  <h2 style="margin-top:36px">Corrections</h2>
  <p class="note" style="max-width:74ch">If a figure here is wrong or out of date, <a href="../contact/">tell the desk</a>. Corrections are published with the source attached.</p>
</div></section>
<div class="wrap">${R2.render()}</div>`;

  out.push({
    path: 'methodology/index.html', title: 'Methodology', active: '', depth: 1,
    canonicalPath: 'methodology/',
    description: 'How the CSW Score is calculated, what counts as a source, and what CSW does when a figure does not exist.',
    body: methodBody,
    index: { t: 'Methodology', s: 'How the CSW Score is calculated and sourced', u: 'methodology/', k: 'methodology csw score sources weights transparency corrections' }
  });

  return out;
};
