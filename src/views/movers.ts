// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// MOVERS — the bump chart.
// Question it answers: "who is Australia's biggest corporate taxpayer, and has
// that changed?" A bar chart per year answers it one year at a time; only
// crossing rank lines make the mining cycle and the banks' steadiness visible
// as a single shape.
// Next action: click any line or label to open that company.

import type { Bundle, Entity } from '../data';
import { d, sectorOf } from '../data';
import { openCompany } from '../drilldown';
import { escapeHtml, moneyShort, num, textOn, tipAttr, yearLabel } from '../format';
import { el, linearScale, polyline, svgRoot } from '../svg';

const TOP = 15;
let highlighted: number | null = null;

interface Track { e: Entity; ranks: (number | null)[]; taxes: (number | null)[]; best: number }

function tracks(b: Bundle): Track[] {
  // Rank every company within each year, then keep those that reach the top N
  // in at least one year — so a company that appears once and vanishes is still
  // visible rather than being filtered out by an all-years-average.
  const rankByYear = new Map<string, Map<number, number>>();
  const taxByYear = new Map<string, Map<number, number>>();

  for (const year of b.years) {
    const list = (b.byYear.get(year) ?? [])
      .map(({ entity, row }) => ({ id: entity.id, tax: d(row.payable) }))
      .filter((r) => r.tax > 0)
      .sort((a, z) => z.tax - a.tax);
    rankByYear.set(year, new Map(list.map((r, i) => [r.id, i + 1])));
    taxByYear.set(year, new Map(list.map((r) => [r.id, r.tax])));
  }

  const ids = new Set<number>();
  for (const year of b.years) {
    for (const [id, rank] of rankByYear.get(year)!) if (rank <= TOP) ids.add(id);
  }

  const out: Track[] = [];
  for (const id of ids) {
    const e = b.entities[id];
    const ranks = b.years.map((y) => rankByYear.get(y)!.get(id) ?? null);
    const taxes = b.years.map((y) => taxByYear.get(y)!.get(id) ?? null);
    const best = Math.min(...ranks.filter((r): r is number => r !== null));
    out.push({ e, ranks, taxes, best });
  }
  out.sort((a, z) => a.best - z.best);
  return out;
}

function bump(b: Bundle, list: Track[], onPick: (e: Entity) => void): SVGSVGElement {
  const W = 940;
  const rowH = 26;
  const m = { t: 30, r: 250, b: 30, l: 44 };
  const H = m.t + m.b + (TOP - 1) * rowH;

  const x = linearScale([0, b.years.length - 1], [m.l, W - m.r]);
  const y = linearScale([1, TOP], [m.t, m.t + (TOP - 1) * rowH]);

  const svg = svgRoot(W, H + 10);
  svg.setAttribute('aria-label', `Rank of the largest company taxpayers, 2013-14 to ${b.meta.latestYear}`);

  for (let r = 1; r <= TOP; r++) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(r), y2: y(r), class: 'gridline' }));
    svg.append(el('text', { x: m.l - 10, y: y(r) + 4, 'text-anchor': 'end', 'font-size': 10 }, String(r)));
  }
  b.years.forEach((year, i) => {
    svg.append(el('text', {
      x: x(i), y: m.t - 12, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600,
    }, year.slice(2)));
  });

  for (const track of list) {
    const colour = sectorOf(b, track.e.sector).colour;
    const dim = highlighted !== null && highlighted !== track.e.id;

    // Split the line wherever the company drops out of the top N, so a gap is
    // drawn as a gap. Bridging it would invent a rank the company never held.
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) {
        svg.append(el('path', {
          d: polyline(run), fill: 'none', stroke: colour, 'stroke-width': dim ? 1.2 : 2.4,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: dim ? 0.18 : 0.9,
          class: 'mark',
        }));
      }
      run = [];
    };

    track.ranks.forEach((rank, i) => {
      if (rank === null || rank > TOP) { flush(); return; }
      run.push([x(i), y(rank)]);
      const dot = el('circle', {
        cx: x(i), cy: y(rank), r: dim ? 2.5 : 4.5, fill: colour, opacity: dim ? 0.25 : 1, class: 'mark',
      });
      dot.setAttribute('data-tip', tipAttr([
        track.e.name,
        `${yearLabel(b.years[i])}: ranked #${rank} by tax payable`,
        `${moneyShort(track.taxes[i])} of company tax`,
        'Click for the full history',
      ]));
      dot.style.cursor = 'pointer';
      dot.addEventListener('click', () => onPick(track.e));
      svg.append(dot);
    });
    flush();

    // Label at the right edge, only for companies still in the top N last year.
    const lastRank = track.ranks.at(-1);
    if (lastRank !== null && lastRank !== undefined && lastRank <= TOP) {
      const label = el('text', {
        x: W - m.r + 10, y: y(lastRank) + 4, 'font-size': 11, 'font-weight': dim ? 400 : 600,
        fill: dim ? 'var(--text-muted)' : 'var(--text-primary)', class: 'mark',
      }, track.e.name.length > 34 ? `${track.e.name.slice(0, 33)}…` : track.e.name);
      label.setAttribute('data-tip', tipAttr([
        track.e.name,
        `Best rank #${track.best}`,
        `${moneyShort(track.e.totalPayable)} of tax over eleven years`,
        'Click for the full history',
      ]));
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => onPick(track.e));
      svg.append(label);
    }
  }

  return svg;
}

/**
 * Illustrate the entity-vs-group problem with the year's actual worked example,
 * rather than asserting it in the abstract.
 *
 * The file has no group identifier, so this groups by the first word of the
 * entity name — a guess, and said to be one. It is enough to surface the case
 * that matters: in 2023-24 the largest single entity is Rio Tinto Ltd at
 * $6.25b, but BHP lodges under two entities totalling more than that, so the
 * headline "Rio overtook BHP" that this view would otherwise imply is false.
 * Generic leading words are excluded or the grouping invents conglomerates out
 * of every company beginning "AUSTRALIAN".
 */
const GENERIC_FIRST_WORD = new Set([
  'AUSTRALIAN', 'AUSTRALIA', 'THE', 'NATIONAL', 'A.C.N.', 'ACN', 'NEW', 'GLOBAL',
  'PACIFIC', 'INTERNATIONAL', 'UNITED', 'GENERAL', 'FIRST', 'SOUTH', 'NORTH', 'WESTERN',
]);

function groupCaveat(b: Bundle, year: string): string {
  const rows = (b.byYear.get(year) ?? [])
    .map(({ entity, row }) => ({ entity, tax: d(row.payable) }))
    .filter((r) => r.tax > 0)
    .sort((a, z) => z.tax - a.tax);
  if (!rows.length) return '';

  const topEntity = rows[0];
  const groups = new Map<string, { tax: number; members: typeof rows }>();
  for (const r of rows) {
    const word = r.entity.name.split(/\s+/)[0].toUpperCase();
    if (GENERIC_FIRST_WORD.has(word) || word.length < 3) continue;
    const g = groups.get(word) ?? { tax: 0, members: [] };
    g.tax += r.tax;
    g.members.push(r);
    groups.set(word, g);
  }

  const best = [...groups.entries()]
    .filter(([, g]) => g.members.length > 1)
    .sort((a, z) => z[1].tax - a[1].tax)[0];
  if (!best || best[1].tax <= topEntity.tax) return '';

  const [word, g] = best;
  const names = g.members.slice(0, 3)
    .map((m) => `${escapeHtml(m.entity.name)} (${moneyShort(m.tax)})`).join(' and ');
  return `In ${yearLabel(year)} the largest single entity is ${escapeHtml(topEntity.entity.name)} at
    ${moneyShort(topEntity.tax)} — but ${escapeHtml(word)} lodges under ${g.members.length} separate
    entities, ${names}, ${moneyShort(g.tax)} between them. On a group view the order at the top of this
    chart reverses.`;
}

export function renderMovers(root: HTMLElement, b: Bundle): void {
  const list = tracks(b);
  const first = b.years[0];
  const last = b.meta.latestYear;
  const groupNote = groupCaveat(b, last);
  const topFirst = (b.byYear.get(first) ?? []).map(({ entity, row }) => ({ entity, tax: d(row.payable) }))
    .sort((a, z) => z.tax - a.tax)[0];
  const topLast = (b.byYear.get(last) ?? []).map(({ entity, row }) => ({ entity, tax: d(row.payable) }))
    .sort((a, z) => z.tax - a.tax)[0];

  root.innerHTML = `
    <div class="view-head">
      <h2>Who tops the table, and when</h2>
      <p>Rank of the biggest corporate taxpayers, year by year. Lines that dive and climb are the commodity
        cycle; lines that stay flat are the banks.</p>
    </div>

    <div class="callout warn">
      <strong>This chart ranks <button type="button" class="glossary-link" data-term="entity">legal entities</button>, not
      corporate groups — and here that changes the answer.</strong> ${groupNote}
      The ATO's file contains no group identifier, so a chart of groups cannot be drawn from it at all. Read
      every position below as "largest single lodging entity".
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-value" style="font-size:1rem;line-height:1.35">${escapeHtml(topFirst?.entity.name ?? '—')}</div>
        <div class="stat-label">Largest single entity, ${yearLabel(first)}</div>
        <div class="stat-note">${moneyShort(topFirst?.tax ?? 0)} — not necessarily the largest group</div></div>
      <div class="stat is-paid"><div class="stat-value" style="font-size:1rem;line-height:1.35">${escapeHtml(topLast?.entity.name ?? '—')}</div>
        <div class="stat-label">Largest single entity, ${yearLabel(last)}</div>
        <div class="stat-note">${moneyShort(topLast?.tax ?? 0)} — not necessarily the largest group</div></div>
      <div class="stat"><div class="stat-value">${num(list.length)}</div>
        <div class="stat-label">Companies to reach the top ${TOP}</div>
        <div class="stat-note">in at least one of eleven years</div></div>
      <div class="stat"><div class="stat-value">${num(list.filter((t) => t.ranks.every((r) => r !== null && r <= TOP)).length)}</div>
        <div class="stat-label">In the top ${TOP} every year</div>
        <div class="stat-note">the permanent fixtures</div></div>
    </div>

    <div class="panel">
      <div class="chart-title">Rank by company tax payable, top ${TOP}</div>
      <div class="section-sub">Rank 1 is the largest payer. A line stops where the company leaves the top
        ${TOP} — the gap is real and is never bridged. Colour is sector. <strong>Two lines can belong to the
        same corporate group</strong> — BHP Group Limited and BHP Iron Ore (Jimblebar) are both drawn here as
        separate companies, because that is how they lodge. Hover a point for the year's figure; click a point
        or a name to open the company. Use the sector legend to isolate an industry.</div>
      <div class="scroller"><div id="m-bump" class="chart-wrap" style="min-width:900px"></div></div>
      <div class="legend" id="m-legend"></div>
    </div>

    <div class="panel">
      <div class="section-title">Every company that has reached the top ${TOP}</div>
      <div class="section-sub">Ranked by best position achieved. Click any row for the full history.</div>
      <div class="scroller"><table class="data">
        <thead><tr><th>Company</th><th>Sector</th><th class="n">Best rank</th>
          <th class="n">Years in the top ${TOP}</th><th class="n">Tax, all years</th></tr></thead>
        <tbody>${list.map((t) => `
          <tr class="clickable" data-id="${t.e.id}" tabindex="0">
            <td class="name-cell">${escapeHtml(t.e.name)}</td>
            <td><span class="sector-pill" style="background:${sectorOf(b, t.e.sector).colour};color:${textOn(sectorOf(b, t.e.sector).colour)}"
              >${escapeHtml(sectorOf(b, t.e.sector).label)}</span></td>
            <td class="n">#${t.best}</td>
            <td class="n">${t.ranks.filter((r) => r !== null && r <= TOP).length}</td>
            <td class="n">${moneyShort(t.e.totalPayable)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const pick = (e: Entity) => openCompany(b, e);
  const chart = root.querySelector<HTMLElement>('#m-bump')!;
  const redraw = () => { chart.innerHTML = ''; chart.append(bump(b, list, pick)); };
  redraw();

  const present = [...new Set(list.map((t) => t.e.sector))];
  const legend = root.querySelector<HTMLElement>('#m-legend')!;
  legend.innerHTML = b.meta.sectors.filter((s) => present.includes(s.id)).map((s) =>
    `<button type="button" class="legend-item clickable" data-sector="${s.id}" aria-pressed="false">
      <span class="legend-swatch" style="background:${s.colour}"></span>${escapeHtml(s.label)}</button>`).join('');

  let activeSector: string | null = null;
  legend.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLElement>('[data-sector]');
    if (!btn) return;
    const id = btn.dataset.sector!;
    activeSector = activeSector === id ? null : id;
    legend.querySelectorAll<HTMLElement>('[data-sector]').forEach((el2) =>
      el2.setAttribute('aria-pressed', String(el2.dataset.sector === activeSector)));
    // Highlighting by sector reuses the same dimming as a single-company
    // highlight: one visual language for "this is the subset you asked for".
    highlighted = null;
    chart.innerHTML = '';
    const filtered = activeSector ? list.filter((t) => t.e.sector === activeSector) : list;
    chart.append(bump(b, filtered.length ? filtered : list, pick));
  });

  root.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    const go = () => pick(b.entities[Number(tr.dataset.id)]);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
    });
  });
}
