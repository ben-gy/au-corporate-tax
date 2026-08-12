// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson

import { describe, expect, it, vi } from 'vitest';
import {
  NIL, abnLabel, clamp, debounce, effectiveRate, escapeHtml, money, moneyShort,
  num, pct1, safe, signedPct, slug, tipAttr, tipHtml, yearLabel,
} from '../src/format';

describe('money', () => {
  it('prints a reported nil as "nil", never as $0', () => {
    // "$0" implies a number was recorded as zero; the ATO's blank cell is the
    // entity stating it had none. Same arithmetic, different claim.
    expect(money(null)).toBe(NIL);
    expect(money(undefined)).toBe(NIL);
    expect(money(0)).toBe(NIL);
    expect(money(Number.NaN)).toBe(NIL);
  });

  it('formats dollars with Australian separators', () => {
    expect(money(1234567)).toBe('$1,234,567');
    expect(money(1234.6)).toBe('$1,235');
  });
});

describe('moneyShort', () => {
  it('scales to trillions, billions, millions and thousands', () => {
    expect(moneyShort(3_278_800_000_000)).toBe('$3.28t');
    expect(moneyShort(95_700_000_000)).toBe('$95.7b');
    expect(moneyShort(6_250_000_000)).toBe('$6.25b');
    expect(moneyShort(412_000_000)).toBe('$412m');
    expect(moneyShort(1_500_000)).toBe('$1.5m');
    expect(moneyShort(12_000)).toBe('$12k');
    expect(moneyShort(940)).toBe('$940');
  });

  it('treats zero and null alike as nil', () => {
    expect(moneyShort(0)).toBe(NIL);
    expect(moneyShort(null)).toBe(NIL);
  });
});

describe('effectiveRate', () => {
  it('divides by TAXABLE income, not total income', () => {
    // Dividing tax by gross revenue makes every company look like it pays
    // almost nothing, which is the single most common way this dataset is
    // misreported. 30% of taxable income is the meaningful comparison.
    expect(effectiveRate(3e7, 1e8)).toBeCloseTo(30, 10);
  });

  it('returns null — not 0 — when there is no taxable income', () => {
    expect(effectiveRate(0, 0)).toBeNull();
    expect(effectiveRate(null, null)).toBeNull();
    expect(effectiveRate(15, 0)).toBeNull();
    expect(effectiveRate(15, -100)).toBeNull();
  });

  it('reports a genuine zero rate against positive taxable income', () => {
    expect(effectiveRate(0, 1e8)).toBe(0);
    expect(effectiveRate(null, 1e8)).toBe(0);
  });
});

describe('escaping', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x">O'Brien & Sons</a>`))
      .toBe('&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Sons&lt;/a&gt;');
  });

  it('uses a RAW newline for setAttribute and the entity for innerHTML', () => {
    // These are not interchangeable. tipHtml inside setAttribute renders a
    // literal "&#10;"; tipAttr inside innerHTML collapses the line break.
    expect(tipAttr(['a', 'b'])).toBe('a\nb');
    expect(tipHtml(['a', 'b'])).toBe('a&#10;b');
  });

  it('escapes company names going into a tooltip attribute', () => {
    expect(tipHtml(['O\'BRIEN & SONS <PTY> LTD']))
      .toBe('O&#39;BRIEN &amp; SONS &lt;PTY&gt; LTD');
  });
});

describe('safe and clamp', () => {
  it('replaces a non-finite SVG coordinate with a fallback', () => {
    // One NaN coordinate makes the browser drop the whole element, silently.
    expect(safe(Number.NaN)).toBe(0);
    expect(safe(Infinity, 5)).toBe(5);
    expect(safe(-3)).toBe(-3);
  });

  it('clamps within bounds', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('small formatters', () => {
  it('formats numbers, percentages and years', () => {
    expect(num(1234567)).toBe('1,234,567');
    expect(num(null)).toBe('—');
    expect(pct1(27.94)).toBe('27.9%');
    expect(pct1(null)).toBe('—');
    expect(signedPct(6.2)).toBe('+6.2%');
    expect(signedPct(-3.8)).toBe('-3.8%');
    expect(yearLabel('2023-24')).toBe('2023–24');
  });

  it('formats an ABN the way the register prints it, and names the absence', () => {
    expect(abnLabel('51824753556')).toBe('51 824 753 556');
    expect(abnLabel(null)).toBe('no ABN');
  });

  it('slugs a company name into something URL-safe and bounded', () => {
    expect(slug('BHP GROUP LIMITED')).toBe('bhp-group-limited');
    expect(slug('A.C.N. 003 933 300 PTY LIMITED')).toBe('a-c-n-003-933-300-pty-limited');
    expect(slug('--- ???  ---')).toBe('');
    expect(slug('X'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('debounce', () => {
  it('fires once, after the delay, with the last arguments', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const fn = debounce(spy as never, 300);
    (fn as (v: string) => void)('a');
    (fn as (v: string) => void)('b');
    vi.advanceTimersByTime(299);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('b');
    vi.useRealTimers();
  });
});
