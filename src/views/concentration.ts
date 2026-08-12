// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// CONCENTRATION — treemap plus cumulative-share curve.
// Question it answers: "how many companies actually carry the company tax base?"
// The treemap makes the answer physical; the curve puts a number on it.
// Next action: click any tile to open that company.

import type { Bundle, Entity } from '../data';
import { d, sectorOf } from '../data';
import { openCompany } from '../drilldown';
import { escapeHtml, moneyShort, num, pct1, textOn, tipAttr, yearLabel } from '../format';
import { el, linearScale, niceTicks, polyline, svgRoot } from '../svg';
import { squarify } from '../utils/squarify';

let year: string | null = null;
const TILES = 120;

interface Payer { e: Entity; tax: number; income: number }

function payers(b: Bundle, y: string): Payer[] {
  return (b.byYear.get(y) ?? [])
    .map(({ entity, row }) => ({ e: entity, tax: d(row.payable), income: d(row.total) }))
    .filter((p) => p.tax > 0)
    .sort((a, z) => z.tax - a.tax);
}

function treemap(b: Bundle, list: Payer[], onPick: (e: Entity) => void): SVGSVGElement {
  const W = 900;
  const H = 480;
  const top = list.slice(0, TILES);
  const rest = list.slice(TILES);
  const restTax = rest.reduce((s, p) => s + p.tax, 0);

  const values = top.map((p) => p.tax).concat(restTax > 0 ? [restTax] : []);
  const rects = squarify(values, W, H);

  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', `Treemap of company tax payable — the ${top.length} largest payers`);

  rects.forEach((r, i) => {
    const isRest = i >= top.length;
    const p = isRest ? null : top[i];
    const colour = isRest ? 'var(--bg-elevated)' : sectorOf(b, p!.e.sector).colour;

    const g = el('g', { class: 'mark' });
    g.append(el('rect', {
      x: r.x, y: r.y, width: Math.max(0, r.w - 1), height: Math.max(0, r.h - 1),
      fill: colour, stroke: '#fff', 'stroke-width': 1, rx: 2,
    }));

    const tip = isRest
      ? tipAttr([
        `All ${num(rest.length)} other paying companies`,
        `${moneyShort(restTax)} of tax between them`,
        `${pct1((restTax / list.reduce((s, q) => s + q.tax, 0)) * 100)} of all company tax this year`,
      ])
      : tipAttr([
        p!.e.name,
        `Tax payable ${moneyShort(p!.tax)}`,
        `Total income ${moneyShort(p!.income)}`,
        sectorOf(b, p!.e.sector).label,
        'Click for the full history',
      ]);
    g.setAttribute('data-tip', tip);
    g.setAttribute('aria-label', isRest ? `All other payers, ${moneyShort(restTax)}` : `${p!.e.name}, ${moneyShort(p!.tax)}`);

    // Only label tiles with room for readable text; the rest rely on hover.
    if (r.w > 78 && r.h > 30) {
      // Truncate to what actually fits. 6.2px per character is measured for
      // this font at 11px — a label wider than its tile spills across the
      // neighbouring rectangle and reads as if it belonged to that company.
      const fits = Math.max(3, Math.floor((r.w - 12) / 6.2));
      const label = isRest ? 'All other payers' : p!.e.name;
      const short = label.length > fits ? `${label.slice(0, fits - 1)}…` : label;
      // Text colour is derived from the fill, never assumed to be white: two of
      // the sector colours are light enough that white text fails WCAG AA on
      // them, and "Unclassified" is deliberately pale.
      const ink = isRest ? 'var(--text-secondary)' : textOn(colour);
      g.append(el('text', {
        x: r.x + 6, y: r.y + 16, 'font-size': 11, 'font-weight': 600,
        fill: ink, 'pointer-events': 'none',
      }, short));
      if (r.h > 44) {
        g.append(el('text', {
          x: r.x + 6, y: r.y + 31, 'font-size': 11, 'font-family': 'var(--font-mono)',
          fill: isRest ? 'var(--text-tertiary)' : ink,
          'pointer-events': 'none',
        }, moneyShort(isRest ? restTax : p!.tax)));
      }
    }

    if (!isRest) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => onPick(p!.e));
    }
    svg.append(g);
  });

  return svg;
}

function lorenz(list: Payer[]): SVGSVGElement {
  const W = 900;
  const H = 300;
  const m = { t: 18, r: 24, b: 40, l: 56 };
  const total = list.reduce((s, p) => s + p.tax, 0);
  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', 'Cumulative share of company tax by number of companies');

  const x = linearScale([0, list.length], [m.l, W - m.r]);
  const y = linearScale([0, 100], [H - m.b, m.t]);

  for (const tick of niceTicks(100, 5)) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(tick), y2: y(tick), class: 'gridline' }));
    svg.append(el('text', { x: m.l - 8, y: y(tick) + 4, 'text-anchor': 'end', 'font-size': 10 }, `${tick}%`));
  }

  const pts: [number, number][] = [[x(0), y(0)]];
  let run = 0;
  const marks: { n: number; share: number }[] = [];
  const wanted = new Set([1, 10, 50, 100, 500]);
  list.forEach((p, i) => {
    run += p.tax;
    pts.push([x(i + 1), y((run / total) * 100)]);
    if (wanted.has(i + 1)) marks.push({ n: i + 1, share: (run / total) * 100 });
  });

  svg.append(el('path', {
    d: polyline(pts), fill: 'none', stroke: 'var(--paid)', 'stroke-width': 2.6, 'stroke-linejoin': 'round',
  }));

  for (const mk of marks) {
    const px = x(mk.n);
    const py = y(mk.share);
    svg.append(el('line', { x1: px, x2: px, y1: py, y2: H - m.b, stroke: 'var(--border-default)', 'stroke-dasharray': '3 3' }));
    const dot = el('circle', { cx: px, cy: py, r: 5, fill: 'var(--paid-deep)', class: 'mark' });
    dot.setAttribute('data-tip', tipAttr([
      `The ${num(mk.n)} largest payer${mk.n === 1 ? '' : 's'}`,
      `${pct1(mk.share)} of all company tax that year`,
    ]));
    svg.append(dot);
    svg.append(el('text', {
      x: px + 7, y: py - 7, 'font-size': 10, 'font-weight': 650, fill: 'var(--text-primary)',
    }, `top ${mk.n}: ${pct1(mk.share)}`));
  }

  svg.append(el('text', {
    x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11,
  }, `Companies, ranked by tax payable (${num(list.length)} paid any tax)`));

  return svg;
}

export function renderConcentration(root: HTMLElement, b: Bundle): void {
  const y = year && b.years.includes(year) ? year : b.meta.latestYear;
  year = y;
  const list = payers(b, y);
  const total = list.reduce((s, p) => s + p.tax, 0);
  const t = b.totals.get(y)!;
  const share = (n: number) => (list.slice(0, n).reduce((s, p) => s + p.tax, 0) / total) * 100;

  root.innerHTML = `
    <div class="view-head">
      <h2>How few companies carry it</h2>
      <p>Company tax in Australia is not spread evenly across big business. A small number of miners and banks
        pay most of it, which is also why the national total swings with commodity prices.</p>
    </div>

    <div class="controls">
      <div class="control-group">
        <label class="control-label" for="k-year">Income year</label>
        <select id="k-year">
          ${b.years.slice().reverse().map((v) =>
    `<option value="${v}"${v === y ? ' selected' : ''}>${yearLabel(v)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat is-paid"><div class="stat-value">${pct1(share(10))}</div>
        <div class="stat-label">Paid by the top 10</div>
        <div class="stat-note">entities, of ${num(t.entities)} in the report — a floor, since groups
          lodging under several ABNs are counted separately</div></div>
      <div class="stat"><div class="stat-value">${pct1(share(50))}</div>
        <div class="stat-label">Paid by the top 50</div>
        <div class="stat-note">also entities, not groups</div></div>
      <div class="stat"><div class="stat-value">${num(list.length)}</div>
        <div class="stat-label">Companies that paid any tax</div>
        <div class="stat-note">${pct1((list.length / t.entities) * 100)} of the report</div></div>
      <div class="stat"><div class="stat-value">${moneyShort(total)}</div>
        <div class="stat-label">Total tax payable</div>
        <div class="stat-note">${yearLabel(y)}</div></div>
    </div>

    <div class="panel">
      <div class="chart-title">Company tax payable, ${yearLabel(y)}</div>
      <div class="section-sub">Every rectangle is one
        <button type="button" class="glossary-link" data-term="entity">legal entity</button> — not one corporate group, so a
        group that lodges under several ABNs appears as several tiles. Its area is the tax it paid; colour is
        sector. The ${TILES} largest are drawn individually and everyone else is pooled into the pale block.
        Hover for exact figures, click a tile to open the company.</div>
      <div class="scroller"><div id="k-tree" class="chart-wrap" style="min-width:660px"></div></div>
      <div class="legend" id="k-legend"></div>
    </div>

    <div class="panel">
      <div class="chart-title">Cumulative share of company tax</div>
      <div class="section-sub">Reading left to right, companies ranked from the largest payer down. The
        steeper the start, the more concentrated the tax base.</div>
      <div class="scroller"><div id="k-lorenz" class="chart-wrap" style="min-width:660px"></div></div>
    </div>

    <div class="panel">
      <div class="section-title">The ten largest payers, ${yearLabel(y)}</div>
      <div class="section-sub">Ranked by <button type="button" class="glossary-link" data-term="entity">legal entity</button>,
        not corporate group — several of these belong to the same group, and the file has no group identifier
        to combine them with.</div>
      <div class="scroller"><table class="data">
        <thead><tr><th>#</th><th>Company</th><th class="n">Tax payable</th><th class="n">Total income</th>
          <th class="n">Share of all tax</th></tr></thead>
        <tbody>${list.slice(0, 10).map((p, i) => `
          <tr class="clickable" data-id="${p.e.id}" tabindex="0">
            <td class="n">${i + 1}</td>
            <td class="name-cell">${escapeHtml(p.e.name)}</td>
            <td class="n">${moneyShort(p.tax)}</td>
            <td class="n">${moneyShort(p.income)}</td>
            <td class="n">${pct1((p.tax / total) * 100)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const pick = (e: Entity) => openCompany(b, e);
  root.querySelector('#k-tree')!.append(treemap(b, list, pick));
  root.querySelector('#k-lorenz')!.append(lorenz(list));

  // Legend covers only the sectors actually drawn, so it never lists a colour
  // the reader cannot find on the chart.
  const present = new Set(list.slice(0, TILES).map((p) => p.e.sector));
  root.querySelector('#k-legend')!.innerHTML = b.meta.sectors
    .filter((s) => present.has(s.id))
    .map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.colour}"></span>${escapeHtml(s.label)}</span>`)
    .join('') + '<span class="legend-item"><span class="legend-swatch" style="background:var(--bg-elevated)"></span>All other payers</span>';

  root.querySelector<HTMLSelectElement>('#k-year')!.addEventListener('change', (ev) => {
    year = (ev.target as HTMLSelectElement).value;
    renderConcentration(root, b);
  });

  root.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    const go = () => pick(b.entities[Number(tr.dataset.id)]);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
    });
  });
}
