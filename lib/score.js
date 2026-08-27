'use strict';

/**
 * The CSW Score.
 *
 * Every input is a figure published by a company, a regulatory filing or an
 * industry data provider, or an arithmetic derivation from two such figures.
 * Nothing here is a judgement call, and no component is hand-set.
 *
 * Components are scaled linearly between a published floor and ceiling, then
 * clamped to 0-100. Brands missing a component are scored on the components
 * they do have, with the remaining weights renormalised. A brand with fewer
 * than three available components is not scored at all.
 */

const COMPONENTS = [
  { key: 'demand',     label: 'Consumer Demand',      weight: 25, from: 'compsPct',       floor: -8,     ceil: 4,       floorScore: 20, ceilScore: 95,
    desc: 'Most recently reported same-store sales.' },
  { key: 'economics',  label: 'Unit Economics',       weight: 30, from: 'auvUsd',         floor: 1.0e6,  ceil: 9.5e6,   floorScore: 40, ceilScore: 100,
    desc: 'Average unit volume.' },
  { key: 'expansion',  label: 'Expansion',            weight: 18, from: 'unitGrowthPct',  floor: -5,     ceil: 55,      floorScore: 20, ceilScore: 100,
    desc: 'Unit growth over the latest reported year.' },
  { key: 'realestate', label: 'Real Estate Strength', weight: 15, from: 'capRateMid',     floor: 7.5,    ceil: 4.2,     floorScore: 45, ceilScore: 100,
    desc: 'Cap rate on the brand’s net-lease product — lower is stronger.' },
  { key: 'momentum',   label: 'System Momentum',      weight: 12, from: 'salesGrowthPct', floor: -5,     ceil: 55,      floorScore: 25, ceilScore: 100,
    desc: 'Systemwide sales growth over the latest reported year.' }
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function scale(value, c) {
  const t = (value - c.floor) / (c.ceil - c.floor);
  return clamp(c.floorScore + t * (c.ceilScore - c.floorScore), 0, 100);
}

function scoreBrand(brand) {
  const m = brand.metrics || {};
  const parts = [];
  for (const c of COMPONENTS) {
    const v = m[c.from];
    if (v == null) continue;
    parts.push({ key: c.key, label: c.label, weight: c.weight, value: Math.round(scale(v, c)), raw: v, desc: c.desc });
  }
  if (parts.length < 3) return { rated: false, parts, penalty: 0 };
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  let score = parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
  // Published, uniform adjustment: a system in net unit decline carries a 4-point penalty.
  const penalty = m.netClosures ? 4 : 0;
  score = clamp(score - penalty, 0, 100);
  return { rated: true, score: Math.round(score), parts, penalty, coverage: parts.length };
}

function rankBrands(brands) {
  const scored = brands.map((b) => ({ brand: b, ...scoreBrand(b) }));
  const rated = scored.filter((s) => s.rated).sort((a, b) => b.score - a.score);
  rated.forEach((s, i) => { s.rank = i + 1; });
  const unrated = scored.filter((s) => !s.rated)
    .sort((a, b) => a.brand.name.localeCompare(b.brand.name));
  return { rated, unrated, all: scored };
}

module.exports = { COMPONENTS, scoreBrand, rankBrands };
