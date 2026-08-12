# Third-party notices

The code in this repository is licensed under the [GNU AGPL v3.0 or later](./LICENSE)
with the [additional attribution term](./ADDITIONAL-TERMS.md). This file records
everything in it that is *not*.

## What actually ships to the browser

**Nothing third-party.** The production bundle was checked against the `sources`
list in `dist/assets/*.js.map` — the only reliable account of what really ends up
in the build — and every module in it is first-party code from `src/`:

```
main.ts  data.ts  format.ts  glossary.ts  svg.ts  drilldown.ts
components/overlay.ts  components/tooltip.ts
utils/squarify.ts  utils/svgZoom.ts
views/{companies,funnel,nil,concentration,movers,rates,sectors}.ts
```

There is no charting library, no mapping library and no framework. Charts are
hand-rolled SVG. Fonts are the operating system's own stack (`-apple-system`,
`Segoe UI`, Helvetica, Arial), so no font files are distributed and no font
licence applies.

Three of the first-party files began as templates shared across this author's
other sites (`utils/squarify.ts`, `utils/svgZoom.ts`, `components/tooltip.ts`).
They are the same author's work under the same licence, not third-party code.
`utils/squarify.ts` implements the squarified treemap algorithm described in
Bruls, Huizing & van Wijk (2000), *Squarified Treemaps* — an algorithm, which
carries no licence, independently implemented here.

## Build-time and pipeline dependencies (not distributed)

These are needed to build the site or refresh its data. None of them is included
in the published output, and none is vendored into this repository.

| Component | Licence | Used for |
|---|---|---|
| [Vite](https://vitejs.dev) | MIT | bundling |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | type checking |
| [Vitest](https://vitest.dev) | MIT | tests |
| [jsdom](https://github.com/jsdom/jsdom) | MIT | DOM for tests |
| [`@types/node`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT | type definitions |
| [SheetJS `xlsx`](https://sheetjs.com) | Apache-2.0 | reading the ATO workbooks in `pipeline/collect.mjs` |

## Hosted scripts loaded at runtime

Two scripts are loaded from external origins at page load. They are services,
not bundled code, and no copy of either is distributed here.

- **Cloudflare Web Analytics** (`static.cloudflareinsights.com/beacon.min.js`) —
  cookie-less, anonymous page-view counts.
- **Feedback widget** (`feedback.benrichardson.dev/w.js`) — the author's own
  feedback form.

## Data

The corporate tax figures are published by the **Australian Taxation Office** as
*Corporate Tax Transparency — Report of Entity Tax Information*, via
[data.gov.au](https://data.gov.au/data/dataset/corporate-transparency), under
**Creative Commons Attribution 3.0 Australia** (CC BY 3.0 AU).

That licence *requires* attribution, and the requirement runs with the data
independently of the code licence. The attribution appears in the site footer,
in the About panel, and in the page's JSON-LD `license` field, and must not be
removed from any copy or derivative of this work.

Cross-checking figures are quoted from the ATO's own *Corporate tax transparency
report* commentary pages on ato.gov.au, under the same licence.

The ATO does not endorse this site and is not affiliated with it.
