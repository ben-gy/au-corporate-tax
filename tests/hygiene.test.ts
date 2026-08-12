// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Source-hygiene checks. Each one exists because the defect it catches is
// INVISIBLE in jsdom and in unit tests — it only shows up in a real browser,
// usually on a phone, usually after deploy.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readSrc = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
// Strip comments before matching — several rules are DOCUMENTED by quoting the
// very anti-pattern they exist to prevent, and a naive regex reads that prose
// as the declaration itself.
const css = readSrc('src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const html = readSrc('index.html');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const srcFiles = walk(path.join(root, 'src')).filter((f) => /\.ts$/.test(f));

describe('the [hidden] guard', () => {
  it('is present, uses !important, and comes before any component rule', () => {
    // Without this, an author `display` on a class outranks the UA stylesheet's
    // `[hidden]{display:none}` and `el.hidden = true` does nothing at all. This
    // shipped an About modal that was open on load and could not be dismissed.
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
    expect(css.indexOf('[hidden]')).toBeLessThan(css.indexOf('.modal'));
  });
});

describe('the tooltip visibility rule', () => {
  it('defines BOTH .hover-tip and .hover-tip.visible', () => {
    // initTooltip() shows and hides purely by toggling `visible`. Defining only
    // `.hover-tip` paints the tooltip on first hover and never hides it — it
    // follows the pointer around the page forever. Nothing errors.
    expect(css).toMatch(/\.hover-tip\s*\{/);
    expect(css).toMatch(/\.hover-tip\.visible\s*\{[^}]*opacity:\s*1/);
  });
});

describe('sticky headers and scrollports', () => {
  it('body uses overflow-x: clip, never hidden', () => {
    // `overflow-x: hidden` on the body silently kills `position: sticky` on
    // every descendant, including the site header.
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).not.toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/);
  });
});

describe('overlay z-index', () => {
  it('scrim, drawer, modal and tooltip all outrank a mapping library', () => {
    // This site ships no map today. The stack is kept above 1000 anyway so that
    // adding one later cannot silently paint its panes over a modal — which has
    // shipped in this fleet before.
    for (const v of ['--z-scrim', '--z-panel', '--z-modal', '--z-tip']) {
      const m = css.match(new RegExp(`${v}:\\s*(\\d+)`));
      expect(m, `${v} must be defined`).toBeTruthy();
      expect(Number(m![1]), `${v} must exceed 1000`).toBeGreaterThan(1000);
    }
  });
});

describe('the overlay dismissal contract', () => {
  const overlay = readSrc('src/components/overlay.ts');

  it('closes on Escape, on a scrim pointerdown, and via a close control', () => {
    expect(overlay).toMatch(/'Escape'/);
    expect(overlay).toMatch(/scrim\.addEventListener\('pointerdown'/);
    expect(overlay).toMatch(/closeBtn\.addEventListener\('click'/);
  });

  it('uses ONE event family per control, so a tap cannot close and reopen', () => {
    // touchstart + click on the same control double-fires on a phone: the
    // overlay closes and instantly reopens, which reads as "the close button
    // does nothing".
    expect(overlay).not.toMatch(/addEventListener\('touchstart'/);
  });

  it('REMOVES the panel from the DOM rather than parking it off-canvas', () => {
    // A drawer left at translateX(100%) is still a real box on iOS Safari and
    // scrolls the page sideways; `overflow-x: clip` neither fixes that nor lets
    // scrollWidth detect it.
    expect(overlay).toMatch(/panel\.remove\(\)/);
    expect(overlay).toMatch(/scrim\.remove\(\)/);
    expect(css).not.toMatch(/\.drawer[^}]*translateX\(100%\)/);
  });

  it('gives the close control a 44x44 hit area inside the overlay bounds', () => {
    const rule = css.match(/\.close-btn\s*\{([^}]*)\}/)![1];
    expect(rule).toMatch(/width:\s*44px/);
    expect(rule).toMatch(/height:\s*44px/);
  });

  it('gives the scrim a real, reachable hit area', () => {
    const rule = css.match(/\.scrim\s*\{([^}]*)\}/)![1];
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).not.toMatch(/pointer-events:\s*none/);
  });
});

describe('sticky footer', () => {
  it('uses the flex column pattern so the footer sits at the bottom on short pages', () => {
    expect(css).toMatch(/#app\s*\{[^}]*min-height:\s*100vh/);
    expect(css).toMatch(/#app\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.main-content\s*\{[^}]*flex:\s*1 0 auto/);
  });
});

describe('mobile overflow defences', () => {
  it('no bare `1fr` auto-fill grid track (it re-introduces the min-width blowout)', () => {
    // `1fr` means `minmax(auto, 1fr)`, and the `auto` minimum refuses to shrink
    // below content width — which pushes the page sideways at 375px.
    const bad = css.match(/repeat\(auto-(?:fit|fill),\s*minmax\([^,)]*,\s*1fr\)\)/g) ?? [];
    for (const decl of bad) {
      expect(decl, `use minmax(min(NNNpx,100%),1fr): ${decl}`).toMatch(/min\(|0/);
    }
  });

  it('wide content has a local scroller class', () => {
    expect(css).toMatch(/\.scroller\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('every truncating flex child that could blow the layout sets min-width: 0', () => {
    // A nowrap child in a flex row refuses to shrink below its content width,
    // which is the single commonest cause of sideways scroll at 375px.
    const rule = css.match(/\.streak-name\s*\{([^}]*)\}/)![1];
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.streak-cells\s*\{[^}]*flex-shrink:\s*0/);
  });

  it('puts every wide chart inside a scroller rather than letting it stretch the page', () => {
    for (const f of srcFiles.filter((p) => /views\//.test(p))) {
      const s = readSrc(path.relative(root, f));
      const minWidths = s.match(/min-width:\s*\d{3,}px/g) ?? [];
      if (!minWidths.length) continue;
      expect(s, `${path.basename(f)}: a min-width chart must sit in a .scroller`).toMatch(/class="scroller"/);
    }
  });
});

describe('the feedback widget is hosted, never re-rolled', () => {
  it('loads w.js from the hosted origin', () => {
    expect(html).toContain('https://feedback.benrichardson.dev/w.js');
  });

  it('does not vendor a local copy or call mountFeedback', () => {
    expect(fs.existsSync(path.join(root, 'src/feedback.ts'))).toBe(false);
    for (const f of srcFiles) expect(readSrc(path.relative(root, f))).not.toMatch(/mountFeedback/);
  });

  it('keeps the footer structure the hosted widget mounts into', () => {
    expect(readSrc('src/main.ts')).toMatch(/class="site-footer"/);
    expect(readSrc('src/main.ts')).toMatch(/class="footer-inner"/);
  });
});

describe('analytics', () => {
  it('ships the Cloudflare beacon and nothing else', () => {
    expect(html).toContain('static.cloudflareinsights.com/beacon.min.js');
    expect(html).not.toMatch(/googletagmanager|google-analytics|plausible|fathom|matomo|segment/i);
  });
});

describe('SEO assets', () => {
  it('has no canonical link (Pages already 301s to the custom domain)', () => {
    expect(html).not.toMatch(/rel=["']canonical["']/);
  });

  it('ships og.png, robots.txt, sitemap.xml, the IndexNow key, a favicon and a CNAME', () => {
    for (const f of ['og.png', 'robots.txt', 'sitemap.xml', 'CNAME',
      '133936b7b2ab337d2e2288fd7dd7c30f.txt', 'favicon.svg']) {
      expect(fs.existsSync(path.join(root, 'public', f)), `public/${f}`).toBe(true);
    }
    expect(fs.statSync(path.join(root, 'public', 'og.png')).size).toBeGreaterThan(5000);
  });

  it('the CNAME matches the og:url host, the sitemap and robots.txt', () => {
    const cname = readSrc('public/CNAME').trim();
    expect(html).toContain(`https://${cname}/`);
    expect(readSrc('public/sitemap.xml')).toContain(`https://${cname}/`);
    expect(readSrc('public/robots.txt')).toContain(`https://${cname}/sitemap.xml`);
  });

  it('declares the data licence in the JSON-LD, because the source requires attribution', () => {
    expect(html).toMatch(/"license":\s*"https:\/\/creativecommons\.org\/licenses\/by\/3\.0\/au\//);
    expect(html).toMatch(/Australian Taxation Office/);
  });
});

describe('no GitHub links in the UI', () => {
  it('the site never links to its own repository', () => {
    for (const f of srcFiles) {
      expect(readSrc(path.relative(root, f)), path.basename(f)).not.toMatch(/github\.com\/ben-gy/);
    }
    expect(html).not.toMatch(/github\.com\/ben-gy/);
  });
});

describe('attribution', () => {
  it('the footer links to benrichardson.dev and the lab directory', () => {
    const main = readSrc('src/main.ts');
    expect(main).toContain('https://benrichardson.dev/');
    expect(main).toContain('https://lab.benrichardson.dev');
  });

  it('data attribution names the ATO and survives anywhere the figures appear', () => {
    const main = readSrc('src/main.ts');
    expect(main).toMatch(/Australian Taxation Office/);
    expect(main).toMatch(/Report of Entity Tax Information/);
    expect(main).toMatch(/data\.gov\.au/);
  });
});

describe('tooltips', () => {
  it('no native SVG <title> is used as the tooltip mechanism', () => {
    // Native <title> is slow, unstyled and invisible on touch.
    for (const f of srcFiles) {
      const s = readSrc(path.relative(root, f));
      expect(s.match(/<title>[^<]+<\/title>/g) ?? [], path.basename(f)).toEqual([]);
    }
  });

  it('every view attaches data-tip to its marks', () => {
    for (const f of srcFiles.filter((p) => /views\//.test(p))) {
      expect(readSrc(path.relative(root, f)), path.basename(f)).toMatch(/data-tip/);
    }
  });
});

describe('nav tabs', () => {
  it('carry words only — never a count badge', () => {
    const main = readSrc('src/main.ts');
    const labels = [...main.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const l of labels) expect(l, `nav label "${l}"`).not.toMatch(/\d/);
  });

  it('there are at least five distinct views', () => {
    expect(fs.readdirSync(path.join(root, 'src', 'views')).filter((f) => f.endsWith('.ts')).length)
      .toBeGreaterThanOrEqual(5);
  });
});

describe('keyboard operability', () => {
  // Each of these was a real defect: a div or span with a click handler looks
  // and behaves correctly with a mouse and is completely unusable without one.
  const allSrc = srcFiles.map((f) => readSrc(path.relative(root, f))).join('\n');

  it('glossary triggers are buttons, never spans', () => {
    // The glossary is this site's entire explanatory layer. As spans, not one
    // definition could be opened by keyboard or screen reader.
    expect(allSrc).not.toMatch(/<span[^>]*class="glossary-link"/);
    expect(allSrc).toMatch(/<button type="button" class="glossary-link"/);
    expect(css).toMatch(/\.glossary-link\s*\{[^}]*appearance:\s*none/);
  });

  it('sortable table headers are buttons, not click handlers on the th', () => {
    const companies = readSrc('src/views/companies.ts');
    expect(companies).toMatch(/class="th-sort"/);
    expect(companies).toMatch(/\.th-sort'\)\.forEach/);
    expect(companies, 'the click listener must be on the button, not the th')
      .not.toMatch(/th\[data-sort\]'\)\.forEach\(\(th\) => \{\s*th\.addEventListener\('click'/);
  });

  it('streak-grid cells are buttons carrying their own accessible name', () => {
    // The per-year figures live only in the hover tooltip, so as spans they
    // were unreachable by keyboard, screen reader AND touch.
    const nil = readSrc('src/views/nil.ts');
    expect(nil).toMatch(/createElement\('button'\)/);
    expect(nil).toMatch(/cell\.setAttribute\('aria-label'/);
  });

  it('filter results are announced', () => {
    for (const f of ['src/views/companies.ts', 'src/views/nil.ts']) {
      expect(readSrc(f), f).toMatch(/role="status"/);
    }
  });

  it('the page keeps a real main landmark and does not fake a tablist', () => {
    // role="tabpanel" on <main> overrides the landmark and removes "skip to
    // main content" from every screen reader; role="tab" without roving focus
    // and aria-controls is a half-implemented pattern.
    // Comments are stripped first: this rule is DOCUMENTED by naming the very
    // roles it forbids, and a naive match reads that prose as the markup.
    const main = readSrc('src/main.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    expect(main).toMatch(/<main class="main-content" id="view-root">/);
    expect(main).not.toMatch(/role="tabpanel"/);
    expect(main).not.toMatch(/role="tab"/);
    expect(main).not.toMatch(/role="tablist"/);
    expect(main).toMatch(/aria-current/);
  });

  it('the drill-down drawer has an accessible name', () => {
    expect(readSrc('src/components/overlay.ts')).toMatch(/labelledBy = 'dd-title'/);
    expect(readSrc('src/drilldown.ts')).toMatch(/id="dd-title"/);
  });
});

describe('colour is never the only carrier', () => {
  it('every body-text colour token clears WCAG AA on both backgrounds', () => {
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
    const token = (name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1];
    // --text-muted was #b3b7bd (2.1:1) and --text-tertiary #8a8f98 (2.9:1), and
    // both are used for the caveat line under every headline figure.
    for (const name of ['--text-primary', '--text-secondary', '--text-tertiary', '--text-muted']) {
      for (const bg of ['--bg-base', '--bg-surface', '--bg-panel']) {
        expect(ratio(token(name), token(bg)), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the scatter names the sector in its tooltip rather than relying on the dot colour', () => {
    // 3.8px dots in an 18-colour palette cannot be told apart by hue alone.
    expect(readSrc('src/views/rates.ts')).toMatch(/sectorOf\(b, p\.e\.sector\)\.label,/);
  });
});

describe('production code quality', () => {
  it('ships no console noise and no inline onclick handlers', () => {
    for (const f of srcFiles) {
      const s = readSrc(path.relative(root, f));
      expect(s, path.basename(f)).not.toMatch(/console\.(log|error|warn|debug)\s*\(/);
      // An inline onclick in an innerHTML string breaks under any CSP that
      // disallows unsafe-inline, and fails silently when it does.
      expect(s, path.basename(f)).not.toMatch(/\son[a-z]+="/);
    }
  });

  it('handles fetch failure with a user-visible error state', () => {
    const main = readSrc('src/main.ts');
    expect(main).toMatch(/class="error-state"/);
    expect(main).toMatch(/AbortController/);
  });
});

describe('licensing', () => {
  it('every first-party source file carries an SPDX header', () => {
    const all = [
      ...srcFiles.map((f) => path.relative(root, f)),
      'pipeline/parse.mjs', 'pipeline/collect.mjs',
    ];
    for (const f of all) {
      // Third-party patterns copied verbatim are exempt only where they carry
      // their own provenance note; everything authored here must be marked.
      if (/utils\/(squarify|svgZoom)\.ts|components\/tooltip\.ts/.test(f)) continue;
      expect(readSrc(f).slice(0, 220), f).toContain('SPDX-License-Identifier: AGPL-3.0-or-later');
    }
  });

  it('ships the AGPL and the additional terms, and declares them in package.json', () => {
    for (const f of ['LICENSE', 'ADDITIONAL-TERMS.md', 'CONTRIBUTING.md', 'THIRD-PARTY-NOTICES.md']) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
    const licence = readSrc('LICENSE');
    expect(licence).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    // Never an MIT LICENSE. Matched on the licence's own opening line rather
    // than the bare string "MIT", which appears inside "LIMITED" throughout the
    // AGPL text and made an earlier version of this assertion always fail.
    expect(licence.trimStart()).not.toMatch(/^MIT License/);
    // GitHub's licence detector matches the exact body, so nothing may be
    // wrapped around it.
    expect(licence.trimStart()).toMatch(/^GNU AFFERO GENERAL PUBLIC LICENSE/);
    expect(JSON.parse(readSrc('package.json')).license).toBe('AGPL-3.0-or-later');
    expect(fs.existsSync(path.join(root, 'public', 'third-party-notices.txt'))).toBe(true);
  });
});

describe('cron cadence', () => {
  it('the data pipeline runs yearly, matching an annual source', () => {
    const wf = readSrc('.github/workflows/data-pipeline.yml');
    const cron = wf.match(/cron:\s*'([^']+)'/)![1];
    const [, , dom, month] = cron.split(/\s+/);
    expect(dom).not.toBe('*');
    expect(month).not.toBe('*');
  });

  it('explicitly dispatches deploy.yml, because a GITHUB_TOKEN push does not', () => {
    // Without this the data job goes green, the commit lands on main, and the
    // live site never changes. It is invisible in the job status.
    const wf = readSrc('.github/workflows/data-pipeline.yml');
    expect(wf).toMatch(/gh workflow run deploy\.yml/);
    expect(wf).not.toMatch(/git pull --rebase/);
  });
});
