// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// The company drill-down drawer. Every view routes here, so a company clicked
// on the treemap, the scatter, the streak grid or the table opens exactly the
// same panel — the reader never has to learn two different detail layouts.

import { openDrawer } from './components/overlay';
import type { Bundle, Entity } from './data';
import { d, sectorOf } from './data';
import {
  abnLabel, effectiveRate, escapeHtml, money, moneyShort, pct1, safe, slug, textOn, tipAttr, yearLabel,
} from './format';
import { el, linearScale, svgRoot } from './svg';

let openHandle: { close(): void } | null = null;
let hashOnOpen = '';

export function closeDrilldown(): void {
  openHandle?.close();
  openHandle = null;
}

/**
 * A company drawer is a linkable thing.
 *
 * Most arrivals here are somebody searching a single company name, so an open
 * drawer writes itself into the URL — `#c=51004028077` — and the URL is
 * restored on close. That makes a specific company shareable and, more to the
 * point, indexable, which is the whole reason a 6,000-name search surface is
 * worth building.
 */
export function companyHash(e: Entity): string {
  return `#c=${e.abn ?? `n-${slug(e.name)}`}`;
}

export function findByHash(b: Bundle, hash: string): Entity | null {
  const m = hash.match(/^#c=(.+)$/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]);
  if (/^\d{11}$/.test(key)) return b.entities.find((e) => e.abn === key) ?? null;
  const name = key.replace(/^n-/, '');
  return b.entities.find((e) => slug(e.name) === name) ?? null;
}

/**
 * Small multiples of the company's whole published history.
 *
 * Income and tax are drawn on SEPARATE scales and labelled as such. Sharing one
 * scale would render every tax bar as an invisible sliver against gross income
 * — technically honest, visually useless, and it would hide the entire question
 * the reader came to answer.
 */
function historyChart(b: Bundle, e: Entity): SVGSVGElement {
  const W = 520;
  const rowH = 30;
  const H = b.years.length * rowH + 34;
  const labelW = 62;
  const gap = 12;
  const colW = (W - labelW - gap) / 2;

  const maxIncome = Math.max(...e.rows.map((r) => d(r.total)), 1);
  const maxTax = Math.max(...e.rows.map((r) => d(r.payable)), 1);
  const xInc = linearScale([0, maxIncome], [0, colW]);
  const xTax = linearScale([0, maxTax], [0, colW]);

  const svg = svgRoot(W, H);
  svg.setAttribute('aria-label', `${e.name}: total income and tax payable by year`);

  svg.append(el('text', { x: labelW, y: 11, 'font-size': 10, 'font-weight': 600 }, 'Total income'));
  svg.append(el('text', { x: labelW + colW + gap, y: 11, 'font-size': 10, 'font-weight': 600 }, 'Tax payable'));

  b.years.forEach((year, i) => {
    const y = 22 + i * rowH;
    const row = e.rows.find((r) => r.year === year);
    svg.append(el('text', { x: 0, y: y + 13, 'font-size': 10 }, yearLabel(year)));

    if (!row) {
      // Not in the report that year. Drawn as an explicit absence — never as a
      // zero bar, which would read as "earned nothing, paid nothing".
      svg.append(el('text', {
        x: labelW, y: y + 13, 'font-size': 10, fill: 'var(--text-muted)', 'font-style': 'italic',
      }, 'not in the report this year'));
      return;
    }

    const income = d(row.total);
    const tax = d(row.payable);
    const rate = effectiveRate(row.payable, row.taxable);

    const incBar = el('rect', {
      x: labelW, y: y + 3, width: Math.max(1, xInc(income)), height: 15,
      fill: 'var(--income)', rx: 2, class: 'bar',
    });
    incBar.setAttribute('data-tip', tipAttr([
      `${e.name} — ${yearLabel(year)}`,
      `Total income: ${money(row.total)}`,
      'Total income is gross revenue, not profit.',
    ]));
    svg.append(incBar);

    if (tax > 0) {
      const taxBar = el('rect', {
        x: labelW + colW + gap, y: y + 3, width: Math.max(1, xTax(tax)), height: 15,
        fill: 'var(--paid)', rx: 2, class: 'bar',
      });
      taxBar.setAttribute('data-tip', tipAttr([
        `${e.name} — ${yearLabel(year)}`,
        `Tax payable: ${money(row.payable)}`,
        `Taxable income: ${money(row.taxable)}`,
        rate === null ? 'No taxable income, so no effective rate' : `Effective rate: ${pct1(rate)}`,
      ]));
      svg.append(taxBar);
    } else {
      const nil = el('text', {
        x: labelW + colW + gap, y: y + 15, 'font-size': 10, fill: 'var(--nil)', 'font-weight': 600,
      }, 'nil');
      nil.setAttribute('data-tip', tipAttr([
        `${e.name} — ${yearLabel(year)}`,
        'Tax payable: nil',
        `Taxable income: ${money(row.taxable)}`,
        'Nil is lawful and common — losses, prior-year losses, or tax consolidation.',
      ]));
      svg.append(nil);
    }
  });

  void safe;
  return svg;
}

/**
 * The lawful-explanation caveat, and the rules about when it appears.
 *
 * This drawer is the screen that gets linked and screenshotted, so it is the
 * one screen where a bare "reported nil tax" figure must never stand alone.
 * Three things were wrong with an earlier version and each of them mattered:
 *
 * 1. It was gated on the company having NEVER paid, so a company that paid a
 *    token amount once and reported nil for the other nine years — Glencore
 *    Holdings, $28bn of taxable income against $90m of tax — got the raw
 *    figures with no explanation at all. It is now gated on the pattern, not
 *    on a perfect record.
 * 2. It offered only loss-based explanations. Losses cannot explain a company
 *    that reported POSITIVE taxable income and still owed nil, which is a large
 *    minority of this list; only offsets can. The wording now branches on which
 *    of those two situations the company is actually in.
 * 3. It fired an alarm-styled red callout for entities appearing in a SINGLE
 *    year, about which the site's own About panel says a single nil year means
 *    almost nothing. One or two years now gets a neutral note.
 */
function nilCaveat(e: Entity, nilYears: number): string {
  if (nilYears === 0) return '';
  const mostlyNil = nilYears >= 2 && nilYears / e.yearsPresent >= 0.5;
  if (!mostlyNil) return '';

  const hadTaxableIncome = e.totalTaxable > 0;
  const alarming = e.yearsPresent >= 3;
  const every = nilYears === e.yearsPresent;

  const lead = every
    ? `Reported nil company tax in every one of its ${e.yearsPresent} years in the report.`
    : `Reported nil company tax in ${nilYears} of its ${e.yearsPresent} years in the report.`;

  const why = hadTaxableIncome
    ? `It also reported ${money(e.totalTaxable)} of taxable income over the period, so a loss alone does not `
      + 'explain the result — offsets do. <button type="button" class="glossary-link" data-term="franking">Franking '
      + 'credits</button> on dividends already taxed, the research and development incentive and foreign '
      + 'income tax offsets all reduce a bill to nil lawfully.'
    : 'It reported no taxable income in those years, which is what a '
      + '<button type="button" class="glossary-link" data-term="losses">loss</button>, or losses carried forward from earlier '
      + 'years, looks like in this report.';

  if (!alarming) {
    return `<div class="callout" style="margin-top:var(--space-lg)">
      ${lead} It appears in only ${e.yearsPresent} report${e.yearsPresent === 1 ? '' : 's'}, so this says very
      little on its own. ${why}</div>`;
  }
  return `<div class="callout warn" style="margin-top:var(--space-lg)">
    <strong>${lead}</strong> That is lawful and has ordinary explanations. ${why}
    It is a question worth asking, not an answer.</div>`;
}

export function openCompany(b: Bundle, e: Entity, onClose?: () => void): void {
  closeDrilldown();

  const sector = sectorOf(b, e.sector);
  const paidYears = e.rows.filter((r) => d(r.payable) > 0).length;
  const nilYears = e.yearsPresent - paidYears;
  const rate = e.totalTaxable > 0 ? (e.totalPayable / e.totalTaxable) * 100 : null;
  const latest = e.rows.at(-1);

  const html = `
    <h3 id="dd-title">${escapeHtml(e.name)}</h3>
    <div class="drawer-sub">
      <span class="sector-pill" style="background:${sector.colour};color:${textOn(sector.colour)}">${escapeHtml(sector.label)}</span>
      &nbsp;ABN ${escapeHtml(abnLabel(e.abn))} ·
      in the report for ${e.yearsPresent} of ${b.years.length} years
    </div>

    <dl class="kv">
      <dt>Total income, all years</dt><dd>${money(e.totalIncome)}</dd>
      <dt>Taxable income, all years</dt><dd>${money(e.totalTaxable)}</dd>
      <dt>Tax payable, all years</dt><dd>${money(e.totalPayable)}</dd>
      <dt>Effective rate over the period</dt><dd>${rate === null ? 'no taxable income' : pct1(rate)}</dd>
      <dt>Years with tax payable</dt><dd>${paidYears}</dd>
      <dt>Years reporting nil</dt><dd>${nilYears}</dd>
    </dl>

    ${nilCaveat(e, nilYears)}

    <div style="margin-top:var(--space-xl)">
      <div class="section-title">Eleven-year history</div>
      <div class="section-sub">Income and tax are drawn on separate scales — on a shared scale the tax bar
        would be an invisible sliver next to gross income.</div>
      <div id="dd-chart" class="chart-wrap"></div>
    </div>

    ${latest ? `<div class="callout" style="margin-top:var(--space-lg)">
      Most recent year in the report, ${yearLabel(latest.year)}: total income ${moneyShort(latest.total)},
      taxable income ${latest.taxable ? moneyShort(latest.taxable) : 'nil'},
      tax payable ${latest.payable ? moneyShort(latest.payable) : 'nil'}.
    </div>` : ''}

    <p style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:var(--space-lg)">
      Figures are exactly as published by the ATO for this single legal entity. Large groups file under
      several entities, so this is not the group's total tax.
    </p>`;

  hashOnOpen = location.hash;
  openHandle = openDrawer(html, () => {
    openHandle = null;
    // Only restore the URL if nothing else has changed it in the meantime —
    // otherwise closing a drawer opened from a back-navigation would fight the
    // browser's own history and bounce the reader somewhere they did not ask for.
    if (location.hash === companyHash(e)) {
      history.replaceState(null, '', hashOnOpen || location.pathname);
    }
    onClose?.();
  });
  history.replaceState(null, '', companyHash(e));
  document.getElementById('dd-chart')?.append(historyChart(b, e));
}
