// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Tests against the ACTUAL shipped data files, not fixtures. A parser can be
// perfectly correct on synthetic input and still ship a broken payload — these
// assert the bytes in public/data/ are the ones the site expects, and that the
// specific claims the interface makes in prose are true of them.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', p), 'utf8'));

const meta = read('meta.json');
const panel = read('panel.json');
const prrt = read('prrt.json');

const d = (v: number | null) => v ?? 0;
const entityRows = (e: { r: [number, number | null, number | null, number | null][] }) => e.r;

describe('the shipped payload', () => {
  it('covers eleven income years, oldest first', () => {
    expect(panel.years).toEqual([
      '2013-14', '2014-15', '2015-16', '2016-17', '2017-18', '2018-19',
      '2019-20', '2020-21', '2021-22', '2022-23', '2023-24',
    ]);
    expect(meta.years).toEqual(panel.years);
    expect(meta.latestYear).toBe('2023-24');
  });

  it('carries several thousand named entities, each with at least one year', () => {
    expect(panel.entities.length).toBeGreaterThan(5000);
    expect(panel.entities.length).toBe(meta.entityCount);
    for (const e of panel.entities) {
      expect(typeof e.n).toBe('string');
      expect(e.n.length).toBeGreaterThan(0);
      expect(entityRows(e).length).toBeGreaterThan(0);
      expect(entityRows(e).length).toBeLessThanOrEqual(11);
    }
  });

  it('never lets one entity hold two rows for the same year', () => {
    for (const e of panel.entities) {
      const years = entityRows(e).map((r) => r[0]);
      expect(new Set(years).size).toBe(years.length);
    }
  });

  it('has finite, non-negative money everywhere, with null preserved as a reported nil', () => {
    let nulls = 0;
    for (const e of panel.entities) {
      for (const [yi, total, taxable, payable] of entityRows(e)) {
        expect(yi).toBeGreaterThanOrEqual(0);
        expect(yi).toBeLessThan(11);
        for (const v of [total, taxable, payable]) {
          if (v === null) { nulls += 1; continue; }
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
    // Nulls are load-bearing: if the pipeline ever coerced them to 0, the
    // interface would start printing "$0" where the ATO reported nil.
    expect(nulls).toBeGreaterThan(1000);
  });

  it('gives every entity a sector from the published list', () => {
    const ids = new Set(meta.sectors.map((s: { id: string }) => s.id));
    for (const e of panel.entities) expect(ids.has(e.s)).toBe(true);
  });
});

describe('reconciliation', () => {
  it('passes every gate the pipeline ran', () => {
    const failing = meta.gates.filter((g: { ok: boolean }) => !g.ok);
    expect(failing.map((g: { title: string }) => g.title)).toEqual([]);
    expect(meta.gatesPassed).toBe(meta.gatesTotal);
    expect(meta.gatesTotal).toBeGreaterThanOrEqual(10);
  });

  it('matches the ATO’s published headline figures for the latest year', () => {
    const anchor = meta.anchors.find((a: { year: string }) => a.year === meta.latestYear);
    const t = meta.totals.find((x: { year: string }) => x.year === meta.latestYear);
    expect(t.entities).toBe(anchor.entities);
    expect(Math.abs(t.total / anchor.total - 1)).toBeLessThan(0.001);
    expect(Math.abs(t.payable / anchor.payable - 1)).toBeLessThan(0.001);
  });

  it('still diverges from the ATO on aggregate taxable income, as documented', () => {
    // This is a real property of the source, not a bug — and the site says so
    // in prose. If it ever reconciles, the prose becomes wrong and a human must
    // look, so the test fails in BOTH directions.
    for (const anchor of meta.anchors) {
      const t = meta.totals.find((x: { year: string }) => x.year === anchor.year);
      const excess = t.taxable / anchor.taxable - 1;
      expect(excess).toBeGreaterThan(0.03);
      expect(excess).toBeLessThan(0.12);
    }
  });

  it('recomputes the year totals from the panel itself', () => {
    // meta.totals is what the interface displays; panel.json is what it charts.
    // If those two ever disagree the site contradicts itself on screen.
    const byYear = new Map<number, { entities: number; total: number; taxable: number; payable: number; nil: number }>();
    for (let i = 0; i < panel.years.length; i++) {
      byYear.set(i, { entities: 0, total: 0, taxable: 0, payable: 0, nil: 0 });
    }
    for (const e of panel.entities) {
      for (const [yi, total, taxable, payable] of entityRows(e)) {
        const agg = byYear.get(yi)!;
        agg.entities += 1;
        agg.total += d(total);
        agg.taxable += d(taxable);
        agg.payable += d(payable);
        if (d(payable) === 0) agg.nil += 1;
      }
    }
    for (const [yi, year] of panel.years.entries()) {
      const mine = byYear.get(yi)!;
      const theirs = meta.totals.find((x: { year: string }) => x.year === year);
      expect(mine.entities, year).toBe(theirs.entities);
      expect(mine.total, year).toBe(theirs.total);
      expect(mine.taxable, year).toBe(theirs.taxable);
      expect(mine.payable, year).toBe(theirs.payable);
      expect(mine.nil, year).toBe(theirs.nil);
    }
  });
});

describe('the claims the interface makes in prose', () => {
  const t = (y: string) => meta.totals.find((x: { year: string }) => x.year === y);

  it('the nil-tax SHARE has fallen while the COUNT has risen', () => {
    // The Nil view leads on this reversal. If the data ever stops supporting
    // it, that copy is wrong and must change with it.
    const first = t('2013-14');
    const last = t(meta.latestYear);
    const shareFirst = (first.nil / first.entities) * 100;
    const shareLast = (last.nil / last.entities) * 100;
    expect(shareLast).toBeLessThan(shareFirst);
    expect(last.nil).toBeGreaterThan(first.nil);
  });

  it('the reporting-threshold cut shows as a jump in the population', () => {
    const before = t('2021-22').entities;
    const after = t(meta.thresholdChangeYear).entities;
    expect(after / before).toBeGreaterThan(1.25);
  });

  it('company tax is heavily concentrated in a handful of entities', () => {
    const latestIdx = panel.years.indexOf(meta.latestYear);
    type Rec = { r: [number, number | null, number | null, number | null][] };
    const paid = (panel.entities as Rec[])
      .map((e) => d(e.r.find((r) => r[0] === latestIdx)?.[3] ?? null))
      .filter((v) => v > 0)
      .sort((a, b) => b - a);
    const total = paid.reduce((s: number, v: number) => s + v, 0);
    const top10 = paid.slice(0, 10).reduce((s: number, v: number) => s + v, 0);
    expect((top10 / total) * 100).toBeGreaterThan(25);
    expect(paid.length).toBeLessThan(t(meta.latestYear).entities);
  });

  it('there is a real cohort that reported nil in every year it appeared', () => {
    const never = panel.entities.filter((e: { r: [number, number | null, number | null, number | null][] }) =>
      e.r.length === 11 && e.r.every((r) => d(r[3]) === 0));
    expect(never.length).toBeGreaterThan(20);
  });

  it('classifies most of the tax base by value, and says so honestly', () => {
    expect(meta.sectorCoverage.payableShare).toBeGreaterThan(0.75);
    // The entity share is much lower and that is fine — but it must be REPORTED,
    // because a reader judging the sector chart needs to know which of the two
    // numbers applies to what they are looking at.
    expect(meta.sectorCoverage.entityShare).toBeGreaterThan(0);
    expect(meta.sectorCoverage.entityShare).toBeLessThan(meta.sectorCoverage.payableShare);
  });
});

describe('nil means one thing everywhere', () => {
  it('the nil count is tax-payable-is-nil, and nothing else', () => {
    // The Rates view once defined its nil band as `no rate OR no tax`, a union
    // that put a company which had paid $9.8m under a legend reading "Nil tax
    // payable" — and made that view print 1,137 where every other view printed
    // 1,136 for the same year. One definition, asserted here for every year.
    for (const [yi, year] of (panel.years as string[]).entries()) {
      const nil = (panel.entities as { r: [number, number | null, number | null, number | null][] }[])
        .filter((e) => { const r = e.r.find((x) => x[0] === yi); return r ? d(r[3]) === 0 : false; }).length;
      const theirs = meta.totals.find((x: { year: string }) => x.year === year).nil;
      expect(nil, year).toBe(theirs);
    }
  });

  it('paying tax with no taxable income is rare, real, and never counted as nil', () => {
    // Offsets and consolidation adjustments produce it. These companies have no
    // effective rate to plot AND are not nil payers, so they get their own band.
    const latestIdx = panel.years.indexOf(meta.latestYear);
    const noBase = (panel.entities as { n: string; r: [number, number | null, number | null, number | null][] }[])
      .map((e) => e.r.find((x) => x[0] === latestIdx))
      .filter((r): r is [number, number | null, number | null, number | null] => !!r)
      .filter((r) => d(r[3]) > 0 && d(r[2]) <= 0);
    expect(noBase.length).toBeGreaterThan(0);
    expect(noBase.length, 'if this grows a lot, the band needs rethinking').toBeLessThan(20);
  });
});

describe('sector colours are legible', () => {
  // Sector colour is the only thing distinguishing a treemap tile or a pill, and
  // white-on-colour is the obvious default that quietly fails: six of the
  // original eighteen colours were between 3.7:1 and 4.4:1 against white, which
  // looks fine to a designer and is unreadable to a large number of people.
  // textOn() picks per colour, so this asserts the PAIR, not the background.
  const lum = (hex: string): number => {
    const n = parseInt(hex.replace('#', ''), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it('every sector reaches WCAG AA against the text colour actually used on it', () => {
    for (const s of meta.sectors as { id: string; label: string; colour: string }[]) {
      expect(s.colour, s.label).toMatch(/^#[0-9a-f]{6}$/i);
      const best = Math.max(ratio('#ffffff', s.colour), ratio('#1b1f27', s.colour));
      expect(best, `${s.label} (${s.colour}) — best text contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every sector colour is distinct', () => {
    const colours = (meta.sectors as { colour: string }[]).map((s) => s.colour.toLowerCase());
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe('PRRT is kept separate', () => {
  it('ships its own file and is never folded into company tax', () => {
    const years = Object.keys(prrt);
    expect(years.length).toBeGreaterThan(5);
    for (const year of years) {
      expect(Array.isArray(prrt[year])).toBe(true);
      for (const p of prrt[year]) expect(Number.isFinite(p.v)).toBe(true);
    }
    // A dozen or so payers a year — if this ever ballooned it would mean the
    // PRRT sheet had been read as the income-tax sheet.
    for (const year of years) expect(prrt[year].length).toBeLessThan(40);
  });
});
