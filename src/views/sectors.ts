// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// SECTORS — the sector × year matrix.
// Question it answers: "which industries carry the company tax base, and how
// has that shifted?" A single-year pie says mining is big; the matrix shows the
// mining column going pale in 2015-16 and 2019-20 and blazing in 2021-22, which
// is the commodity cycle written in tax receipts.
//
// The classifier behind it is a name-matching heuristic and is therefore wrong
// at the margins by construction. Unclassified is a first-class row here, never
// a hidden residual, and coverage is reported by dollars as well as by count —
// a classifier naming 30% of companies but 82% of the tax base is useful, and
// only one of those two numbers says so.

import type { Bundle } from '../data';
import { d, sectorOf } from '../data';
import { escapeHtml, moneyShort, num, pct1, textOn, tipAttr, yearLabel } from '../format';
import { el, linearScale, svgRoot } from '../svg';

type Measure = 'payable' | 'total' | 'rate';
let measure: Measure = 'payable';
let picked: string | null = null;

interface Cell { sector: string; year: string; payable: number; total: number; taxable: number; count: number }

function matrix(b: Bundle): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const s of b.meta.sectors) {
    for (const year of b.years) {
      cells.set(`${s.id}|${year}`, { sector: s.id, year, payable: 0, total: 0, taxable: 0, count: 0 });
    }
  }
  for (const [year, list] of b.byYear) {
    for (const { entity, row } of list) {
      const c = cells.get(`${entity.sector}|${year}`);
      if (!c) continue;
      c.payable += d(row.payable);
      c.total += d(row.total);
      c.taxable += d(row.taxable);
      c.count += 1;
    }
  }
  return cells;
}

function value(c: Cell): number {
  if (measure === 'payable') return c.payable;
  if (measure === 'total') return c.total;
  return c.taxable > 0 ? (c.payable / c.taxable) * 100 : NaN;
}

const MEASURE_LABEL: Record<Measure, string> = {
  payable: 'Tax payable',
  total: 'Total income',
  rate: 'Effective tax rate',
};

function heatmap(b: Bundle, cells: Map<string, Cell>, onPick: (id: string) => void): SVGSVGElement {
  const rows = b.meta.sectors;
  const cellW = 62;
  const cellH = 26;
  const m = { t: 30, r: 96, b: 12, l: 186 };
  const W = m.l + b.years.length * cellW + m.r;
  const H = m.t + rows.length * cellH + m.b;

  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', `${MEASURE_LABEL[measure]} by sector and income year`);

  /*
   * SCALED PER ROW, NOT GLOBALLY — and this is the difference between a useful
   * matrix and a decorative one.
   *
   * Mining pays several times more company tax than any other sector, so a
   * single scale across the whole grid renders the mining row dark and every
   * other row an indistinguishable pale wash. That version tells you only that
   * mining is big, which the stacked chart below already says better.
   *
   * The question this view exists to answer is how each sector moved over
   * ELEVEN YEARS, so each row is scaled to its own maximum and the absolute
   * size lives in the "All years" column on the right. Comparing cells across
   * rows is therefore meaningless, which the subtitle says out loud.
   *
   * The effective-rate measure is the exception: it stays anchored at 0-30% so
   * that "pale" always means "below the statutory rate" rather than "below
   * whatever this sector's own best year happened to be".
   */
  const rowMax = new Map(rows.map((s) => [s.id, Math.max(
    ...b.years.map((year) => {
      const c = cells.get(`${s.id}|${year}`);
      const v = c ? value(c) : 0;
      return Number.isFinite(v) ? v : 0;
    }),
    1,
  )]));
  const scaleFor = (id: string): number => (measure === 'rate' ? 30 : rowMax.get(id) ?? 1);

  b.years.forEach((year, i) => {
    svg.append(el('text', {
      x: m.l + i * cellW + cellW / 2, y: m.t - 12, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600,
    }, year.slice(2)));
  });

  // The reporting-threshold break, drawn ON the grid. Every cell tooltip
  // reports a company count, and a reader tracking one row across the decade
  // sees jumps that are the law change and not the sector — Property &
  // construction goes 77 to 175 companies in that single step.
  const bi = b.years.indexOf(b.meta.thresholdChangeYear);
  if (bi > 0) {
    const bx = m.l + bi * cellW - 1;
    svg.append(el('line', {
      x1: bx, x2: bx, y1: m.t - 8, y2: m.t + rows.length * cellH,
      stroke: 'var(--text-primary)', 'stroke-dasharray': '4 4', 'stroke-width': 1.2,
    }));
    const flag = el('text', {
      x: bx + 4, y: m.t - 22, 'font-size': 9, 'font-weight': 650, fill: 'var(--text-primary)',
    }, 'threshold cut →');
    flag.setAttribute('data-tip', tipAttr([
      'Reporting threshold cut, 2022-23',
      'Australian-owned private companies became reportable at $100m instead of $200m.',
      'Company counts either side of this line are not comparable — over a thousand companies',
      'entered the report at once, and they landed unevenly across these sectors.',
    ]));
    svg.append(flag);
  }

  rows.forEach((s, r) => {
    const yTop = m.t + r * cellH;
    const dim = picked !== null && picked !== s.id;

    const label = el('text', {
      x: m.l - 10, y: yTop + cellH / 2 + 4, 'text-anchor': 'end', 'font-size': 11,
      'font-weight': picked === s.id ? 700 : 500,
      fill: dim ? 'var(--text-muted)' : 'var(--text-primary)', class: 'mark',
    }, s.label);
    label.style.cursor = 'pointer';
    label.addEventListener('click', () => onPick(s.id));
    label.setAttribute('data-tip', tipAttr([s.label, 'Click to isolate this sector']));
    svg.append(label);

    let rowTotal = 0;
    b.years.forEach((year, i) => {
      const c = cells.get(`${s.id}|${year}`)!;
      const v = value(c);
      rowTotal += measure === 'total' ? c.total : c.payable;
      const scale = scaleFor(s.id);
      const t = Number.isFinite(v) && scale > 0 ? Math.min(1, v / scale) : 0;

      const cell = el('rect', {
        x: m.l + i * cellW, y: yTop, width: cellW - 2, height: cellH - 2, rx: 2,
        fill: !Number.isFinite(v) || c.count === 0 ? 'var(--bg-elevated)' : s.colour,
        // Intensity, never a fade toward white: a pale cell must still read as
        // the sector's own colour so the row stays identifiable at a glance.
        opacity: !Number.isFinite(v) || c.count === 0 ? 0.5 : (dim ? 0.12 : 0.18 + t * 0.82),
        class: 'mark',
      });
      cell.setAttribute('data-tip', tipAttr(c.count === 0
        ? [`${s.label} — ${yearLabel(year)}`, 'No companies classified into this sector this year.']
        : [
          `${s.label} — ${yearLabel(year)}`,
          `Tax payable ${moneyShort(c.payable)}`,
          `Total income ${moneyShort(c.total)}`,
          c.taxable > 0 ? `Effective rate ${pct1((c.payable / c.taxable) * 100)}` : 'No taxable income',
          `${num(c.count)} compan${c.count === 1 ? 'y' : 'ies'}`,
          year >= b.meta.thresholdChangeYear
            ? 'Counts from 2022-23 include companies the lower reporting threshold added.'
            : 'Counts before 2022-23 use the higher reporting threshold — not comparable with later years.',
        ]));
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => onPick(s.id));
      svg.append(cell);
    });

    svg.append(el('text', {
      x: W - m.r + 8, y: yTop + cellH / 2 + 4, 'font-size': 10, 'font-family': 'var(--font-mono)',
      fill: dim ? 'var(--text-muted)' : 'var(--text-secondary)',
    }, moneyShort(rowTotal)));
  });

  svg.append(el('text', {
    x: W - m.r + 8, y: m.t - 12, 'font-size': 10, 'font-weight': 600,
  }, 'All years'));

  return svg;
}

function sectorShare(b: Bundle, cells: Map<string, Cell>): SVGSVGElement {
  const W = 900;
  const H = 300;
  const m = { t: 16, r: 20, b: 36, l: 46 };
  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', 'Share of all company tax by sector, by year (stacked)');

  const x = linearScale([0, b.years.length - 1], [m.l, W - m.r]);
  const y = linearScale([0, 100], [H - m.b, m.t]);
  const bandW = (W - m.r - m.l) / b.years.length;

  b.years.forEach((year, i) => {
    const yearTotal = b.meta.sectors.reduce((s, sec) => s + cells.get(`${sec.id}|${year}`)!.payable, 0);
    let acc = 0;
    for (const sec of b.meta.sectors) {
      const c = cells.get(`${sec.id}|${year}`)!;
      if (c.payable <= 0 || yearTotal <= 0) continue;
      const share = (c.payable / yearTotal) * 100;
      const rect = el('rect', {
        x: x(i) - bandW / 2 + 2, y: y(acc + share), width: bandW - 4, height: Math.max(0.5, y(acc) - y(acc + share)),
        fill: sec.colour, opacity: picked && picked !== sec.id ? 0.15 : 0.92, class: 'mark',
      });
      rect.setAttribute('data-tip', tipAttr([
        `${sec.label} — ${yearLabel(year)}`,
        `${pct1(share)} of all company tax that year`,
        moneyShort(c.payable),
      ]));
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => { picked = picked === sec.id ? null : sec.id; });
      svg.append(rect);
      acc += share;
    }
    svg.append(el('text', { x: x(i), y: H - m.b + 15, 'text-anchor': 'middle', 'font-size': 10 }, year.slice(2)));
  });

  for (const tick of [0, 25, 50, 75, 100]) {
    svg.append(el('text', { x: m.l - 8, y: y(tick) + 4, 'text-anchor': 'end', 'font-size': 10 }, `${tick}%`));
  }

  return svg;
}

export function renderSectors(root: HTMLElement, b: Bundle): void {
  const cells = matrix(b);
  const cov = b.meta.sectorCoverage;
  const latest = b.meta.latestYear;
  const latestBySector = b.meta.sectors
    .map((s) => ({ s, c: cells.get(`${s.id}|${latest}`)! }))
    .filter((r) => r.c.payable > 0)
    .sort((a, z) => z.c.payable - a.c.payable);
  const latestTotal = latestBySector.reduce((s, r) => s + r.c.payable, 0);

  root.innerHTML = `
    <div class="view-head">
      <h2>Which industries pay it</h2>
      <p>The ATO's file has no industry column, so sectors here are inferred from company names. The result
        is good for the large payers and rough for the long tail — the numbers below say exactly how rough.</p>
    </div>

    <div class="callout">
      <strong>How much of this is actually classified.</strong> The classifier names
      ${pct1(cov.entityShare * 100)} of companies but ${pct1(cov.payableShare * 100)} of all tax payable,
      because the largest payers are pinned individually and the unnamed remainder is mostly small holding
      companies. Both numbers matter: judge the <em>shape</em> of the chart on the
      ${pct1(cov.payableShare * 100)}, and treat any statement about the <em>number</em> of companies in a
      sector as approximate. Unclassified is drawn as its own row and is never hidden.
    </div>

    <div class="controls">
      <div class="control-group">
        <span class="control-label">Measure</span>
        <div class="seg" role="group" aria-label="Measure">
          <button type="button" data-measure="payable" aria-pressed="${measure === 'payable'}">Tax payable</button>
          <button type="button" data-measure="total" aria-pressed="${measure === 'total'}">Total income</button>
          <button type="button" data-measure="rate" aria-pressed="${measure === 'rate'}">Effective rate</button>
        </div>
      </div>
      ${picked ? `<button type="button" class="icon-btn" id="s-clear"
        style="background:var(--bg-elevated);color:var(--accent-secondary);border-color:var(--border-default)"
        >Clear ${escapeHtml(sectorOf(b, picked).label)} filter</button>` : ''}
    </div>

    <div class="panel">
      <div class="chart-title">${MEASURE_LABEL[measure]} by sector and year</div>
      <div class="section-sub">${measure === 'rate'
    ? 'Darker means a higher effective rate. The scale runs 0% to the 30% statutory rate across every row, so a pale cell is a sector paying well under the headline rate that year.'
    : '<strong>Each row is shaded against its own best year</strong>, so you can read a sector\'s trajectory across the decade. '
      + 'That means cells are <em>not</em> comparable between rows — mining pays several times what any other sector does, and on a '
      + 'single shared scale every row but mining would be an identical pale wash. Absolute size is in the <em>All years</em> column '
      + 'on the right, and relative size is the chart below.'} Click a sector name or cell to isolate it across
        both charts. Hover any cell for the exact figures. Company counts in the tooltips are not comparable
        across the marked <button type="button" class="glossary-link" data-term="threshold">2022&ndash;23
        threshold cut</button>.</div>
      <div class="scroller"><div id="s-matrix" class="chart-wrap" style="min-width:800px"></div></div>
    </div>

    <div class="panel">
      <div class="chart-title">Share of all company tax, by sector</div>
      <div class="section-sub">Each column is one year, normalised to 100%. This is where the commodity cycle
        shows: the mining band swells and shrinks while the banks hold a steady slab.</div>
      <div class="scroller"><div id="s-share" class="chart-wrap" style="min-width:800px"></div></div>
      <div class="legend" id="s-legend"></div>
    </div>

    <div class="panel">
      <div class="section-title">Sectors in ${yearLabel(latest)}</div>
      <div class="scroller"><table class="data">
        <thead><tr><th>Sector</th><th class="n">Tax payable</th><th class="n">Share of tax</th>
          <th class="n">Total income</th><th class="n">Effective rate</th><th class="n">Companies</th></tr></thead>
        <tbody>${latestBySector.map((r) => `
          <tr>
            <td><span class="sector-pill" style="background:${r.s.colour};color:${textOn(r.s.colour)}">${escapeHtml(r.s.label)}</span></td>
            <td class="n">${moneyShort(r.c.payable)}</td>
            <td class="n">${pct1((r.c.payable / latestTotal) * 100)}</td>
            <td class="n">${moneyShort(r.c.total)}</td>
            <td class="n">${r.c.taxable > 0 ? pct1((r.c.payable / r.c.taxable) * 100) : '<span class="cell-nil">n/a</span>'}</td>
            <td class="n">${num(r.c.count)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const pick = (id: string) => { picked = picked === id ? null : id; renderSectors(root, b); };
  root.querySelector('#s-matrix')!.append(heatmap(b, cells, pick));
  root.querySelector('#s-share')!.append(sectorShare(b, cells));

  root.querySelector('#s-legend')!.innerHTML = b.meta.sectors.map((s) =>
    `<button type="button" class="legend-item clickable" data-sector="${s.id}" aria-pressed="${picked === s.id}">
      <span class="legend-swatch" style="background:${s.colour}"></span>${escapeHtml(s.label)}</button>`).join('');
  root.querySelector('#s-legend')!.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLElement>('[data-sector]');
    if (btn) pick(btn.dataset.sector!);
  });

  root.querySelectorAll<HTMLElement>('[data-measure]').forEach((btn) => {
    btn.addEventListener('click', () => {
      measure = btn.dataset.measure as Measure;
      renderSectors(root, b);
    });
  });
  root.querySelector('#s-clear')?.addEventListener('click', () => { picked = null; renderSectors(root, b); });
}
