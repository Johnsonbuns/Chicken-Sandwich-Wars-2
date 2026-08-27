'use strict';
const { esc, usd, num, pct, fmtStat, arrow, dirClass } = require('./util');

/**
 * Per-page footnote tracker. Every figure on this site renders with a numbered
 * reference back to the publisher it came from; nothing is presented bare.
 */
function refs(sources) {
  const order = [];
  return {
    ref(id) {
      if (!id || !sources[id]) return '';
      let i = order.indexOf(id);
      if (i === -1) { order.push(id); i = order.length - 1; }
      const s = sources[id];
      return `<sup class="ref"><a href="#src-${i + 1}" title="${esc(s.pub)} — ${esc(s.title)}">${i + 1}</a></sup>`;
    },
    refAll(ids) { return (ids || []).map((id) => this.ref(id)).join(''); },
    used() { return order; },
    render(heading = 'Sources') {
      if (!order.length) return '';
      const items = order.map((id, i) => {
        const s = sources[id];
        return `<li id="src-${i + 1}"><span class="mono">[${i + 1}]</span> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.pub)} — ${esc(s.title)}</a>${s.date ? ` <span class="asof">(${esc(s.date)})</span>` : ''}</li>`;
      }).join('');
      return `<section class="section"><h2>${esc(heading)}</h2>
<p class="note" style="max-width:74ch">Every figure on this page is attributed. CSW does not publish estimates as facts — where a number is unavailable it is shown as “—”, and where a figure is derived arithmetically from two published figures it is marked as derived.</p>
<ol class="srclist" style="padding-left:18px">${items}</ol></section>`;
    }
  };
}

const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;

const MOMENTUM = {
  leader:      ['Category leader', 'hot'],
  hot:         ['Compounding', 'hot'],
  rocket:      ['Hypergrowth', 'rocket'],
  expanding:   ['Expanding', 'good'],
  growing:     ['Growing', 'good'],
  steady:      ['Steady', 'mut'],
  stabilizing: ['Stabilizing', 'mut'],
  split:       ['Growth vs. traffic split', 'warn'],
  turnaround:  ['Turnaround', 'warn'],
  mixed:       ['Mixed signals', 'warn'],
  pressured:   ['Under pressure', 'bad'],
  distressed:  ['Distressed', 'bad'],
  emerging:    ['Emerging', 'good']
};
const momentumBadge = (m) => {
  const [label, cls] = MOMENTUM[m] || ['Tracking', 'mut'];
  return badge(label, cls);
};

function statGrid(items) {
  const cells = items.map((it) => `<div class="stat">
    <div class="v">${it.value}</div>
    <div class="l">${esc(it.label)}</div>
    ${it.note ? `<div class="n">${it.note}</div>` : ''}
  </div>`).join('');
  return `<div class="stats">${cells}</div>`;
}

function brandStat(stat, label, R) {
  if (!stat) return null;
  return {
    value: fmtStat(stat) + R.ref(stat.src),
    label,
    note: [stat.asOf ? `<span class="asof">${esc(stat.asOf)}</span>` : '', stat.note ? esc(stat.note) : '']
      .filter(Boolean).join(' · ')
  };
}

function table({ cols, rows, cls = '' }) {
  const head = cols.map((c) => {
    const label = typeof c === 'string' ? c : c.label;
    const num = typeof c === 'object' && c.num ? ' class="num"' : '';
    return `<th${num}>${esc(label)}</th>`;
  }).join('');
  const body = rows.map((r) => {
    const attrs = r.attrs || '';
    const cells = (r.cells || r).map((cell, i) => {
      const c = cols[i];
      const isNum = typeof c === 'object' && c.num;
      return `<td${isNum ? ' class="num"' : ''}>${cell}</td>`;
    }).join('');
    return `<tr${attrs}>${cells}</tr>`;
  }).join('');
  return `<div class="tablewrap ${cls}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function chart(c, R) {
  const vals = c.series.map((s) => s.value);
  const max = Math.max(...vals.map(Math.abs), 0.0001);
  const fmt = (v) => {
    if (c.unit === 'pct') return pct(v);
    if (c.unit === 'usdM') return '$' + v.toFixed(v < 10 ? 2 : 1) + 'M';
    if (c.unit === 'usd') return '$' + v.toFixed(2);
    if (c.unit === 'lbs') return v.toFixed(1) + ' lbs';
    return num(v);
  };
  const rows = c.series.map((s) => {
    const w = (Math.abs(s.value) / max) * 100;
    const label = s.slug ? `<a href="../brands/${s.slug}.html">${esc(s.label)}</a>` : esc(s.label);
    return `<div class="row">
      <div class="lbl">${label}</div>
      <div class="track"><div class="fill${s.value < 0 ? ' neg' : ''}" style="width:${w.toFixed(1)}%"></div></div>
      <div class="v">${fmt(s.value)}</div>
    </div>`;
  }).join('');
  return `<section class="panel" id="${esc(c.id)}" style="margin-bottom:22px">
    <div class="panel-head"><h3>${esc(c.title)}</h3><span class="asof" style="margin-left:auto">${R.refAll(c.srcs)}</span></div>
    <div class="panel-body"><div class="chart">${rows}</div>
    ${c.note ? `<p class="note" style="margin:14px 0 0">${esc(c.note)}</p>` : ''}</div>
  </section>`;
}

function scoreBars(parts) {
  return `<div class="bars">${parts.map((p) => `<div class="bar">
    <div class="lbl">${esc(p.label)}</div>
    <div class="track"><div class="fill" style="width:${p.value}%"></div></div>
    <div class="val">${p.value}</div>
  </div>`).join('')}</div>`;
}

function newsItem(n, R, opts = {}) {
  const brandLink = n.brand && opts.brandName
    ? ` <a class="badge mut" href="${opts.depth === 0 ? '' : '../'}brands/${n.brand}.html">${esc(opts.brandName)}</a>` : '';
  return `<article class="newsitem">
    <div class="head"><span class="date">${esc(n.date)}</span>${badge(n.cat, 'mut')}${brandLink}</div>
    <h3>${esc(n.title)}${R.ref(n.src)}</h3>
    <p class="means"><b>What it means for the Chicken Wars:</b> ${esc(n.means)}</p>
  </article>`;
}

function emptyState(title, body, ctaHref, ctaLabel) {
  return `<div class="empty">
    <h3>${esc(title)}</h3>
    <p class="note" style="max-width:60ch;margin:0 auto 16px">${body}</p>
    ${ctaHref ? `<a class="btn" href="${ctaHref}">${esc(ctaLabel)}</a>` : ''}
  </div>`;
}

function form({ id, title, intro, fields, submit }) {
  const html = fields.map((f) => {
    if (f.type === 'row') return `<div class="row2">${f.fields.map(renderField).join('')}</div>`;
    return renderField(f);
  }).join('');
  return `<div class="card" style="padding:24px">
    ${title ? `<h3>${esc(title)}</h3>` : ''}
    ${intro ? `<p class="note" style="max-width:62ch">${intro}</p>` : ''}
    <form class="csw" id="${esc(id)}" data-csw-form>
      ${html}
      <div><button class="btn" type="submit">${esc(submit)}</button></div>
      <p class="formnote" data-formnote>This form is not yet wired to a backend. Submitting copies your entry to the clipboard and opens a pre-filled email to <a href="mailto:desk@chickensandwichwars.com">desk@chickensandwichwars.com</a> so nothing is silently lost.</p>
    </form>
  </div>`;
}

function renderField(f) {
  const id = esc(f.name);
  const req = f.required ? ' required' : '';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${id}"${req} placeholder="${esc(f.placeholder || '')}"></textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${id}"${req}>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  else input = `<input id="${id}" name="${id}" type="${esc(f.type || 'text')}"${req} placeholder="${esc(f.placeholder || '')}">`;
  return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}</div>`;
}

module.exports = {
  refs, badge, momentumBadge, statGrid, brandStat, table, chart,
  scoreBars, newsItem, emptyState, form, MOMENTUM
};
