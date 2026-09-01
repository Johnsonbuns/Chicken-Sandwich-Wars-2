'use strict';

/**
 * How old is the number behind a ranking?
 *
 * The editorial rule says every figure carries a publisher, a URL and an as-of date.
 * The five figures that actually decide the rankings were the exception: `brand.metrics`
 * is a bag of bare numbers, so the site could render a #1 seat off a comp nobody had
 * republished in a year and there was no way — in the data, in the build or in the
 * checks — to notice. This module is the missing half of that rule: it resolves the
 * as-of date behind each scoring input and says how old it is.
 *
 * Nothing here invents a date. A component whose provenance cannot be resolved is
 * reported `unknown`, which is a finding rather than a default, and `check-freshness.js`
 * treats it as one.
 */

const { COMPONENTS } = require('./score');

/* ---------- freshness policy ----------
 *
 * A figure's shelf life is set by how often its publisher republishes it, not by how
 * much we would like it to still be true. Comps are quarterly, so a comp that has not
 * moved in three quarters means we missed two reports. AUV, unit growth and systemwide
 * sales growth are annual measures and are not stale until the next annual number is
 * out and we have not read it. Cap rates are republished quarterly by the brokerages
 * but move slowly, so they get a year.
 *
 * `fresh` is the age past which a figure is worth re-checking; `stale` is the age past
 * which the site should say so out loud. /methodology/ publishes this table. */
const POLICY = {
  demand:     { fresh: 5,  stale: 8,  cadence: 'quarterly' },
  economics:  { fresh: 14, stale: 20, cadence: 'annual' },
  expansion:  { fresh: 14, stale: 20, cadence: 'annual' },
  realestate: { fresh: 9,  stale: 15, cadence: 'quarterly, slow-moving' },
  momentum:   { fresh: 14, stale: 20, cadence: 'annual' }
};

/* Where a scoring metric's as-of date comes from when the exporter has not supplied one.
 *
 * These are not guesses. `auvUsd` and `compsPct` are written from the same database fact
 * as the `auv` and `compsLatest` stats, so the stat's period label is that metric's
 * period label. `unitGrowthPct` and `salesGrowthPct` are usually derived from two
 * published counts, and a derived rate is exactly as fresh as the later of its inputs —
 * which is the unit count and the systemwide sales figure. `capRateMid` is not a stat at
 * all; its provenance is the cap-rate source cited under realEstate.
 *
 * An entry may be an exact stat key or a pattern. The patterns are not laziness: the
 * desk writes year-stamped keys ("salesGrowth2025", "systemwideSales2024"), so an exact
 * list would silently stop resolving the moment a brand's 2026 figure lands under a new
 * key — and silently losing provenance is the failure this module exists to prevent. */
const MIRRORS = {
  demand:     ['compsLatest', 'compsFY', /^comps/],
  economics:  ['auv', 'blendedAuv', /^auv/],
  expansion:  ['usUnits', 'globalUnits', 'currentUnits', /^u(s|nits)/],
  momentum:   ['systemwideSales', 'globalSales', /^salesGrowth/, /^systemwideSales/]
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const endOfMonth = (y, m) => new Date(Date.UTC(y, m, 0));

/**
 * Resolve a published period label to the date the period ended.
 *
 * Returns `{ end, precision }` or null. `precision` is how much the label actually
 * pinned down — 'day', 'month', 'quarter' or 'year' — because a bare "2026" and a
 * "2026-06-27" should not be trusted to the same tolerance.
 */
function parsePeriod(label) {
  if (label == null) return null;
  let s = String(label).trim();
  if (!s) return null;

  // A range ("Jan 2025 – Mar 2026", "Jul 2025 - Jul 2026") is as fresh as its end.
  // Split on a dash that is flanked by spaces, so an ISO date's hyphens survive.
  const range = s.split(/\s+[–—-]\s+/);
  if (range.length > 1) s = range[range.length - 1].trim();

  // Qualifiers that describe the record rather than the period.
  s = s.replace(/\b(target|estimate|estimated|projected|expected|planned)\b/gi, '').trim();

  // A year range written without spaces ("2024-2025") is a range, not an ISO date, and
  // has to be caught before the ISO rule below can mis-read its second half as a month.
  let m = s.match(/^(\d{4})-(\d{4})$/);
  if (m) return { end: endOfMonth(Math.max(+m[1], +m[2]), 12), precision: 'year' };

  // ISO date, the only fully precise form the data uses.
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { end: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), precision: 'day' };

  // ISO year-month, which is how two thirds of the dated source records are written.
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { end: endOfMonth(+m[1], +m[2]), precision: 'month' };

  // A franchise disclosure document reports the fiscal year *before* the year it is
  // filed, so "2025 FDD" is data through the end of 2024. Dating it 2025 would credit
  // the figure with a year of freshness it does not have.
  m = s.match(/^(\d{4})\s*FDD$/i) || s.match(/^FDD\s*(\d{4})$/i);
  if (m) return { end: endOfMonth(+m[1] - 1, 12), precision: 'year' };

  // "Q2 2026" / "2026 Q2"
  m = s.match(/^Q([1-4])\s*(\d{4})$/i) || s.match(/^(\d{4})\s*Q([1-4])$/i);
  if (m) {
    const [q, y] = /^Q/i.test(s) ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return { end: endOfMonth(y, q * 3), precision: 'quarter' };
  }

  // "H1 2026" / "H2 2025"
  m = s.match(/^H([12])\s*(\d{4})$/i);
  if (m) return { end: endOfMonth(+m[2], +m[1] === 1 ? 6 : 12), precision: 'quarter' };

  // "FY2025", "YE2025", "CY2025", with or without a space.
  m = s.match(/^(?:FY|YE|CY)\s*(\d{4})$/i);
  if (m) return { end: endOfMonth(+m[1], 12), precision: 'year' };

  // "May 2026", "June 2025"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return { end: endOfMonth(+m[2], mo), precision: 'month' };
  }

  // Vague-but-real positions in a year: "Early 2026", "Late 2025", "Entering 2026".
  m = s.match(/^(early|entering|start of|mid|late|end of)\s+(\d{4})$/i);
  if (m) {
    const y = +m[2], k = m[1].toLowerCase();
    const mo = k === 'mid' ? 6 : k === 'late' || k === 'end of' ? 12 : 1;
    return { end: endOfMonth(y, mo), precision: 'quarter' };
  }

  // A bare year is the weakest label the data carries. Take it at its end and mark it.
  m = s.match(/^(\d{4})$/);
  if (m) return { end: endOfMonth(+m[1], 12), precision: 'year' };

  return null;
}

/** Whole months between two dates, floored, never negative. */
function monthsBetween(from, to) {
  if (!from || !to) return null;
  let n = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) n -= 1;
  return Math.max(0, n);
}

/**
 * Where one scoring input's as-of date and source come from, for one brand.
 *
 * Order matters: an explicit `metricsMeta` entry is what the exporter writes off the
 * database fact itself and is always right; the mirror is a documented correspondence;
 * the cap-rate case reads the source registry. Anything else is honestly unknown.
 */
function provenance(brand, component, sources = {}) {
  const meta = (brand.metricsMeta || {})[component.from];
  if (meta && meta.asOf) return { asOf: meta.asOf, src: meta.src || null, via: 'exported' };

  const stats = brand.stats || {};
  // Sorted so a pattern that matches two stat keys resolves to the same one on every
  // build; an unstable pick would make the rendered as-of date flap between deploys.
  const statKeys = Object.keys(stats).sort();
  for (const matcher of MIRRORS[component.key] || []) {
    const key = typeof matcher === 'string'
      ? (stats[matcher] ? matcher : null)
      : statKeys.find((k) => matcher.test(k) && stats[k] && stats[k].asOf);
    const stat = key ? stats[key] : null;
    if (stat && stat.asOf) return { asOf: stat.asOf, src: stat.src || null, via: `stat:${key}` };
  }

  // The cap rate is cited under realEstate rather than as a stat, so its date is the
  // date of the source that published it.
  if (component.key === 'realestate') {
    const keys = (brand.realEstate || {}).capSrc || [];
    for (const k of keys) {
      const s = sources[k];
      if (s && s.date) return { asOf: String(s.date), src: k, via: 'capSrc' };
    }
  }

  return null;
}

function classify(ageMonths, policy) {
  if (ageMonths == null) return 'unknown';
  if (ageMonths >= policy.stale) return 'stale';
  if (ageMonths >= policy.fresh) return 'aging';
  return 'current';
}

const RANK = { current: 0, aging: 1, unknown: 2, stale: 3 };

/**
 * The freshness of every scoring input a brand actually has.
 *
 * Only components that feed the brand's score are reported — a component the brand has
 * not published is a gap the rankings page already shows as a dash, not a stale figure.
 */
function brandFreshness(brand, { today = new Date(), sources = {} } = {}) {
  const metrics = brand.metrics || {};
  const items = [];

  for (const c of COMPONENTS) {
    if (metrics[c.from] == null) continue;
    const policy = POLICY[c.key] || { fresh: 12, stale: 18, cadence: 'unknown' };
    const p = provenance(brand, c, sources);
    const period = p ? parsePeriod(p.asOf) : null;
    const ageMonths = period ? monthsBetween(period.end, today) : null;
    items.push({
      key: c.key,
      label: c.label,
      metric: c.from,
      value: metrics[c.from],
      asOf: p ? p.asOf : null,
      src: p ? p.src : null,
      via: p ? p.via : null,
      precision: period ? period.precision : null,
      ageMonths,
      policy,
      state: classify(ageMonths, policy)
    });
  }

  // A ranking is only as current as its oldest input, so the brand takes the worst state
  // of its components rather than an average that would hide one bad figure.
  let state = 'current';
  for (const it of items) if (RANK[it.state] > RANK[state]) state = it.state;
  if (!items.length) state = 'unrated';

  const dated = items.filter((it) => it.ageMonths != null);
  const oldest = dated.length ? dated.reduce((a, b) => (a.ageMonths >= b.ageMonths ? a : b)) : null;

  return { items, state, oldest, unknowns: items.filter((it) => it.state === 'unknown').length };
}

/** The build's idea of "now". Overridable so a check can pin it. */
function today() {
  const override = process.env.CSW_TODAY;
  if (override) {
    const d = new Date(override);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

const STATE_LABEL = {
  current: 'Current',
  aging: 'Due for review',
  stale: 'Stale',
  unknown: 'Undated',
  unrated: 'Unrated'
};

module.exports = { POLICY, MIRRORS, parsePeriod, monthsBetween, provenance, brandFreshness, today, STATE_LABEL, classify };
