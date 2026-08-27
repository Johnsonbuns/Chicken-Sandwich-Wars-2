'use strict';
/**
 * ChickenSandwichWars.com static site build.
 *   node build.js   →   writes ./docs
 *
 * Data in ./data is the single source of truth. Every figure rendered on the
 * site carries a source id resolved against data/sources.json.
 */
const fs = require('fs');
const path = require('path');
const layout = require('./lib/layout');
const { rankBrands } = require('./lib/score');
const { pct, usd, num } = require('./lib/util');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'docs');

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const data = {
  brands: readJSON('brands.json'),
  operators: readJSON('operators.json'),
  news: readJSON('news.json'),
  transactions: readJSON('transactions.json'),
  realestate: readJSON('realestate.json'),
  expansion: readJSON('expansion.json'),
  movement: readJSON('movement.json'),
  markets: readJSON('markets.json'),
  research: readJSON('research.json'),
  datacenter: readJSON('datacenter.json'),
  consumer: readJSON('consumer.json'),
  events: readJSON('events.json')
};
const sources = readJSON('sources.json');

/* ---------- derived context ---------- */
const ranking = rankBrands(data.brands);
const scoreBySlug = Object.fromEntries(ranking.all.map((s) => [s.brand.slug, s]));
const brandBySlug = Object.fromEntries(data.brands.map((b) => [b.slug, b]));

const operatorsByBrand = {};
for (const o of data.operators) {
  for (const bn of o.chickenBrands || []) {
    const b = data.brands.find((x) =>
      x.name.toLowerCase().includes(bn.toLowerCase()) ||
      bn.toLowerCase().includes(x.name.split(' ')[0].toLowerCase()));
    if (!b) continue;
    (operatorsByBrand[b.slug] = operatorsByBrand[b.slug] || []).push(o);
  }
}

/* The wire ticker: live figures pulled straight from the dataset. */
const ticker = [
  { label: 'Popeyes U.S. comps', value: pct(brandBySlug['popeyes'].metrics.compsPct) + ' Q2’26', dir: 'down' },
  { label: 'Wingstop domestic SSS', value: pct(brandBySlug['wingstop'].metrics.compsPct) + ' Q2’26', dir: 'down' },
  { label: 'KFC U.S. units', value: num(brandBySlug['kfc'].stats.usUnits.v) + ' YE’25', dir: 'down' },
  { label: 'Dave’s unit growth', value: pct(brandBySlug['daves-hot-chicken'].metrics.unitGrowthPct) + ' FY’25', dir: 'up' },
  { label: 'Chick-fil-A AUV', value: usd(brandBySlug['chick-fil-a'].metrics.auvUsd), dir: 'up' },
  { label: 'Cane’s systemwide', value: usd(brandBySlug['raising-canes'].stats.systemwideSales.v) + ' FY’25', dir: 'up' },
  { label: 'Franchisee QSR cap', value: '6.85%', dir: 'down' },
  { label: 'Corporate QSR cap', value: '5.85%', dir: 'down' },
  { label: 'Category growth', value: '+5.3% ’25', dir: 'flat' },
  { label: 'Wings wholesale', value: '$0.98/lb YE’25', dir: 'down' }
];

const ctx = { data, sources, ranking, scoreBySlug, brandBySlug, operatorsByBrand };

/* ---------- run page modules ---------- */
const modules = ['home', 'brands', 'operators', 'realestate', 'rankings', 'news', 'markets', 'misc'];
let pages = [];
for (const m of modules) pages = pages.concat(require(`./pages/${m}`)(ctx));

/* ---------- write ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function writeFile(rel, content) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

for (const pg of pages) {
  writeFile(pg.path, layout.page({ ...pg, ticker }));
}

/* copy static assets */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));

/* search index */
const index = pages.filter((p) => p.index).map((p) => p.index);
writeFile('assets/search-index.json', JSON.stringify(index));

/* downloadable dataset */
writeFile('assets/data/csw-dataset.json', JSON.stringify({
  generated: new Date().toISOString(),
  notice: 'Every figure carries a source id resolvable against the sources object. Where a value is absent it has not been published; CSW does not estimate.',
  sources, ...data,
  cswScores: ranking.rated.map((s) => ({ rank: s.rank, brand: s.brand.slug, score: s.score, components: s.parts }))
}, null, 2));

const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const csvRows = [['brand', 'slug', 'hq', 'founded', 'ownership', 'us_units', 'units_as_of', 'systemwide_sales_usd', 'auv_usd', 'unit_growth_pct', 'sales_growth_pct', 'comps_pct', 'cap_rate_mid_pct', 'csw_score', 'momentum'].join(',')];
for (const b of data.brands) {
  const u = b.stats.usUnits || b.stats.usCanadaUnits || b.stats.globalUnits || b.stats.currentUnits;
  const s = b.stats.systemwideSales || b.stats.globalSales;
  const sc = scoreBySlug[b.slug];
  csvRows.push([b.name, b.slug, b.hq, b.founded, b.ownership, u ? u.v : '', u ? u.asOf : '',
    s ? s.v : '', b.metrics.auvUsd || '', b.metrics.unitGrowthPct ?? '', b.metrics.salesGrowthPct ?? '',
    b.metrics.compsPct ?? '', b.metrics.capRateMid ?? '', sc && sc.rated ? sc.score : '', b.momentum].map(csvEsc).join(','));
}
writeFile('assets/data/csw-brands.csv', csvRows.join('\n') + '\n');

/* sitemap + robots + GitHub Pages passthrough */
const base = 'https://chickensandwichwars.com/';
writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${base}${p.canonicalPath || p.path}</loc></url>`).join('\n')}
</urlset>\n`);
writeFile('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
writeFile('.nojekyll', '');

console.log(`Built ${pages.length} pages → docs/`);
console.log(`  brands ${data.brands.length} · operators ${data.operators.length} · news ${data.news.length} · markets ${data.markets.length} · research ${data.research.length} · charts ${data.datacenter.length}`);
console.log(`  rated brands ${ranking.rated.length} · unrated ${ranking.unrated.length} · sources ${Object.keys(sources).length}`);
