'use strict';
/**
 * Does the build survive a record that has almost nothing in it?
 *
 *   node scripts/check-sparse.js
 *
 * data/*.json is generated from the database now, and the database has no opinion about
 * which optional fields a record happens to have. A brand added through the desk with a
 * name and a slug and nothing else exports as `{slug, name, stats:{}, metrics:{}}` — no
 * tags, no analysis, no franchise model — and six page modules called `.join()`, `.map()`
 * or `.split()` directly on those fields.
 *
 * That is not hypothetical. The first brand ever added through the desk failed the Vercel
 * deploy with `Cannot read properties of undefined (reading 'join')`, and the only reason
 * the site stayed up is that a failed build leaves the previous deployment serving.
 *
 * So this builds the whole site against a copy of data/ with a deliberately minimal
 * record of each kind appended, into a throwaway directory. It asserts nothing about how
 * they render — only that a page module never assumes a field the desk does not require.
 * Every new page module and every widened review target is covered by it for free.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csw-sparse-'));
const dataDir = path.join(tmp, 'data');
const outDir = path.join(tmp, 'docs');
fs.mkdirSync(dataDir, { recursive: true });

for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dataDir, f));

const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const save = (f, v) => fs.writeFileSync(path.join(dataDir, f), JSON.stringify(v, null, 2));

/* Exactly what scripts/export-data.js emits for a record whose only filled-in columns
   are the ones review_targets marks required. Kept in that shape deliberately: if the
   exporter starts emitting more, this check gets weaker and should be updated to match. */
const added = [];

const brands = load('brands.json');
brands.push({ slug: 'sparse-test-brand', name: 'Sparse Test Brand',
              stats: {}, metrics: {}, realEstate: {}, pipeline: [] });
save('brands.json', brands);
added.push('a brand with no tags, analysis, momentum or figures');

const operators = load('operators.json');
operators.push({ slug: 'sparse-test-operator', name: 'Sparse Test Operator' });
save('operators.json', operators);
added.push('an operator with no brands, facts or analysis');

const tx = load('transactions.json');
tx.property.push({ date: 'Aug 2026', type: 'Property sale', src: Object.keys(load('sources.json'))[0] });
save('transactions.json', tx);
added.push('a transaction with no price, brand or location');

const news = load('news.json');
news.push({ date: 'Aug 2026', title: 'Sparse test item',
            src: Object.keys(load('sources.json'))[0] });
save('news.json', news);
added.push('a news item with no brand, dek or analysis');

console.log(`  building against ${added.length} deliberately minimal records:`);
for (const a of added) console.log(`    · ${a}`);

try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'build.js')], {
    encoding: 'utf8',
    env: { ...process.env, CSW_DATA_DIR: dataDir, CSW_OUT_DIR: outDir }
  });
  const pages = (out.match(/Built (\d+) pages/) || [])[1];
  console.log(`\n✓ the build survives sparse records · ${pages} pages`);
} catch (e) {
  const detail = ((e.stderr || '') + (e.stdout || '')).trim().split('\n').slice(0, 12);
  console.error('\n✗ the build crashed on a record the desk is allowed to create:\n');
  for (const line of detail) console.error('  ' + line);
  console.error('\n  Fix it where the field is defaulted in build.js, not at the call site —'
    + '\n  the next page module will make the same assumption.\n');
  process.exit(1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
