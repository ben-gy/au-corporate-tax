# Site Plan: Corporate Tax Transparency

## Overview
- **Name:** Corporate Tax Transparency
- **Repo name:** au-corporate-tax
- **Tagline:** Search every large company's income, taxable income and tax bill in Australia — eleven years, 6,000 entities.

### Naming Convention
Plain topic name, no country code in the name. `country: "AU"` lives in the index entry.

## Target Audience
Australian journalists, tax and policy researchers, union and NGO campaigners, accountants,
and — the biggest group by volume — ordinary people who have just read a headline like
"one in three big companies paid no tax" and want to look up a specific company by name.
Mostly desktop for the researchers, heavily mobile for the headline-driven traffic that
spikes every November when the ATO publishes.

## Value Proposition
The ATO publishes this as eleven separate Excel workbooks with inconsistent sheet names and
no cross-year key. Nobody has assembled them into a searchable eleven-year panel. This site
lets you type a company name and immediately see its full published history — income,
taxable income, tax payable, effective rate — plus the structural context that makes the
numbers mean something: that the reporting population changed in 2022-23, that gross income
is not profit, and that a lawful nil result is not the same as avoidance.

## Data Sources
| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| ATO Corporate Tax Transparency (data.gov.au CKAN) | https://data.gov.au/data/api/3/action/package_show?id=corporate-transparency | 11 annual XLSX workbooks, 2013-14 → 2023-24: entity name, ABN, total income, taxable income, tax payable, income year; plus a PRRT sheet | Annual, late Oct–Nov | No (CC BY 3.0 AU) |

## Key Features
1. **Company search** — type any of ~6,000 names, get the full eleven-year panel in a drawer.
2. **The shrinkage funnel** — total income → taxable income → tax payable, per year, with both drops quantified and explained.
3. **The nil-tax streak grid** — every entity that reported nil tax payable in every year it appeared, ranked by cumulative income, drawn as an 11-column streak grid.
4. **Concentration treemap** — how few companies pay most of the company tax.
5. **Rank bump chart** — the top taxpayers trading places across eleven years.
6. **Income vs effective rate scatter** — log income against tax-over-taxable-income, with a dedicated NIL band so nil payers cannot hide off a log scale.
7. **Sector view** — a name-based sector classifier, with an honest Unclassified bucket, driving a sector × year tax matrix.
8. **The threshold explainer** — the 2022-23 $200m → $100m reporting-threshold cut rendered as a view, not buried in a footnote.

## Target Audience (detailed)
Two very different visitors. The researcher arrives on desktop, wants the whole panel, will
sort and drill and expects the caveats to be visible and precise. The headline-driven visitor
arrives on a phone from a news article or a search for one company name, has thirty seconds,
knows nothing about tax consolidation or carried-forward losses, and will draw a conclusion
from whatever the first screen says. The site has to serve the second visitor without
misleading them, which means the "$X income, $0 tax" framing must never appear without the
lawful-explanation caveat on the same screen.

## Style Direction
**Tone:** Professional / civic, with a financial-press seriousness.
**Colour palette:** Warm paper off-white, deep ink navy, a restrained brass/amber accent for
tax paid and a muted clay red for nil. Reads like the data pages of a serious newspaper —
authoritative, unexcitable, not a campaign site. Deliberately not the navy/teal of the
existing government-data sites in the fleet.
**UI density:** Balanced-to-dense. Tables and monospaced figures, but generous headroom.
**Dark/light theme:** Light.
**Reference sites for tone:** the FT's data pages; ProPublica's Nonprofit Explorer (the
named-entity search-and-drill pattern this site copies).

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite
- **Data strategy:** pipeline. Annual source → yearly cron (`0 19 8 11 *`, 8 November, which
  sits just after the ATO's usual late-October/November release), plus `workflow_dispatch`
  and a `pipeline/**` push trigger. The data job must explicitly dispatch `deploy.yml` — a
  `GITHUB_TOKEN` push does not trigger it.
- **Key libraries:** none at runtime. `xlsx` in the pipeline only. No map, so no Leaflet.

## Layout
Sticky header (title + About). Sticky word-only nav tabs. Content in a 1680px-max column.
Views are panels: stat row on top, then the visualization, then supporting tables. Drill-down
is a right-hand drawer, detached from the DOM when closed. Below 768px panels stack, the
table gets a local `overflow-x: auto` scroller, and the streak grid switches to a compact
cell size.

## Pages/Views
Single page, seven hash-routed views: Companies, Funnel, Nil, Concentration, Movers, Rates,
Sectors.

## Visualization Strategy
- **Companies (table + drawer)** — answers "what did *this* company pay?". The SEO surface:
  ~6,000 long-tail entity names. Sortable, searchable (debounced), filterable by year and by
  nil status. Every row clickable into a drawer with an eleven-year small-multiple.
- **Funnel (Sankey)** — answers "where does $3.3 trillion of income go before tax?". Two
  drops: income → taxable income (deductions, losses, consolidation) and taxable income →
  tax payable (offsets, rate). This is the view that stops the site being tabloid: it shows
  the shrinkage is mostly structural, not scandalous.
- **Nil (streak grid)** — answers "who has never paid?". A matrix of entity × year, cell
  filled where the entity reported and coloured by paid/nil. A ranked bar of cumulative
  income alongside. No other view can show a *streak*.
- **Concentration (treemap + cumulative curve)** — answers "how concentrated is company tax?".
  Squarified treemap from `patterns/treemap.ts`, with a Lorenz-style cumulative share curve
  marking the top-10 and top-50 lines.
- **Movers (bump chart)** — answers "who is Australia's biggest taxpayer, and has that
  changed?". Rank trajectories over eleven years; the mining-boom cycle is legible as
  crossing lines in a way no bar chart shows.
- **Rates (scatter)** — answers "does size predict effective rate?". Log income on x,
  tax ÷ taxable income on y, with a physically separate NIL band below the axis break so nil
  payers are counted rather than swallowed by the log scale. Zoom/pan via `patterns/svgZoom.ts`.
- **Sectors (matrix heatmap)** — answers "which industries carry the company tax base?".
  Sector × year, cell = share of total tax payable, with an explicit Unclassified row so the
  classifier's coverage is visible rather than hidden.
- **Threshold** — folded into Nil as a full-width callout plus a paired chart, because it is
  a confounder for exactly one metric (the *count* of nil payers) and belongs next to it.

Colour is consistent across every view: brass = tax paid, clay = nil, ink = income.
Sector colours are defined once in `src/sectors.ts` and referenced everywhere.
