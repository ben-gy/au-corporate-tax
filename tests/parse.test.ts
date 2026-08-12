// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Tests for the pipeline's parsing logic. `pipeline/parse.mjs` is dependency-
// free precisely so this file can import it without installing the pipeline
// package — logic that can only be exercised after a second `npm install` is
// logic that never runs on CI.
//
// Every case here is drawn from the actual shape of an ATO workbook, and the
// awkward ones are the point: three overlapping sheets in the first year,
// header rows that move, blank ABNs, and amendments arriving years late.

import { describe, expect, it } from 'vitest';
import {
  YEARS, THRESHOLD_CHANGE_YEAR,
  buildPanel, classifySector, entityKey, fallbackYear, findHeaderRow, mapColumns,
  nilStreaks, normaliseAbn, normaliseName, prrtFromSheet, recordsFromSheet,
  runGates, selectSheets, toMoney, yearTotals,
} from '../pipeline/parse.mjs';

const HEADER = ['Name', 'ABN', 'Total income $', 'Taxable income $', 'Tax payable $', 'Income year'];
const OLD_HEADER = ['Name', 'ABN', 'Total Income $', 'Taxable Income $', 'Tax Payable $'];

describe('selectSheets', () => {
  it('reads only the Combined sheet where one exists', () => {
    // THE TRIPLE-COUNT TRAP. The 2013-14 workbook's Combined sheet already
    // contains December and March. Reading all three reads the year roughly
    // twice and invents a collapse in entity numbers the following year.
    const plan = selectSheets(['Information', 'December', 'March', 'Combined']);
    expect(plan.data).toEqual(['Combined']);
    expect(plan.skipped.map((s) => s.name)).toEqual(['Information', 'December', 'March']);
  });

  it('keeps prior-year amendment sheets, which are NOT components of a Combined sheet', () => {
    // 2015-16 carries three data sheets and all three must be read — they hold
    // different income years, not overlapping copies of one.
    const plan = selectSheets(['Information', '2015-16', '2014-15', '2013-14']);
    expect(plan.data).toEqual(['2015-16', '2014-15', '2013-14']);
  });

  it('routes PRRT sheets separately under both spellings the ATO uses', () => {
    expect(selectSheets(['Information', 'Income tax details', 'PRRT details']).prrt).toEqual(['PRRT details']);
    expect(selectSheets(['Information', 'Income tax', 'PRRT']).prrt).toEqual(['PRRT']);
  });

  it('handles the four different data-sheet names across the eleven files', () => {
    for (const name of ['Income tax details', 'Income tax', '2014-15', 'Combined']) {
      expect(selectSheets(['Information', name]).data).toEqual([name]);
    }
  });
});

describe('findHeaderRow and mapColumns', () => {
  it('finds a header on row 0 (modern workbooks)', () => {
    expect(findHeaderRow([HEADER, ['ACME', 1, 2]])).toBe(0);
  });

  it('finds a header on row 1, under a title row (the three earliest workbooks)', () => {
    expect(findHeaderRow([['Income tax information for 2013-14'], OLD_HEADER, ['ACME']])).toBe(1);
  });

  it('finds a header on row 1 under the amendment blurb', () => {
    const rows = [['This list consists of entities whose information was not available…'], OLD_HEADER];
    expect(findHeaderRow(rows)).toBe(1);
  });

  it('returns -1 when there is no header at all', () => {
    expect(findHeaderRow([['just'], ['some'], ['prose']])).toBe(-1);
  });

  it('maps columns case-insensitively across the two capitalisations', () => {
    expect(mapColumns(HEADER)).toEqual({ name: 0, abn: 1, total: 2, taxable: 3, payable: 4, year: 5 });
    expect(mapColumns(OLD_HEADER)).toEqual({ name: 0, abn: 1, total: 2, taxable: 3, payable: 4 });
  });
});

describe('toMoney', () => {
  it('keeps a reported nil as null rather than collapsing it to zero', () => {
    // A blank taxable-income cell is the entity reporting none. It aggregates
    // as zero dollars but it is not the number zero, and the interface prints
    // "nil" rather than "$0" on the strength of this distinction.
    expect(toMoney(null)).toBeNull();
    expect(toMoney(undefined)).toBeNull();
    expect(toMoney('')).toBeNull();
    expect(toMoney('-')).toBeNull();
  });

  it('passes numbers through and parses formatted strings', () => {
    expect(toMoney(452892659)).toBe(452892659);
    expect(toMoney('$1,234,567')).toBe(1234567);
    expect(toMoney(' 1 000 ')).toBe(1000);
    expect(toMoney(0)).toBe(0);
  });

  it('rejects non-numeric text instead of producing NaN', () => {
    expect(toMoney('n/a')).toBeNull();
    expect(toMoney(Number.NaN)).toBeNull();
    expect(toMoney(Infinity)).toBeNull();
  });
});

describe('normalisation and entity identity', () => {
  it('pads a short ABN and strips separators', () => {
    expect(normaliseAbn(90000100096)).toBe('90000100096');
    expect(normaliseAbn('51 824 753 556')).toBe('51824753556');
    expect(normaliseAbn(' ')).toBe('');
  });

  it('collapses runs of whitespace in names', () => {
    expect(normaliseName('  ACME   PTY  LTD ')).toBe('ACME PTY LTD');
  });

  it('keeps blank-ABN entities separate from one another', () => {
    // THE PHANTOM MEGA-ENTITY. Keying on ABN alone folds every ABN-less row in
    // every year into one fabricated company that appears in all eleven years
    // and lands near the top of any "never paid tax" ranking.
    const a = entityKey({ abn: '', name: 'INFRABRIDGE (GIF CAYMAN HOLDCO) 4 LP' });
    const b = entityKey({ abn: '', name: 'PRUDENTIAL ASSURANCE COMPANY SINGAPORE' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^n:/);
  });

  it('tracks an entity across a rename via its ABN', () => {
    expect(entityKey({ abn: '33104201014', name: '21ST CENTURY RESORT HOLDINGS PTY LTD' }))
      .toBe(entityKey({ abn: '33104201014', name: '21ST CENTURY RESORTS HOLDINGS PTY LIMITED' }));
  });
});

describe('recordsFromSheet', () => {
  it('prefers the Income year column over the file the row arrived in', () => {
    const rows = [HEADER,
      ['ACME PTY LTD', 11111111111, 100, 50, 15, '2023-24'],
      ['LATE PTY LTD', 22222222222, 200, 60, 18, '2022-23']];
    const out = recordsFromSheet(rows, { sheetName: 'Income tax details', fileYear: '2023-24' });
    expect(out.map((r) => r.year)).toEqual(['2023-24', '2022-23']);
  });

  it('falls back to the sheet name, then the file year, when there is no year column', () => {
    expect(fallbackYear('2013-14', '2015-16')).toBe('2013-14');
    expect(fallbackYear('Combined', '2013-14')).toBe('2013-14');
    const rows = [['Income tax information for 2013-14'], OLD_HEADER, ['ACME', 1, 100, 50, 15]];
    expect(recordsFromSheet(rows, { sheetName: 'Combined', fileYear: '2013-14' })[0].year).toBe('2013-14');
  });

  it('does not delete a real company whose name begins with "NOTE"', () => {
    // The guard that skips the amendment blurb was once `/^note[:s]?\b/i`,
    // which silently removed NOTE PRINTING AUSTRALIA LIMITED — the Reserve
    // Bank's banknote printer — from every year, putting the entity count
    // exactly one below the ATO's published figure. A guard that eats real rows
    // is worse than no guard, so this asserts the colon is required.
    const rows = [HEADER,
      ['NOTE PRINTING AUSTRALIA LIMITED', 86082630671, 196987818, 19029285, 5708786, '2023-24'],
      ['This list consists of entities whose information was not available'],
      ['Notes: figures are as lodged']];
    const out = recordsFromSheet(rows, { sheetName: 'Income tax details', fileYear: '2023-24' });
    expect(out.map((r) => r.name)).toEqual(['NOTE PRINTING AUSTRALIA LIMITED']);
  });

  it('skips rows with no name and throws on a missing required column', () => {
    const rows = [HEADER, ['', 1, 2], ['REAL PTY LTD', 2, 3, 4, 5, '2023-24']];
    expect(recordsFromSheet(rows, { sheetName: 's', fileYear: '2023-24' })).toHaveLength(1);
    expect(() => recordsFromSheet([['Name', 'ABN']], { sheetName: 's', fileYear: '2023-24' }))
      .toThrow(/missing the total column/);
    expect(() => recordsFromSheet([['nothing']], { sheetName: 'oops', fileYear: '2023-24' }))
      .toThrow(/no header row/);
  });
});

describe('prrtFromSheet', () => {
  it('reads the PRRT table and returns nothing for a sheet without a PRRT column', () => {
    const rows = [['Name', 'ABN', 'PRRT Payable $'], ['ESSO AUSTRALIA RESOURCES PTY LTD', 62091829819, 351898218]];
    const out = prrtFromSheet(rows, { sheetName: 'PRRT details', fileYear: '2023-24' });
    expect(out).toEqual([{ name: 'ESSO AUSTRALIA RESOURCES PTY LTD', abn: '62091829819', prrt: 351898218, year: '2023-24' }]);
    expect(prrtFromSheet([HEADER, ['A', 1, 2]], { sheetName: 'x', fileYear: '2023-24' })).toEqual([]);
  });
});

describe('buildPanel', () => {
  const rec = (name, abn, year, fileYear, total, taxable, payable) =>
    ({ name, abn, year, fileYear, total, taxable, payable, sheetName: 's' });

  it('routes a prior-year amendment into the year it belongs to', () => {
    const panel = buildPanel([
      rec('ACME', '11111111111', '2022-23', '2022-23', 100, 50, 15),
      rec('LATE', '22222222222', '2022-23', '2023-24', 200, 60, 18),
    ]);
    const totals = Object.fromEntries(yearTotals(panel).map((t) => [t.year, t]));
    expect(totals['2022-23'].entities).toBe(2);
    expect(totals['2023-24'].entities).toBe(0);
  });

  it('lets a later workbook supersede an earlier statement of the same cell', () => {
    // Amendments REPLACE, they do not accumulate. Appending would double-count.
    const panel = buildPanel([
      rec('ACME', '11111111111', '2022-23', '2022-23', 100, 50, 15),
      rec('ACME', '11111111111', '2022-23', '2023-24', 999, 500, 150),
    ]);
    expect(panel.entities).toHaveLength(1);
    expect(panel.entities[0].rows).toHaveLength(1);
    expect(panel.entities[0].rows[0].payable).toBe(150);
  });

  it('does not let an older workbook overwrite a newer figure', () => {
    const panel = buildPanel([
      rec('ACME', '11111111111', '2022-23', '2023-24', 999, 500, 150),
      rec('ACME', '11111111111', '2022-23', '2022-23', 100, 50, 15),
    ]);
    expect(panel.entities[0].rows[0].payable).toBe(150);
  });

  it('adopts the most recent legal name and remembers the old one', () => {
    const panel = buildPanel([
      rec('OLD NAME PTY LTD', '33104201014', '2019-20', '2019-20', 1, 1, 1),
      rec('NEW NAME PTY LIMITED', '33104201014', '2023-24', '2023-24', 1, 1, 1),
    ]);
    expect(panel.entities[0].name).toBe('NEW NAME PTY LIMITED');
    expect(panel.entities[0].aliases).toContain('OLD NAME PTY LTD');
  });

  it('sorts rows chronologically regardless of input order', () => {
    const panel = buildPanel([
      rec('ACME', '1'.repeat(11), '2023-24', '2023-24', 1, 1, 1),
      rec('ACME', '1'.repeat(11), '2013-14', '2013-14', 1, 1, 1),
    ]);
    expect(panel.entities[0].rows.map((r) => r.year)).toEqual(['2013-14', '2023-24']);
  });
});

describe('yearTotals', () => {
  it('counts a null tax payable as a nil-tax company and as zero dollars', () => {
    const panel = buildPanel([
      { name: 'A', abn: '1'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 1000, taxable: null, payable: null },
      { name: 'B', abn: '2'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 1000, taxable: 500, payable: 150 },
    ]);
    const t = yearTotals(panel).find((x) => x.year === '2023-24');
    expect(t.entities).toBe(2);
    expect(t.nil).toBe(1);
    expect(t.payable).toBe(150);
    expect(t.taxable).toBe(500);
  });

  it('tracks the $200m+ cohort separately so trends can cross the threshold change', () => {
    const panel = buildPanel([
      { name: 'BIG', abn: '1'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 3e8, taxable: 1e8, payable: 3e7 },
      { name: 'SMALL', abn: '2'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 1.5e8, taxable: 1e7, payable: 3e6 },
    ]);
    const t = yearTotals(panel).find((x) => x.year === '2023-24');
    expect(t.entities).toBe(2);
    expect(t.stableEntities).toBe(1);
    expect(t.stablePayable).toBe(3e7);
  });
});

describe('nilStreaks', () => {
  it('lists only entities that reported nil in every year they appear', () => {
    const panel = buildPanel([
      { name: 'NEVER', abn: '1'.repeat(11), year: '2022-23', fileYear: '2022-23', total: 100, taxable: null, payable: null },
      { name: 'NEVER', abn: '1'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 200, taxable: null, payable: null },
      { name: 'ONCE', abn: '2'.repeat(11), year: '2022-23', fileYear: '2022-23', total: 100, taxable: null, payable: null },
      { name: 'ONCE', abn: '2'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 100, taxable: 50, payable: 15 },
    ]);
    const streaks = nilStreaks(panel, 1);
    expect(streaks.map((s) => s.name)).toEqual(['NEVER']);
    expect(streaks[0].years).toBe(2);
    expect(streaks[0].totalIncome).toBe(300);
  });

  it('honours the minimum-years filter, because one nil year is not a streak', () => {
    const panel = buildPanel([
      { name: 'ONE', abn: '3'.repeat(11), year: '2023-24', fileYear: '2023-24', total: 100, taxable: null, payable: null },
    ]);
    expect(nilStreaks(panel, 1)).toHaveLength(1);
    expect(nilStreaks(panel, 2)).toHaveLength(0);
  });
});

describe('classifySector', () => {
  it('pins the largest payers by ABN, ahead of any keyword', () => {
    expect(classifySector('HANCOCK PROSPECTING PTY LTD', '69008676417')).toBe('mining');
    expect(classifySector('AMP LIMITED', '49079354519')).toBe('insurance');
    expect(classifySector('ANZ GROUP HOLDINGS LIMITED', '16659510791')).toBe('banking');
  });

  it('falls back to keywords for the long tail', () => {
    expect(classifySector('SOME COAL MINING PTY LTD', '')).toBe('mining');
    expect(classifySector('BIGTOWN INSURANCE LIMITED', '')).toBe('insurance');
    expect(classifySector('ACME LOGISTICS PTY LTD', '')).toBe('transport');
  });

  it('returns "other" rather than guessing, for a name with no signal', () => {
    // Unclassified is a first-class category in the sector view, not a hidden
    // residual — inventing a sector for A.C.N. 123 456 789 PTY LTD would be
    // worse than admitting the classifier does not know.
    expect(classifySector('A.C.N. 003 933 300 PTY LIMITED', '')).toBe('other');
    expect(classifySector('', '')).toBe('other');
  });

  it('is deterministic', () => {
    const name = 'GENERIC HOLDINGS PTY LTD';
    expect(classifySector(name, '')).toBe(classifySector(name, ''));
  });
});

describe('runGates', () => {
  // The fixture mirrors the real population shape: a stable cohort of ~2,000
  // companies above $200m that is present in every year, plus a tail below
  // $200m that only becomes reportable once the threshold is cut. Making every
  // company $300m instead would make the $200m+ cohort jump 46% at the
  // threshold change and fail the very gate that exists to prove it does not.
  const STABLE = 2000;
  const panelFor = (perYear) => buildPanel(YEARS.flatMap((year, yi) =>
    Array.from({ length: perYear[yi] }, (_, i) => ({
      name: `E${i}`, abn: String(i).padStart(11, '0'), year, fileYear: year,
      total: i < STABLE ? 3e8 : 1.5e8,
      taxable: i < STABLE ? 1e8 : 5e7,
      payable: i < STABLE ? 3e7 : 1.5e7,
    }))));

  // blankAbnRows is 0 here because the fixture gives every entity an ABN. The
  // phantom-entity gate gets its own test below, built on a panel that actually
  // contains ABN-less rows — a context that claims 240 blank rows over a panel
  // with none is testing nothing except the fixture's own inconsistency.
  const baseContext = {
    naive2013Rows: 3741, guarded2013Rows: 1859, blankAbnRows: 0,
    crossYearRows: 552, futureRows: 0, latestYear: '2023-24', anchors: [],
  };

  it('passes a well-formed panel', () => {
    const counts = COUNTS;
    const gates = runGates(panelFor(counts), baseContext);
    const failing = gates.filter((g) => !g.ok).map((g) => g.id);
    expect(failing).toEqual([]);
  });

  it('fails the triple-count gate when the Combined guard stops being load-bearing', () => {
    // VALIDATE THE GUARD, NOT THE OUTPUT. If reading every 2013-14 sheet stops
    // producing materially more rows than reading Combined alone, the guard is
    // doing nothing and its removal would go unnoticed.
    const counts = COUNTS;
    const gates = runGates(panelFor(counts), { ...baseContext, naive2013Rows: 1860 });
    expect(gates.find((g) => g.id === 'triple-count-guard').ok).toBe(false);
  });

  it('catches the phantom mega-entity — tested on a panel that HAS blank ABNs', () => {
    // 22 ABN-less rows across 11 years. Keyed correctly they are 2 entities;
    // keyed on ABN alone they collapse into 1, which is the defect. The gate's
    // floor is rows/years, so it must reject a single survivor and accept two.
    const blankRows = YEARS.flatMap((year) => [
      { name: 'INFRABRIDGE (GIF CAYMAN HOLDCO) 4 LP', abn: '', year, fileYear: year, total: 5e8, taxable: null, payable: null },
      { name: 'PRUDENTIAL ASSURANCE COMPANY SINGAPORE', abn: '', year, fileYear: year, total: 7e8, taxable: 1e8, payable: 3e7 },
    ]);
    const withBlanks = buildPanel([
      ...YEARS.flatMap((year) => Array.from({ length: 2100 }, (_, i) => ({
        name: `E${i}`, abn: String(i).padStart(11, '0'), year, fileYear: year,
        total: 3e8, taxable: 1e8, payable: 3e7,
      }))),
      ...blankRows,
    ]);
    const ctx = { ...baseContext, blankAbnRows: blankRows.length };
    expect(runGates(withBlanks, ctx).find((g) => g.id === 'no-phantom-entity').ok).toBe(true);

    // Now the collapse: every blank-ABN row folded into a single entity.
    const collapsed = buildPanel([
      ...YEARS.flatMap((year) => Array.from({ length: 2100 }, (_, i) => ({
        name: `E${i}`, abn: String(i).padStart(11, '0'), year, fileYear: year,
        total: 3e8, taxable: 1e8, payable: 3e7,
      }))),
      ...blankRows.map((r) => ({ ...r, name: 'PHANTOM' })),
    ]);
    expect(runGates(collapsed, ctx).find((g) => g.id === 'no-phantom-entity').ok).toBe(false);
  });

  it('fails when prior-year amendments stop being routed', () => {
    const counts = COUNTS;
    const gates = runGates(panelFor(counts), { ...baseContext, crossYearRows: 0 });
    expect(gates.find((g) => g.id === 'prior-year-routing').ok).toBe(false);
  });

  it('fails when the threshold break disappears — which would mean a year was mis-parsed', () => {
    const flat = YEARS.map(() => 2000);
    const gates = runGates(panelFor(flat), baseContext);
    expect(gates.find((g) => g.id === 'threshold-break').ok).toBe(false);
    expect(THRESHOLD_CHANGE_YEAR).toBe('2022-23');
  });

  const COUNTS = [1909, 1984, 2095, 2146, 2254, 2375, 2421, 2527, 2776, 4064, 4110];
  /** The anchor a perfectly-parsed panel would reproduce for a given year. */
  const anchorFor = (panel, year, taxableRatio = 1) => {
    const t = yearTotals(panel).find((x) => x.year === year);
    return { year, entities: t.entities, total: t.total, payable: t.payable, taxable: t.taxable / taxableRatio };
  };

  it('requires the latest year to match its anchor exactly', () => {
    const panel = panelFor(COUNTS);
    const anchor = anchorFor(panel, '2023-24');
    expect(runGates(panel, { ...baseContext, anchors: [anchor] })
      .find((g) => g.id === 'anchor-2023-24').ok).toBe(true);

    const off = runGates(panel, { ...baseContext, anchors: [{ ...anchor, entities: anchor.entities + 1 }] });
    expect(off.find((g) => g.id === 'anchor-2023-24').ok).toBe(false);
  });

  it('requires a PRIOR year to exceed its as-published figures, not merely be near them', () => {
    // Amendments only ever ADD to an older year. "Within 3%" alone would also
    // pass a panel that had silently dropped every amendment, so the gate is
    // directional: strictly greater, and bounded.
    const panel = panelFor(COUNTS);
    const current = anchorFor(panel, '2022-23');
    const published = {
      ...current,
      entities: current.entities - 79,
      total: current.total * 0.993,
      payable: current.payable * 0.996,
    };
    expect(runGates(panel, { ...baseContext, anchors: [published] })
      .find((g) => g.id === 'anchor-2022-23').ok).toBe(true);

    // Identical to the as-published figures means no amendment ever landed.
    expect(runGates(panel, { ...baseContext, anchors: [current] })
      .find((g) => g.id === 'anchor-2022-23').ok).toBe(false);
  });

  it('pins the taxable-income divergence to a band instead of hiding or ignoring it', () => {
    const panel = panelFor(COUNTS);
    expect(runGates(panel, { ...baseContext, anchors: [anchorFor(panel, '2023-24', 1.078)] })
      .find((g) => g.id === 'taxable-divergence-2023-24').ok).toBe(true);

    // Reconciling exactly is ALSO a failure: it would mean the source changed
    // behaviour, and a human needs to look rather than the site quietly
    // publishing a different definition than the one it documents on screen.
    expect(runGates(panel, { ...baseContext, anchors: [anchorFor(panel, '2023-24', 1)] })
      .find((g) => g.id === 'taxable-divergence-2023-24').ok).toBe(false);

    // And so is a divergence that has grown beyond anything observed.
    expect(runGates(panel, { ...baseContext, anchors: [anchorFor(panel, '2023-24', 1.4)] })
      .find((g) => g.id === 'taxable-divergence-2023-24').ok).toBe(false);
  });

  it('fails on negative money and on rows post-dating their workbook', () => {
    const bad = buildPanel([{
      name: 'A', abn: '1'.repeat(11), year: '2023-24', fileYear: '2023-24',
      total: -5, taxable: 1, payable: 1,
    }]);
    expect(runGates(bad, baseContext).find((g) => g.id === 'money-finite').ok).toBe(false);

    const counts = COUNTS;
    expect(runGates(panelFor(counts), { ...baseContext, futureRows: 3 })
      .find((g) => g.id === 'no-future-rows').ok).toBe(false);
  });

  it('judges sector coverage by DOLLARS, not by how many companies got a label', () => {
    // A classifier naming 60% of companies but 20% of the tax base is useless,
    // and a count-based coverage metric hides that completely.
    const counts = COUNTS;
    const panel = panelFor(counts);
    const lots = runGates(panel, { ...baseContext, sectorCoverage: { entityShare: 0.30, payableShare: 0.82 } });
    expect(lots.find((g) => g.id === 'sector-coverage').ok).toBe(true);

    const hollow = runGates(panel, { ...baseContext, sectorCoverage: { entityShare: 0.95, payableShare: 0.20 } });
    expect(hollow.find((g) => g.id === 'sector-coverage').ok).toBe(false);
  });
});
