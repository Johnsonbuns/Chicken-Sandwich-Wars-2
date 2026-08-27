'use strict';
const C = require('../lib/components');
const { esc, usd, num } = require('../lib/util');

module.exports = function realestate(ctx) {
  const { data, sources } = ctx;
  const out = [];
  const re = data.realestate;

  /* ---------------- real estate home ---------------- */
  const R = C.refs(sources);
  const body = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Chicken + commercial real estate</div>
  <h1>Real Estate</h1>
  <p class="dek">Cap rates, lease structures, verified transactions and the second-generation inventory that brand closures and franchisee distress are putting back on the market.</p>

  <div class="stats" style="margin-top:28px">
    ${re.benchmarks.map((b) => `<div class="stat">
      <div class="v">${esc(b.value)}${R.ref(b.src)}</div>
      <div class="l">${esc(b.label)}</div>
      <div class="n">${esc(b.asOf)}${b.change ? ' · ' + esc(b.change) : ''}</div>
    </div>`).join('')}
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="split">
    <div>
      <h2>Cap rates by brand</h2>
      ${C.table({
        cols: ['Brand', 'Cap rate', 'Structure'],
        rows: re.brandCapRates.map((b) => [
          b.slug ? `<a href="../brands/${b.slug}.html"><b>${esc(b.brand)}</b></a>` : `<b>${esc(b.brand)}</b>`,
          `<b>${esc(b.range)}</b>${R.ref(b.src)}`,
          `<span class="note">${esc(b.structure)}</span>`
        ])
      })}
      <p class="note" style="margin-top:12px">Where a brand has no independently published cap rate series, CSW shows the applicable corporate or franchisee QSR benchmark rather than inventing a brand-specific number. The difference between those two benchmarks — 100 basis points in Q2 2026 — is the market's price on operator credit.</p>

      <h2 style="margin-top:36px">Lease intelligence</h2>
      <div class="panel"><div class="panel-body">
        ${re.leaseIntel.map((l) => `<p style="margin-bottom:14px"><b>${esc(l.label)}.</b> <span class="note">${esc(l.text)}${R.ref(l.src)}</span></p>`).join('')}
      </div></div>

      <h2 style="margin-top:36px">Recent comparable sales</h2>
      ${C.table({
        cols: ['Date', 'Brand', 'Location', { label: 'Price', num: true }, { label: 'Cap', num: true }],
        rows: data.transactions.property.map((t) => [
          esc(t.date), esc(t.brand), esc(t.location) + R.ref(t.src), usd(t.price), t.capRate ? t.capRate.toFixed(2) + '%' : '—'
        ])
      })}
      <p style="margin-top:12px"><a class="btn ghost" href="../transactions/">Full transaction database →</a></p>
    </div>

    <aside>
      <div class="panel">
        <div class="panel-head"><h3>Closures &amp; vacancy supply</h3></div>
        <div class="panel-body">
          <p class="note" style="margin-bottom:12px">Second-generation chicken inventory currently being created:</p>
          ${re.supply.map((s) => `<p style="margin:0 0 12px"><b>${esc(s.label)}</b><br><span class="note">${esc(s.text)}${R.ref(s.src)}</span></p>`).join('')}
          <a class="btn ghost" href="../openings-closures/">Openings &amp; closures →</a>
        </div>
      </div>

      <div class="panel" style="margin-top:18px">
        <div class="panel-head"><h3>Market conditions</h3></div>
        <div class="panel-body">
          ${re.marketConditions.map((m) => `<p class="note" style="margin:0 0 12px">${esc(m.text)}${R.ref(m.src)}</p>`).join('')}
        </div>
      </div>

      <div class="cta" style="margin-top:18px">
        <h3>Bring CSW a deal</h3>
        <p class="note">Stabilized property, sale-leaseback, development site, vacant restaurant, franchise portfolio or land.</p>
        <a class="btn" href="../submit-deal/">Submit an opportunity</a>
      </div>
    </aside>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="grid g4">
    <a class="card" href="../properties/"><div class="kicker">Marketplace</div><h3>Properties for sale</h3><p class="note">Chicken restaurant investment properties listed with CSW.</p></a>
    <a class="card" href="../sell/"><div class="kicker">Owners</div><h3>Sell a property</h3><p class="note">Request a confidential valuation on a chicken restaurant asset.</p></a>
    <a class="card" href="../buy/"><div class="kicker">Investors</div><h3>Buy a property</h3><p class="note">Register a buying criteria — brands, geography, cap rate, 1031 timing.</p></a>
    <a class="card" href="../investment/"><div class="kicker">Capital</div><h3>Chicken Capital Partners</h3><p class="note">Investing across the real estate lifecycle of the chicken ecosystem.</p></a>
  </div>
</div></section>

<div class="wrap">${R.render()}</div>`;

  out.push({
    path: 'real-estate/index.html', title: 'Chicken Restaurant Real Estate', active: 'real-estate', depth: 1,
    canonicalPath: 'real-estate/',
    description: 'Cap rates, lease structures, comparable sales and second-generation inventory across the U.S. chicken restaurant sector.',
    body,
    index: { t: 'Real Estate', s: 'Cap rates, lease intelligence, comps and closure inventory', u: 'real-estate/', k: 'real estate cap rates net lease nnn ground lease comps closures vacancy chicken property' }
  });

  /* ---------------- transactions ---------------- */
  const R2 = C.refs(sources);
  const txBody = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Database</div>
  <h1>Transactions</h1>
  <p class="dek">One record of what is actually trading in chicken: property sales, franchise portfolio deals, brand acquisitions and bankruptcy sales — with prices where they have been published.</p>

  <h2 style="margin-top:34px">Real estate</h2>
  ${C.table({
    cols: ['Date', 'Type', 'Brand', 'Location', { label: 'Price', num: true }, { label: 'Cap', num: true }, 'Terms'],
    rows: data.transactions.property.map((t) => [
      esc(t.date), esc(t.type), `<b>${esc(t.brand)}</b>`, esc(t.location) + R2.ref(t.src),
      usd(t.price), t.capRate ? t.capRate.toFixed(2) + '%' : '—',
      `<span class="note">${esc(t.term || '—')}${t.detail ? ' — ' + esc(t.detail) : ''}</span>`
    ])
  }).replace('<table>', '<table data-sortable>')}

  <h2 style="margin-top:40px">Corporate, franchise portfolio and M&amp;A</h2>
  ${C.table({
    cols: ['Date', 'Type', 'Target', 'Acquirer', { label: 'Value', num: true }],
    rows: data.transactions.corporate.map((t) => [
      esc(t.date), esc(t.type), `<b>${esc(t.target)}</b><div class="note">${esc(t.detail)}${R2.ref(t.src)}</div>`,
      esc(t.acquirer), t.value ? usd(t.value) : '<span class="note">Not disclosed</span>'
    ])
  }).replace('<table>', '<table data-sortable>')}

  <div class="callout" style="margin-top:30px">
    The Sailormen auction is the most instructive dataset in this table. Ninety-seven Popeyes restaurants cleared at five different per-restaurant prices in a single proceeding — roughly $600,000 per store in Miami against roughly $54,000 per store across Tampa, Tallahassee, Pensacola and Jacksonville${R2.ref('qsr-sailormen-97')}. That spread is a live map of where the brand's trade areas still work.
  </div>

  <div class="cta" style="margin-top:26px">
    <h3>Know of a transaction we're missing?</h3>
    <p class="note">CSW publishes verified transactions with the source attached. Closed comps, franchise transfers and portfolio deals welcome — confidentiality respected.</p>
    <a class="btn" href="../contact/">Submit a transaction</a>
  </div>
</div></section>
<div class="wrap">${R2.render()}</div>`;

  out.push({
    path: 'transactions/index.html', title: 'Chicken Transactions', active: 'transactions', depth: 1,
    canonicalPath: 'transactions/',
    description: 'Chicken restaurant property sales, franchise portfolio deals, brand acquisitions and bankruptcy sales with published pricing.',
    body: txBody,
    index: { t: 'Transactions', s: 'Property comps, franchise portfolio deals, M&A and bankruptcy sales', u: 'transactions/', k: 'transactions comps sales m&a acquisitions bankruptcy cap rate price' }
  });

  /* ---------------- properties marketplace ---------------- */
  const R3 = C.refs(sources);
  const propBody = `
<section class="section"><div class="wrap">
  <div class="eyebrow">Marketplace</div>
  <h1>Chicken Real Estate Marketplace</h1>
  <p class="dek">Chicken restaurant investment properties listed with CSW — net-leased assets, second-generation boxes, development sites and land.</p>

  <div style="margin-top:30px">
    ${C.emptyState(
      'No active listings yet',
      'CSW does not publish placeholder listings. The marketplace goes live with the first property brought to the desk — until then, the <a href="../transactions/">transaction database</a> carries verified comparable sales and the <a href="../real-estate/">real estate desk</a> carries current cap rate benchmarks.',
      '../sell/', 'List a property'
    )}
  </div>

  <div class="grid g3" style="margin-top:30px">
    <div class="card"><div class="kicker">What trades here</div><h3>Net-leased chicken assets</h3><p class="note">Corporate and franchisee-guaranteed QSR product. Current benchmarks: 5.85% corporate, 6.85% franchisee${R3.ref('boulder-q2-2026')}.</p></div>
    <div class="card"><div class="kicker">What trades here</div><h3>Second-generation boxes</h3><p class="note">Former KFC, Popeyes and casual-dining pads. More than 300 KFC restaurants closed in twelve months${R3.ref('thestreet-kfc-300')}, and roughly 33 Popeyes leases were rejected in one bankruptcy${R3.ref('qsr-sailormen-97')}.</p></div>
    <div class="card"><div class="kicker">What trades here</div><h3>Development sites</h3><p class="note">Pads for brands with committed pipelines — Dave's has roughly 1,000 units in development${R3.ref('ifa-daves-eight')} and Slim Chickens more than 1,200${R3.ref('qsr-slim-2026')}.</p></div>
  </div>

  <div class="split" style="margin-top:36px">
    <div class="cta"><h3>Want to sell a chicken restaurant property?</h3><p class="note">Request a confidential valuation. CSW tracks brand-level cap rates, lease structures and closed comps across the category.</p><a class="btn" href="../sell/">Submit a property</a></div>
    <div class="cta"><h3>Looking to buy?</h3><p class="note">Register your criteria — brands, price range, geography, cap rate and 1031 timing — and see matching assets first.</p><a class="btn" href="../buy/">Register buying criteria</a></div>
  </div>
</div></section>
<div class="wrap">${R3.render()}</div>`;

  out.push({
    path: 'properties/index.html', title: 'Chicken Real Estate Marketplace', active: 'properties', depth: 1,
    canonicalPath: 'properties/',
    description: 'Chicken restaurant investment properties, second-generation boxes and development sites listed with CSW.',
    body: propBody,
    index: { t: 'Properties for Sale', s: 'Chicken real estate marketplace', u: 'properties/', k: 'properties for sale marketplace listings net lease investment property' }
  });

  /* ---------------- sell ---------------- */
  out.push({
    path: 'sell/index.html', title: 'Sell a Property', active: 'properties', depth: 1,
    canonicalPath: 'sell/',
    description: 'Request a confidential valuation on a chicken restaurant property.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Property owners</div>
  <h1>Sell a Property</h1>
  <p class="dek">Tell us about the asset and CSW will come back with a confidential valuation built from brand-level cap rates, lease structure and closed comparable sales — not a guess.</p>
  <div class="split" style="margin-top:30px">
    ${C.form({
      id: 'sell-property', title: 'Request a confidential valuation',
      intro: 'Nothing submitted here is published. CSW does not list a property without the owner\'s written authorization.',
      submit: 'Request a confidential valuation',
      fields: [
        { type: 'row', fields: [{ label: 'Brand / tenant', name: 'brand', required: true, placeholder: 'e.g. Popeyes' }, { label: 'Property address', name: 'address', required: true }] },
        { type: 'row', fields: [{ label: 'Lease expiration', name: 'lease_expiration', placeholder: 'e.g. 03/2034' }, { label: 'Annual rent', name: 'annual_rent', placeholder: 'e.g. $135,000' }] },
        { type: 'row', fields: [{ label: 'Tenant / operator entity', name: 'operator', placeholder: 'Franchisee entity or corporate' }, { label: 'Guarantee', name: 'guarantee', type: 'select', options: ['Corporate', 'Franchisee', 'Personal', 'Unsecured / none', 'Not sure'] }] },
        { type: 'row', fields: [{ label: 'Rent escalations', name: 'escalations', placeholder: 'e.g. 10% every 5 years' }, { label: 'Asking price (if any)', name: 'asking_price' }] },
        { label: 'Anything else we should know', name: 'notes', type: 'textarea', placeholder: 'Sales performance, remodel history, drive-thru configuration, parcel size, co-tenancy…' },
        { type: 'row', fields: [{ label: 'Your name', name: 'name', required: true }, { label: 'Email', name: 'email', type: 'email', required: true }] },
        { type: 'row', fields: [{ label: 'Company', name: 'company' }, { label: 'Phone', name: 'phone', type: 'tel' }] }
      ]
    })}
    <aside>
      <div class="panel"><div class="panel-head"><h3>What CSW will look at</h3></div><div class="panel-body">
        <ul class="bullets" style="margin:0">
          <li class="note">Brand-level cap rate range and where your credit sits within it</li>
          <li class="note">Corporate vs. franchisee guarantee — currently a 100 basis point spread</li>
          <li class="note">Remaining term, escalation structure and option ladder</li>
          <li class="note">Operator health, including any known distress in the franchise system</li>
          <li class="note">Recent closed comparables in the brand and the region</li>
          <li class="note">Second-generation value of the box if the tenant goes dark</li>
        </ul>
      </div></div>
      <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Also useful</h3></div><div class="panel-body">
        <p class="note" style="margin:0"><a href="../real-estate/">Current cap rate benchmarks</a> · <a href="../transactions/">Closed comparable sales</a> · <a href="../brands/">Brand database</a></p>
      </div></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'Sell a Property', s: 'Request a confidential valuation on a chicken restaurant asset', u: 'sell/', k: 'sell property valuation owner listing broker' }
  });

  /* ---------------- buy ---------------- */
  out.push({
    path: 'buy/index.html', title: 'Buy a Property', active: 'properties', depth: 1,
    canonicalPath: 'buy/',
    description: 'Register your chicken restaurant real estate buying criteria with CSW.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Investors</div>
  <h1>Buy a Property</h1>
  <p class="dek">Register what you are looking for and see matching chicken restaurant assets before they are broadly marketed.</p>
  <div class="split" style="margin-top:30px">
    ${C.form({
      id: 'buy-property', title: 'Register buying criteria',
      intro: 'Used to match you against incoming listings and off-market opportunities. Not published, not shared with third parties.',
      submit: 'Register criteria',
      fields: [
        { label: 'Desired brands', name: 'brands', placeholder: 'e.g. Chick-fil-A, Raising Cane\'s, Dave\'s Hot Chicken' },
        { type: 'row', fields: [{ label: 'Price range', name: 'price_range', placeholder: 'e.g. $1.5M – $4M' }, { label: 'Target cap rate', name: 'cap_rate', placeholder: 'e.g. 5.5%+' }] },
        { type: 'row', fields: [{ label: 'Geography', name: 'geography', placeholder: 'e.g. Texas, Southeast, national' }, { label: 'Guarantee required', name: 'guarantee', type: 'select', options: ['Corporate only', 'Corporate or franchisee', 'Franchisee acceptable', 'Any'] }] },
        { type: 'row', fields: [{ label: '1031 deadline (if any)', name: 'deadline_1031', type: 'date' }, { label: 'Capital structure', name: 'capital', type: 'select', options: ['All cash', 'Cash + debt', 'Debt-dependent', 'Fund / institutional', 'Not sure yet'] }] },
        { label: 'Also interested in', name: 'interests', type: 'select', options: ['Stabilized net lease only', 'Stabilized + value-add', 'Vacant / second-generation', 'Development and build-to-suit', 'Everything'] },
        { type: 'row', fields: [{ label: 'Your name', name: 'name', required: true }, { label: 'Email', name: 'email', type: 'email', required: true }] },
        { type: 'row', fields: [{ label: 'Company', name: 'company' }, { label: 'Phone', name: 'phone', type: 'tel' }] }
      ]
    })}
    <aside>
      <div class="panel"><div class="panel-head"><h3>Where the market is</h3></div><div class="panel-body">
        ${re.benchmarks.slice(0, 4).map((b) => `<p style="margin:0 0 10px"><b>${esc(b.value)}</b> <span class="note">${esc(b.label)} (${esc(b.asOf)})</span></p>`).join('')}
        <p class="note" style="margin:12px 0 0">Single-tenant supply rose 12.5% quarter over quarter in Q2 2026, with retail listings up 16.2% — the most buyer-friendly inventory conditions in several quarters.</p>
        <p style="margin:14px 0 0"><a class="btn ghost" href="../real-estate/">Real estate desk →</a></p>
      </div></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'Buy a Property', s: 'Register chicken real estate buying criteria', u: 'buy/', k: 'buy property investor 1031 cap rate criteria acquisition' }
  });

  /* ---------------- submit a deal ---------------- */
  out.push({
    path: 'submit-deal/index.html', title: 'Submit an Opportunity', active: 'properties', depth: 1,
    canonicalPath: 'submit-deal/',
    description: 'Bring a chicken restaurant real estate or operating opportunity to CSW.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Deal origination</div>
  <h1>Submit an Opportunity</h1>
  <p class="dek">CSW reviews opportunities across the chicken restaurant ecosystem — real estate and operating businesses alike.</p>
  <div class="split" style="margin-top:30px">
    ${C.form({
      id: 'submit-deal', title: 'Tell us about the opportunity',
      intro: 'Reviewed confidentially. If it is not a fit, we will say so quickly rather than sit on it.',
      submit: 'Submit opportunity',
      fields: [
        { label: 'Opportunity type', name: 'type', type: 'select', required: true, options: [
          'Stabilized net-leased property', 'Sale-leaseback', 'Development / build-to-suit', 'Vacant restaurant',
          'Distressed property', 'Franchise portfolio', 'Conversion opportunity', 'Land', 'Recapitalization', 'Other'] },
        { type: 'row', fields: [{ label: 'Brand(s)', name: 'brands' }, { label: 'Market / location', name: 'market', required: true }] },
        { type: 'row', fields: [{ label: 'Units involved', name: 'units', placeholder: 'e.g. 1 property, or 14-unit portfolio' }, { label: 'Indicative pricing', name: 'pricing' }] },
        { label: 'Description', name: 'description', type: 'textarea', required: true, placeholder: 'Situation, timing, why it is available, what the seller needs…' },
        { type: 'row', fields: [{ label: 'Your name', name: 'name', required: true }, { label: 'Email', name: 'email', type: 'email', required: true }] },
        { type: 'row', fields: [{ label: 'Company / role', name: 'company' }, { label: 'Phone', name: 'phone', type: 'tel' }] }
      ]
    })}
    <aside>
      <div class="panel"><div class="panel-head"><h3>What we review</h3></div><div class="panel-body">
        <ul class="bullets" style="margin:0">
          <li class="note">Stabilized chicken restaurant properties</li>
          <li class="note">Sale-leasebacks with operators</li>
          <li class="note">Development and build-to-suit</li>
          <li class="note">Vacant and second-generation restaurants</li>
          <li class="note">Distressed properties and lease rejections</li>
          <li class="note">Franchise portfolios and operating businesses</li>
          <li class="note">Conversions, land and recapitalizations</li>
        </ul>
        <p style="margin:16px 0 0"><a class="btn ghost" href="../investment/">About Chicken Capital Partners →</a></p>
      </div></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'Submit an Opportunity', s: 'Bring a chicken real estate or operating deal to CSW', u: 'submit-deal/', k: 'submit deal opportunity sale leaseback development distressed portfolio' }
  });

  /* ---------------- investment ---------------- */
  out.push({
    path: 'investment/index.html', title: 'Investment', active: 'investment', depth: 1,
    canonicalPath: 'investment/',
    description: 'Chicken Capital Partners invests across the real estate lifecycle of the U.S. chicken restaurant ecosystem.',
    body: `<section class="section"><div class="wrap">
  <div class="eyebrow">Chicken Capital Partners</div>
  <h1>Investment</h1>
  <p class="dek" style="max-width:60ch">Chicken Capital Partners invests across the real estate lifecycle of the U.S. chicken restaurant ecosystem.</p>

  <div class="grid g3" style="margin-top:36px">
    <div class="card"><div class="kicker">Income</div><h3>Stabilized</h3><p class="note">Net-leased chicken restaurant real estate with durable operators and structured escalations.</p></div>
    <div class="card"><div class="kicker">Value creation</div><h3>Mispriced &amp; troubled</h3><p class="note">Vacant, distressed, short-term and mispriced assets — including second-generation boxes created by brand rationalization and franchisee distress.</p></div>
    <div class="card"><div class="kicker">Growth capital</div><h3>Development &amp; operators</h3><p class="note">Sale-leasebacks, build-to-suit, development, land and expansion capital for operators with committed pipelines.</p></div>
  </div>

  <div class="split" style="margin-top:40px">
    <div>
      <h2>Why this sector, now</h2>
      <p class="note">Three conditions are true at the same time, and rarely are. Chicken demand is at a record — U.S. per-capita availability is projected at 102.8 pounds in 2026, the most consumed animal protein in the country. Category sales growth has slowed to 5.3%, which means share is being taken rather than created, and losers are being created alongside winners. And the losing side is producing real estate: more than 300 KFC closures in twelve months, roughly 33 rejected Popeyes leases out of a single bankruptcy, and a wave of casual-dining pads from the Hooters restructuring.</p>
      <p class="note">That combination — durable end demand, brand-level churn, and physical inventory hitting the market through distress rather than through a marketed process — is what makes the sector investable at this point in the cycle.</p>
      <p style="margin-top:20px"><a class="btn" href="../submit-deal/">Submit an opportunity</a></p>
    </div>
    <aside>
      <div class="panel"><div class="panel-head"><h3>Disclosure</h3></div><div class="panel-body">
        <p class="note" style="margin:0">Nothing on this page is an offer to sell or a solicitation of an offer to buy any security, nor is it investment advice. Chicken Sandwich Wars publishes industry intelligence; any investment activity is conducted separately and subject to its own documentation.</p>
      </div></div>
    </aside>
  </div>
</div></section>`,
    index: { t: 'Investment — Chicken Capital Partners', s: 'Income, value creation, development and operator capital', u: 'investment/', k: 'investment chicken capital partners sale leaseback development distressed income' }
  });

  return out;
};
