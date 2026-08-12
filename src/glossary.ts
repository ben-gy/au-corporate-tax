// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Assume the reader knows nothing about company tax. Every jargon term that
// appears anywhere in the interface has an entry here and is marked up as a
// .glossary-link, so nobody has to leave the page to understand a number.

export interface GlossaryEntry { term: string; definition: string }

export const GLOSSARY: Record<string, GlossaryEntry> = {
  'total-income': {
    term: 'Total income',
    definition:
      'Gross income — essentially everything the company took in before any expenses. It is NOT '
      + 'profit. A supermarket chain with $60 billion of total income has already spent most of '
      + 'that buying stock and paying staff. Comparing tax to total income makes every company '
      + 'look like it pays almost nothing, which is why this site never does it.',
  },
  'taxable-income': {
    term: 'Taxable income',
    definition:
      'What is left after allowable deductions, and after losses carried forward from earlier '
      + 'years are applied. This is the base that company tax is actually charged on. A company '
      + 'can have billions in total income and nil taxable income perfectly lawfully — most often '
      + 'because it made a loss, or is still working through losses from previous years.',
  },
  'tax-payable': {
    term: 'Tax payable',
    definition:
      'The company tax owed on that year’s taxable income, after offsets such as franking '
      + 'credits, research and development incentives and foreign income tax offsets. It is the '
      + 'figure from the tax return at the time it was lodged, and does not reflect later audits, '
      + 'amendments or settlements.',
  },
  'effective-rate': {
    term: 'Effective tax rate',
    definition:
      'Tax payable divided by taxable income. The statutory company tax rate in Australia is 30% '
      + '(25% for base-rate entities), so most profitable companies land near 30%. A rate well '
      + 'below that usually means offsets — commonly franking credits on dividends already taxed, '
      + 'or the R&D tax incentive.',
  },
  nil: {
    term: 'Nil tax payable',
    definition:
      'The company reported no company tax owed for that year. There are many lawful reasons: an '
      + 'accounting loss, prior-year losses being carried forward and used up, deductions '
      + 'exceeding income, or offsets such as franking credits and the R&D incentive reducing the '
      + 'bill to zero. Nil is not evidence of avoidance — but a company reporting nil every year '
      + 'for a decade is a reasonable thing to ask questions about.',
  },
  losses: {
    term: 'Tax losses',
    definition:
      'A company that makes a loss pays no tax that year, and can carry the loss forward to offset '
      + 'profits in later years. The report cannot show you this directly: the law only requires '
      + 'publication of taxable income where there is a positive amount, so a loss appears as a '
      + 'blank. That is also why adding up the published taxable-income column comes out higher '
      + 'than the ATO’s own aggregate — the ATO nets the losses off and the column cannot.',
  },
  consolidation: {
    term: 'Tax consolidation',
    definition:
      'A wholly-owned Australian group can elect to be treated as a single taxpayer. Under the '
      + 'single entity rule the subsidiary members then stop lodging returns of their own — so '
      + 'they do not appear in this report at all, rather than appearing in it with nil. The ATO '
      + 'lists joining a consolidated group as one of the reasons a company drops out of the '
      + 'population from one year to the next. What this does mean is that a familiar brand may be '
      + 'represented here by one head company, or by several separately-lodging entities, and the '
      + 'file gives no way to tell which.',
  },
  threshold: {
    term: 'Reporting threshold',
    definition:
      'A company only appears in this report if its total income reaches a threshold. For '
      + 'Australian public and foreign-owned entities that has always been $100 million. For '
      + 'Australian-owned private companies it was $200 million until 2021–22, and was cut to '
      + '$100 million from 2022–23 — which added over a thousand companies to the report in a '
      + 'single year. Counting companies across that boundary measures the law change, not '
      + 'corporate behaviour.',
  },
  entity: {
    term: 'Entity (not group)',
    definition:
      'Each row is one legal entity with one ABN, not a corporate group. Large groups file under '
      + 'several entities, so "Australia’s biggest taxpayer" changes depending on whether you '
      + 'total by entity or by group — and this file contains no group identifier, so every '
      + 'ranking here is by entity and says so.',
  },
  abn: {
    term: 'ABN',
    definition:
      'Australian Business Number — the 11-digit identifier that makes an entity trackable across '
      + 'years even when it changes its name. A small number of entities in the report have no '
      + 'ABN, typically foreign partnerships; they are tracked by name instead.',
  },
  prrt: {
    term: 'PRRT',
    definition:
      'Petroleum Resource Rent Tax — a separate 40% tax on profits from petroleum projects, paid '
      + 'by around a dozen entities a year. It is reported in its own table and is deliberately '
      + 'never added to company tax on this site, because the payer lists only partly overlap and '
      + 'combining them would double-count some companies and misstate others.',
  },
  franking: {
    term: 'Franking credits',
    definition:
      'When an Australian company pays tax and then pays a dividend, the tax already paid travels '
      + 'with the dividend as a credit. A company whose income is largely dividends from other '
      + 'Australian companies can therefore owe little or no further tax — the tax was paid, just '
      + 'not by that entity.',
  },
  amendment: {
    term: 'Late lodgers',
    definition:
      'Some corporations lodge after the cut-off date for their year’s report, so the ATO includes '
      + 'them in a later one — tagged with the income year they belong to. This site routes each '
      + 'of those rows back to its own year, so its figure for an older year is slightly higher '
      + 'than the one the ATO announced at the time: 4,064 companies for 2022–23 against the 3,985 '
      + 'originally published, the difference being 79 late lodgers that turned up in the 2023–24 '
      + 'report. These are additions, not revisions — across all 28,000 rows no company’s figure '
      + 'for a year is ever restated by a later report.',
  },
};
