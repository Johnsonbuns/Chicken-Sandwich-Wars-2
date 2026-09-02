#!/usr/bin/env node
'use strict';
/**
 * The eleventh check: are the rankings honest about their own age?
 *
 * The five figures that decide the CSW Score used to be the only numbers on the site
 * with no as-of date attached, which meant a brand could hold a ranking on a comp two
 * quarters out of date and nothing — not the build, not review, not the other ten
 * checks — would say so. `lib/freshness.js` resolves those dates; this asserts that the
 * resolution still works and that the site publishes what it finds.
 *
 * What fails here is a *code* regression, not old data:
 *
 *   - a period label in data/ that the parser cannot read, because an unreadable label
 *     silently becomes "undated" and quietly drops a figure out of the freshness report;
 *   - a scoring input whose provenance stopped resolving, i.e. a mirror in freshness.js
 *     that no longer matches the stat key the exporter writes;
 *   - an overdue or undated figure that the rankings page does not disclose.
 *
 * Old data is a job for the desk, not a broken build: failing the deploy because a
 * figure aged out would take the whole site down over one number, when the site's
 * actual answer to an old number is to publish how old it is. So staleness is reported
 * and exits 0 — unless --strict (or CSW_FRESHNESS_STRICT=1) is passed, which is the
 * gate to run before a release when the desk wants no overdue figure shipped at all.
 */
const fs = require('fs');
const path = require('path');
const { parsePeriod, brandFreshness, provenance, today, STATE_LABEL } = require('../lib/freshness');
const { COMPONENTS, rankBrands } = require('../lib/score');
const { esc } = require('../lib/util');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.CSW_DATA_DIR || path.join(ROOT, 'data');
const OUT = process.env.CSW_OUT_DIR || path.join(ROOT, 'docs');
const STRICT = process.argv.includes('--strict') || process.env.CSW_FRESHNESS_STRICT === '1';

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const brands = readJSON('brands.json');
const sources = readJSON('sources.json');
const NOW = today();

const failures = [];
const fail = (check, detail) => failures.push({ check, detail });

/* ---------- 1. every published period label is readable ----------
 * A label the parser cannot read does not raise anything on its own; it just makes the
 * figure undated, which is exactly the silent failure this file exists to prevent. */
for (const b of brands) {
  for (const [key, stat] of Object.entries(b.stats || {})) {
    if (!stat || stat.asOf == null) continue;
    if (!parsePeriod(stat.asOf)) fail('unreadable period', `${b.slug}.stats.${key}.asOf = ${JSON.stringify(stat.asOf)}`);
  }
  for (const [key, meta] of Object.entries(b.metricsMeta || {})) {
    if (!meta || meta.asOf == null) continue;
    if (!parsePeriod(meta.asOf)) fail('unreadable period', `${b.slug}.metricsMeta.${key}.asOf = ${JSON.stringify(meta.asOf)}`);
  }
}
for (const [key, s] of Object.entries(sources)) {
  if (!s || s.date == null) continue;
  if (!parsePeriod(String(s.date))) fail('unreadable period', `sources.${key}.date = ${JSON.stringify(s.date)}`);
}

/* ---------- 2. provenance still resolves ----------
 * Two scoring inputs in the dataset genuinely have no published as-of date, and that is
 * a finding the site now shows rather than a bug. What must not happen is the number of
 * them growing because a mirror in freshness.js stopped matching the stat key the
 * exporter writes — so this pins the known gaps by name and fails on any new one. */
const KNOWN_UNDATED = new Set([
  // Empty since 2026-09-01: the desk published as-of dates for both entries that used to
  // be here (daves-hot-chicken:economics and kfc:demand), so the allowance went stale and
  // the check below said so. Keep the mechanism — a figure that arrives without a period
  // label belongs here by name, so that the count of undated inputs can only shrink by a
  // deliberate edit rather than drift upward when a mirror in lib/freshness.js stops
  // matching the stat key the exporter writes.
]);

const ranking = rankBrands(brands);
const report = [];
for (const s of ranking.rated) {
  const f = brandFreshness(s.brand, { today: NOW, sources });
  for (const item of f.items) {
    if (item.state === 'current') continue;
    report.push({ slug: s.brand.slug, name: s.brand.name, rank: s.rank, item });
    if (item.state !== 'unknown') continue;
    const id = `${s.brand.slug}:${item.key}`;
    if (!KNOWN_UNDATED.has(id)) {
      fail('provenance lost', `${id} (${item.label}) resolves to no as-of date — either the figure lost its source or a mirror in lib/freshness.js no longer matches the stat key`);
    }
  }
}
for (const id of KNOWN_UNDATED) {
  const [slug, key] = id.split(':');
  const b = brands.find((x) => x.slug === slug);
  const c = COMPONENTS.find((x) => x.key === key);
  if (!b || !c) continue;
  if ((b.metrics || {})[c.from] == null) continue;
  if (provenance(b, c, sources)) {
    fail('stale allowance', `${id} now resolves an as-of date — remove it from KNOWN_UNDATED in ${path.basename(__filename)}`);
  }
}

/* ---------- 3. the site says so ----------
 * The disclosure is the product. A freshness model that the rankings page does not
 * render is worth nothing, so read the built page back and confirm every flagged
 * figure is named on it. */
const rankingsFile = path.join(OUT, 'rankings', 'index.html');
if (!fs.existsSync(rankingsFile)) {
  fail('not built', 'docs/rankings/index.html is missing — run node build.js first');
} else {
  const html = fs.readFileSync(rankingsFile, 'utf8');
  const start = html.indexOf('How current are these rankings?');
  const end = html.indexOf('Unrated brands');
  if (start < 0 || end < 0 || end < start) {
    fail('no disclosure', 'the rankings page has no freshness section');
  } else {
    const section = html.slice(start, end);
    for (const r of report) {
      if (!section.includes(esc(r.name))) {
        fail('undisclosed', `${r.name} has an overdue or undated ${r.item.label} figure that the rankings page does not list`);
      }
    }
  }
}

/* ---------- 4. report ---------- */
const stale = report.filter((r) => r.item.state === 'stale');
const undated = report.filter((r) => r.item.state === 'unknown');
const aging = report.filter((r) => r.item.state === 'aging');

const line = (r) => `    ${r.name} — ${r.item.label}: ${r.item.asOf || 'no as-of date recorded'}` +
  (r.item.ageMonths == null ? '' : ` (${r.item.ageMonths} months, overdue at ${r.item.policy.stale})`);

console.log(`freshness — as of ${NOW.toISOString().slice(0, 10)}, ${ranking.rated.length} ranked brands`);
console.log(`  ${stale.length} overdue · ${undated.length} undated · ${aging.length} due for review`);
if (stale.length) { console.log('  overdue:'); stale.forEach((r) => console.log(line(r))); }
if (undated.length) { console.log('  undated:'); undated.forEach((r) => console.log(line(r))); }
if (aging.length) { console.log('  due for review:'); aging.forEach((r) => console.log(line(r))); }

if (STRICT && (stale.length || undated.length)) {
  for (const r of [...stale, ...undated]) {
    fail('strict', `${r.name} ${r.item.label} is ${STATE_LABEL[r.item.state].toLowerCase()}`);
  }
}

if (failures.length) {
  console.error(`\ncheck-freshness: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  [${f.check}] ${f.detail}`);
  process.exit(1);
}
console.log('check-freshness: ok');
