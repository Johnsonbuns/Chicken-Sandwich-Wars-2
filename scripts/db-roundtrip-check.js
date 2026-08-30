'use strict';
/**
 * The Phase 2 gate.
 *
 *   node scripts/db-roundtrip-check.js <exportedDir>
 *
 * Deep-compares an export against data/, key-order-insensitively. Any difference means
 * the model lost something on the way through Postgres, and the fix is the schema —
 * never data/. Exits non-zero on the first sign of loss.
 */
const fs = require('fs');
const path = require('path');

const ref = path.join(__dirname, '..', 'data');
const got = process.argv[2];
if (!got) { console.error('usage: db-roundtrip-check.js <exportedDir>'); process.exit(2); }

const read = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const files = fs.readdirSync(ref).filter((f) => f.endsWith('.json')).sort();

const diffs = [];
function walk(a, b, p) {
  if (diffs.length > 400) return;
  if (a === b) return;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) return void diffs.push(`${p}: type ${ta} -> ${tb}`);
  if (ta === 'array') {
    if (a.length !== b.length) diffs.push(`${p}: length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${p}[${i}]`);
    return;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { diffs.push(`${p}.${k}: added (${JSON.stringify(b[k]).slice(0, 60)})`); continue; }
      if (!(k in b)) { diffs.push(`${p}.${k}: MISSING (was ${JSON.stringify(a[k]).slice(0, 60)})`); continue; }
      walk(a[k], b[k], `${p}.${k}`);
    }
    return;
  }
  diffs.push(`${p}: ${JSON.stringify(a).slice(0, 70)} -> ${JSON.stringify(b).slice(0, 70)}`);
}

let missing = 0;
for (const f of files) {
  if (!fs.existsSync(path.join(got, f))) { console.log(`  NOT EXPORTED  ${f}`); missing++; continue; }
  const before = diffs.length;
  walk(read(ref, f), read(got, f), f.replace('.json', ''));
  const n = diffs.length - before;
  console.log(`  ${n === 0 ? 'clean ' : String(n).padStart(5) + ' '} ${f}`);
}

if (diffs.length || missing) {
  console.log(`\n${diffs.length} difference(s)${missing ? `, ${missing} file(s) not exported` : ''}:\n`);
  const shown = diffs.slice(0, 60);
  for (const d of shown) console.log('  ' + d);
  if (diffs.length > shown.length) console.log(`  … and ${diffs.length - shown.length} more`);
  process.exit(1);
}
console.log('\nRound-trip clean: the database reproduces data/ exactly.');
