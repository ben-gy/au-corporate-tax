// TEMPLATE: position-asserting layout tests. Copy alongside any hand-rolled
// layout algorithm (treemap, histogram, sankey, force) and adapt the imports.
//
// WHY: area-only tests pass on visually broken layouts. An implementation that
// stacks every cell at the same origin conserves total area perfectly and still
// renders as garbage — au-gov shipped exactly that with green CI. Positions,
// bounds, and pairwise overlap are what catch it.
import { describe, expect, it } from 'vitest';
import { squarify, type Rect } from '../src/utils/squarify';

const EPS = 1e-6;

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

// Deterministic pseudo-random values — no Math.random() in tests.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('layout — positional correctness', () => {
  const boxes: Array<[number, number]> = [[1000, 560], [200, 900], [500, 500]];
  const rand = mulberry32(7);
  const valueSets: number[][] = [
    [5, 3, 2, 1],
    [100],
    Array.from({ length: 9 }, () => 1),
    Array.from({ length: 50 }, () => 1 + Math.floor(rand() * 200)),
  ];

  for (const [W, H] of boxes) {
    for (const values of valueSets) {
      it(`lays out ${values.length} values in ${W}×${H}: in-bounds, no overlap, no NaN, area conserved`, () => {
        const rects = squarify(values, W, H);
        const total = values.reduce((a, b) => a + b, 0);
        expect(rects).toHaveLength(values.length);
        for (const r of rects) {
          // no NaN / negatives
          expect(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h)).toBe(true);
          expect(r.w).toBeGreaterThanOrEqual(0);
          expect(r.h).toBeGreaterThanOrEqual(0);
          // within bounds
          expect(r.x).toBeGreaterThanOrEqual(-EPS);
          expect(r.y).toBeGreaterThanOrEqual(-EPS);
          expect(r.x + r.w).toBeLessThanOrEqual(W + EPS * W);
          expect(r.y + r.h).toBeLessThanOrEqual(H + EPS * H);
        }
        // no pairwise overlap (>0.5px² fails)
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            expect(overlapArea(rects[i], rects[j])).toBeLessThan(0.5);
          }
        }
        // area conservation + per-cell proportionality
        const sumArea = rects.reduce((s, r) => s + r.w * r.h, 0);
        expect(Math.abs(sumArea - W * H)).toBeLessThan(W * H * 1e-6);
        rects.forEach((r, i) => {
          const expected = (values[i] / total) * W * H;
          expect(Math.abs(r.w * r.h - expected)).toBeLessThan(Math.max(1e-6, expected * 1e-6));
        });
      });
    }
  }

  it('handles degenerates: empty, single fills box, zero-total has no NaN', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    const [single] = squarify([42], 100, 80);
    expect(single.w * single.h).toBeCloseTo(8000, 6);
    for (const r of squarify([0, 0, 0], 100, 100)) {
      expect(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h)).toBe(true);
      expect(r.w * r.h).toBe(0);
    }
  });
});
