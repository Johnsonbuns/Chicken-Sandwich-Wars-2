'use strict';
/**
 * Submit research findings to the CSW review queue.
 *
 *   CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js findings.json
 *   CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js findings.json --dry-run
 *   CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js --schema
 *   CSW_AGENT_KEY=csw_ag_... node scripts/agent-submit.js --lookup brand popeyes
 *
 * For a research agent — a Claude Code session, a scheduled script — that has found
 * something and wants a human to look at it. It is a thin wrapper over POST /api/agent;
 * the contract is in db/AGENT_INTAKE.md and curl works just as well. What this adds is
 * the checking that is worth doing before a run of forty findings goes over the wire:
 * that the file is the right shape, that every target exists, that nothing is cited to
 * a source that is only a hunch, and that --dry-run can prove all of that without
 * queueing anything for a person to read.
 *
 * Nothing here can write canonical data. That is not this script's discipline, it is
 * the endpoint's: /api/agent can reach four review functions and no table at all.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };

const KEY = process.env.CSW_AGENT_KEY || opt('--key');
// The apex domain 308-redirects to www, and fetch drops the Authorization header across
// a host change — so posting to the apex arrives unauthenticated and comes back 401
// "send an agent key", which reads as a bad key rather than a wrong URL. Default to www.
const BASE = (opt('--url', process.env.CSW_SITE_URL || 'https://www.chickensandwichwars.com'))
  .replace(/\/+$/, '');
const DRY = flag('--dry-run');

const die = (msg, code = 1) => { console.error(`\n✗ ${msg}\n`); process.exit(code); };

async function post(body) {
  const r = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) die(`${r.status} — ${data.error || 'request failed'}`);
  return data;
}

(async () => {
  if (!KEY) {
    die('No agent key. Set CSW_AGENT_KEY, or pass --key. Mint one in the desk under Settings.');
  }

  if (flag('--schema')) {
    const { targets } = await post({ op: 'schema' });
    for (const t of targets) {
      console.log(`\n${t.label}  (${t.table_name})`);
      if (t.description) console.log(`  ${t.description}`);
      console.log(`  required: ${t.required_columns.join(', ') || 'none'}`);
      console.log(`  columns:  ${t.columns.map((c) => c.name).join(', ')}`);
    }
    return;
  }

  if (flag('--lookup')) {
    const i = args.indexOf('--lookup');
    const { results } = await post({ op: 'lookup', kind: args[i + 1], q: args[i + 2] || '' });
    if (!results.length) return console.log('nothing matches — it may not exist yet');
    for (const r of results) console.log(`  ${r.ref.padEnd(28)} ${r.label}${r.detail ? '  · ' + r.detail : ''}`);
    return;
  }

  const file = args.find((a) => !a.startsWith('--') && /\.json$/.test(a));
  if (!file) die('Usage: node scripts/agent-submit.js findings.json [--dry-run]');

  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (e) { die(`${file}: ${e.message}`); }

  const items = Array.isArray(doc) ? doc : doc.items;
  if (!Array.isArray(items) || !items.length) {
    die('The file needs an "items" array (or be an array of items).');
  }

  /* Local checks first, against the live target list. A run that fails here has cost
     nobody a moment's reading. */
  const { targets } = await post({ op: 'schema' });
  const byTable = new Map(targets.map((t) => [t.table_name, t]));
  const problems = [];
  items.forEach((it, i) => {
    const where = `item ${i + 1}${it.title ? ` ("${it.title}")` : ''}`;
    const t = byTable.get(it.target_table);
    if (!t) return problems.push(`${where}: unknown target "${it.target_table}"`);
    if (!it.payload || !Object.keys(it.payload).length) problems.push(`${where}: empty payload`);
    const allowed = new Set(t.columns.map((c) => c.name));
    for (const k of Object.keys(it.payload || {})) {
      if (!allowed.has(k)) problems.push(`${where}: "${k}" is not a writable column of ${t.label}`);
    }
    if (it.operation !== 'update') {
      for (const req of t.required_columns) {
        if (!(req in (it.payload || {}))) problems.push(`${where}: missing required "${req}"`);
      }
    }
    if (t.requires_source && !(it.sources || []).length) {
      problems.push(`${where}: no source — it will land in needs-verification rather than the queue`);
    }
    for (const s of it.sources || []) {
      if (!s.url && !s.source_key && !s.source_id) problems.push(`${where}: a source with no url or key`);
    }
  });

  if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
    for (const p of problems) console.error(`  · ${p}`);
    if (problems.some((p) => !/needs-verification/.test(p))) {
      die('Nothing was submitted. Fix these and run again.');
    }
    console.error('');
  }

  if (DRY) {
    console.log(`✓ ${items.length} item${items.length === 1 ? '' : 's'} check out. Nothing was submitted (--dry-run).`);
    return;
  }

  const result = await post({ op: 'submit', batch: doc.batch || { title: 'Research run' }, items });
  console.log(`\n${result.accepted} accepted, ${result.rejected} rejected · run ${result.batch_id}`);
  for (const i of result.items || []) {
    const flags = [].concat(i.errors || [], i.warnings || []);
    console.log(`  ${i.accepted ? '✓' : '✗'} ${i.title || i.id}`
      + (i.status ? `  [${i.status}]` : '')
      + (i.matches ? `  ${i.matches} possible duplicate${i.matches === 1 ? '' : 's'}` : '')
      + (flags.length ? `\n      ${flags.join('; ')}` : ''));
  }
  if (doc.batch && doc.batch.summary) {
    await post({ op: 'finish', batch_id: result.batch_id, summary: doc.batch.summary });
    console.log('\nRun closed.');
  }
  console.log('\nNothing here is published. Each item waits for a human decision at /admin/.\n');
})();
