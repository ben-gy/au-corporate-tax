// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson

/**
 * A reported nil must never print as "$0".
 *
 * In the ATO's report a blank taxable-income or tax-payable cell is the entity
 * saying it had none — a statement, not a missing value. Both aggregate to zero
 * dollars, but printing "$0" invites the reader to think a number was recorded
 * as zero when the record is simply "nil". They are the same arithmetic and a
 * different claim, so the interface says "nil".
 */
export const NIL = 'nil';

export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NIL;
  if (v === 0) return NIL;
  return `$${Math.round(v).toLocaleString('en-AU')}`;
}

/** Compact dollars for chart labels and stat tiles: $3.28t, $95.7b, $412m. */
export function moneyShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NIL;
  const a = Math.abs(v);
  if (a === 0) return NIL;
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}t`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(a >= 1e10 ? 1 : 2)}b`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-AU');
}

export function pct1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

export function signedPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/**
 * The effective tax rate.
 *
 * Deliberately tax payable over TAXABLE income, never over total income. Total
 * income is gross revenue, not profit, so "paid 0.3% of its income in tax" is a
 * number with no meaning that reads like an accusation. Where taxable income is
 * nil there is no rate to compute and this returns null — which the interface
 * renders as a separate "nil" band rather than as 0%.
 */
export function effectiveRate(payable: number | null, taxable: number | null): number | null {
  if (!taxable || taxable <= 0) return null;
  return ((payable ?? 0) / taxable) * 100;
}

/**
 * Two escaping functions, and they are NOT interchangeable. `setAttribute`
 * takes a RAW newline; a string going into `innerHTML` needs the `&#10;`
 * entity. Using the innerHTML form with setAttribute renders a literal "&#10;"
 * in the tooltip; using the raw form inside innerHTML collapses the break.
 */
export function tipAttr(lines: string[]): string {
  return lines.join('\n');
}

export function tipHtml(lines: string[]): string {
  return lines.map(escapeHtml).join('&#10;');
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ink used wherever a sector colour needs readable text on top of it. */
export const INK = '#1b1f27';

/**
 * The readable text colour for a given background.
 *
 * Sector colours are chosen dark enough that white clears WCAG AA on all but
 * one of them — but "Unclassified" is deliberately pale (it must recede), and
 * white on pale grey is a 2.1:1 smear. Picking by luminance means a future
 * sector colour cannot quietly ship unreadable labels, and it is why the pills
 * and treemap labels set their colour inline rather than in the stylesheet.
 */
export function textOn(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio(INK, background) ? '#ffffff' : INK;
}

/** Guards every SVG coordinate: one NaN silently voids the whole element. */
export function safe(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 300): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: never[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

/** "2023-24" → "2023–24" (en dash), the way the ATO prints it. */
export function yearLabel(y: string): string {
  return y.replace('-', '–');
}

/** Format an ABN the way the ABR does: 51 824 753 556. */
export function abnLabel(abn: string | null): string {
  if (!abn) return 'no ABN';
  return abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
}
