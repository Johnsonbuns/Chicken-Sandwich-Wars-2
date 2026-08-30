'use strict';
/**
 * Mobile layout check. Run after `node build.js`:
 *
 *   npm run check:mobile          # 393px, an iPhone 15
 *   npm run check:mobile -- 320   # or any width
 *
 * Two assertions, both of which this codebase has failed before:
 *
 *   1. No page scrolls horizontally. Every one of the 77 pages did — a 304px
 *      wordmark that could not shrink made the masthead 440px wide against a
 *      393px viewport, which pushed the menu button off-screen entirely. The
 *      symptom on a phone was a stray strip beside the page that looked like a
 *      broken sidebar. Nothing in the static checks can see this: the markup is
 *      valid and the CSS parses. It only exists once a viewport has a width.
 *
 *   2. A table that scrolls says so. Mobile browsers hide scrollbars, so 36 of
 *      52 tables silently cut their content off with no indication there was
 *      more. Any .tablewrap wider than its box has to carry a visible hint.
 *
 * Deliberately not folded into scripts/check.js: those checks read the built
 * HTML and run anywhere, and `npm test` chains this after them. This one needs
 * a browser, so it skips with a notice rather than failing when there isn't
 * one — Vercel's build box has no Chromium and does not need to run it.
 *
 * No dependencies, in keeping with the rest of the build: it drives Chromium
 * over the DevTools protocol using Node's own fetch and WebSocket. Node 22 or
 * newer is needed for the latter; on anything older it skips.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const WIDTH = Number(process.argv[2] || 393);
const HEIGHT = 852;

const skip = (why) => { console.log(`↷ mobile check skipped — ${why}`); process.exit(0); };

if (typeof WebSocket === 'undefined') skip('this Node has no global WebSocket (needs Node 22+)');
if (!fs.existsSync(OUT)) { console.error('docs/ does not exist — run `node build.js` first.'); process.exit(1); }

/* Chromium lives at a versioned path in this project's container; honour
   CHROME_PATH first so any other machine can point at its own. */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) skip('no Chromium found (set CHROME_PATH to run it)');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'assets') walk(p, acc); }
    else if (e.name.endsWith('.html')) acc.push(path.relative(OUT, p));
  }
  return acc;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8'
};

/* Measured inside the page. Reports the document's own overflow — the reliable
   signal, since a position:fixed element that sits outside the viewport does
   not make the document scrollable — plus any table whose box hides content
   without showing a hint for it. */
const PROBE = `(function () {
  var d = document.documentElement;
  var tables = [];
  document.querySelectorAll('.tablewrap').forEach(function (w) {
    var hidden = Math.round(w.scrollWidth - w.clientWidth);
    if (hidden <= 4) return;
    var sc = w.closest('.tablescroll');
    var hint = sc && sc.querySelector('.tablehint');
    var shown = hint && getComputedStyle(hint).display !== 'none';
    var fade = sc && sc.querySelector('.tablefade');
    var fading = fade && getComputedStyle(fade).display !== 'none';
    if (!shown && !fading) tables.push(hidden);
  });
  return JSON.stringify({ over: d.scrollWidth - d.clientWidth, mute: tables });
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pages = walk(OUT).sort();
  const server = http.createServer((req, res) => {
    let file = path.join(OUT, decodeURIComponent(req.url.split('?')[0]));
    if (file.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const port = 9200 + Math.floor(Math.random() * 600);
  const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + port, '--window-size=1200,1000', 'about:blank'], { stdio: 'ignore' });
  const done = (code) => { chrome.kill(); server.close(); process.exit(code); };

  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  if (!targets || !targets.length) { chrome.kill(); server.close(); skip('Chromium did not start'); }

  const target = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });

  await send('Page.enable');
  await send('Network.enable', {});
  /* Both 404 off Vercel and neither affects layout; blocking them keeps the
     run from waiting on the network for 77 pages. */
  await send('Network.setBlockedURLs', { urls: ['*_vercel*', '*fonts.googleapis.com*', '*fonts.gstatic.com*'] });

  /* Headless clamps --window-size at around 500px, well above any phone, so the
     viewport has to be set through the browser window itself. */
  const { windowId } = await send('Browser.getWindowForTarget', { targetId: target.id });
  await send('Browser.setWindowBounds', { windowId, bounds: { width: WIDTH, height: HEIGHT } });

  const failures = [];
  for (const page of pages) {
    await send('Page.navigate', { url: base + page });
    await sleep(220);
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    let v;
    try { v = JSON.parse(r.result.value); } catch (e) { failures.push({ check: 'probe failed', detail: page }); continue; }
    if (v.over > 1) failures.push({ check: 'horizontal overflow', detail: `${page} — document is ${v.over}px wider than the ${WIDTH}px viewport` });
    for (const hidden of v.mute) failures.push({ check: 'table scrolls with no hint', detail: `${page} — a table hides ${hidden}px with nothing shown to say so` });
  }

  if (failures.length) {
    const byCheck = {};
    for (const f of failures) (byCheck[f.check] = byCheck[f.check] || []).push(f.detail);
    console.error(`\n✗ ${failures.length} mobile problem${failures.length === 1 ? '' : 's'} at ${WIDTH}px:\n`);
    for (const [check, details] of Object.entries(byCheck)) {
      console.error(`  ${check} (${details.length})`);
      for (const d of details.slice(0, 10)) console.error(`    ${d}`);
      if (details.length > 10) console.error(`    …and ${details.length - 10} more`);
    }
    console.error('');
    done(1);
  }

  console.log(`✓ ${pages.length} pages at ${WIDTH}px · no horizontal overflow · every scrolling table signposted`);
  done(0);
})().catch((e) => { console.error(e); process.exit(1); });
