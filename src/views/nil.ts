// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// NIL — the streak grid.
// Question it answers: "who reports nil tax payable, year after year?"
// No other view can show a STREAK: a bar chart of nil-tax companies tells you a
// count, and a table tells you a year, but only the grid shows that a company
// has reported nil in every single year it has appeared.
// Next action: click a name or a cell to open that company's history.

import type { Bundle, Entity } from '../data';
import { d } from '../data';
import { openCompany } from '../drilldown';
import { escapeHtml, money, moneyShort, num, pct1, tipAttr, tipHtml, yearLabel } from '../format';
import { el, linearScale, niceTicks, polyline, svgRoot } from '../svg';

let minYears = 6;

/**
 * The count of nil-tax companies, drawn against the population that produced
 * it. Plotting the count alone across 2022-23 would show a dramatic jump that
 * is entirely the reporting-threshold cut — so the SHARE is the primary series
 * and the raw count is the secondary one, explicitly labelled as confounded.
 */
function nilTrend(b: Bundle): SVGSVGElement {
  const W = 900;
  const H = 260;
  const m = { t: 18, r: 54, b: 40, l: 48 };
  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', 'Share and count of companies reporting nil tax, by year');

  const pts = b.years.map((y) => {
    const t = b.totals.get(y)!;
    return { year: y, share: (t.nil / t.entities) * 100, count: t.nil, entities: t.entities };
  });
  const maxShare = Math.max(...pts.map((p) => p.share)) * 1.15;
  const maxCount = Math.max(...pts.map((p) => p.count)) * 1.15;
  const x = linearScale([0, b.years.length - 1], [m.l, W - m.r]);
  const yShare = linearScale([0, maxShare], [H - m.b, m.t]);
  const yCount = linearScale([0, maxCount], [H - m.b, m.t]);

  for (const tick of niceTicks(maxShare, 4)) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: yShare(tick), y2: yShare(tick), class: 'gridline' }));
    svg.append(el('text', {
      x: m.l - 8, y: yShare(tick) + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--nil)',
    }, `${tick.toFixed(0)}%`));
  }

  // The threshold break, drawn on the chart rather than footnoted under it.
  const bi = b.years.indexOf(b.meta.thresholdChangeYear);
  if (bi > 0) {
    const bx = (x(bi - 1) + x(bi)) / 2;
    svg.append(el('line', {
      x1: bx, x2: bx, y1: m.t - 6, y2: H - m.b, stroke: 'var(--border-strong)', 'stroke-dasharray': '4 4',
    }));
    const flag = el('text', {
      x: bx + 5, y: m.t + 4, 'font-size': 10, 'font-weight': 650, fill: 'var(--text-primary)',
    }, 'threshold cut →');
    flag.setAttribute('data-tip', tipAttr([
      'Reporting threshold cut, 2022-23',
      'Australian-owned private companies became reportable at $100m of total income instead of $200m.',
      'That added over a thousand companies at once — the COUNT series jumps here for that reason alone.',
    ]));
    svg.append(flag);
  }

  svg.append(el('path', {
    d: polyline(pts.map((p, i) => [x(i), yCount(p.count)])),
    fill: 'none', stroke: 'var(--text-tertiary)', 'stroke-width': 1.8, 'stroke-dasharray': '4 3',
  }));
  svg.append(el('path', {
    d: polyline(pts.map((p, i) => [x(i), yShare(p.share)])),
    fill: 'none', stroke: 'var(--nil)', 'stroke-width': 2.6, 'stroke-linejoin': 'round',
  }));

  pts.forEach((p, i) => {
    const dot = el('circle', { cx: x(i), cy: yShare(p.share), r: 5, fill: 'var(--nil)', class: 'mark' });
    dot.setAttribute('data-tip', tipAttr([
      yearLabel(p.year),
      `${pct1(p.share)} of companies reported nil tax`,
      `${num(p.count)} of ${num(p.entities)} companies`,
    ]));
    svg.append(dot);
    const gh = el('circle', { cx: x(i), cy: yCount(p.count), r: 3.5, fill: 'var(--text-tertiary)', class: 'mark' });
    gh.setAttribute('data-tip', tipAttr([
      yearLabel(p.year),
      `${num(p.count)} companies reported nil tax`,
      'The count is not comparable across 2022-23 — the reporting threshold changed.',
    ]));
    svg.append(gh);
    if (i % 2 === 0 || i === pts.length - 1) {
      svg.append(el('text', { x: x(i), y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 10 }, p.year.slice(2)));
    }
  });

  for (const tick of niceTicks(maxCount, 4)) {
    svg.append(el('text', {
      x: W - m.r + 8, y: yCount(tick) + 4, 'font-size': 10, fill: 'var(--text-tertiary)',
    }, num(Math.round(tick))));
  }

  return svg;
}

function streakRow(b: Bundle, e: Entity): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'streak-row';

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'streak-name link-btn';
  name.textContent = e.name;
  name.setAttribute('data-tip', tipAttr([
    e.name,
    `${moneyShort(e.totalIncome)} of total income across ${e.yearsPresent} years`,
    'Tax payable: nil in every year it appears',
    'Click for the full history',
  ]));
  name.addEventListener('click', () => openCompany(b, e));

  const cells = document.createElement('div');
  cells.className = 'streak-cells';
  for (const year of b.years) {
    const row = e.rows.find((r) => r.year === year);
    // A real <button>, not a <span>. The per-year figures exist ONLY in the
    // hover tooltip, so as spans they were unreachable by keyboard, invisible
    // to a screen reader and unavailable on touch. The aria-label carries the
    // same text the tooltip does.
    const cell = document.createElement('button');
    cell.type = 'button';
    if (!row) {
      cell.className = 'streak-cell is-absent';
      cell.disabled = true;
      const text = [`${e.name} — ${yearLabel(year)}`,
        'Not in the report this year (below the reporting threshold, or not lodged).'];
      cell.setAttribute('data-tip', tipAttr(text));
      cell.setAttribute('aria-label', text.join('. '));
    } else {
      const paid = d(row.payable) > 0;
      cell.className = `streak-cell ${paid ? 'is-paid' : 'is-nil'}`;
      const text = [
        `${e.name} — ${yearLabel(year)}`,
        `Total income ${money(row.total)}`,
        `Taxable income ${money(row.taxable)}`,
        `Tax payable ${money(row.payable)}`,
      ];
      cell.setAttribute('data-tip', tipAttr(text));
      cell.setAttribute('aria-label', `${text.join('. ')}. Open full history.`);
      cell.addEventListener('click', () => openCompany(b, e));
    }
    cells.append(cell);
  }

  wrap.append(name, cells);
  return wrap;
}

export function renderNil(root: HTMLElement, b: Bundle): void {
  const never = b.entities
    .filter((e) => e.neverPaid && e.yearsPresent >= minYears)
    .sort((a, z) => z.yearsPresent - a.yearsPresent || z.totalIncome - a.totalIncome);
  const allEleven = b.entities.filter((e) => e.neverPaid && e.yearsPresent === b.years.length);
  const elevenIncome = allEleven.reduce((s, e) => s + e.totalIncome, 0);
  const t = b.totals.get(b.meta.latestYear)!;

  root.innerHTML = `
    <div class="view-head">
      <h2>Nil, year after year</h2>
      <p>Reporting <button type="button" class="glossary-link" data-term="nil">nil company tax</button> is lawful and ordinary —
        <button type="button" class="glossary-link" data-term="losses">losses</button>, losses carried forward from earlier
        years, and offsets such as <button type="button" class="glossary-link" data-term="franking">franking credits</button>
        and the research and development incentive all produce it. Doing it every single year for a decade, on
        billions of dollars of income, is a different kind of fact. Note the wording throughout: these
        companies <em>reported nil tax payable</em>, which is not the same as saying no tax was paid on their
        profits by anyone.</p>
    </div>

    <div class="stat-row">
      <div class="stat is-nil"><div class="stat-value">${num(allEleven.length)}</div>
        <div class="stat-label">Nil in all ${b.years.length} years</div>
        <div class="stat-note">present and nil in every report</div></div>
      <div class="stat"><div class="stat-value">${moneyShort(elevenIncome)}</div>
        <div class="stat-label">Their combined income</div>
        <div class="stat-note">gross revenue over eleven years</div></div>
      <div class="stat is-nil"><div class="stat-value">${pct1((t.nil / t.entities) * 100)}</div>
        <div class="stat-label">Nil in ${yearLabel(b.meta.latestYear)}</div>
        <div class="stat-note">${num(t.nil)} of ${num(t.entities)} companies</div></div>
      <div class="stat"><div class="stat-value">${pct1((b.totals.get(b.years[0])!.nil / b.totals.get(b.years[0])!.entities) * 100)}</div>
        <div class="stat-label">Nil in 2013–14</div>
        <div class="stat-note">the share has fallen, not risen</div></div>
    </div>

    <div class="callout warn">
      <strong>The headline everyone reaches for is the wrong way round.</strong> The <em>number</em> of
      companies reporting nil tax has gone up, from ${num(b.totals.get(b.years[0])!.nil)} to ${num(t.nil)}.
      The <em>share</em> has gone <em>down</em>, from
      ${pct1((b.totals.get(b.years[0])!.nil / b.totals.get(b.years[0])!.entities) * 100)} to
      ${pct1((t.nil / t.entities) * 100)}. The count rose mainly because the
      <button type="button" class="glossary-link" data-term="threshold">reporting threshold was cut in 2022–23</button>, pulling
      more than a thousand additional companies into the report at once. A count trended across that line is
      measuring a change in the law.
    </div>

    <div class="panel">
      <div class="chart-title">Nil-tax companies, share and count</div>
      <div class="section-sub">Solid red, left axis: the share of companies reporting nil. Dashed grey, right
        axis: the raw count — shown because people quote it, and drawn dashed because it is not comparable
        across the marked threshold change.</div>
      <div class="scroller"><div id="n-trend" class="chart-wrap" style="min-width:660px"></div></div>
    </div>

    <div class="panel">
      <div class="chart-title">Companies reporting nil in every year on record</div>
      <div class="section-sub">One row per company, one cell per year, oldest on the left.
        <span style="color:var(--nil);font-weight:650">Red</span> is a year reporting nil tax; a dashed outline
        means the company was not in the report that year at all. Ranked by how many years the streak runs,
        then by income. Click any name or cell for the full history.</div>

      <div class="controls">
        <div class="control-group">
          <label class="control-label" for="n-min">Minimum years in the report</label>
          <select id="n-min">
            ${[11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((v) =>
    `<option value="${v}"${v === minYears ? ' selected' : ''}>${v}+ years</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="n-count" class="section-sub" role="status"></div>

      <!-- ABOVE the grid, not below it. The grid runs to hundreds of rows, so a
           caveat placed underneath is several screens away from most of the
           names it applies to — and this list is the part of the site a reader
           is most likely to screenshot. -->
      <div class="callout">
        <strong>Every company on this list has a lawful explanation available to it, and this site does not
        know which one applies.</strong> A company working through accumulated
        <button type="button" class="glossary-link" data-term="losses">losses</button> reports nil until they are used up. A
        company whose income is largely dividends from other Australian companies may owe nothing further
        because <button type="button" class="glossary-link" data-term="franking">the tax was already paid</button>. Others are
        reducing a bill to nil with the research and development incentive. Nil <em>reported</em> tax is not
        the same as no tax paid on those profits by anyone. Treat this as a list of questions.
      </div>

      <div class="legend" style="margin-top:0;margin-bottom:var(--space-md)">
        <span class="legend-item"><span class="legend-swatch" style="background:var(--nil)"></span> Reported nil tax payable — every company here did so in every year it appears</span>
        <span class="legend-item"><span class="legend-swatch" style="background:transparent;border:1px dashed var(--border-default)"></span> Not in the report</span>
      </div>
      <div class="streak-grid" id="n-grid"></div>
    </div>`;

  root.querySelector('#n-trend')!.append(nilTrend(b));

  const grid = root.querySelector<HTMLElement>('#n-grid')!;
  const count = root.querySelector<HTMLElement>('#n-count')!;
  const RENDER_CAP = 250;
  const draw = (): void => {
    // Count and sum over the FULL filtered set, then slice only for rendering.
    // Reading `.length` off the sliced array printed the cap as if it were a
    // finding: at "2+ years" it said "250 companies" when the real answer is in
    // the hundreds more. A cap that is silently reported as a total is exactly
    // the kind of truncation that reads as complete coverage.
    const full = b.entities
      .filter((e) => e.neverPaid && e.yearsPresent >= minYears)
      .sort((a, z) => z.yearsPresent - a.yearsPresent || z.totalIncome - a.totalIncome);
    const list = full.slice(0, RENDER_CAP);
    // Split the list by WHY nil is possible. A loss explains a company with no
    // taxable income; it cannot explain one that reported taxable income and
    // still owed nothing — only offsets do that, and it is a large minority
    // here. Stating one explanation for both would be wrong for hundreds of
    // named companies.
    const withTaxable = full.filter((e) => e.totalTaxable > 0).length;
    count.innerHTML = `${num(full.length)} compan${full.length === 1 ? 'y' : 'ies'} appeared in at least
      ${minYears} annual reports and reported nil company tax in every one of them, on
      ${moneyShort(full.reduce((s, e) => s + e.totalIncome, 0))} of combined gross income.
      ${withTaxable > 0 ? `${num(full.length - withTaxable)} of them reported no taxable income at all,
      consistent with a loss; the other ${num(withTaxable)} <em>did</em> report taxable income and still owed
      nil, which losses cannot explain and offsets can.` : ''}
      ${full.length > RENDER_CAP
    ? `<strong>The ${num(RENDER_CAP)} longest streaks are drawn below</strong> — raise the minimum-years
       filter to see fewer, longer ones.` : ''}`;
    grid.innerHTML = '';
    for (const e of list) grid.append(streakRow(b, e));
  };

  root.querySelector<HTMLSelectElement>('#n-min')!.addEventListener('change', (ev) => {
    minYears = Number((ev.target as HTMLSelectElement).value);
    draw();
  });

  draw();
  void never; void escapeHtml; void tipHtml;
}
