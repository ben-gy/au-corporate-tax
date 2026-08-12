# Corporate Tax Transparency

**What Australia's biggest companies earned and what they paid in tax — 6,158 named entities, eleven years of ATO data, searchable.**

🔗 **Live:** [https://au-corporate-tax.benrichardson.dev](https://au-corporate-tax.benrichardson.dev)

## What is this?

Every year the Australian Taxation Office is required by law to publish the total income,
taxable income and tax payable of Australia's largest corporations. It is one of the most
newsworthy datasets the Commonwealth produces — and it is published as eleven separate Excel
workbooks with four different sheet names, three different header layouts, and no key linking
a company from one year to the next.

This site assembles them into a single searchable eleven-year panel: 6,158 named entities,
28,000 entity-years, from 2013–14 to 2023–24. You can type a company name and see its entire
published history in one place, which is not otherwise possible without downloading and
joining eleven spreadsheets by hand.

It is also built to be hard to misread. The dataset is routinely reported badly, in three
specific ways, and each of those has a countermeasure here:

- **Total income is gross revenue, not profit.** Dividing tax by total income makes every
  company look like it pays nothing. This site never does it — every rate shown is tax over
  *taxable* income, and the one place a percentage-of-income figure appears it is labelled.
- **The reporting population changed in 2022–23.** The threshold for Australian-owned private
  companies was cut from $200m to $100m, adding more than a thousand companies overnight. Any
  chart of *counts* across that line measures a change in the law, so the break is drawn on
  the chart, not footnoted under it.
- **Nil tax is lawful and ordinary.** Losses, losses carried forward, franking credits and the
  R&D incentive all produce it. The lawful explanation appears on the same screen as every
  figure that invites the opposite conclusion — including inside the drill-down panel, which
  is the screen people actually link to.

## Who is this for?

Australian journalists working the annual transparency-report story; tax and policy
researchers who want the panel rather than one year; union and NGO analysts; accountants
checking a competitor or a client. And, in the largest numbers, ordinary people who have just
read a headline about companies paying no tax and want to look up one specific company by
name.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| [ATO Corporate Tax Transparency](https://data.gov.au/data/dataset/corporate-transparency) (data.gov.au) | Eleven annual workbooks: entity name, ABN, total income, taxable income, tax payable, income year, plus a PRRT table | Annual, published late October / November |
| [ATO *Corporate tax transparency report* commentary](https://www.ato.gov.au/businesses-and-organisations/corporate-tax-measures-and-assurance/large-business/in-detail/tax-transparency) | The ATO's own published aggregates, used as external reconciliation anchors | Annual |

Licensed **CC BY 3.0 AU**. Attribution is required and is carried in the site footer, the
About panel and the page's JSON-LD.

## Features

- **Company search** — every one of 6,158 named entities, filterable by year, sector and nil
  status, with a shareable `#c=<ABN>` link per company.
- **Drill-down drawer** — one company's full eleven-year history, income and tax drawn on
  separate scales, with the lawful-explanation caveat wherever it is warranted.
- **The shrinkage funnel** — $3.28t of income → $394b taxable → $95.7b tax, with both drops
  sized and explained.
- **Nil streak grid** — entity × year, showing not just *that* a company reported nil but for
  how many consecutive years, split by whether a loss can explain it.
- **Concentration treemap** + cumulative-share curve — the top 10 entities pay 36.2% of all
  company tax; the top 50 pay 60.3%.
- **Rank bump chart** — eleven years of the largest payers trading places, with the
  entity-vs-group caveat worked through on the year's actual numbers.
- **Income vs effective rate scatter** — log income against tax ÷ taxable income, with nil
  payers in their own band below an explicit axis break rather than buried at 0%.
- **Sector matrix** — a name-based classifier covering 39% of companies but 85% of the tax
  base, with both numbers stated and Unclassified as a first-class row.

## Tech Stack

- **Runtime:** Vanilla TypeScript — no framework, no charting library. All SVG is hand-rolled.
- **Build:** Vite 6 · **Testing:** Vitest (135 tests) · **Hosting:** GitHub Pages, static
- **Data:** GitHub Actions pipeline, yearly, matching the ATO's annual release
- **Bundle:** ~96 KB JS (30 KB gzipped), no third-party runtime code at all

## Local Development

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

Refresh the data (downloads eleven workbooks and runs every reconciliation gate):

```bash
cd pipeline && npm install && cd .. && npm run data
```

## How it works

`pipeline/collect.mjs` resolves the dataset through the data.gov.au CKAN API, downloads all
eleven workbooks, and hands the rows to `pipeline/parse.mjs` — which is deliberately
dependency-free so the test suite can exercise the parsing logic without installing the
pipeline package. The result is written to `public/data/` and the browser derives every view
from the same 28,000 rows, so no two views can disagree.

**Fourteen reconciliation gates run before anything is published**, and they check the things
that fail silently rather than the things that throw:

- The latest year matches the ATO's own published headline figures **exactly** (4,110
  entities, $3,278.8b income, $95.7b tax payable).
- A prior year must *exceed* its as-published figures by a bounded amount — proving late
  lodgers are being routed backwards into their own income year, and that they are not being
  double-counted.
- Reading every sheet of the 2013–14 workbook must yield materially more rows than reading
  only `Combined` — i.e. the guard against triple-counting the first year is doing something.
  A guard measured on convenient input is not a guard.
- Blank-ABN rows must survive as separate entities. Keying the panel on ABN alone collapses
  every ABN-less row in every year into one fabricated mega-entity that then appears in all
  eleven years near the top of the never-paid ranking. It does not throw and it looks fine.
- The taxable-income divergence stays inside its expected band. Summing the ATO's own
  published taxable-income column gives 6–8% *more* than the ATO's stated aggregate, because
  the law only requires publication of a positive amount, so losses appear as blanks and the
  column can only sum upwards. The gate fails if that gap disappears **or** grows — either
  would mean the source changed and the site's explanation is now wrong.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
The ATO data is licensed CC BY 3.0 AU and its attribution requirement is not mine to remove;
it stays in the site's footer and methodology panel.

This is an independent site and is not affiliated with, or endorsed by, the Australian
Taxation Office or the Australian Government. Nothing here is tax, financial or legal advice.
