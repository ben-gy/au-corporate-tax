// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson

import './styles.css';

import { loadAll, type Bundle } from './data';
import { escapeHtml, moneyShort, num, pct1, yearLabel } from './format';
import { initTooltip } from './components/tooltip';
import { openModal, showGlossary } from './components/overlay';
import { GLOSSARY } from './glossary';
import { findByHash, openCompany } from './drilldown';
import { renderCompanies } from './views/companies';
import { renderFunnel } from './views/funnel';
import { renderNil } from './views/nil';
import { renderConcentration } from './views/concentration';
import { renderMovers } from './views/movers';
import { renderRates } from './views/rates';
import { renderSectors } from './views/sectors';

type ViewId = 'companies' | 'funnel' | 'nil' | 'concentration' | 'movers' | 'rates' | 'sectors';

// Nav tabs are WORDS ONLY — never count badges. Counts belong in the views.
const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'companies', label: 'Companies' },
  { id: 'funnel', label: 'Where it goes' },
  { id: 'nil', label: 'Nil every year' },
  { id: 'concentration', label: 'Who carries it' },
  { id: 'movers', label: 'Movers' },
  { id: 'rates', label: 'Size vs rate' },
  { id: 'sectors', label: 'Sectors' },
];

const app = document.getElementById('app')!;
let bundle: Bundle | null = null;
let current: ViewId = 'companies';

function shell(): void {
  app.innerHTML = `
    <header class="site-header">
      <div class="header-inner">
        <div class="brand">
          <h1>Corporate Tax Transparency</h1>
          <span class="brand-sub">Australia&rsquo;s largest companies, 2013&ndash;14 to 2023&ndash;24</span>
        </div>
        <div class="header-spacer"></div>
        <div class="header-actions">
          <button type="button" class="icon-btn" id="about-btn"
            aria-label="About this site, its data and its caveats">About</button>
        </div>
      </div>
    </header>
    <!-- A plain nav of buttons with aria-current, NOT an ARIA tablist.
         role="tab" commits you to arrow-key roving focus and aria-controls, and
         a half-implemented tab pattern is worse than none. More importantly the
         panel was marked role="tabpanel", which overrides the implicit <main>
         landmark and removes "skip to main content" from every screen reader. -->
    <nav class="site-nav" aria-label="Views">
      <div class="nav-inner">
        ${VIEWS.map((v) => `<button type="button" class="nav-tab" data-view="${v.id}"
          aria-current="${v.id === current ? 'page' : 'false'}" id="tab-${v.id}">${v.label}</button>`).join('')}
      </div>
    </nav>
    <main class="main-content" id="view-root">
      <div class="loading">Loading eleven years of ATO corporate tax data&hellip;</div>
      <div class="skeleton" style="max-width:900px;margin:var(--space-lg) auto"></div>
    </main>
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-src" id="footer-src"></div>
        <div>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> &middot;
          <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></div>
      </div>
    </footer>`;

  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.view as ViewId));
  });
  document.getElementById('about-btn')!.addEventListener('click', showAbout);
}

function go(id: ViewId): void {
  current = id;
  history.replaceState(null, '', `#/${id}`);
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.setAttribute('aria-current', b.dataset.view === id ? 'page' : 'false'));
  render();
}

function render(): void {
  if (!bundle) return;
  const root = document.getElementById('view-root')!;
  root.innerHTML = '';
  root.setAttribute('aria-label', `${VIEWS.find((v) => v.id === current)?.label ?? ''} view`);
  try {
    switch (current) {
      case 'companies': renderCompanies(root, bundle); break;
      case 'funnel': renderFunnel(root, bundle); break;
      case 'nil': renderNil(root, bundle); break;
      case 'concentration': renderConcentration(root, bundle); break;
      case 'movers': renderMovers(root, bundle); break;
      case 'rates': renderRates(root, bundle); break;
      case 'sectors': renderSectors(root, bundle); break;
    }
  } catch (err) {
    root.innerHTML = `<div class="error-state">
      <p>Something went wrong drawing this view.</p>
      <p style="font-size:var(--font-size-sm)">${escapeHtml(String(err))}</p>
      <button type="button" class="icon-btn" style="background:var(--accent-primary);margin-top:var(--space-md)"
        id="err-reload">Reload</button></div>`;
    document.getElementById('err-reload')?.addEventListener('click', () => location.reload());
  }
  window.scrollTo({ top: 0 });
}

function showAbout(): void {
  const b = bundle;
  if (!b) return;
  const t = b.totals.get(b.meta.latestYear)!;
  const anchor = b.meta.anchors.find((a) => a.year === b.meta.latestYear);
  const failed = b.meta.gates.filter((g) => !g.ok);

  openModal(`
    <h3 id="modal-title">About this site</h3>
    <p>Every year the Australian Taxation Office is required by law to publish the total income, taxable
      income and tax payable of Australia's largest companies. It does so as eleven separate spreadsheets with
      inconsistent layouts and no key linking a company across years. This site assembles them into one
      searchable eleven-year record of ${num(b.meta.entityCount)} named entities.</p>

    <h4>What the data covers</h4>
    <p>A company appears if its total income reaches the
      <button type="button" class="glossary-link" data-term="threshold">reporting threshold</button>, plus anyone with
      <button type="button" class="glossary-link" data-term="prrt">PRRT</button> payable. In ${yearLabel(b.meta.latestYear)}
      that is ${num(t.entities)} companies reporting ${moneyShort(t.total)} of total income,
      ${moneyShort(t.taxable)} of taxable income and ${moneyShort(t.payable)} of company tax.</p>
    <p>It does <strong>not</strong> cover small and medium businesses, GST, payroll tax, excise, or personal
      income tax. It does not reflect audits, amendments or settlements after lodgment. And each row is one
      <button type="button" class="glossary-link" data-term="entity">legal entity</button>, not a corporate group.</p>

    <h4>How to read it without being misled</h4>
    <ul>
      <li><strong><button type="button" class="glossary-link" data-term="total-income">Total income</button> is not profit.</strong>
        It is gross revenue. A supermarket turning over $60 billion has already spent most of it on stock and
        wages. Comparing tax to total income makes everyone look like they pay nothing, so this site never
        does — the rate shown everywhere is tax over
        <button type="button" class="glossary-link" data-term="taxable-income">taxable income</button>.</li>
      <li><strong><button type="button" class="glossary-link" data-term="nil">Nil tax is lawful and common.</button></strong>
        Losses, losses carried forward, <button type="button" class="glossary-link" data-term="franking">franking
        credits</button> and <button type="button" class="glossary-link" data-term="consolidation">tax consolidation</button> all
        produce it. A single nil year says almost nothing. A decade of them is a fair question.</li>
      <li><strong>Company counts are not comparable across ${yearLabel(b.meta.thresholdChangeYear)}.</strong>
        The threshold for Australian-owned private companies was cut from $200m to $100m, which added over a
        thousand companies at once. Shares and rates are safe across that line; counts are not, and this site
        marks the break wherever a count is drawn.</li>
      <li><strong>Rankings are by entity, not group.</strong> Large groups file under several ABNs, so
        "Australia's biggest taxpayer" depends on how you total. The file contains no group identifier.</li>
      <li><strong>Older years grow.</strong> Later reports carry
        <button type="button" class="glossary-link" data-term="amendment">amendments and late lodgers</button>, which this site
        applies — so its 2022&ndash;23 figure covers ${num(b.totals.get('2022-23')?.entities ?? 0)} companies
        against the 3,985 the ATO announced at the time.</li>
    </ul>

    <h4>One number that does not reconcile</h4>
    ${anchor ? `<p>Adding up the taxable-income column of the ATO's own spreadsheet for
      ${yearLabel(b.meta.latestYear)} gives ${moneyShort(t.taxable)}. The ATO's report commentary states
      ${moneyShort(anchor.taxable)} — our sum is ${pct1((t.taxable / anchor.taxable - 1) * 100)} higher, while
      total income and tax payable reconcile with the ATO <em>exactly</em> in the same year. The reason is
      definitional, and the ATO's own workbook states it: the law only requires a taxable income to be
      published where it is a positive amount, so a company with a
      <button type="button" class="glossary-link" data-term="losses">tax loss</button> is left blank and the
      published column can only sum upwards. The ATO's aggregate nets those losses off — which is why its own
      industry table can show an entire segment as a negative number. The gap is essentially the population's
      aggregate tax losses. Every taxable-income figure here is the published column, summed, so the effective
      rates shown are a floor.</p>` : ''}

    <h4>How it is built</h4>
    <p>A pipeline downloads all eleven workbooks from data.gov.au, folds them into one entity-by-year panel
      and runs ${b.meta.gatesTotal} reconciliation checks before anything is published —
      <strong>${b.meta.gatesPassed} of ${b.meta.gatesTotal} passing</strong>. They include matching the ATO's
      published headline figures for two separate years, proving that prior-year amendments are being routed
      correctly, and proving that the guard against double-reading the 2013&ndash;14 workbook is actually
      doing something.</p>
    ${failed.length ? `<p style="color:var(--status-bad)"><strong>Currently failing:</strong>
      ${failed.map((g) => escapeHtml(g.title)).join('; ')}.</p>` : ''}
    <details style="margin-bottom:var(--space-sm)">
      <summary style="cursor:pointer;color:var(--accent-secondary);font-size:var(--font-size-sm)">
        Show all ${b.meta.gatesTotal} data checks</summary>
      <ul style="margin-top:var(--space-sm);font-size:var(--font-size-sm)">
        ${b.meta.gates.map((g) => `<li><strong style="color:${g.ok ? 'var(--status-good)' : 'var(--status-bad)'}">
          ${g.ok ? 'PASS' : 'FAIL'}</strong> ${escapeHtml(g.title)} —
          <span style="color:var(--text-tertiary)">${escapeHtml(g.detail)}</span></li>`).join('')}
      </ul>
    </details>
    <p>Updated once a year, following the ATO's own release cycle — the
      ${yearLabel(b.meta.latestYear)} report was published in October 2025.</p>

    <h4>Sources and licence</h4>
    <ul>
      <li>Australian Taxation Office, <em>Corporate Tax Transparency — Report of Entity Tax Information</em>,
        2013&ndash;14 to ${yearLabel(b.meta.latestYear)}, via
        <a href="https://data.gov.au/data/dataset/corporate-transparency" target="_blank" rel="noopener"
          >data.gov.au</a>. Licensed ${escapeHtml(b.meta.source.licence)}.</li>
      <li>Headline aggregates for cross-checking from the ATO's own
        <em>Corporate tax transparency report</em> commentary pages.</li>
    </ul>
    <p style="font-size:var(--font-size-xs)">This is an independent site and is not affiliated with, or
      endorsed by, the Australian Taxation Office or the Australian Government. Nothing here is tax,
      financial or legal advice.</p>
  `);
}

function wireGlossary(): void {
  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest<HTMLElement>('.glossary-link');
    if (!link) return;
    const key = link.dataset.term;
    const entry = key ? GLOSSARY[key] : undefined;
    if (!entry) return;
    e.preventDefault();
    e.stopPropagation();
    showGlossary(link, entry.term, entry.definition);
  });
}

function footer(b: Bundle): void {
  document.getElementById('footer-src')!.innerHTML =
    `Source: Australian Taxation Office, <em>Report of Entity Tax Information</em>, 2013&ndash;14 to `
    + `${yearLabel(b.meta.latestYear)} (${escapeHtml(b.meta.source.licence)}, via data.gov.au). `
    + `${num(b.meta.entityCount)} companies &middot; ${num(b.meta.rowCount)} company-years &middot; `
    + `${b.meta.gatesPassed}/${b.meta.gatesTotal} data checks passing. `
    + `<button type="button" class="icon-btn" id="footer-about" style="background:var(--bg-elevated);`
    + `color:var(--accent-secondary);border-color:var(--border-default);min-height:28px;margin-left:6px"`
    + `>Methodology</button>`;
  document.getElementById('footer-about')!.addEventListener('click', showAbout);
}

async function boot(): Promise<void> {
  shell();
  initTooltip();
  wireGlossary();

  const hash = location.hash.replace('#/', '') as ViewId;
  if (VIEWS.some((v) => v.id === hash)) current = hash;
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.setAttribute('aria-current', b.dataset.view === current ? 'page' : 'false'));

  const controller = new AbortController();
  try {
    bundle = await loadAll(controller.signal);
    footer(bundle);
    render();
    // A shared #c=<abn> link lands directly on that company.
    const linked = findByHash(bundle, location.hash);
    if (linked) openCompany(bundle, linked);
  } catch (err) {
    const root = document.getElementById('view-root')!;
    root.innerHTML = `
      <div class="error-state">
        <p>The data could not be loaded.</p>
        <p style="font-size:var(--font-size-sm)">${escapeHtml(String(err))}</p>
        <button type="button" class="icon-btn" style="background:var(--accent-primary);margin-top:var(--space-md)"
          id="boot-retry">Try again</button>
      </div>`;
    document.getElementById('boot-retry')?.addEventListener('click', () => location.reload());
  }

  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#/', '') as ViewId;
    if (VIEWS.some((v) => v.id === h) && h !== current) go(h);
  });
}

void boot();
