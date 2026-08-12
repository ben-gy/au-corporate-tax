// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// RATES — income against effective tax rate.
// Question it answers: "does being bigger mean paying a lower rate?"
// The design problem this view exists to solve: income spans five orders of
// magnitude so the x axis has to be logarithmic, and log(0) does not exist
// while a nil tax bill is the most interesting value in the dataset. Clamping
// nil to the axis floor would bury it among the smallest payers. So nil sits in
// its own band below an explicit axis break, counted and visible.
// Next action: click any dot to open that company.

import type { Bundle, Entity } from '../data';
import { d, sectorOf } from '../data';
import { openCompany } from '../drilldown';
import { effectiveRate, escapeHtml, moneyShort, num, pct1, tipAttr, yearLabel } from '../format';
import { el, linearScale, logScale, niceTicks, powerTicks, svgRoot } from '../svg';
import { attachSvgZoom } from '../utils/svgZoom';

let year: string | null = null;
let sectorFilter = 'all';

interface Dot { e: Entity; income: number; taxable: number; tax: number; rate: number | null }

export function renderRates(root: HTMLElement, b: Bundle): void {
  const y = year && b.years.includes(year) ? year : b.meta.latestYear;
  year = y;

  const all: Dot[] = (b.byYear.get(y) ?? []).map(({ entity, row }) => ({
    e: entity,
    income: d(row.total),
    taxable: d(row.taxable),
    tax: d(row.payable),
    rate: effectiveRate(row.payable, row.taxable),
  }));
  const dots = sectorFilter === 'all' ? all : all.filter((p) => p.e.sector === sectorFilter);
  /*
   * THREE POPULATIONS, NOT TWO.
   *
   * An earlier version defined the nil band as `rate === null || tax === 0`,
   * which is a union of two different things. A handful of companies each year
   * report NO taxable income and yet a positive tax payable — offsets and
   * consolidation adjustments do that — so Zurich Financial Services, which
   * paid $9.8m in 2023-24, was being drawn under a legend reading "Nil tax
   * payable". It also made this view print 1,137 nil companies where the Nil
   * view printed 1,136, for the same year.
   *
   * So: the nil band is nil tax payable and nothing else, which matches the
   * figure every other view uses; companies with a real rate are plotted; and
   * the rare paid-but-no-taxable-income case gets its own marked band instead
   * of being folded into whichever neighbour is convenient.
   */
  const nils = dots.filter((p) => p.tax === 0);
  const noBase = dots.filter((p) => p.tax > 0 && p.taxable <= 0);
  const withRate = dots.filter((p) => p.rate !== null && p.tax > 0);
  const bigNils = dots.filter((p) => p.tax === 0 && p.income >= 1e9);

  const W = 940;
  const H = 520;
  const m = { t: 20, r: 24, b: 96, l: 54 };
  const plotBottom = H - m.b;
  const nilBandY = H - 54;

  const maxIncome = Math.max(...dots.map((p) => p.income), 1e9);
  const minIncome = Math.min(...dots.map((p) => p.income), 1e8);
  const x = logScale([minIncome, maxIncome], [m.l, W - m.r]);
  const maxRate = Math.min(60, Math.max(35, ...withRate.map((p) => p.rate!)));
  const yr = linearScale([0, maxRate], [plotBottom, m.t]);

  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label',
    `Total income against effective tax rate for ${dots.length} companies in ${y}, with a separate band for nil payers`);

  for (const tick of niceTicks(maxRate, 6)) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: yr(tick), y2: yr(tick), class: 'gridline' }));
    svg.append(el('text', { x: m.l - 8, y: yr(tick) + 4, 'text-anchor': 'end', 'font-size': 10 }, `${tick.toFixed(0)}%`));
  }
  svg.append(el('line', {
    x1: m.l, x2: W - m.r, y1: yr(30), y2: yr(30), stroke: 'var(--accent-primary)',
    'stroke-dasharray': '5 4', 'stroke-width': 1.4,
  }));
  // Sits BELOW the line and inset from the right edge: the zoom controls are
  // absolutely positioned in the top-right corner of this container, and an
  // end-anchored label at the top of the plot runs straight under them.
  svg.append(el('text', {
    x: W - m.r - 52, y: yr(30) + 15, 'text-anchor': 'end', 'font-size': 10,
    fill: 'var(--accent-primary)', 'font-weight': 650,
  }, '30% statutory rate'));

  for (const tick of powerTicks(minIncome, maxIncome)) {
    if (tick < minIncome) continue;
    svg.append(el('line', { x1: x(tick), x2: x(tick), y1: m.t, y2: plotBottom, class: 'gridline' }));
    svg.append(el('text', {
      x: x(tick), y: plotBottom + 15, 'text-anchor': 'middle', 'font-size': 10,
    }, moneyShort(tick)));
  }
  svg.append(el('text', {
    x: (m.l + W - m.r) / 2, y: plotBottom + 32, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600,
  }, 'Total income (log scale) — gross revenue, not profit'));

  // THE AXIS BREAK. Explicit, labelled, and physically separated, so nobody can
  // mistake the nil band for "an effective rate of about zero".
  svg.append(el('path', {
    d: `M${m.l - 6},${nilBandY - 20} l12,-5 M${m.l - 6},${nilBandY - 14} l12,-5`,
    stroke: 'var(--border-strong)', 'stroke-width': 1.4, fill: 'none',
  }));
  svg.append(el('line', {
    x1: m.l, x2: W - m.r, y1: nilBandY, y2: nilBandY, stroke: 'var(--nil)', 'stroke-width': 1, opacity: 0.35,
  }));
  svg.append(el('text', {
    x: m.l - 8, y: nilBandY + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--nil)', 'font-weight': 650,
  }, 'nil'));

  // The paid-but-no-taxable-income band, drawn only when it has members.
  if (noBase.length) {
    svg.append(el('line', {
      x1: m.l, x2: W - m.r, y1: nilBandY - 26, y2: nilBandY - 26,
      stroke: 'var(--accent-brass)', 'stroke-width': 1, opacity: 0.35,
    }));
    const lbl = el('text', {
      x: m.l - 8, y: nilBandY - 22, 'text-anchor': 'end', 'font-size': 9,
      fill: 'var(--paid-deep)', 'font-weight': 650,
    }, 'no base');
    lbl.setAttribute('data-tip', tipAttr([
      'Paid tax, but reported no taxable income',
      `${noBase.length} compan${noBase.length === 1 ? 'y' : 'ies'} in ${yearLabel(y)}.`,
      'There is no rate to compute, so they cannot sit on the axis — and they are not nil payers either.',
    ]));
    svg.append(lbl);
  }

  const plot = el('g', {});
  const draw = (p: Dot, cy: number, isNil: boolean) => {
    const colour = isNil ? 'var(--nil)' : sectorOf(b, p.e.sector).colour;
    const dot = el('circle', {
      cx: x(p.income), cy, r: isNil ? 3.4 : 3.8, fill: colour,
      opacity: isNil ? 0.6 : 0.72, class: 'mark',
    });
    dot.setAttribute('data-tip', tipAttr([
      p.e.name,
      sectorOf(b, p.e.sector).label,
      `Total income ${moneyShort(p.income)}`,
      `Taxable income ${p.taxable > 0 ? moneyShort(p.taxable) : 'nil'}`,
      `Tax payable ${p.tax > 0 ? moneyShort(p.tax) : 'nil'}`,
      p.rate === null ? 'No taxable income, so no effective rate' : `Effective rate ${pct1(p.rate)}`,
      'Click for the full history',
    ]));
    dot.style.cursor = 'pointer';
    dot.addEventListener('click', () => openCompany(b, p.e));
    plot.append(dot);
  };

  for (const p of withRate) draw(p, yr(Math.min(p.rate!, maxRate)), false);
  // Jitter both bands vertically so overlapping companies stay separable.
  nils.forEach((p, i) => draw(p, nilBandY + ((i % 5) - 2) * 3.2, true));
  noBase.forEach((p, i) => draw(p, nilBandY - 26 + ((i % 3) - 1) * 3.2, false));
  svg.append(plot);

  root.innerHTML = `
    <div class="view-head">
      <h2>Size against rate</h2>
      <p>Every company in one year, plotted by how much came in and what share of its taxable income it owed
        in tax. The cluster along the 30% line is the ordinary case; the interesting companies are the ones
        that are not on it.</p>
    </div>

    <div class="controls">
      <div class="control-group">
        <label class="control-label" for="r-year">Income year</label>
        <select id="r-year">
          ${b.years.slice().reverse().map((v) =>
    `<option value="${v}"${v === y ? ' selected' : ''}>${yearLabel(v)}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label class="control-label" for="r-sector">Sector</label>
        <select id="r-sector">
          <option value="all">All sectors</option>
          ${b.meta.sectors.map((s) =>
    `<option value="${s.id}"${sectorFilter === s.id ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-value">${num(dots.length)}</div>
        <div class="stat-label">Companies plotted</div>
        <div class="stat-note">${yearLabel(y)}${sectorFilter === 'all' ? '' : `, ${escapeHtml(sectorOf(b, sectorFilter).label)}`}</div></div>
      <div class="stat is-nil"><div class="stat-value">${num(nils.length)}</div>
        <div class="stat-label">Reported nil tax</div>
        <div class="stat-note">${pct1((nils.length / Math.max(1, dots.length)) * 100)} of those plotted${noBase.length
    ? `; a further ${num(noBase.length)} paid tax with no taxable income` : ''}</div></div>
      <div class="stat is-nil"><div class="stat-value">${num(bigNils.length)}</div>
        <div class="stat-label">Nil on $1b+ of income</div>
        <div class="stat-note">reported nil tax payable</div></div>
      <div class="stat is-paid"><div class="stat-value">${pct1(median(withRate.filter((p) => p.tax > 0).map((p) => p.rate!)))}</div>
        <div class="stat-label">Median effective rate</div>
        <div class="stat-note">among companies that paid tax</div></div>
    </div>

    <div class="panel">
      <div class="chart-title">Total income against effective tax rate, ${yearLabel(y)}</div>
      <div class="section-sub">Scroll to zoom, drag to pan, double-click to reset. Colour is sector.
        Companies in the <strong style="color:var(--nil)">nil band</strong> below the axis break reported no
        <button type="button" class="glossary-link" data-term="tax-payable">tax payable</button> at all — they sit below the
        break rather than at 0% because most of them have no taxable income to compute a rate from.
        ${noBase.length ? `The thin <strong style="color:var(--paid-deep)">no base</strong> band just above it
        holds the ${num(noBase.length)} compan${noBase.length === 1 ? 'y' : 'ies'} that paid tax while
        reporting no taxable income — offsets and consolidation adjustments do that, and there is no rate to
        plot for them either.` : ''} Click any dot to open the company.</div>
      <div class="scroller"><div id="r-chart" class="chart-wrap" style="min-width:900px;position:relative"></div></div>
      <div class="legend" id="r-legend"></div>
    </div>

    <div class="panel">
      <div class="section-title">Nil tax on a billion dollars or more of income, ${yearLabel(y)}</div>
      <div class="section-sub">${num(bigNils.length)} compan${bigNils.length === 1 ? 'y' : 'ies'}.
        Remember what <button type="button" class="glossary-link" data-term="total-income">total income</button> is: gross
        revenue — a company can turn over $2 billion and make a loss.
        ${(() => {
    // Two different situations, and one caption cannot cover both honestly.
    const noTaxable = bigNils.filter((p) => p.taxable <= 0).length;
    const someTaxable = bigNils.length - noTaxable;
    return someTaxable > 0
      ? `${num(noTaxable)} of these reported no taxable income, which is consistent with a
          <button type="button" class="glossary-link" data-term="losses">loss</button>. The other ${num(someTaxable)}
          reported taxable income and <em>still</em> owed nil — a loss cannot explain that, and offsets such
          as <button type="button" class="glossary-link" data-term="franking">franking credits</button> or the research and
          development incentive can.`
      : 'All of them reported no taxable income, which is consistent with a loss.';
  })()}</div>
      <div class="scroller"><table class="data">
        <thead><tr><th>Company</th><th class="n">Total income</th><th class="n">Taxable income</th>
          <th class="n">Tax payable</th></tr></thead>
        <tbody>${bigNils.sort((a, z) => z.income - a.income).slice(0, 60).map((p) => `
          <tr class="clickable" data-id="${p.e.id}" tabindex="0">
            <td class="name-cell">${escapeHtml(p.e.name)}</td>
            <td class="n">${moneyShort(p.income)}</td>
            <td class="n">${p.taxable > 0 ? moneyShort(p.taxable) : '<span class="cell-nil">nil</span>'}</td>
            <td class="n"><span class="cell-nil">nil</span></td>
          </tr>`).join('') || '<tr><td colspan="4" class="empty-state">None in this selection.</td></tr>'}</tbody>
      </table></div>
    </div>`;

  const host = root.querySelector<HTMLElement>('#r-chart')!;
  host.append(svg);
  attachSvgZoom(svg);

  const present = new Set(dots.map((p) => p.e.sector));
  root.querySelector('#r-legend')!.innerHTML = b.meta.sectors.filter((s) => present.has(s.id)).map((s) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${s.colour}"></span>${escapeHtml(s.label)}</span>`)
    .join('') + '<span class="legend-item"><span class="legend-swatch" style="background:var(--nil)"></span>Nil tax payable</span>';

  root.querySelector<HTMLSelectElement>('#r-year')!.addEventListener('change', (ev) => {
    year = (ev.target as HTMLSelectElement).value;
    renderRates(root, b);
  });
  root.querySelector<HTMLSelectElement>('#r-sector')!.addEventListener('change', (ev) => {
    sectorFilter = (ev.target as HTMLSelectElement).value;
    renderRates(root, b);
  });
  root.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    const go = () => openCompany(b, b.entities[Number(tr.dataset.id)]);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
    });
  });
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
