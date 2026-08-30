'use strict';
const C = require('../lib/components');
const { esc } = require('../lib/util');

module.exports = function markets(ctx) {
  const { data, sources } = ctx;
  const out = [];
  const R = C.refs(sources);

  const body = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Geography</div>
  <h1>Markets</h1>
  <p class="dek">Chicken competition is local. These market profiles are built from verified activity — development agreements, bankruptcies, openings and headquarters — in each metro, not from modelled market share.</p>

  <div class="grid g2" style="margin-top:28px">
    ${data.markets.map((m) => `<a class="card" href="${m.slug}.html">
      <div class="kicker">${esc(m.state)}</div>
      <h3>${esc(m.name)}</h3>
      <p class="note">${esc(m.thesis)}</p>
      <p class="meta">${m.activity.length} tracked developments</p>
    </a>`).join('')}
  </div>

  <div class="callout" style="margin-top:30px">
    CSW does not publish estimated market share by metro. Nobody publishes reliable trade-area share for private chicken chains, and modelling it would be inventing data. What these pages carry instead is every verified move — who signed, who filed, who opened, who paid what — in each market.
  </div>
</div></section>
<div class="wrap">${R.render()}</div>`;

  out.push({
    path: 'markets/index.html', title: 'Markets', active: 'markets', depth: 1,
    canonicalPath: 'markets/',
    description: 'Chicken restaurant market profiles — Houston, DFW, New York, South Florida, Tampa, Orlando, Ohio and Atlanta.',
    body,
    index: { t: 'Markets', s: `${data.markets.length} metro chicken market profiles`, u: 'markets/', k: 'markets houston dallas new york florida ohio atlanta metro market profile' }
  });

  for (const m of data.markets) {
    const R2 = C.refs(sources);
    const mbody = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Market profile · ${esc(m.state)}</div>
  <h1>${esc(m.name)}</h1>
  <p class="dek">${esc(m.thesis)}</p>

  <div class="split" style="margin-top:32px">
    <div>
      <h2>Tracked activity</h2>
      <div class="panel"><div class="panel-body">
        <ul class="bullets" style="margin:0">
          ${m.activity.map((a) => `<li>${esc(a.text)}${R2.ref(a.src)}</li>`).join('')}
        </ul>
      </div></div>
    </div>
    <aside>
      <div class="panel"><div class="panel-head"><h3>What CSW is watching here</h3></div><div class="panel-body">
        <ul class="bullets" style="margin:0">${m.watch.map((w) => `<li class="note">${esc(w)}</li>`).join('')}</ul>
      </div></div>
      <div class="cta" style="margin-top:18px">
        <h3>Operating in ${esc(m.name.split(',')[0].split('(')[0].trim())}?</h3>
        <p class="note">Development agreements, closures, site availability and transactions — the desk publishes market intelligence with the source attached.</p>
        <a class="btn" href="../contact/">Submit market intelligence</a>
      </div>
    </aside>
  </div>
</div></section>
<div class="wrap">${R2.render()}</div>`;

    out.push({
      path: `markets/${m.slug}.html`, title: m.name, active: 'markets', depth: 1,
      canonicalPath: `markets/${m.slug}.html`,
      description: `${m.name} chicken restaurant market — tracked development, operators, closures and transactions.`,
      breadcrumb: `<a href="../index.html">Home</a> / <a href="./">Markets</a> / ${esc(m.name)}`,
      body: mbody,
      index: { t: m.name, s: 'Market profile', u: `markets/${m.slug}.html`, k: `${m.name} ${m.state} market chicken competition development` }
    });
  }

  return out;
};
