'use strict';
const { esc } = require('./util');

const PRIMARY = [
  ['news', 'News', 'news/'],
  ['brands', 'Brands', 'brands/'],
  ['operators', 'Operators', 'operators/'],
  ['real-estate', 'Real Estate', 'real-estate/'],
  ['rankings', 'Rankings', 'rankings/']
];

const SUB = [
  ['markets', 'Markets', 'markets/'],
  ['expansion', 'Expansion Tracker', 'expansion/'],
  ['movement', 'Openings & Closures', 'openings-closures/'],
  ['transactions', 'Transactions', 'transactions/'],
  ['research', 'Research', 'research/'],
  ['data', 'Data Center', 'data/'],
  ['franchise', 'Franchise Opportunities', 'franchise-opportunities/'],
  ['properties', 'Properties', 'properties/'],
  ['sandwiches', 'Best Sandwiches', 'best-chicken-sandwiches/'],
  ['newsletter', 'The Chicken Wire', 'newsletter/']
];

const FOOTER = [
  ['Intelligence', [['News & Analysis', 'news/'], ['Brand Database', 'brands/'], ['Operator Database', 'operators/'],
    ['Power Rankings', 'rankings/'], ['Markets', 'markets/'], ['Expansion Tracker', 'expansion/'],
    ['Openings & Closures', 'openings-closures/'], ['Research', 'research/'], ['Data Center', 'data/']]],
  ['Real Estate', [['Real Estate Home', 'real-estate/'], ['Properties for Sale', 'properties/'], ['Transactions', 'transactions/'],
    ['Sell a Property', 'sell/'], ['Buy a Property', 'buy/'], ['Submit a Deal', 'submit-deal/']]],
  ['Participate', [['Best Chicken Sandwiches', 'best-chicken-sandwiches/'],
    ['The Chicken Wire', 'newsletter/'], ['Franchise Opportunities', 'franchise-opportunities/'],
    ['Jobs', 'jobs/'], ['Events', 'events/']]],
  ['Company', [['About', 'about/'], ['Contact', 'contact/'], ['Advertise & Partner', 'advertise/'],
    ['Methodology', 'methodology/'], ['Search', 'search/']]]
];

function page(opts) {
  const {
    title, description, depth = 1, active = '', body,
    ticker = [], breadcrumb = null, canonicalPath = '',
    origin = 'https://chickensandwichwars.com', noindex = false
  } = opts;
  const u = (p) => (depth === 0 ? '' : '../'.repeat(depth)) + p;
  const fullTitle = title === 'home'
    ? 'Chicken Sandwich Wars — Intelligence for the U.S. chicken restaurant industry'
    : `${title} — Chicken Sandwich Wars`;

  /* The track is rendered twice; the marquee translates one full track width,
     so the duplicate is already in place when the first copy runs out. The copy
     is aria-hidden so screen readers read the figures once. */
  const tickerItems = ticker.map((t) =>
    `<span><b>${esc(t.label)}</b> <span class="${t.dir || ''}">${esc(t.value)}</span></span>`).join('');
  const tickerHtml = ticker.length
    ? `<div class="ticker-track">${tickerItems}</div><div class="ticker-track" aria-hidden="true">${tickerItems}</div>`
    : '';

  const primaryHtml = PRIMARY.map(([k, label, href]) =>
    `<a href="${u(href)}"${active === k ? ' class="on"' : ''}>${esc(label)}</a>`).join('');

  const subHtml = SUB.map(([k, label, href]) =>
    `<a href="${u(href)}"${active === k ? ' class="on"' : ''}>${esc(label)}</a>`).join('');

  /* The drawer duplicates the two navs as one flat list. Under 760px the header
     shows neither — the primary nav is hidden and the subnav is a masked
     horizontal scroller that half its links never surface from — so this is the
     only place a phone can reach the full site. Desktop never renders it: the
     base stylesheet sets .drawer{display:none} and only the mobile media query
     turns it on. */
  const drawerLink = ([k, label, href]) =>
    `<a href="${u(href)}"${active === k ? ' class="on"' : ''}>${esc(label)}</a>`;
  const drawerHtml = `<div class="drawer-group">Sections</div>${PRIMARY.map(drawerLink).join('')}` +
    `<div class="drawer-group">More from CSW</div>${SUB.map(drawerLink).join('')}`;

  const footerCols = FOOTER.map(([h, links]) => `<div><h4>${esc(h)}</h4><ul>${
    links.map(([l, href]) => `<li><a href="${u(href)}">${esc(l)}</a></li>`).join('')
  }</ul></div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || '')}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || '')}">
<meta property="og:site_name" content="Chicken Sandwich Wars">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${origin}/${canonicalPath}">
<meta property="og:url" content="${origin}/${canonicalPath}">${noindex ? '\n<meta name="robots" content="noindex,nofollow">' : ''}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='16' fill='%23F2A413'/><text y='72' x='50' font-size='62' text-anchor='middle'>🍗</text></svg>">
<link rel="stylesheet" href="${u('assets/css/site.css')}">
<!-- async, not defer: a deferred script still waits on every pending
     stylesheet, and one of ours is fetched from fonts.googleapis.com. That put
     the mobile menu, search, filters and form handling behind a third
     party's response time. site.js guards on DOM readiness itself, so async
     costs nothing here. The font link keeps its blocking behaviour, so first
     paint and the desktop rendering are unchanged. -->
<script async src="${u('assets/js/site.js')}"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body data-root="${u('')}">

<div class="topbar">
  <div class="ticker" role="marquee" aria-label="Industry figures">${tickerHtml}</div>
</div>

<header class="site">
  <div class="wrap masthead">
    <a class="logo" href="${u('index.html')}">
      <span class="mark">🍗</span>
      <span>CHICKEN<span class="b">SANDWICH</span>WARS</span>
    </a>
    <nav class="primary" id="primaryNav">${primaryHtml}</nav>
    <button class="searchbtn" id="searchOpen" aria-label="Search">⌕ <span>Search</span></button>
    <button class="menutoggle" id="menuToggle" aria-label="Open menu" aria-expanded="false" aria-controls="siteDrawer">☰</button>
  </div>
  <div class="subnav"><div class="wrap">${subHtml}</div></div>
</header>

<div class="drawer-scrim" id="drawerScrim"></div>
<aside class="drawer" id="siteDrawer" aria-label="Site menu" aria-hidden="true">
  <div class="drawer-head">
    <span class="drawer-title">Menu</span>
    <button class="drawer-close" id="drawerClose" aria-label="Close menu">✕</button>
  </div>
  <button class="drawer-search" id="drawerSearch">⌕ Search the site</button>
  <nav class="drawer-nav">${drawerHtml}</nav>
</aside>

<main>
${breadcrumb ? `<div class="wrap"><div class="breadcrumb">${breadcrumb}</div></div>` : ''}
${body}
</main>

<footer class="site">
  <div class="wrap">
    <div class="cols">
      <div>
        <div class="logo" style="margin-bottom:12px"><span class="mark">🍗</span><span>CHICKEN<span class="b">SANDWICH</span>WARS</span></div>
        <p style="max-width:34ch;color:var(--ink-2)">An independent intelligence platform tracking the brands, operators, real estate and consumer trends shaping America's chicken restaurant industry.</p>
        <p><a class="btn ghost" href="${u('newsletter/')}">Get The Chicken Wire</a></p>
      </div>
      ${footerCols}
    </div>
    <div class="fine">
      <p>Every figure published on this site carries a source and an as-of date. Where a number has not been published by a company, a regulatory filing or an industry data provider, CSW shows “—” rather than an estimate. Derived figures — arithmetic on two published numbers — are marked as derived. Corrections: <a href="${u('contact/')}">contact the desk</a>.</p>
      <p>© ${new Date().getFullYear()} Chicken Sandwich Wars. Independent and not affiliated with any restaurant brand, franchisor or franchisee referenced. Trademarks belong to their respective owners. Nothing on this site is investment advice or an offer to buy or sell securities or real estate.</p>
    </div>
  </div>
</footer>

<div class="overlay" id="searchOverlay">
  <div class="searchpanel">
    <input type="search" id="searchInput" placeholder="Search brands, operators, markets, transactions…" autocomplete="off">
    <div id="searchResults"></div>
  </div>
</div>
<!-- Vercel Web Analytics. This is what @vercel/analytics' inject() appends at
     runtime; the package's framework adapters all require a bundler, and this
     site is deliberately zero-dependency static HTML. The path is served by
     Vercel's edge only, so it 404s harmlessly on any other host. -->
<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>`;
}

module.exports = { page, PRIMARY, SUB, FOOTER };
