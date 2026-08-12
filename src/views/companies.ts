// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// COMPANIES — the search surface, and the reason most people arrive here.
// Question it answers: "what did THIS company earn, and what did it pay?"
// Next action: click any row to open the eleven-year drill-down.

import type { Bundle, Entity } from '../data';
import { d, sectorOf } from '../data';
import { openCompany } from '../drilldown';
import {
  debounce, effectiveRate, escapeHtml, money, moneyShort, num, pct1, textOn, tipHtml, yearLabel,
} from '../format';

type SortKey = 'name' | 'income' | 'taxable' | 'tax' | 'rate' | 'years';
const PAGE = 150;

interface State { q: string; year: string; sector: string; nilOnly: boolean; sort: SortKey; desc: boolean; limit: number }

const state: State = {
  q: '', year: '', sector: 'all', nilOnly: false, sort: 'tax', desc: true, limit: PAGE,
};

function restore(b: Bundle): void {
  if (!state.year) state.year = b.meta.latestYear;
  try {
    const saved = JSON.parse(localStorage.getItem('act:companies') ?? 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.sort === 'string') state.sort = saved.sort;
      if (typeof saved.desc === 'boolean') state.desc = saved.desc;
      if (typeof saved.year === 'string' && b.years.includes(saved.year)) state.year = saved.year;
      if (typeof saved.sector === 'string') state.sector = saved.sector;
    }
  } catch { /* a corrupt preference must never stop the page rendering */ }
}

function persist(): void {
  try {
    localStorage.setItem('act:companies', JSON.stringify({
      sort: state.sort, desc: state.desc, year: state.year, sector: state.sector,
    }));
  } catch { /* private browsing */ }
}

interface Line {
  e: Entity; income: number; taxable: number; tax: number; rate: number | null; years: number;
}

function rows(b: Bundle): Line[] {
  const q = state.q.trim().toLowerCase();
  const out: Line[] = [];

  const consider = (e: Entity, income: number, taxable: number, tax: number, years: number) => {
    if (state.sector !== 'all' && e.sector !== state.sector) return;
    if (state.nilOnly && tax > 0) return;
    if (q && !e.search.includes(q)) return;
    out.push({ e, income, taxable, tax, rate: effectiveRate(tax, taxable), years });
  };

  // `years` is always the company's TOTAL years on record, even when a single
  // income year is selected. Showing "1" against every row in single-year mode
  // is true and tells the reader nothing; how long a company has been in the
  // report is genuinely useful next to one year's figures — it separates a
  // long-standing reporter from one that has just crossed the threshold.
  if (state.year === 'all') {
    for (const e of b.entities) consider(e, e.totalIncome, e.totalTaxable, e.totalPayable, e.yearsPresent);
  } else {
    for (const { entity, row } of b.byYear.get(state.year) ?? []) {
      consider(entity, d(row.total), d(row.taxable), d(row.payable), entity.yearsPresent);
    }
  }

  const dir = state.desc ? -1 : 1;
  out.sort((a, z) => {
    switch (state.sort) {
      case 'name': return a.e.name.localeCompare(z.e.name, 'en') * (state.desc ? -1 : 1);
      case 'income': return (a.income - z.income) * dir;
      case 'taxable': return (a.taxable - z.taxable) * dir;
      case 'years': return (a.years - z.years) * dir || (a.tax - z.tax) * dir;
      case 'rate': {
        // Entities with no taxable income have no rate. They sort to the end in
        // BOTH directions rather than being treated as 0% — a nil rate and a
        // zero rate are different statements and mixing them would put every
        // loss-making company at the top of an "ascending rate" list.
        if (a.rate === null && z.rate === null) return z.income - a.income;
        if (a.rate === null) return 1;
        if (z.rate === null) return -1;
        return (a.rate - z.rate) * dir;
      }
      default: return (a.tax - z.tax) * dir;
    }
  });
  return out;
}

export function renderCompanies(root: HTMLElement, b: Bundle): void {
  restore(b);
  const t = b.totals.get(b.meta.latestYear)!;

  root.innerHTML = `
    <div class="view-head">
      <h2>Every company in the report</h2>
      <p>Search ${num(b.entities.length)} named entities across eleven years of the ATO's corporate tax
        transparency data. Click any company for its full published history.</p>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-value">${num(b.entities.length)}</div>
        <div class="stat-label">Companies on record</div>
        <div class="stat-note">2013–14 to ${yearLabel(b.meta.latestYear)}</div></div>
      <div class="stat"><div class="stat-value">${moneyShort(t.total)}</div>
        <div class="stat-label">Total income, ${yearLabel(b.meta.latestYear)}</div>
        <div class="stat-note">gross revenue, not profit</div></div>
      <div class="stat is-paid"><div class="stat-value">${moneyShort(t.payable)}</div>
        <div class="stat-label">Company tax payable</div>
        <div class="stat-note">${pct1((t.payable / t.taxable) * 100)} of taxable income</div></div>
      <div class="stat is-nil"><div class="stat-value">${pct1((t.nil / t.entities) * 100)}</div>
        <div class="stat-label">Reported nil tax</div>
        <div class="stat-note">${num(t.nil)} of ${num(t.entities)} companies</div></div>
    </div>

    <div class="controls">
      <div class="control-group">
        <label class="control-label" for="c-search">Search</label>
        <input type="search" id="c-search" placeholder="Company name, e.g. Qantas" value="${escapeHtml(state.q)}"
          aria-label="Search company names">
      </div>
      <div class="control-group">
        <label class="control-label" for="c-year">Year</label>
        <select id="c-year" aria-label="Income year">
          <option value="all"${state.year === 'all' ? ' selected' : ''}>All years combined</option>
          ${b.years.slice().reverse().map((y) =>
    `<option value="${y}"${state.year === y ? ' selected' : ''}>${yearLabel(y)}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label class="control-label" for="c-sector">Sector</label>
        <select id="c-sector" aria-label="Sector">
          <option value="all">All sectors</option>
          ${b.meta.sectors.map((s) =>
    `<option value="${s.id}"${state.sector === s.id ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>
      <div class="seg">
        <button type="button" id="c-all" aria-pressed="${!state.nilOnly}">All companies</button>
        <button type="button" id="c-nil" aria-pressed="${state.nilOnly}">Nil tax only</button>
      </div>
    </div>

    <div class="panel">
      <!-- role="status" so a screen-reader user hears that the filter did
           something. Without it, typing in the search box changes 6,000 rows
           silently, including the no-results case. -->
      <div id="c-count" class="section-sub" role="status"></div>
      <div class="scroller"><table class="data" id="c-table">
        <thead><tr>
          ${([
    ['name', 'Company', ''],
    ['income', 'Total income', 'n'],
    ['taxable', 'Taxable income', 'n'],
    ['tax', 'Tax payable', 'n'],
    ['rate', 'Effective rate', 'n'],
    ['years', 'Years on record', 'n'],
  ] as [SortKey, string, string][]).map(([key, label, cls]) =>
    `<th class="${cls}" data-sort="${key}">
       <button type="button" class="th-sort" data-sort="${key}">${label}</button>
     </th>`).join('')}
        </tr></thead>
        <tbody></tbody>
      </table></div>
      <div id="c-more" style="margin-top:var(--space-lg);text-align:center"></div>
    </div>`;

  const tbody = root.querySelector<HTMLTableSectionElement>('#c-table tbody')!;
  const count = root.querySelector<HTMLElement>('#c-count')!;
  const more = root.querySelector<HTMLElement>('#c-more')!;

  const draw = (): void => {
    const list = rows(b);
    const shown = list.slice(0, state.limit);

    count.innerHTML = `${num(list.length)} compan${list.length === 1 ? 'y' : 'ies'}`
      + `${state.year === 'all' ? ' across all years' : ` in ${yearLabel(state.year)}`}`
      + `${state.nilOnly ? ', reporting nil tax' : ''}. `
      + `${state.year === 'all'
        ? 'Figures are the sum of every year the company appears — the number of years differs between companies, so compare with care.'
        : 'Click a row for the company&rsquo;s full history.'}`;

    tbody.innerHTML = shown.map((r) => {
      const sector = sectorOf(b, r.e.sector);
      const tip = tipHtml([
        r.e.name,
        `Total income ${money(r.income)} (gross revenue, not profit)`,
        `Taxable income ${money(r.taxable)}`,
        `Tax payable ${money(r.tax)}`,
        r.rate === null ? 'No taxable income, so no effective rate' : `Effective rate ${pct1(r.rate)}`,
      ]);
      return `<tr class="clickable" data-id="${r.e.id}" tabindex="0" data-tip="${tip}">
        <td class="name-cell">${escapeHtml(r.e.name)}
          <span class="sector-pill" style="background:${sector.colour};color:${textOn(sector.colour)};font-size:0.62rem;margin-left:6px"
            >${escapeHtml(sector.label)}</span></td>
        <td class="n">${moneyShort(r.income)}</td>
        <td class="n">${r.taxable > 0 ? moneyShort(r.taxable) : '<span class="cell-nil">nil</span>'}</td>
        <td class="n">${r.tax > 0 ? moneyShort(r.tax) : '<span class="cell-nil">nil</span>'}</td>
        <td class="n">${r.rate === null ? '<span class="cell-nil">n/a</span>' : pct1(r.rate)}</td>
        <td class="n">${r.years}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="empty-state">No company matches that search.
      Try part of the name — the ATO records legal entity names, so it is
      &ldquo;QANTAS AIRWAYS LIMITED&rdquo;, not &ldquo;Qantas Airlines&rdquo;.</td></tr>`;

    more.innerHTML = list.length > shown.length
      ? `<button type="button" class="icon-btn" id="c-load"
          style="background:var(--accent-primary);min-height:38px;padding:0 var(--space-lg)"
          >Show ${num(Math.min(PAGE, list.length - shown.length))} more</button>`
      : '';
    more.querySelector('#c-load')?.addEventListener('click', () => { state.limit += PAGE; draw(); });

    root.querySelectorAll<HTMLElement>('#c-table th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === state.sort;
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (state.desc ? 'descending' : 'ascending') : 'none');
      const btn = th.querySelector<HTMLElement>('.th-sort');
      if (btn) {
        // The arrow is data-driven so it is announced as part of the button's
        // name, not painted on by CSS where assistive tech cannot see it.
        btn.dataset.arrow = active ? (state.desc ? '▾' : '▴') : '';
        btn.setAttribute('aria-label', active
          ? `${btn.textContent?.trim()}, sorted ${state.desc ? 'descending' : 'ascending'}; activate to reverse`
          : `Sort by ${btn.textContent?.trim()}`);
      }
    });
  };

  const open = (id: number): void => {
    const entity = b.entities[id];
    if (entity) openCompany(b, entity);
  };

  tbody.addEventListener('click', (ev) => {
    const tr = (ev.target as Element).closest<HTMLElement>('tr[data-id]');
    if (tr) open(Number(tr.dataset.id));
  });
  tbody.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const tr = (ev.target as Element).closest<HTMLElement>('tr[data-id]');
    if (!tr) return;
    ev.preventDefault();
    open(Number(tr.dataset.id));
  });

  root.querySelector<HTMLInputElement>('#c-search')!
    .addEventListener('input', debounce(((ev: Event) => {
      state.q = (ev.target as HTMLInputElement).value;
      state.limit = PAGE;
      draw();
    }) as never, 300));

  root.querySelector<HTMLSelectElement>('#c-year')!.addEventListener('change', (ev) => {
    state.year = (ev.target as HTMLSelectElement).value;
    state.limit = PAGE; persist(); draw();
  });
  root.querySelector<HTMLSelectElement>('#c-sector')!.addEventListener('change', (ev) => {
    state.sector = (ev.target as HTMLSelectElement).value;
    state.limit = PAGE; persist(); draw();
  });

  const setNil = (v: boolean) => {
    state.nilOnly = v; state.limit = PAGE;
    root.querySelector('#c-all')!.setAttribute('aria-pressed', String(!v));
    root.querySelector('#c-nil')!.setAttribute('aria-pressed', String(v));
    draw();
  };
  root.querySelector('#c-all')!.addEventListener('click', () => setNil(false));
  root.querySelector('#c-nil')!.addEventListener('click', () => setNil(true));

  root.querySelectorAll<HTMLElement>('#c-table .th-sort').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort as SortKey;
      if (state.sort === key) state.desc = !state.desc;
      else { state.sort = key; state.desc = key !== 'name'; }
      state.limit = PAGE; persist(); draw();
    });
  });

  draw();
}
