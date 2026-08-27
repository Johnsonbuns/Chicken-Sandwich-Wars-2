'use strict';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function usd(n, opts = {}) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  // Keep at least one decimal on M/B figures: "$2.0M" and "$2.1M" are a
  // meaningful distinction for an AUV, "$2M" hides it.
  const trim = (x) => x.replace(/(\.\d)0+$/, '$1').replace(/\.00$/, '.0');
  if (abs >= 1e9) return '$' + trim((n / 1e9).toFixed(opts.precise ? 3 : 2)) + 'B';
  if (abs >= 1e6) return '$' + trim((n / 1e6).toFixed(opts.precise ? 3 : 2)) + 'M';
  if (abs >= 1e3) return '$' + Math.round(n).toLocaleString('en-US');
  return '$' + n.toLocaleString('en-US');
}

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

function pct(n, withSign = true) {
  if (n == null) return '—';
  const s = withSign && n > 0 ? '+' : '';
  return s + Number(n).toFixed(1) + '%';
}

function fmtStat(stat) {
  if (!stat || stat.v == null) return '—';
  if (stat.fmt === 'usd') return usd(stat.v);
  if (stat.fmt === 'pct') return pct(stat.v);
  return num(stat.v);
}

const arrow = (n) => (n == null ? '' : n > 0.5 ? '▲' : n < -0.5 ? '▼' : '▬');
const dirClass = (n) => (n == null ? '' : n > 0.5 ? 'up' : n < -0.5 ? 'down' : 'flat');

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Relative path from a page depth to site root ("" for root, "../" for depth 1, ...)
const root = (depth) => (depth === 0 ? './' : '../'.repeat(depth));

module.exports = { esc, usd, num, pct, fmtStat, arrow, dirClass, slugify, root };
