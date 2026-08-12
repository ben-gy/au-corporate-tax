// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Loads the pipeline's output and derives everything the views need. Deriving
// in the browser rather than precomputing per-view files keeps ONE definition
// of each figure: the concentration curve, the sector matrix and the drawer all
// read the same 28,000 rows, so they cannot disagree with each other.

export interface Sector { id: string; label: string; colour: string }

export interface Gate { id: string; title: string; ok: boolean; detail: string }

export interface YearTotal {
  year: string;
  entities: number;
  total: number;
  taxable: number;
  payable: number;
  nil: number;
  stableEntities: number;
  stableNil: number;
  stablePayable: number;
  stableTaxable: number;
}

export interface Anchor {
  year: string; entities: number; total: number; taxable: number; payable: number; citation: string;
}

export interface Meta {
  generated: string;
  latestYear: string;
  years: string[];
  thresholdChangeYear: string;
  stableThreshold: number;
  entityCount: number;
  rowCount: number;
  blankAbnRows: number;
  priorYearAmendments: number;
  sectors: Sector[];
  sectorCoverage: { entityShare: number; payableShare: number };
  totals: YearTotal[];
  anchors: Anchor[];
  gates: Gate[];
  gatesPassed: number;
  gatesTotal: number;
  source: {
    dataset: string; landing: string; licence: string; publisher: string;
    metadataModified: string; resources: { year: string; name: string; url: string }[];
  };
}

/** One entity-year cell. A null taxable/payable is a REPORTED NIL, not missing. */
export interface Row {
  year: string;
  yi: number;
  total: number | null;
  taxable: number | null;
  payable: number | null;
}

export interface Entity {
  id: number;
  name: string;
  abn: string | null;
  sector: string;
  rows: Row[];
  /** Fast lookups the views lean on, computed once at load. */
  totalIncome: number;
  totalTaxable: number;
  totalPayable: number;
  yearsPresent: number;
  neverPaid: boolean;
  search: string;
}

export interface Bundle {
  meta: Meta;
  years: string[];
  entities: Entity[];
  byYear: Map<string, { entity: Entity; row: Row }[]>;
  totals: Map<string, YearTotal>;
  prrt: Record<string, { n: string; a: string; v: number }[]>;
  sectorById: Map<string, Sector>;
}

interface RawEntity { n: string; a: string | null; s: string; r: [number, number | null, number | null, number | null][] }

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadAll(signal: AbortSignal): Promise<Bundle> {
  const [meta, panel, prrt] = await Promise.all([
    getJson<Meta>('data/meta.json', signal),
    getJson<{ years: string[]; entities: RawEntity[] }>('data/panel.json', signal),
    getJson<Record<string, { n: string; a: string; v: number }[]>>('data/prrt.json', signal),
  ]);

  const years = panel.years;
  const entities: Entity[] = panel.entities.map((e, id) => {
    const rows: Row[] = e.r.map(([yi, total, taxable, payable]) => ({
      year: years[yi], yi, total, taxable, payable,
    }));
    const d = (v: number | null) => v ?? 0;
    const totalPayable = rows.reduce((s, r) => s + d(r.payable), 0);
    return {
      id,
      name: e.n,
      abn: e.a,
      sector: e.s,
      rows,
      totalIncome: rows.reduce((s, r) => s + d(r.total), 0),
      totalTaxable: rows.reduce((s, r) => s + d(r.taxable), 0),
      totalPayable,
      yearsPresent: rows.length,
      neverPaid: rows.length > 0 && totalPayable === 0,
      search: e.n.toLowerCase(),
    };
  });

  const byYear = new Map<string, { entity: Entity; row: Row }[]>(years.map((y) => [y, []]));
  for (const entity of entities) {
    for (const row of entity.rows) byYear.get(row.year)?.push({ entity, row });
  }

  return {
    meta,
    years,
    entities,
    byYear,
    totals: new Map(meta.totals.map((t) => [t.year, t])),
    prrt,
    sectorById: new Map(meta.sectors.map((s) => [s.id, s])),
  };
}

export const d = (v: number | null | undefined): number => v ?? 0;

/** The sector palette, resolved with a safe fallback for an unknown id. */
export function sectorOf(b: Bundle, id: string): Sector {
  return b.sectorById.get(id) ?? { id, label: id, colour: '#b9b3a7' };
}
