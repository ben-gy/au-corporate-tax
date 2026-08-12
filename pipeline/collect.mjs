// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Downloads every annual Report of Entity Tax Information workbook from the ATO
// dataset on data.gov.au, folds them into one entity x year panel, runs the
// reconciliation gates, and writes public/data/.
//
// All the parsing LOGIC lives in parse.mjs, which is dependency-free so the test
// suite can import it without installing this package. This file is the I/O.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import {
  YEARS, THRESHOLD_CHANGE_YEAR, STABLE_THRESHOLD, SECTORS,
  selectSheets, recordsFromSheet, prrtFromSheet, buildPanel, yearTotals,
  nilStreaks, classifySector, runGates, dollars, normaliseAbn,
} from './parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'public', 'data');
const CACHE = path.join(HERE, '.cache');

const PACKAGE_URL = 'https://data.gov.au/data/api/3/action/package_show?id=corporate-transparency';

/**
 * The ATO's own published headline figures, transcribed from the "About the
 * Corporate tax transparency report" page that ships with each release. These
 * are the only external anchors available and they are the only check capable
 * of catching a parser that is internally consistent and externally wrong, so
 * they are hardcoded deliberately and a new one is added with each release.
 *
 * TWO years, not one, on purpose: a single anchor cannot distinguish "the
 * parser is wrong this year" from "the source behaves like this every year",
 * which is exactly the question the taxable-income divergence turned on.
 */
const ATO_ANCHORS = [
  {
    year: '2022-23',
    entities: 3985,
    total: 3_138_400_000_000,
    taxable: 380_100_000_000,
    payable: 97_900_000_000,
    citation: 'ATO, "About the Corporate tax transparency report 2022-23" — 3,985 entities, '
      + '$3,138.4b total income, $380.1b taxable income, $97.9b tax payable.',
  },
  {
    year: '2023-24',
    entities: 4110,
    total: 3_278_800_000_000,
    taxable: 365_500_000_000,
    payable: 95_700_000_000,
    citation: 'ATO, "About the Corporate tax transparency report 2023-24" — 4,110 entities, '
      + '$3,278.8b total income, $365.5b taxable income, $95.7b tax payable.',
  },
];

const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return fs.readFileSync(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A data.gov.au download that quietly returns an HTML error page still comes
  // back HTTP 200. An xlsx always starts with the ZIP magic number.
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new Error(`${url} returned ${buf.length} bytes that are not a zip/xlsx `
      + `(starts with ${JSON.stringify(buf.subarray(0, 40).toString('latin1'))})`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

const sheetRows = (wb, name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: true });

async function main() {
  log('Resolving the ATO Corporate Tax Transparency dataset…');
  const pkg = (await fetchJson(PACKAGE_URL)).result;

  const resources = pkg.resources
    .map((r) => ({
      name: r.name,
      url: r.url,
      year: (String(r.name).match(/(\d{4}-\d{2})/) || [])[1],
      lastModified: r.last_modified || r.created || null,
    }))
    .filter((r) => r.year)
    .sort((a, b) => a.year.localeCompare(b.year));

  if (!resources.length) throw new Error('the CKAN package listed no year-tagged resources');
  log(`  ${resources.length} annual workbooks, ${resources[0].year} → ${resources.at(-1).year}`);

  const records = [];
  const prrtRecords = [];
  const context = {
    blankAbnRows: 0, crossYearRows: 0, futureRows: 0,
    naive2013Rows: 0, guarded2013Rows: 0,
    latestYear: resources.at(-1).year,
    anchors: ATO_ANCHORS,
  };

  for (const r of resources) {
    const buf = await download(r.url, path.join(CACHE, `${r.year}.xlsx`));
    const wb = XLSX.read(buf, { type: 'buffer' });
    const plan = selectSheets(wb.SheetNames);
    log(`  ${r.year}: data=[${plan.data.join(', ')}] prrt=[${plan.prrt.join(', ')}]`
      + (plan.skipped.length ? ` skipped=[${plan.skipped.map((s) => `${s.name} (${s.why})`).join(', ')}]` : ''));

    for (const sheet of plan.data) {
      const rows = recordsFromSheet(sheetRows(wb, sheet), { sheetName: sheet, fileYear: r.year });
      records.push(...rows);
    }
    for (const sheet of plan.prrt) {
      prrtRecords.push(...prrtFromSheet(sheetRows(wb, sheet), { sheetName: sheet, fileYear: r.year }));
    }

    // Measure what the Combined-sheet guard actually suppresses, so the gate can
    // assert the guard is load-bearing rather than decorative.
    if (r.year === '2013-14') {
      for (const sheet of wb.SheetNames) {
        if (sheet.trim().toLowerCase() === 'information') continue;
        context.naive2013Rows += recordsFromSheet(sheetRows(wb, sheet),
          { sheetName: sheet, fileYear: r.year }).length;
      }
      context.guarded2013Rows = records.filter((x) => x.fileYear === '2013-14').length;
    }
  }

  for (const rec of records) {
    if (!rec.abn) context.blankAbnRows += 1;
    if (rec.year < rec.fileYear) context.crossYearRows += 1;
    if (rec.year > rec.fileYear) context.futureRows += 1;
  }
  log(`Parsed ${records.length} entity-year rows `
    + `(${context.blankAbnRows} without an ABN, ${context.crossYearRows} prior-year amendments)`);

  const panel = buildPanel(records);
  log(`Folded into ${panel.entities.length} distinct entities`);

  // Sector classification, with coverage measured by value as well as by count.
  let classifiedEntities = 0;
  let classifiedPayable = 0;
  let allPayable = 0;
  for (const e of panel.entities) {
    e.sector = classifySector(e.name, e.abn);
    const paid = e.rows.reduce((s, x) => s + dollars(x.payable), 0);
    allPayable += paid;
    if (e.sector !== 'other') { classifiedEntities += 1; classifiedPayable += paid; }
  }
  context.sectorCoverage = {
    entityShare: classifiedEntities / panel.entities.length,
    payableShare: allPayable ? classifiedPayable / allPayable : 0,
  };
  log(`Sectors: ${(context.sectorCoverage.entityShare * 100).toFixed(1)}% of entities, `
    + `${(context.sectorCoverage.payableShare * 100).toFixed(1)}% of tax payable classified`);

  const totals = yearTotals(panel);
  const gates = runGates(panel, context);
  for (const g of gates) log(`  ${g.ok ? 'PASS' : 'FAIL'}  ${g.title} — ${g.detail}`);
  const failed = gates.filter((g) => !g.ok);

  // PRRT, kept in its own file and never summed into company tax: the payer
  // lists only partially overlap and adding them would double-count.
  const prrtByYear = {};
  for (const p of prrtRecords) {
    (prrtByYear[p.year] ||= []).push({ n: p.name, a: p.abn, v: p.prrt });
  }
  for (const y of Object.keys(prrtByYear)) prrtByYear[y].sort((a, b) => b.v - a.v);

  // ---- Write the site payload -------------------------------------------
  const yi = Object.fromEntries(YEARS.map((y, i) => [y, i]));
  const compact = {
    years: YEARS,
    // [yearIndex, totalIncome, taxableIncome, taxPayable] with null preserved:
    // a null taxable/payable is a REPORTED NIL, which the interface prints as
    // "nil" rather than "$0" — see parse.mjs toMoney.
    entities: panel.entities.map((e) => ({
      n: e.name,
      a: e.abn || null,
      s: e.sector,
      r: e.rows.map((r) => [yi[r.year], r.total, r.taxable, r.payable]),
    })),
  };

  const meta = {
    generated: new Date().toISOString(),
    latestYear: context.latestYear,
    years: YEARS,
    thresholdChangeYear: THRESHOLD_CHANGE_YEAR,
    stableThreshold: STABLE_THRESHOLD,
    entityCount: panel.entities.length,
    rowCount: records.length,
    blankAbnRows: context.blankAbnRows,
    priorYearAmendments: context.crossYearRows,
    sectors: SECTORS,
    sectorCoverage: context.sectorCoverage,
    totals,
    nilStreaks: nilStreaks(panel, 2).slice(0, 400),
    anchors: ATO_ANCHORS,
    gates,
    gatesPassed: gates.filter((g) => g.ok).length,
    gatesTotal: gates.length,
    source: {
      dataset: pkg.title,
      landing: `https://data.gov.au/data/dataset/${pkg.name}`,
      licence: pkg.license_title,
      publisher: pkg.organization?.title ?? 'Australian Taxation Office',
      metadataModified: pkg.metadata_modified,
      resources: resources.map((r) => ({ year: r.year, name: r.name, url: r.url })),
    },
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'panel.json'), JSON.stringify(compact));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(OUT, 'prrt.json'), JSON.stringify(prrtByYear));

  const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
  log(`Wrote panel.json (${size('panel.json')} KB), meta.json (${size('meta.json')} KB), `
    + `prrt.json (${size('prrt.json')} KB)`);
  log(`Gates: ${meta.gatesPassed}/${meta.gatesTotal} passing`);

  void normaliseAbn;
  if (failed.length) {
    log(`\nFAILED GATES:\n${failed.map((g) => `  - ${g.title}: ${g.detail}`).join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
