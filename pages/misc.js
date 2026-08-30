'use strict';
const C = require('../lib/components');
const { esc, num, usd, pct } = require('../lib/util');

module.exports = function misc(ctx) {
  const { data, sources } = ctx;
  const out = [];

  /* ---------------- expansion tracker ---------------- */
  {
    const R = C.refs(sources);
    const rows = data.expansion.map((e) => ({
      attrs: ` data-tags="${esc(e.brandName + ' ' + e.market)}" data-name="${esc(e.brandName + ' ' + e.market)}"`,
      cells: [
        esc(e.announced),
        `<a href="../brands/${e.brand}.html"><b>${esc(e.brandName)}</b></a>`,
        e.operator && !/^[A-Z]/.test(e.operator) === false && data.operators.find((o) => o.slug === e.operator)
          ? `<a href="../operators/${e.operator}.html">${esc(data.operators.find((o) => o.slug === e.operator).name)}</a>`
          : (e.operator ? esc(e.operator) : '<span class="note">—</span>'),
        esc(e.market) + R.ref(e.src),
        `<b>${esc(e.unitsLabel)}</b>`,
        `<span class="note">${esc(e.timeline || '—')}</span>`
      ]
    }));
    const totalCommitted = data.expansion.reduce((s, e) => s + (e.units || 0), 0);
    out.push({
      path: 'expansion/index.html', title: 'Chicken Expansion Tracker', active: 'expansion', depth: 1,
      canonicalPath: 'expansion/',
      description: 'Announced chicken restaurant development agreements, pipelines and market entries by brand, operator and market.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Database</div>
  <h1>Chicken Expansion Tracker</h1>
  <p class="dek">Announced development agreements, committed pipelines and market entries — the connective tissue between brands, operators and real estate.</p>

  ${C.statGrid([
    { value: num(totalCommitted) + '+', label: 'Units under announced commitment', note: 'Sum of publicly announced pipelines and agreements tracked below' },
    { value: num(data.expansion.length), label: 'Tracked commitments' },
    { value: '1,200+', label: "Slim Chickens' committed pipeline", note: 'Against roughly 300 open restaurants' },
    { value: '~1,000', label: "Dave's Hot Chicken in development", note: '150+ openings planned in 2026' }
  ])}

  <div class="callout" style="margin-top:22px">
    Treat committed pipeline and demonstrated throughput as different numbers. Signed area development agreements convert to open restaurants at well under 100% across franchising. What is verifiable is throughput: Dave's opened eight restaurants in a single day${R.ref('ifa-daves-eight')}, Wingstop opened 102 in one quarter${R.ref('wing-q2-2026')}, and Golden Chick set a brand record with 23 openings in 2025${R.ref('qsr-golden-250')}.
  </div>

  <div class="filters" data-filter-group="tbody tr" style="margin-top:26px">
    <button class="chip on" data-filter="all">All</button>
    <input class="searchinput" data-filter-text placeholder="Filter by brand or market…" style="max-width:300px">
  </div>

  ${C.table({ cols: [{ label: 'Announced', hideSmall: true }, 'Brand', { label: 'Operator', hideSmall: true }, 'Market', 'Commitment', 'Timeline'], rows }).replace('<table>', '<table data-sortable>')}

  <div class="cta" style="margin-top:26px">
    <h3>Signed a development agreement?</h3>
    <p class="note">The expansion tracker is where brokers, developers and lenders look for who needs sites. Getting listed is free.</p>
    <a class="btn" href="../contact/">Submit a development agreement</a>
  </div>
</div></section>
<div class="wrap">${R.render()}</div>`,
      index: { t: 'Expansion Tracker', s: 'Announced development agreements and pipelines', u: 'expansion/', k: 'expansion tracker development agreements pipeline units market entry growth' }
    });
  }

  /* ---------------- openings & closures ---------------- */
  {
    const R = C.refs(sources);
    out.push({
      path: 'openings-closures/index.html', title: 'Openings & Closures', active: 'movement', depth: 1,
      canonicalPath: 'openings-closures/',
      description: 'Chicken restaurant openings and closures — physical unit movement across the U.S. chicken industry.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Unit movement</div>
  <h1>Openings &amp; Closures</h1>
  <p class="dek">Physical unit movement across the industry. The closure database is the more valuable half — closures create distressed property, conversions, landlord problems, franchisee distress and acquisition opportunities.</p>

  <div class="split" style="margin-top:32px">
    <div>
      <h2>Closures</h2>
      ${C.table({
        cols: ['Period', { label: 'Brand', id: 120 }, { label: 'Geography', hideSmall: true }, { label: 'Units', num: true }, 'Detail'],
        rows: data.movement.closures.map((m) => [
          esc(m.date), `<a href="../brands/${m.brand}.html"><b>${esc(m.brandName)}</b></a>`, esc(m.location),
          m.count ? `<b class="down">${num(m.count)}</b>` : '—', `<span class="note">${esc(m.detail)}${R.ref(m.src)}</span>`
        ])
      })}

      <h2 style="margin-top:40px">Openings</h2>
      ${C.table({
        cols: ['Date', { label: 'Brand', id: 120 }, 'Location', 'Detail'],
        rows: data.movement.openings.map((m) => [
          esc(m.date), `<a href="../brands/${m.brand}.html"><b>${esc(m.brandName)}</b></a>`, esc(m.location),
          `<span class="note">${esc(m.detail)}${R.ref(m.src)}</span>`
        ])
      })}
    </div>
    <aside>
      <div class="panel"><div class="panel-head"><h3>Why closures matter more</h3></div><div class="panel-body">
        <p class="note">A closure is not just a lost restaurant. It creates:</p>
        <ul class="bullets" style="margin:8px 0 0">
          <li class="note">A distressed or dark property</li>
          <li class="note">A conversion opportunity for a growing brand</li>
          <li class="note">A landlord with a re-tenanting problem</li>
          <li class="note">Evidence of franchisee distress before it reaches a filing</li>
          <li class="note">Below-replacement-cost basis for a buyer</li>
        </ul>
        <p style="margin:16px 0 0"><a class="btn ghost" href="../real-estate/">Real estate desk →</a></p>
      </div></div>
      <div class="cta" style="margin-top:18px">
        <h3>Spotted a closure?</h3>
        <p class="note">Dark boxes are the hardest thing in this industry to track systematically. Tips are protected.</p>
        <a class="btn" href="../contact/">Report a closure</a>
      </div>
    </aside>
  </div>
</div></section>
<div class="wrap">${R.render()}</div>`,
      index: { t: 'Openings & Closures', s: 'Physical unit movement and the second-generation inventory it creates', u: 'openings-closures/', k: 'openings closures closed restaurants dark boxes vacancy unit movement' }
    });
  }

  /* ---------------- data center ---------------- */
  {
    const R = C.refs(sources);
    out.push({
      path: 'data/index.html', title: 'CSW Data Center', active: 'data', depth: 1,
      canonicalPath: 'data/',
      description: 'Charts and historical statistics for the U.S. chicken restaurant industry — AUV, units, growth, comps, cap rates, commodities and consumption.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">CSW Data</div>
  <h1>Data Center</h1>
  <p class="dek">The industry's numbers in one place — average unit volumes, unit counts, growth rates, same-store sales, cap rates, commodity costs and consumption. Every series is sourced and every source is linked.</p>
  <p class="note" style="margin-top:14px"><a href="../assets/data/csw-dataset.json">Download the full dataset (JSON)</a> · <a href="../assets/data/csw-brands.csv">Brand table (CSV)</a> · <a href="../methodology/">Methodology</a></p>
</div></section>

<section class="section"><div class="wrap">
  ${data.datacenter.map((c) => C.chart(c, R)).join('')}
</div></section>
<div class="wrap">${R.render()}</div>`,
      index: { t: 'Data Center', s: 'Charts, historical statistics and downloadable data', u: 'data/', k: 'data center charts statistics auv units growth cap rates commodities download csv json' }
    });
  }

  /* ---------------- research ---------------- */
  {
    const R = C.refs(sources);
    out.push({
      path: 'research/index.html', title: 'CSW Research', active: 'research', depth: 1,
      canonicalPath: 'research/',
      description: 'Long-form CSW research on the chicken restaurant industry, real estate, franchisee landscape and expansion outlook.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Proprietary research</div>
  <h1>Research</h1>
  <p class="dek">Long-form CSW analysis built from the same sourced dataset that powers the rest of the site.</p>
  <div class="grid g2" style="margin-top:30px">
    ${data.research.map((r) => `<a class="card" href="${r.slug}.html">
      <div class="kicker">${esc(r.date)} · ${esc(r.readTime)}</div>
      <h3>${esc(r.title)}</h3>
      <p class="note">${esc(r.dek)}</p>
      <p class="meta" style="margin-top:10px">${r.sections.length} sections</p>
    </a>`).join('')}
  </div>
  <div class="cta" style="margin-top:30px">
    <h3>Commission or sponsor research</h3>
    <p class="note" style="max-width:64ch">CSW produces custom analysis on brands, operators, markets and real estate for franchisors, operators, lenders and investors.</p>
    <a class="btn" href="../advertise/">Talk to the desk</a>
  </div>
</div></section>`,
      index: { t: 'Research', s: `${data.research.length} long-form CSW reports`, u: 'research/', k: 'research reports state of the industry real estate franchisee landscape expansion outlook' }
    });

    for (const r of data.research) {
      const R2 = C.refs(sources);
      out.push({
        path: `research/${r.slug}.html`, title: r.title, active: 'research', depth: 1,
        canonicalPath: `research/${r.slug}.html`,
        description: r.dek,
        breadcrumb: `<a href="../index.html">Home</a> / <a href="./">Research</a> / ${esc(r.title)}`,
        body: `<section class="section"><div class="wrap">
  <div class="eyebrow">CSW Research · ${esc(r.date)} · ${esc(r.readTime)}</div>
  <h1 style="max-width:22ch">${esc(r.title)}</h1>
  <p class="dek">${esc(r.dek)}</p>
  <div class="split" style="margin-top:36px">
    <article class="prose">
      ${r.sections.map((s, i) => `<h2 id="s${i}">${esc(s.h)}</h2><p>${esc(s.p)}${R2.refAll(s.srcs)}</p>`).join('')}
    </article>
    <aside>
      <div class="panel sticky"><div class="panel-head"><h3>Contents</h3></div><div class="panel-body toc">
        ${r.sections.map((s, i) => `<a href="#s${i}">${esc(s.h)}</a>`).join('')}
      </div></div>
      <div class="cta" style="margin-top:18px">
        <h3>Get CSW research by email</h3>
        <p class="note">New reports go to Chicken Wire subscribers first.</p>
        <a class="btn" href="../newsletter/">Subscribe</a>
      </div>
    </aside>
  </div>
</div></section>
<div class="wrap">${R2.render()}</div>`,
        index: { t: r.title, s: r.dek, u: `research/${r.slug}.html`, k: `${r.title} research report ${r.dek}` }
      });
    }
  }

  /* ---------------- franchise opportunities ---------------- */
  {
    const R = C.refs(sources);
    const rows = data.brands
      .filter((b) => /franchised/.test(b.tags.join(' ')) || b.metrics.unitGrowthPct != null)
      .sort((a, b) => (b.metrics.auvUsd || 0) - (a.metrics.auvUsd || 0))
      .map((b) => [
        `<a href="../brands/${b.slug}.html"><b>${esc(b.name)}</b></a>`,
        b.metrics.auvUsd ? usd(b.metrics.auvUsd) : '<span class="note">—</span>',
        b.metrics.unitGrowthPct != null ? pct(b.metrics.unitGrowthPct) : '<span class="note">—</span>',
        b.metrics.compsPct != null ? `<span class="${b.metrics.compsPct > 0 ? 'up' : 'down'}">${pct(b.metrics.compsPct)}</span>` : '<span class="note">—</span>',
        `<span class="note">${esc(b.franchiseModel.slice(0, 90))}${b.franchiseModel.length > 90 ? '…' : ''}</span>`
      ]);
    out.push({
      path: 'franchise-opportunities/index.html', title: 'Franchise Opportunities', active: 'franchise', depth: 1,
      canonicalPath: 'franchise-opportunities/',
      description: 'Compare chicken franchise concepts on AUV, unit growth, same-store sales and franchise structure.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">For prospective operators</div>
  <h1>Franchise Opportunities</h1>
  <p class="dek">Every chicken franchisor will show you their best number. This table shows the same four numbers for all of them — average unit volume, unit growth, same-store sales and franchise structure — sourced and dated.</p>

  ${C.table({ cols: ['Brand', { label: 'AUV', num: true }, { label: 'Unit growth', num: true }, { label: 'Comps', num: true }, { label: 'Franchise structure', hideSmall: true }], rows })
    .replace('<table>', '<table data-sortable>')}

  <div class="callout" style="margin-top:24px">
    Read AUV and comps together. Wingstop grew units 19.2% in fiscal 2025${R.ref('wing-fy25')} while domestic same-store sales fell 7.5% in Q2 2026 and AUV slipped from $2.1M to $2.0M${R.ref('wing-q2-2026')}. A brand can be excellent at selling franchises and still be a difficult year for the franchisee who bought one.
  </div>

  <div class="grid g3" style="margin-top:30px">
    <div class="card"><div class="kicker">Question to ask</div><h3>What does a new unit actually cost to build?</h3><p class="note">Huey Magoo's cut drive-thru build costs by roughly 40%${R.ref('rd-huey')}. Build cost against AUV determines whether a franchisee clears a return — it is the number franchisors discuss least.</p></div>
    <div class="card"><div class="kicker">Question to ask</div><h3>What is franchisee-level profit?</h3><p class="note">RBI disclosed average Popeyes franchisee restaurant profit of roughly $235,000 in 2025${R.ref('cnbc-rbi-q4-2025')}. Weeks later a 136-unit operator filed Chapter 11${R.ref('rbo-sailormen-bk')}.</p></div>
    <div class="card"><div class="kicker">Question to ask</div><h3>Who else is developing in my market?</h3><p class="note">Check the <a href="../expansion/">expansion tracker</a> and <a href="../operators/">operator database</a> before signing. Several brands are committing to the same metros simultaneously.</p></div>
  </div>
</div></section>
<div class="wrap">${R.render()}</div>`,
      index: { t: 'Franchise Opportunities', s: 'Compare chicken franchise concepts on real numbers', u: 'franchise-opportunities/', k: 'franchise opportunities compare concepts auv unit growth invest franchisee' }
    });
  }

  /* ---------------- best chicken sandwiches ---------------- */
  {
    const R = C.refs(sources);
    const cons = data.consumer;
    out.push({
      path: 'best-chicken-sandwiches/index.html', title: 'America\'s Best Chicken Sandwiches', active: 'sandwiches', depth: 1,
      canonicalPath: 'best-chicken-sandwiches/',
      description: 'What published rankings actually say about America\'s best chicken sandwiches — and how consumer preference differs from financial performance.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Consumer</div>
  <h1>America's Best Chicken Sandwiches</h1>
  <p class="dek">CSW does not run its own taste test and then present it as a national ranking. What follows is what published rankings actually say — with the methodology behind each one, so you can decide what it is worth.</p>

  <div class="grid g3" style="margin-top:30px">
    ${cons.publishedRankings.map((r) => `<div class="card">
      <div class="kicker">${esc(r.publisher)}</div>
      <h3>${esc(r.title)}${R.ref(r.src)}</h3>
      <ol style="padding-left:20px;color:var(--ink-2);font-size:14.5px">${r.items.map((i) => `<li style="margin-bottom:5px">${esc(i)}</li>`).join('')}</ol>
      <p class="note" style="margin-top:10px"><b>Method:</b> ${esc(r.method)}</p>
    </div>`).join('')}
  </div>

  <div class="callout" style="margin-top:30px">
    Notice the gap. Chick-fil-A leads the category on every financial measure CSW tracks — a $9.16M average unit volume and $23.9B in systemwide sales — yet ranks third among fried chicken chains on YouGov consumer popularity${R.ref('stacker-yougov')}, and does not top the 2026 sandwich rankings at all. Consumer affection and category dominance are different things, and the brands that confuse them tend to over-invest in the wrong one.
  </div>

  <h2 style="margin-top:40px">Category context</h2>
  <div class="panel"><div class="panel-body">
    <ul class="bullets" style="margin:0">${cons.context.map((c) => `<li>${esc(c.text)}${R.ref(c.src)}</li>`).join('')}</ul>
  </div></div>

</div></section>
<div class="wrap">${R.render()}</div>`,
      index: { t: "America's Best Chicken Sandwiches", s: 'What published rankings actually say', u: 'best-chicken-sandwiches/', k: 'best chicken sandwich ranking reviews taste test consumer popular' }
    });
  }

  /* ---------------- newsletter ---------------- */
  out.push({
    path: 'newsletter/index.html', title: 'The Chicken Wire', active: 'newsletter', depth: 1,
    canonicalPath: 'newsletter/',
    description: 'The Chicken Wire — the five things shaping the chicken restaurant industry this week.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Newsletter</div>
  <h1>The Chicken Wire</h1>
  <p class="dek" style="max-width:52ch">The five things shaping the chicken restaurant industry this week — brands, operators, real estate, and what each one means for the Chicken Wars.</p>
  <div class="split" style="margin-top:30px">
    ${C.form({
      id: 'newsletter', title: 'Subscribe',
      intro: 'One email a week. No sponsored content dressed as coverage.',
      submit: 'Subscribe',
      fields: [
        { type: 'row', fields: [{ label: 'First name', name: 'first_name' }, { label: 'Last name', name: 'last_name' }] },
        { label: 'Email', name: 'email', type: 'email', required: true },
        { type: 'row', fields: [{ label: 'Company', name: 'company' }, { label: 'Role', name: 'role', type: 'select', options: ['Franchisee / operator', 'Franchisor', 'Broker', 'Developer', 'Lender', 'Investor / PE', 'Supplier / vendor', 'Press', 'Other'] }] }
      ]
    })}
    <aside>
      <div class="panel"><div class="panel-head"><h3>What's in it</h3></div><div class="panel-body">
        <ul class="bullets" style="margin:0">
          <li class="note">The week's brand and operator moves, with analysis</li>
          <li class="note">New development agreements and market entries</li>
          <li class="note">Closed property comps and cap rate movement</li>
          <li class="note">Closures and distress worth watching</li>
          <li class="note">CSW research before it is published on the site</li>
        </ul>
      </div></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'The Chicken Wire', s: 'Weekly newsletter — five things shaping the industry', u: 'newsletter/', k: 'newsletter chicken wire subscribe email weekly' }
  });

  /* ---------------- about ---------------- */
  out.push({
    path: 'about/index.html', title: 'About', active: '', depth: 1,
    canonicalPath: 'about/',
    description: 'Chicken Sandwich Wars is an independent intelligence platform tracking the U.S. chicken restaurant industry.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">About</div>
  <h1 style="max-width:20ch">An intelligence platform, not a food blog</h1>
  <div class="split" style="margin-top:30px">
    <div class="prose">
      <p class="lede">Chicken Sandwich Wars is an independent intelligence platform tracking the brands, operators, real estate and consumer trends shaping America's chicken restaurant industry.</p>
      <h2>Why it exists</h2>
      <p>Chicken is the most consumed animal protein in the United States and the fastest-growing major restaurant category — and the information about it is scattered across earnings releases, franchise disclosure documents, bankruptcy dockets, net-lease brokerage reports and trade press. Nobody has assembled it in one place with a consistent standard for what counts as a fact.</p>
      <h2>What CSW covers</h2>
      <p>Four databases and the analysis connecting them: <a href="../brands/">brands</a> (units, volumes, growth, structure), <a href="../operators/">operators</a> (who actually owns the restaurants), <a href="../real-estate/">real estate</a> (cap rates, leases, comps and second-generation inventory), and <a href="../rankings/">rankings</a> (a computed answer to who is winning). Around them sit the <a href="../news/">news desk</a>, the <a href="../expansion/">expansion tracker</a>, <a href="../openings-closures/">openings and closures</a>, <a href="../transactions/">transactions</a>, <a href="../markets/">markets</a>, <a href="../research/">research</a> and the <a href="../data/">data center</a>.</p>
      <h2>The standard</h2>
      <p>Every figure published on this site carries a source and an as-of date. Where a number has not been published by a company, a filing or an industry data provider, CSW shows a dash rather than an estimate. Figures derived arithmetically from two published numbers are marked as derived. Franchisee-reported figures are labelled as such. The <a href="../methodology/">methodology page</a> sets out the scoring formula in full, including its known limitations.</p>
      <h2>Independence</h2>
      <p>CSW is not affiliated with any restaurant brand, franchisor or franchisee. Where the people behind CSW have a commercial interest — brokerage, or investment through Chicken Capital Partners — that is disclosed rather than hidden. Coverage is not for sale, and sponsorship never buys a ranking, a score or a favourable analysis.</p>
    </div>
    <aside>
      <div class="panel"><div class="panel-head"><h3>Get in touch</h3></div><div class="panel-body">
        <p class="note">News tips, operator updates, corrections, real estate opportunities, partnerships and advertising all route through one desk.</p>
        <a class="btn" href="../contact/">Contact CSW</a>
      </div></div>
      <div class="cta" style="margin-top:18px"><h3>The Chicken Wire</h3><p class="note">The five things shaping the industry each week.</p><a class="btn" href="../newsletter/">Subscribe</a></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'About', s: 'Independent intelligence for the chicken restaurant industry', u: 'about/', k: 'about mission independent intelligence platform standard' }
  });

  /* ---------------- contact ---------------- */
  out.push({
    path: 'contact/index.html', title: 'Contact', active: '', depth: 1,
    canonicalPath: 'contact/',
    description: 'Contact the Chicken Sandwich Wars desk — news tips, operator updates, real estate, partnerships and corrections.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Contact</div>
  <h1>Contact the desk</h1>
  <p class="dek">Tips, corrections, operator updates and opportunities. Sources are protected.</p>
  <div class="split" style="margin-top:30px">
    ${C.form({
      id: 'contact', title: 'Send a message',
      submit: 'Send to the desk',
      fields: [
        { label: 'What is this about?', name: 'topic', type: 'select', required: true, options: [
          'News tip', 'Operator update', 'Brand data correction', 'Real estate opportunity',
          'Transaction / comp submission', 'Development agreement', 'Partnership', 'Advertising', 'Correction', 'General inquiry'] },
        { type: 'row', fields: [{ label: 'Your name', name: 'name', required: true }, { label: 'Email', name: 'email', type: 'email', required: true }] },
        { type: 'row', fields: [{ label: 'Company', name: 'company' }, { label: 'Role', name: 'role' }] },
        { label: 'Message', name: 'message', type: 'textarea', required: true },
        { label: 'Source link (if applicable)', name: 'source', placeholder: 'CSW publishes updates with the source attached where possible' }
      ]
    })}
    <aside>
      <div class="panel"><div class="panel-head"><h3>Corrections policy</h3></div><div class="panel-body">
        <p class="note" style="margin:0">If a figure on this site is wrong or out of date, tell us and it gets fixed with the source attached. CSW would rather publish a dash than a number it cannot stand behind — and would rather correct one quickly than defend it.</p>
      </div></div>
      <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Confidentiality</h3></div><div class="panel-body">
        <p class="note" style="margin:0">Franchisee transactions, closures and property trades are the hardest things in this industry to see from outside. If you share one in confidence, it stays confidential.</p>
      </div></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'Contact', s: 'News tips, corrections, operator updates and opportunities', u: 'contact/', k: 'contact tip correction submit update partnership advertising' }
  });

  /* ---------------- advertise ---------------- */
  out.push({
    path: 'advertise/index.html', title: 'Advertise & Partner', active: '', depth: 1,
    canonicalPath: 'advertise/',
    description: 'Reach the operators, franchisors, brokers, lenders and investors in the U.S. chicken restaurant industry.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Partnerships</div>
  <h1>Advertise &amp; Partner</h1>
  <p class="dek">CSW's audience is the operating and capital side of the chicken industry — franchisees, franchisors, brokers, developers, lenders, private equity and suppliers.</p>
  <div class="grid g3" style="margin-top:30px">
    <div class="card"><h3>Newsletter sponsorship</h3><p class="note">A single sponsor slot in The Chicken Wire, clearly marked as a sponsor.</p></div>
    <div class="card"><h3>Research sponsorship</h3><p class="note">Underwrite a CSW report. Sponsors do not review findings before publication.</p></div>
    <div class="card"><h3>Franchise development</h3><p class="note">Reach prospective multi-unit operators on the franchise opportunities and expansion pages.</p></div>
    <div class="card"><h3>Vendor &amp; supplier placement</h3><p class="note">Equipment, construction, technology and services for chicken operators.</p></div>
    <div class="card"><h3>Industry jobs</h3><p class="note">Development, real estate and operations roles in front of the people who fill them.</p></div>
    <div class="card"><h3>Data access</h3><p class="note">Programmatic and bulk access to the CSW brand, operator and transaction datasets.</p></div>
  </div>
  <div class="callout" style="margin-top:26px">
    One rule, stated up front: sponsorship never buys a ranking, a CSW Score, an analysis or the removal of an unfavourable fact. Sponsored content is labelled as sponsored. The value of this audience depends entirely on that being true.
  </div>
  <p style="margin-top:24px"><a class="btn" href="../contact/">Talk to the desk</a></p>
</div></section>`,
    index: { t: 'Advertise & Partner', s: 'Newsletter, research, vendor and data partnerships', u: 'advertise/', k: 'advertise partner sponsorship newsletter research vendor jobs data access' }
  });

  /* ---------------- jobs ---------------- */
  out.push({
    path: 'jobs/index.html', title: 'Chicken Industry Jobs', active: '', depth: 1,
    canonicalPath: 'jobs/',
    description: 'Franchisor, franchisee, development, real estate and operations roles across the chicken restaurant industry.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Careers</div>
  <h1>Chicken Industry Jobs</h1>
  <p class="dek">Franchisor roles, franchisee positions, development executives, real estate and operations — in one place.</p>
  <div style="margin-top:28px">
    ${C.emptyState('No open roles posted yet',
      'CSW does not scrape or invent listings. The board opens with the first role posted by a franchisor, operator or service provider — posting is free while the board is being built.',
      '../contact/', 'Post a role')}
  </div>
  <div class="grid g4" style="margin-top:30px">
    <div class="card tight"><div class="kicker">Hiring context</div><p class="note" style="margin:0">KFC is relocating its U.S. corporate headquarters to Plano, TX — roughly 100 corporate roles moving over six months and 90 remote roles over 18.</p></div>
    <div class="card tight"><div class="kicker">Hiring context</div><p class="note" style="margin:0">Popeyes is expanding its field leadership team by roughly 75% as part of its turnaround.</p></div>
    <div class="card tight"><div class="kicker">Hiring context</div><p class="note" style="margin:0">Slim Chickens hired a former Starbucks site-strategy executive as Chief Development Officer.</p></div>
    <div class="card tight"><div class="kicker">Hiring context</div><p class="note" style="margin:0">Dave's Hot Chicken is opening 150+ restaurants in 2026 with roughly 1,000 in development.</p></div>
  </div>
</div></section>`,
    index: { t: 'Chicken Industry Jobs', s: 'Franchisor, operator, development and real estate roles', u: 'jobs/', k: 'jobs careers hiring franchisor operator development real estate operations' }
  });

  /* ---------------- events ---------------- */
  {
    const R = C.refs(sources);
    out.push({
      path: 'events/index.html', title: 'Industry Events', active: '', depth: 1,
      canonicalPath: 'events/',
      description: 'Restaurant and franchising industry events relevant to chicken operators, franchisors and investors.',
      body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Calendar</div>
  <h1>Industry Events</h1>
  <p class="dek">Where chicken operators, franchisors, brokers and capital actually meet. CSW lists only events with dates published by the organiser.</p>
  ${C.table({
    cols: ['Event', 'Date', { label: 'Location', hideSmall: true }, 'Why it matters'],
    rows: data.events.map((e) => [
      `<b>${esc(e.name)}</b>${R.ref(e.src)}`, esc(e.date), esc(e.location), `<span class="note">${esc(e.why)}</span>`
    ])
  })}
  <p class="note" style="margin-top:14px">Where an organiser has not yet published dates for the next edition, CSW says so rather than guessing. Running an event chicken operators should know about? <a href="../contact/">Tell the desk</a>.</p>
</div></section>
<div class="wrap">${R.render()}</div>`,
      index: { t: 'Industry Events', s: 'Conferences and events for chicken operators and capital', u: 'events/', k: 'events conferences ifa rfdc restaurant finance franchising calendar' }
    });
  }

  /* ---------------- search ---------------- */
  out.push({
    path: 'search/index.html', title: 'Search', active: '', depth: 1,
    canonicalPath: 'search/',
    description: 'Search brands, operators, markets, transactions and research across Chicken Sandwich Wars.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Search</div>
  <h1>Search CSW</h1>
  <p class="dek">Brands, operators, markets, research and every page on the site. Press <span class="mono">/</span> anywhere to open quick search.</p>
  <input id="pageSearchInput" class="searchinput" style="max-width:520px;margin:26px 0 22px" placeholder="Search brands, operators, markets, transactions…" autocomplete="off">
  <div id="pageSearchResults"></div>
</div></section>`,
    index: { t: 'Search', s: 'Search the CSW database', u: 'search/', k: 'search find brands operators markets' }
  });

  return out;
};
