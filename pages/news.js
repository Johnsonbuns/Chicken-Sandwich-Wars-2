'use strict';
const C = require('../lib/components');
const { esc } = require('../lib/util');

module.exports = function news(ctx) {
  const { data, sources, brandBySlug } = ctx;
  const R = C.refs(sources);
  const cats = [...new Set(data.news.map((n) => n.cat))];

  const items = data.news.map((n) => `<div data-tags="${esc(n.cat + ' ' + (n.brand || ''))}" data-name="${esc(n.title)}">
    ${C.newsItem(n, R, { depth: 1, brandName: n.brand && brandBySlug[n.brand] ? brandBySlug[n.brand].name : null })}
  </div>`).join('');

  const body = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Intelligence</div>
  <h1>News &amp; Analysis</h1>
  <p class="dek">CSW does not just report what happened. Every item carries the only question that matters to people who own, operate, finance or build chicken restaurants: what does this mean for the Chicken Wars?</p>

  <div class="filters" data-filter-group="[data-tags]" style="margin-top:26px">
    <button class="chip on" data-filter="all">All</button>
    ${cats.map((c) => `<button class="chip" data-filter="${esc(c)}">${esc(c)}</button>`).join('')}
    <input class="searchinput" data-filter-text placeholder="Search coverage…" style="margin-left:auto;max-width:260px">
  </div>

  <div class="split" style="margin-top:20px">
    <div>${items}</div>
    <aside>
      <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Coverage areas</h3></div><div class="panel-body">
        <p class="note" style="margin:0">Brands · Operators · Real Estate · M&amp;A · Franchising · Development · Supply Chain · Consumer</p>
      </div></div>
      <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Got a tip?</h3></div><div class="panel-body">
        <p class="note">Franchisee transactions, closures, development agreements and property trades are the hardest things in this industry to see from the outside. If you know one, the desk protects sources.</p>
        <a class="btn ghost" href="../contact/">Send a news tip</a>
      </div></div>
    </aside>
  </div>
</div></section>
<div class="wrap">${R.render()}</div>`;

  return [{
    path: 'news/index.html', title: 'News & Intelligence', active: 'news', depth: 1,
    canonicalPath: 'news/',
    description: 'Chicken restaurant industry news with CSW analysis — brands, operators, real estate, M&A, franchising, development, supply chain and consumer.',
    body,
    index: { t: 'News & Analysis', s: `${data.news.length} sourced briefs with CSW analysis`, u: 'news/', k: 'news intelligence analysis brands operators real estate m&a franchising supply chain' }
  }];
};
