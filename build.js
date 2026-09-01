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
const { brandFreshness, today } = require('./lib/freshness');
const { pct, usd, num } = require('./lib/util');

const ROOT = __dirname;
/* Overridable so scripts/check-sparse.js can build a doctored copy of the dataset into a
   throwaway directory. Unset — which is every real build, local and on Vercel — these are
   exactly what they always were. */
const DATA = process.env.CSW_DATA_DIR || path.join(ROOT, 'data');
const OUT = process.env.CSW_OUT_DIR || path.join(ROOT, 'docs');

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

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

/* ---------- sparse records ----------
 *
 * data/*.json is generated from the database now, and the database has no opinion about
 * which optional fields a record happens to have. A brand added through the desk with
 * nothing but a name and a slug exports as {slug, name, stats:{}, metrics:{}} — no tags,
 * no analysis — and six page modules called .join(), .map() or .split() straight on those
 * fields. The first brand anyone added through the desk failed the deploy.
 *
 * Defaulting them once here rather than guarding six call sites is what keeps the
 * seventh from being written. It cannot change the existing records: every one of them
 * already has these fields, so this only fills in what is genuinely absent. */
for (const b of data.brands) {
  b.tags = b.tags || [];
  b.pipeline = b.pipeline || [];
  b.stats = b.stats || {};
  b.metrics = b.metrics || {};
  b.realEstate = b.realEstate || {};
  b.analysis = b.analysis || '';
  b.franchiseModel = b.franchiseModel || '';
}
for (const o of data.operators) {
  o.brands = o.brands || [];
  o.chickenBrands = o.chickenBrands || [];
  o.facts = o.facts || [];
  o.analysis = o.analysis || '';
}
/* Transactions match brands by name, so an undisclosed counterparty has to be an empty
   string rather than absent: '' matches nothing, which is the right answer. Only kind,
   subject, date and source are required of a transaction, so this is a shape the desk
   produces the moment anyone records a deal without naming the brand. */
for (const t of [...(data.transactions.property || []), ...(data.transactions.corporate || [])]) {
  t.brand = t.brand || '';
  t.location = t.location || '';
  t.detail = t.detail || '';
}

/* ---------- derived context ---------- */
const ranking = rankBrands(data.brands);
const scoreBySlug = Object.fromEntries(ranking.all.map((s) => [s.brand.slug, s]));
const brandBySlug = Object.fromEntries(data.brands.map((b) => [b.slug, b]));

/* How old is the number behind each ranking?
 *
 * The five figures that decide the CSW Score live in `brand.metrics`, which — unlike
 * every rendered stat — carries no as-of date, so until now the site had no way to know
 * or say that a #4 seat was resting on a comp two quarters out of date. `NOW` is
 * resolved once for the whole build so that every page dates the same figure the same
 * way; a build that straddled midnight would otherwise disagree with itself. */
const NOW = today();
const freshnessBySlug = Object.fromEntries(
  data.brands.map((b) => [b.slug, brandFreshness(b, { today: NOW, sources })]));

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

/**
 * Canonical origin.
 *
 * VERCEL_PROJECT_PRODUCTION_URL is the project's stable production domain — the
 * custom domain once one is attached, the *.vercel.app production host before
 * that. Deliberately not VERCEL_URL, which is unique per deployment and would
 * canonicalise every page at a URL that dies with the next deploy.
 *
 * Preview builds still canonicalise at production and are marked noindex, so a
 * preview never competes with the live site in search results.
 */
const SITE_ORIGIN = (
  process.env.CSW_SITE_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  'https://chickensandwichwars.com'
).replace(/\/+$/, '');
const IS_PRODUCTION = (process.env.VERCEL_ENV || 'production') === 'production';

const ctx = { data, sources, ranking, scoreBySlug, brandBySlug, operatorsByBrand, freshnessBySlug, now: NOW };

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
  writeFile(pg.path, layout.page({ ...pg, ticker, origin: SITE_ORIGIN, noindex: !IS_PRODUCTION }));
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

/* The internal dashboard. Copied verbatim rather than run through the page pipeline:
   it is an application shell, not a page. It has no layout, no ticker, no footer and
   nothing to put in the sitemap, and it is excluded from the page checks in
   scripts/check.js for the same reason — everything a crawler can see of it is a
   sign-in box. robots.txt disallows it below, and the shell carries a noindex tag of
   its own so it stays out of search even if something links to it. */
copyDir(path.join(ROOT, 'admin'), path.join(OUT, 'admin'));

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

/* sitemap + robots + no-Jekyll marker for plain static hosts */
const base = SITE_ORIGIN + '/';
writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${base}${p.canonicalPath ?? p.path}</loc></url>`).join('\n')}
</urlset>\n`);
writeFile('robots.txt', IS_PRODUCTION
  ? `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${base}sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n');
writeFile('.nojekyll', '');

console.log(`Built ${pages.length} pages → docs/ (plus the /admin/ desk)`);
console.log(`  origin ${SITE_ORIGIN}${IS_PRODUCTION ? '' : ' (preview build — noindex)'}`);
console.log(`  brands ${data.brands.length} · operators ${data.operators.length} · news ${data.news.length} · markets ${data.markets.length} · research ${data.research.length} · charts ${data.datacenter.length}`);
console.log(`  rated brands ${ranking.rated.length} · unrated ${ranking.unrated.length} · sources ${Object.keys(sources).length}`);
