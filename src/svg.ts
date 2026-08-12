// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Minimal SVG helpers. Charts here are hand-rolled rather than pulled from a
// charting library: every view needs its own interaction wiring anyway, and a
// library's default tooltip is exactly the unstyled, touch-invisible thing the
// factory's tooltip rule exists to prevent.

import { safe } from './format';

const NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (Node | string)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    // Every numeric attribute goes through safe(): a single NaN coordinate
    // makes the browser drop the element silently, with no console error and
    // no visible clue beyond a hole in the chart.
    node.setAttribute(k, typeof v === 'number' ? String(safe(v)) : v);
  }
  for (const c of children) node.append(c);
  return node;
}

export function svgRoot(width: number, height: number, cls = 'chart'): SVGSVGElement {
  const s = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: cls,
    role: 'img',
  });
  return s;
}

/** A nice round tick step for a linear axis covering [0, max]. */
export function niceTicks(max: number, count = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = 0; v <= max * 1.0000001; v += step) out.push(v);
  return out;
}

export interface Scale { (v: number): number; domain: [number, number]; range: [number, number] }

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = ((v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/**
 * A log scale that refuses to pretend zero exists.
 *
 * Company income spans five orders of magnitude, so the scatter needs log x —
 * but log(0) is undefined and a nil tax bill is the single most interesting
 * value in this dataset. Rather than clamp nil to the axis floor (which buries
 * it among the smallest payers and is a lie), values at or below the floor are
 * reported as out-of-domain and the caller draws them in a separate band.
 */
export function logScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const l0 = Math.log10(Math.max(d0, 1));
  const l1 = Math.log10(Math.max(d1, 10));
  const [r0, r1] = range;
  return (v: number): number => {
    if (!Number.isFinite(v) || v <= 0) return r0;
    return r0 + ((Math.log10(v) - l0) / (l1 - l0)) * (r1 - r0);
  };
}

export function powerTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let p = Math.floor(Math.log10(Math.max(min, 1))); p <= Math.ceil(Math.log10(Math.max(max, 10))); p++) {
    out.push(10 ** p);
  }
  return out;
}

/** A rounded-corner path for a horizontal bar, so short bars stay legible. */
export function hBar(x: number, y: number, w: number, h: number, r = 2): string {
  const rr = Math.min(r, Math.max(0, w) / 2, h / 2);
  const x1 = x + Math.max(0, w);
  return `M${safe(x)},${safe(y)}H${safe(x1 - rr)}a${rr},${rr} 0 0 1 ${rr},${rr}`
    + `V${safe(y + h - rr)}a${rr},${rr} 0 0 1 ${-rr},${rr}H${safe(x)}Z`;
}

/** Cubic Bézier ribbon between two vertical spans — the Sankey link shape. */
export function ribbon(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number): string {
  const mx = (x0 + x1) / 2;
  return `M${safe(x0)},${safe(y0a)}`
    + `C${safe(mx)},${safe(y0a)} ${safe(mx)},${safe(y1a)} ${safe(x1)},${safe(y1a)}`
    + `L${safe(x1)},${safe(y1b)}`
    + `C${safe(mx)},${safe(y1b)} ${safe(mx)},${safe(y0b)} ${safe(x0)},${safe(y0b)}Z`;
}

export function polyline(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${safe(x)},${safe(y)}`).join('');
}
