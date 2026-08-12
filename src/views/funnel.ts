// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// FUNNEL — the view that stops this site being a tabloid.
// Question it answers: "where does $3.3 trillion of company income go before
// any tax is charged?" Two drops: income → taxable income (costs, deductions,
// carried-forward losses), and taxable income → tax payable (offsets, rate).
// Next action: the year selector, and the trend chart underneath it.

import type { Bundle } from '../data';
import { escapeHtml, moneyShort, num, pct1, tipAttr, yearLabel } from '../format';
import { el, linearScale, niceTicks, polyline, ribbon, svgRoot } from '../svg';

let selectedYear: string | null = null;

function sankey(b: Bundle, year: string): SVGSVGElement {
  const t = b.totals.get(year)!;
  const W = 900;
  const H = 300;
  const top = 34;
  const bandH = H - top - 46;
  const colW = 108;
  const xs = [40, (W - colW) / 2, W - colW - 40];

  const max = t.total;
  const h = (v: number) => Math.max(2, (v / max) * bandH);

  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label',
    `${year}: total income ${moneyShort(t.total)} reduces to taxable income ${moneyShort(t.taxable)} `
    + `and then to tax payable ${moneyShort(t.payable)}`);

  const nodes = [
    { x: xs[0], v: t.total, label: 'Total income', colour: 'var(--income)', term: 'total-income' },
    { x: xs[1], v: t.taxable, label: 'Taxable income', colour: 'var(--taxable)', term: 'taxable-income' },
    { x: xs[2], v: t.payable, label: 'Tax payable', colour: 'var(--paid)', term: 'tax-payable' },
  ];
  const ys = nodes.map((n) => top + (bandH - h(n.v)) / 2);

  // Links first so the node blocks sit on top of them.
  for (let i = 0; i < 2; i++) {
    const a = nodes[i];
    const z = nodes[i + 1];
    const link = el('path', {
      d: ribbon(a.x + colW, ys[i], ys[i] + h(a.v), z.x, ys[i + 1], ys[i + 1] + h(z.v)),
      fill: i === 0 ? 'var(--taxable)' : 'var(--paid)', opacity: 0.22,
    });
    const lost = a.v - z.v;
    link.setAttribute('data-tip', tipAttr(i === 0
      ? [`${moneyShort(a.v)} of income becomes ${moneyShort(z.v)} of taxable income`,
        `${moneyShort(lost)} (${pct1((lost / a.v) * 100)}) is the cost of doing business:`,
        'wages, stock, interest, depreciation, and losses carried forward from earlier years.']
      : [`${moneyShort(a.v)} of taxable income yields ${moneyShort(z.v)} of tax`,
        `An effective rate of ${pct1((z.v / a.v) * 100)} against a 30% statutory rate.`,
        'The difference is offsets — franking credits, R&D incentive, foreign tax offsets.']));
    svg.append(link);
  }

  nodes.forEach((n, i) => {
    const block = el('rect', {
      x: n.x, y: ys[i], width: colW, height: h(n.v), fill: n.colour, rx: 3, class: 'mark',
    });
    /*
     * The denominator is PER NODE, and that is not a nicety.
     *
     * A single "% of total income" line applied to every block renders the tax
     * node as "2.9% of total income" — the exact ratio this site tells the
     * reader is meaningless and refuses to publish, contradicting itself two
     * panels above. Tax is only ever expressed against taxable income.
     */
    const denominator = i === 2
      ? `${pct1((n.v / t.taxable) * 100)} of taxable income — the effective rate`
      : i === 1
        ? `${pct1((n.v / t.total) * 100)} of total income`
        : 'gross revenue, before any costs — not profit';
    block.setAttribute('data-tip', tipAttr([
      `${n.label}, ${yearLabel(year)}`,
      moneyShort(n.v),
      denominator,
    ]));
    svg.append(block);

    svg.append(el('text', {
      x: n.x + colW / 2, y: top - 18, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 650,
      fill: 'var(--text-primary)',
    }, n.label));
    svg.append(el('text', {
      x: n.x + colW / 2, y: top - 4, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700,
      fill: n.colour, 'font-family': 'var(--font-mono)',
    }, moneyShort(n.v)));
  });

  // The two drops, labelled where they happen.
  const drops = [
    { x: (xs[0] + colW + xs[1]) / 2, from: t.total, to: t.taxable, why: 'costs, deductions, prior-year losses' },
    { x: (xs[1] + colW + xs[2]) / 2, from: t.taxable, to: t.payable, why: 'offsets and the tax rate' },
  ];
  drops.forEach((dr) => {
    svg.append(el('text', {
      x: dr.x, y: H - 26, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 650, fill: 'var(--text-primary)',
    }, `−${pct1(((dr.from - dr.to) / dr.from) * 100)}`));
    svg.append(el('text', {
      x: dr.x, y: H - 12, 'text-anchor': 'middle', 'font-size': 10,
    }, dr.why));
  });

  return svg;
}

/** Effective rate over time — the one series that is safe across the threshold change. */
function rateTrend(b: Bundle): SVGSVGElement {
  const W = 900;
  const H = 240;
  const m = { t: 16, r: 20, b: 34, l: 46 };
  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', 'Effective tax rate — tax payable as a share of taxable income — by year');

  const pts = b.years.map((y) => {
    const t = b.totals.get(y)!;
    return { year: y, rate: t.taxable > 0 ? (t.payable / t.taxable) * 100 : 0 };
  });
  const maxRate = Math.max(32, ...pts.map((p) => p.rate));
  const x = linearScale([0, b.years.length - 1], [m.l, W - m.r]);
  const y = linearScale([0, maxRate], [H - m.b, m.t]);

  for (const tick of niceTicks(maxRate, 5)) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(tick), y2: y(tick), class: 'gridline' }));
    svg.append(el('text', { x: m.l - 8, y: y(tick) + 4, 'text-anchor': 'end', 'font-size': 10 }, `${tick.toFixed(0)}%`));
  }

  // The 30% statutory rate, as the reference every reader actually has.
  svg.append(el('line', {
    x1: m.l, x2: W - m.r, y1: y(30), y2: y(30), stroke: 'var(--nil)', 'stroke-dasharray': '5 4', 'stroke-width': 1.4,
  }));
  svg.append(el('text', {
    x: W - m.r, y: y(30) - 6, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--nil)', 'font-weight': 650,
  }, '30% statutory rate'));

  svg.append(el('path', {
    d: polyline(pts.map((p, i) => [x(i), y(p.rate)])),
    fill: 'none', stroke: 'var(--paid)', 'stroke-width': 2.4, 'stroke-linejoin': 'round',
  }));

  pts.forEach((p, i) => {
    const dot = el('circle', { cx: x(i), cy: y(p.rate), r: 5, fill: 'var(--paid)', class: 'mark' });
    dot.setAttribute('data-tip', tipAttr([
      yearLabel(p.year),
      `Effective rate ${pct1(p.rate)}`,
      `${moneyShort(b.totals.get(p.year)!.payable)} of tax on ${moneyShort(b.totals.get(p.year)!.taxable)} of taxable income`,
    ]));
    svg.append(dot);
    if (i % 2 === 0 || i === pts.length - 1) {
      svg.append(el('text', {
        x: x(i), y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 10,
      }, p.year.slice(2)));
    }
  });

  return svg;
}

export function renderFunnel(root: HTMLElement, b: Bundle): void {
  const year = selectedYear && b.years.includes(selectedYear) ? selectedYear : b.meta.latestYear;
  selectedYear = year;
  const t = b.totals.get(year)!;
  const anchor = b.meta.anchors.find((a) => a.year === year) ?? null;

  root.innerHTML = `
    <div class="view-head">
      <h2>Where the money goes</h2>
      <p>The gap between what companies take in and what they pay tax on is mostly the cost of running a
        business, not avoidance. This view puts both drops on the screen at once, with sizes.</p>
    </div>

    <div class="controls">
      <div class="control-group">
        <label class="control-label" for="f-year">Income year</label>
        <select id="f-year">
          ${b.years.slice().reverse().map((y) =>
    `<option value="${y}"${y === year ? ' selected' : ''}>${yearLabel(y)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="panel">
      <div class="chart-title">From income to tax, ${yearLabel(year)}</div>
      <div class="section-sub">Band height is proportional to dollars. Hover any block or ribbon for the
        exact figures and what drives each drop.</div>
      <div class="scroller"><div id="f-sankey" class="chart-wrap" style="min-width:660px"></div></div>
      <div class="legend">
        <span class="legend-item"><span class="legend-swatch" style="background:var(--income)"></span>
          <button type="button" class="glossary-link" data-term="total-income">Total income</button></span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--taxable)"></span>
          <button type="button" class="glossary-link" data-term="taxable-income">Taxable income</button></span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--paid)"></span>
          <button type="button" class="glossary-link" data-term="tax-payable">Tax payable</button></span>
      </div>
    </div>

    <div class="panel">
      <div class="chart-title">Effective tax rate, 2013–14 to ${yearLabel(b.meta.latestYear)}</div>
      <div class="section-sub">Tax payable as a share of
        <button type="button" class="glossary-link" data-term="taxable-income">taxable income</button>. This is the one headline
        series that is safe to read straight across the
        <button type="button" class="glossary-link" data-term="threshold">2022–23 reporting-threshold change</button>, because it
        is a ratio rather than a count — adding a thousand smaller companies barely moves it.</div>
      <div class="scroller"><div id="f-rate" class="chart-wrap" style="min-width:660px"></div></div>
    </div>

    ${anchor ? `<div class="callout" style="margin-top:var(--space-lg)">
      <strong>The middle number is bigger than the ATO's own, and the gap is the losses.</strong>
      Adding up the taxable-income column of the published spreadsheet for ${yearLabel(year)} gives
      ${moneyShort(t.taxable)}; the ATO's report commentary states ${moneyShort(anchor.taxable)} — our sum is
      ${pct1((t.taxable / anchor.taxable - 1) * 100)} <em>higher</em>.
      ${year === b.meta.latestYear
    ? `Total income and tax payable reconcile with the ATO exactly (${moneyShort(t.total)} and
       ${moneyShort(t.payable)} against ${moneyShort(anchor.total)} and ${moneyShort(anchor.payable)}), so the
       columns are being read correctly.`
    : `Total income and tax payable sit slightly <em>above</em> the figures published with the
       ${yearLabel(year)} report (${moneyShort(t.total)} and ${moneyShort(t.payable)} against
       ${moneyShort(anchor.total)} and ${moneyShort(anchor.payable)}), because this site applies the
       <button type="button" class="glossary-link" data-term="amendment">late lodgers</button> that appeared in
       later reports. That is an addition of real companies, not a discrepancy.`}
      The taxable-income difference is something else, and it is definitional:
      the law only requires a taxable income to be published where it is a positive amount, so a company with
      a <button type="button" class="glossary-link" data-term="losses">tax loss</button> appears as a blank and the column can
      only ever sum upwards. The ATO's aggregate nets those losses off — which is why its own industry table
      can show a whole segment as <em>negative</em>. The ${moneyShort(t.taxable - anchor.taxable)} gap in
      ${yearLabel(year)} is essentially the population's aggregate tax losses. Read the effective rate above
      as a floor: measured against the ATO's net figure it is
      ${pct1((t.payable / anchor.taxable) * 100)}.
    </div>` : ''}

    <div class="panel">
      <div class="section-title">The same year in words</div>
      <div class="section-sub">For ${yearLabel(year)}, across ${num(t.entities)} companies.</div>
      <dl class="kv" style="max-width:640px">
        <dt><button type="button" class="glossary-link" data-term="total-income">Total income</button></dt><dd>${moneyShort(t.total)}</dd>
        <dt><button type="button" class="glossary-link" data-term="taxable-income">Taxable income</button></dt><dd>${moneyShort(t.taxable)}</dd>
        <dt>Share of income that is taxable</dt><dd>${pct1((t.taxable / t.total) * 100)}</dd>
        <dt><button type="button" class="glossary-link" data-term="tax-payable">Tax payable</button></dt><dd>${moneyShort(t.payable)}</dd>
        <dt><button type="button" class="glossary-link" data-term="effective-rate">Effective rate</button></dt><dd>${pct1((t.payable / t.taxable) * 100)}</dd>
        <dt>Companies reporting <button type="button" class="glossary-link" data-term="nil">nil tax</button></dt>
          <dd>${num(t.nil)} (${pct1((t.nil / t.entities) * 100)})</dd>
      </dl>
    </div>`;

  root.querySelector('#f-sankey')!.append(sankey(b, year));
  root.querySelector('#f-rate')!.append(rateTrend(b));
  root.querySelector<HTMLSelectElement>('#f-year')!.addEventListener('change', (ev) => {
    selectedYear = (ev.target as HTMLSelectElement).value;
    renderFunnel(root, b);
  });
  void escapeHtml;
}
