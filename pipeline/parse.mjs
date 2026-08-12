// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
//
// Pure parsing and reconciliation for the ATO Report of Entity Tax Information.
// Dependency-free ON PURPOSE: the test suite imports this file directly, and a
// pipeline whose logic can only run after `npm install` in a second package is a
// pipeline whose logic is never tested on CI.
//
// Every function here takes already-extracted rows (arrays of cell values) and
// returns plain data. All the I/O lives in collect.mjs.

/** The eleven published income years, oldest first. */
export const YEARS = [
  '2013-14', '2014-15', '2015-16', '2016-17', '2017-18', '2018-19',
  '2019-20', '2020-21', '2021-22', '2022-23', '2023-24',
];

/**
 * The income year in which the reporting threshold for Australian-owned
 * resident private companies was cut from $200m to $100m of total income.
 * Every count-based series that crosses this boundary is measuring a law
 * change, not corporate behaviour. Nothing in this codebase may draw a count
 * trend across it without saying so.
 */
export const THRESHOLD_CHANGE_YEAR = '2022-23';

/** Total income at or above which an entity was reportable in EVERY year. */
export const STABLE_THRESHOLD = 200_000_000;

// ---------------------------------------------------------------------------
// Sheet selection
// ---------------------------------------------------------------------------

/**
 * Pick which sheets of a workbook to read.
 *
 * THE TRIPLE-COUNT TRAP. The 2013-14 workbook holds three overlapping data
 * sheets — "December" (1,561 entities), "March" (321) and "Combined" (1,859,
 * the deduplicated union of the other two). Iterating every sheet reads the
 * first year roughly twice, which then renders as a spectacular fake collapse
 * in entity numbers from 2013-14 to 2014-15. Where a "Combined" sheet exists it
 * supersedes its component sheets and they must be dropped.
 *
 * The component names are matched explicitly rather than by "any sheet that
 * isn't Combined", because the 2014-15 and 2015-16 workbooks legitimately carry
 * EXTRA sheets — prior-year amendment lists — that must be kept and routed to
 * the year their sheet is named after.
 */
const SUPERSEDED_BY_COMBINED = new Set(['december', 'march']);

export function selectSheets(sheetNames) {
  const data = [];
  const prrt = [];
  const skipped = [];
  const hasCombined = sheetNames.some((s) => s.trim().toLowerCase() === 'combined');

  for (const name of sheetNames) {
    const key = name.trim().toLowerCase();
    if (key === 'information') { skipped.push({ name, why: 'front matter' }); continue; }
    if (key.startsWith('prrt')) { prrt.push(name); continue; }
    if (hasCombined && SUPERSEDED_BY_COMBINED.has(key)) {
      skipped.push({ name, why: 'superseded by the Combined sheet' });
      continue;
    }
    data.push(name);
  }
  return { data, prrt, skipped };
}

/**
 * The income year a sheet's rows belong to, when the rows themselves do not say.
 *
 * Modern workbooks carry an "Income year" column and that column always wins —
 * see recordsFromSheet. This is only the fallback, and it matters because the
 * 2014-15 and 2015-16 workbooks each carry sheets NAMED after a prior year that
 * hold late-lodged entities missing from that year's own report.
 */
export function fallbackYear(sheetName, fileYear) {
  const m = String(sheetName).trim().match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : fileYear;
}

// ---------------------------------------------------------------------------
// Header and cell handling
// ---------------------------------------------------------------------------

const COLUMN_PATTERNS = [
  ['name', /^name$/i],
  ['abn', /^abn$/i],
  ['total', /^total\s*income/i],
  ['taxable', /^taxable\s*income/i],
  ['payable', /^tax\s*payable/i],
  ['year', /^income\s*year$/i],
  ['prrt', /^prrt\s*payable/i],
];

/**
 * Find the header row. It is row 0 in most workbooks but row 1 in the three
 * earliest ones, which put a human title ("Income tax information for 2013-14")
 * above it. Searching for the row that actually looks like a header is both
 * simpler and safer than a per-year offset table.
 */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').trim());
    if (cells.some((c) => /^name$/i.test(c)) && cells.some((c) => /^abn$/i.test(c))) return i;
  }
  return -1;
}

export function mapColumns(headerRow) {
  const out = {};
  headerRow.forEach((cell, idx) => {
    const text = String(cell ?? '').trim();
    for (const [key, re] of COLUMN_PATTERNS) {
      if (out[key] === undefined && re.test(text)) { out[key] = idx; return; }
    }
  });
  return out;
}

/**
 * Coerce a money cell.
 *
 * A BLANK IS NOT A ZERO AND IS NOT AN ERROR. The ATO leaves taxable income and
 * tax payable blank where the entity had none, so `null` here means "reported as
 * nil", which is a different statement from "we do not know". Both aggregate as
 * zero dollars; only one of them may be PRINTED as "$0". Everything downstream
 * keeps the null so the interface can say "nil" instead.
 */
export function toMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function normaliseName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

export function normaliseAbn(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits.length ? digits.padStart(11, '0') : '';
}

/**
 * The cross-year identity of an entity.
 *
 * THE PHANTOM MEGA-ENTITY TRAP. Between 10 and 37 rows a year have NO ABN —
 * non-resident entities, partnerships and foreign limited partnerships, some of
 * them very large (one Singapore insurer books $7.5b of income with a blank
 * ABN). Keying the panel on ABN silently collapses every one of those, in every
 * year, into a single fabricated entity that then appears in all eleven years
 * and lands near the top of any "never paid tax" ranking. It does not throw, it
 * does not look wrong, and it inflated the never-paid count in the research
 * pass before it was caught. Blank ABNs therefore fall back to a name key, and
 * a gate asserts that no such collapse survives.
 */
export function entityKey(rec) {
  return rec.abn ? `a:${rec.abn}` : `n:${rec.name.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Row extraction
// ---------------------------------------------------------------------------

export function recordsFromSheet(rows, { sheetName, fileYear }) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) throw new Error(`no header row found in sheet "${sheetName}"`);
  const col = mapColumns(rows[headerIdx]);
  for (const required of ['name', 'abn', 'total']) {
    if (col[required] === undefined) {
      throw new Error(`sheet "${sheetName}" is missing the ${required} column`);
    }
  }

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = normaliseName(row[col.name]);
    if (!name) continue;
    // Drop the explanatory blurb that sits above the prior-year amendment
    // lists. The colon is REQUIRED: an earlier version of this guard was
    // `/^note[:s]?\b/i`, which silently deleted NOTE PRINTING AUSTRALIA LIMITED
    // — the Reserve Bank's banknote printer, a real reporting entity — from
    // every year, putting the parsed entity count exactly one below the ATO's
    // published figure. A guard that removes real rows is worse than no guard,
    // so this one only matches text that cannot be a company name.
    if (/^this list consists\b/i.test(name) || /^notes?:/i.test(name)) continue;

    const yearCell = col.year !== undefined ? String(row[col.year] ?? '').trim() : '';
    const year = /^\d{4}-\d{2}$/.test(yearCell) ? yearCell : fallbackYear(sheetName, fileYear);

    out.push({
      name,
      abn: normaliseAbn(row[col.abn]),
      total: toMoney(row[col.total]),
      taxable: col.taxable === undefined ? null : toMoney(row[col.taxable]),
      payable: col.payable === undefined ? null : toMoney(row[col.payable]),
      year,
      fileYear,
      sheetName,
    });
  }
  return out;
}

export function prrtFromSheet(rows, { sheetName, fileYear }) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return [];
  const col = mapColumns(rows[headerIdx]);
  if (col.prrt === undefined) return [];
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = normaliseName(row[col.name]);
    if (!name) continue;
    out.push({
      name,
      abn: normaliseAbn(row[col.abn]),
      prrt: toMoney(row[col.prrt]) ?? 0,
      year: fileYear,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Panel assembly
// ---------------------------------------------------------------------------

/**
 * Fold every record from every workbook into one entity × year panel.
 *
 * Records arrive oldest-file-first and LATER FILES WIN for the same
 * (entity, income year). That is deliberate: each report carries amendments to
 * prior years alongside its own, so the newest statement of a 2022-23 figure is
 * the correct one. Ignoring this leaves stale superseded figures in the panel;
 * appending instead of replacing double-counts them.
 */
export function buildPanel(records) {
  const byKey = new Map();
  const cellSource = new Map(); // `${key}|${year}` -> fileYear that last wrote it

  for (const rec of records) {
    const key = entityKey(rec);
    let entity = byKey.get(key);
    if (!entity) {
      entity = { key, name: rec.name, abn: rec.abn, names: new Set(), rows: new Map() };
      byKey.set(key, entity);
    }
    entity.names.add(rec.name);
    // The most recent workbook also supplies the most current legal name.
    if (rec.fileYear >= (entity.latestFileYear ?? '')) {
      entity.name = rec.name;
      entity.latestFileYear = rec.fileYear;
    }
    const cellKey = `${key}|${rec.year}`;
    const prevSource = cellSource.get(cellKey);
    if (prevSource !== undefined && prevSource > rec.fileYear) continue;
    cellSource.set(cellKey, rec.fileYear);
    entity.rows.set(rec.year, {
      year: rec.year,
      total: rec.total,
      taxable: rec.taxable,
      payable: rec.payable,
      source: rec.fileYear,
    });
  }

  const entities = [...byKey.values()].map((e) => ({
    key: e.key,
    name: e.name,
    abn: e.abn,
    aliases: [...e.names].filter((n) => n !== e.name),
    rows: [...e.rows.values()].sort((a, b) => a.year.localeCompare(b.year)),
  }));
  entities.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { years: YEARS, entities };
}

/** Dollars, treating a reported nil as the zero dollars it is. */
export const dollars = (v) => (v === null || v === undefined ? 0 : v);

export function yearTotals(panel) {
  const out = new Map(panel.years.map((y) => [y, {
    year: y, entities: 0, total: 0, taxable: 0, payable: 0, nil: 0,
    stableEntities: 0, stableNil: 0, stablePayable: 0, stableTaxable: 0,
  }]));
  for (const e of panel.entities) {
    for (const r of e.rows) {
      const agg = out.get(r.year);
      if (!agg) continue;
      agg.entities += 1;
      agg.total += dollars(r.total);
      agg.taxable += dollars(r.taxable);
      agg.payable += dollars(r.payable);
      if (dollars(r.payable) === 0) agg.nil += 1;
      // The threshold-stable subpopulation: entities big enough to have been
      // reportable in every year, so a trend across 2022-23 means something.
      if (dollars(r.total) >= STABLE_THRESHOLD) {
        agg.stableEntities += 1;
        agg.stableTaxable += dollars(r.taxable);
        agg.stablePayable += dollars(r.payable);
        if (dollars(r.payable) === 0) agg.stableNil += 1;
      }
    }
  }
  return [...out.values()];
}

/**
 * Entities that reported nil tax payable in EVERY year they appear.
 *
 * `years` is how many times they appeared, and it is reported alongside the
 * total, because "never paid in eleven years" and "never paid in the one year it
 * appeared" are wildly different claims and a ranking that mixes them is
 * dishonest.
 */
export function nilStreaks(panel, minYears = 1) {
  const out = [];
  for (const e of panel.entities) {
    if (!e.rows.length) continue;
    if (e.rows.some((r) => dollars(r.payable) > 0)) continue;
    if (e.rows.length < minYears) continue;
    out.push({
      key: e.key,
      name: e.name,
      years: e.rows.length,
      totalIncome: e.rows.reduce((s, r) => s + dollars(r.total), 0),
    });
  }
  out.sort((a, b) => b.years - a.years || b.totalIncome - a.totalIncome);
  return out;
}

// ---------------------------------------------------------------------------
// Sector classification
// ---------------------------------------------------------------------------

export const SECTORS = [
  { id: 'mining', label: 'Mining & resources', colour: '#8a5a2b' },
  { id: 'energy', label: 'Oil, gas & energy', colour: '#a06925' },
  { id: 'banking', label: 'Banking & finance', colour: '#1f5673' },
  { id: 'insurance', label: 'Insurance & super', colour: '#367d94' },
  { id: 'property', label: 'Property & construction', colour: '#7c6a4e' },
  { id: 'retail', label: 'Retail & consumer goods', colour: '#a6483f' },
  { id: 'health', label: 'Health & pharmaceuticals', colour: '#2f7a5b' },
  { id: 'transport', label: 'Transport & logistics', colour: '#4a6fa5' },
  { id: 'tech', label: 'Technology & telecoms', colour: '#5d5099' },
  { id: 'media', label: 'Media & entertainment', colour: '#96477f' },
  { id: 'manufacturing', label: 'Manufacturing & industrial', colour: '#6b6b6b' },
  { id: 'agriculture', label: 'Agriculture & food', colour: '#637d37' },
  { id: 'motor', label: 'Motor vehicles', colour: '#976c3d' },
  { id: 'utilities', label: 'Utilities & waste', colour: '#3f7f7f' },
  { id: 'hospitality', label: 'Hospitality & gaming', colour: '#a05c7b' },
  { id: 'services', label: 'Business services', colour: '#737749' },
  { id: 'education', label: 'Education', colour: '#477a9e' },
  { id: 'other', label: 'Unclassified', colour: '#b9b3a7' },
];

export const SECTOR_LABEL = Object.fromEntries(SECTORS.map((s) => [s.id, s.label]));
export const SECTOR_COLOUR = Object.fromEntries(SECTORS.map((s) => [s.id, s.colour]));

/**
 * Keyword rules, applied in order — first match wins, so the specific rules sit
 * above the generic ones. This is a NAME-BASED heuristic and it is wrong at the
 * margins by construction; that is why coverage is reported by dollars as well
 * as by entity count, why an "Unclassified" sector is a first-class row in every
 * sector view rather than a hidden residual, and why the largest entities are
 * pinned by ABN in SECTOR_OVERRIDES rather than left to the keywords.
 */
/*
 * NOTE ON THE REGEX SHAPE. Each alternative is anchored with a leading `\b` and
 * has NO trailing `\b`, so it matches as a PREFIX. That is deliberate and it is
 * the difference between working and not working: an earlier version wrapped
 * the whole alternation in `\b(...)\b`, which meant every truncated stem here —
 * TECHNOLOG, MANUFACTUR, PROPERT, LOGISTIC, PHARMACEUTIC — could never match
 * anything, because a stem is by definition followed by more word characters.
 * It also silently failed on EXXONMOBIL while matching EXXON, and on LOGISTICS
 * while matching LOGISTIC. Roughly half the rules below were dead.
 *
 * Prefix matching brings its own collisions, so the handful that actually
 * occur in this dataset are excluded by name: GOLDMAN is not a gold miner and
 * BANKSIA is not a bank.
 */
const SECTOR_RULES = [
  ['motor', /\b(?:TOYOTA|FORD MOTOR|NISSAN|MAZDA|HYUNDAI|MERCEDES|BMW|VOLKSWAGEN|SUBARU|KIA AUTO|HONDA|ISUZU|MITSUBISHI MOTOR|VOLVO|PORSCHE|AUDI|JAGUAR|TYRE|AUTOMOTIVE|MOTORS|MOTOR GROUP|CAR SALES|CAR RENTAL)/],
  ['energy', /\b(?:PETROLEUM|OIL(?!S)|LNG|LIQUEFIED|GAS(?![A-Z])|ENERGY|DRILLING|OILFIELD|REFINER|REFINING|WOODSIDE|SANTOS|CHEVRON|EXXON|ESSO|SHELL (?:AUSTRALIA|ENERGY)|BP (?:AUSTRALIA|REGIONAL)|VIVA ENERGY|AMPOL|CALTEX)/],
  ['mining', /\b(?:MINING|MINERAL|MINES|RESOURCES|COAL|IRON ORE|GOLD(?!MAN)|COPPER|NICKEL|LITHIUM|URANIUM|BAUXITE|ALUMINA|ZINC|QUARR|EXPLORATION|SMELT|BHP|RIO TINTO|FORTESCUE|GLENCORE|NEWCREST|NEWMONT|ANGLO ?AMERICAN|SOUTH32|WHITEHAVEN|YANCOAL|PEABODY)/],
  ['insurance', /\b(?:INSURANCE|INSURER|REINSURANCE|ASSURANCE|SUPERANNUATION|LIFE COMPANY|UNDERWRITING)/],
  ['banking', /\b(?:BANK(?!SIA)|FINANC|CAPITAL|INVESTMENT|SECURITIES|CREDIT UNION|MORTGAGE|LENDING|LEASING|FUNDS MANAGEMENT|ASSET MANAGEMENT|WEALTH|PAYMENTS|EQUITY PARTNERS|VENTURES|TREASURY)/],
  ['health', /\b(?:HEALTH|MEDICAL|PHARMACEUTIC|PHARMA|HOSPITAL|PATHOLOG|RADIOLOG|DIAGNOSTIC|SURGICAL|DENTAL|BIOTECH|MEDICINE|AGED CARE|CLINIC)/],
  ['tech', /\b(?:TECHNOLOG|SOFTWARE|DIGITAL|TELECOM|COMMUNICATION|COMPUTER|SEMICONDUCTOR|ELECTRONIC|DATA CENT|CLOUD|INTERNET|MOBILE|NETWORK(?!S PTY)|CYBER|MICROSOFT|GOOGLE|APPLE PTY|AMAZON|IBM|ORACLE|SAP |CISCO|INTEL(?!L)|SAMSUNG|HUAWEI|OPTUS|TELSTRA|VODAFONE|TPG)/],
  ['media', /\b(?:MEDIA|BROADCAST|TELEVISION|PUBLISH|NEWSPAPER|NEWS |ENTERTAINMENT|STUDIOS|CINEMA|FILM|MUSIC|ADVERTISING|MARKETING)/],
  ['transport', /\b(?:TRANSPORT|LOGISTIC|FREIGHT|SHIPPING|AIRLINE|AIRWAYS|AVIATION|AIRPORT|RAIL(?!ING)|PORT OF|STEVEDOR|TOLL|MOTORWAY|COURIER|HAULAGE|CARGO|QANTAS|VIRGIN AUSTRALIA|LINFOX|TRANSURBAN)/],
  ['property', /\b(?:PROPERT|REALTY|REAL ESTATE|CONSTRUCT|BUILDING|BUILDERS|DEVELOPMENT|LAND CORP|ESTATES|HOMES|HOUSING|CEMENT|CONCRETE|CIVIL|INFRASTRUCTURE|SHOPPING CENT|MALL|TOWER|PRECINCT)/],
  ['retail', /\b(?:RETAIL|STORES|SUPERMARKET|GROCER|LIQUOR|FASHION|APPAREL|CLOTHING|FOOTWEAR|DEPARTMENT STORE|SUPPLIES|WHOLESAL|DISTRIBUT|TRADING|CONSUMER|COLES|WOOLWORTHS|BUNNINGS|KMART|ALDI|IKEA|COSTCO|WESFARMERS)/],
  ['agriculture', /\b(?:AGRI|FARM|PASTORAL|DAIRY|MEAT|ABATTOIR|GRAIN|WHEAT|SUGAR|POULTRY|SEAFOOD|FISHERIES|COTTON|WOOL(?!WORTH)|TIMBER|FOREST|HORTICULT|VITICULT|WINE|WINERY|BREWING|BREWER|BEVERAGE|FOODS|FOOD GROUP)/],
  ['utilities', /\b(?:WATER|POWER|ELECTRIC|UTILIT|WASTE|RECYCL|SEWER|GRID|GENERATION|NETWORKS PTY|DISTRIBUTION NETWORK)/],
  ['hospitality', /\b(?:HOTEL|RESORT|GAMING|CASINO|LEISURE|TOURISM|TRAVEL|RESTAURANT|CATERING|HOSPITALITY|CLUBS|BAR |PUB )/],
  ['manufacturing', /\b(?:MANUFACTUR|INDUSTR|STEEL|CHEMICAL|PLASTIC|PACKAGING|ENGINEERING|MACHINERY|EQUIPMENT|PAPER|GLASS|TEXTILE|FABRICAT|FOUNDRY|PRODUCTS|MATERIALS)/],
  ['education', /\b(?:EDUCATION|COLLEGE|UNIVERSIT|SCHOOL|TRAINING|LEARNING|ACADEM|INSTITUTE)/],
  ['services', /\b(?:CONSULT|SERVICES|RECRUIT|STAFFING|ADVISORY|LEGAL|LAWYERS|ACCOUNTING|SECURITY|CLEANING|FACILIT|MANAGEMENT|SOLUTIONS|CONTRACTORS|LABOUR|EMPLOYMENT)/],
];

/**
 * Entities pinned by ABN.
 *
 * The keyword rules cover the long tail well and the head badly — the biggest
 * names in the country are exactly the ones with no industry word in them
 * ("MACQUARIE GROUP LIMITED", "WESFARMERS", "AMP", "CSL"). Since a handful of
 * entities carry most of the dollars, leaving the head to the keywords would
 * make the sector view wrong where it matters most while looking fine on a
 * coverage-by-count metric. These overrides are checked before the keywords.
 */
export const SECTOR_OVERRIDES = {
  // Ranked by eleven-year tax payable among the entities the keyword rules miss.
  // Every ABN here was taken from the parsed data, not from memory.
  '69008676417': 'mining',        // HANCOCK PROSPECTING PTY LTD
  '71123721077': 'mining',        // ROY HILL HOLDINGS PTY LTD
  '64004349795': 'mining',        // MITSUI & CO. (AUSTRALIA) LTD
  '49079354519': 'insurance',     // AMP LIMITED
  '60160456164': 'mining',        // WINDFIELD HOLDINGS PTY LTD (Talison/Greenbushes lithium)
  '66145290124': 'insurance',     // SUNCORP GROUP LIMITED
  '91092495700': 'energy',        // BP REGIONAL AUSTRALASIA HOLDINGS PTY LTD
  '93004879298': 'mining',        // ALCOA OF AUSTRALIA LTD
  '63000192790': 'mining',        // ITOCHU AUSTRALIA LIMITED
  '16659510791': 'banking',       // ANZ GROUP HOLDINGS LIMITED
  '54010754793': 'mining',        // JELLINBAH GROUP PTY LTD
  '28122234539': 'manufacturing', // BURRUP FACILITIES COMPANY PTY LTD (ammonia)
  '23095066345': 'manufacturing', // BAT SOUTH PTY LIMITED (tobacco)
  '98008624691': 'banking',       // ASX LIMITED
  '47080890259': 'insurance',     // MEDIBANK PRIVATE LIMITED
  '84008702761': 'mining',        // MITSUI-ITOCHU IRON PTY LTD
  '27008459596': 'banking',       // ING AUSTRALIA HOLDINGS LIMITED
  '77122234306': 'energy',        // BURRUP TRAIN 1 PTY LTD
  '21000006226': 'insurance',     // ALLIANZ AUSTRALIA LIMITED
  '48091561198': 'energy',        // EXXONMOBIL AUSTRALIA PTY LTD
  '45010236272': 'mining',        // IDEMITSU AUSTRALIA PTY LTD (coal)
  '34009713875': 'mining',        // STANMORE SMC PTY LTD
  '80093220136': 'retail',        // JB HI-FI LIMITED
  '54068349066': 'tech',          // REA GROUP LIMITED
  '28003765133': 'health',        // RESMED HOLDINGS PTY LTD
  '54003237545': 'retail',        // HARVEY NORMAN HOLDINGS LTD
  '55002913555': 'hospitality',   // MCDONALD'S AUSTRALIAN PROPERTY CORPORATION
  '22006513873': 'banking',       // HSBC AUSTRALIA HOLDINGS PTY LIMITED
  '14146335622': 'transport',     // AURIZON HOLDINGS LIMITED
  '38010653844': 'mining',        // NEW HOPE CORPORATION LIMITED
  '17090574431': 'utilities',     // SNOWY HYDRO LIMITED
  '42006334505': 'property',      // BECHTEL AUSTRALIA PTY LTD
  '95608490455': 'insurance',     // BUPA ANZ GROUP PTY LTD
  '67000230419': 'mining',        // OAKBRIDGE PTY LIMITED (coal)
  '49004313133': 'retail',        // REECE LIMITED
  '48135315767': 'agriculture',   // ASAHI HOLDINGS (AUSTRALIA) PTY LTD
  '49000698626': 'property',      // MERITON PROPERTIES PTY LIMITED
  '68004316901': 'manufacturing', // PHILIP MORRIS (AUSTRALIA) LIMITED
  '34072814058': 'banking',       // CITIBANK NA
  '57004482982': 'property',      // CIMIC GROUP LIMITED
  '66063780709': 'hospitality',   // TABCORP HOLDINGS LIMITED
  '48000003976': 'property',      // PERRON INVESTMENTS PTY LTD
  '95000029729': 'manufacturing', // BOC LIMITED (industrial gases)
  '59108437592': 'banking',       // MAGELLAN FINANCIAL GROUP LIMITED
  '85106842371': 'insurance',     // CHALLENGER LIMITED
  '32112073480': 'retail',        // METCASH LIMITED
  '39060452217': 'banking',       // RABO AUSTRALIA LIMITED
  '68098212134': 'hospitality',   // ALH GROUP PTY LTD
  '35008677021': 'mining',        // WRIGHT PROSPECTING PTY LTD
  '26004139397': 'agriculture',   // COCA-COLA EUROPACIFIC PARTNERS API PTY LTD
  '88004325080': 'banking',       // CITIGROUP PTY LIMITED
  '89118896021': 'transport',     // BRAMBLES LIMITED
  '46142003469': 'services',      // SGH LIMITED (Seven Group Holdings)
  '83635851839': 'retail',        // CW GROUP HOLDINGS LIMITED (Chemist Warehouse)
  '77000060364': 'retail',        // PET CARE HOLDINGS AUSTRALIA PTY LTD
  '14149723053': 'transport',     // QUBE HOLDINGS LIMITED
  '89069775266': 'transport',     // AUSTRALIA PACIFIC AIRPORTS CORPORATION LIMITED
  '64006727966': 'retail',        // PREMIER INVESTMENTS LIMITED
  '77000011316': 'agriculture',   // NESTLE AUSTRALIA LIMITED
  '16000213132': 'mining',        // SOJITZ AUSTRALIA LIMITED
  '72154890730': 'insurance',     // HELIA GROUP LIMITED
  '57113531150': 'property',      // CHARTER HALL LIMITED
  '51125633856': 'insurance',     // NIB HOLDINGS LIMITED
  '16627011938': 'banking',       // LIBERTY HOLDINGS AUSTRALIA PTY LTD
  '76130856843': 'energy',        // QGC UPSTREAM HOLDINGS PTY LIMITED
  '43004669667': 'motor',         // PACCAR AUSTRALIA PTY LTD
  '48090994657': 'property',      // HANSON AUSTRALIA (HOLDINGS) PTY LTD
  '46080075314': 'tech',          // SEEK LIMITED
  '86097026812': 'insurance',     // MARSH MERCER HOLDINGS (AUSTRALIA) PTY LTD
  '53000329699': 'mining',        // MARUBENI AUSTRALIA LIMITED
  '49100103722': 'banking',       // INSIGNIA FINANCIAL LTD
  '42133404065': 'manufacturing', // DULUXGROUP LIMITED
  '15007596018': 'property',      // ADBRI LIMITED (cement)
  '57101876135': 'utilities',     // ENERGYAUSTRALIA HOLDINGS LIMITED
  '81161229867': 'agriculture',   // VITERRA AUSTRALIA HOLDINGS PTY LTD
  '91074444018': 'tech',          // CAR GROUP LIMITED (carsales)
  '98166799542': 'tech',          // ATLASSIAN AUSTRALIA 1 PTY LTD
  '96002618073': 'health',        // COCHLEAR LIMITED
  '24064530516': 'health',        // HEALIUS LIMITED
  '39632245446': 'mining',        // MINERALOGY INTERNATIONAL LIMITED
  '63110396168': 'mining',        // ATLAS IRON PTY LTD
  '18000383764': 'manufacturing', // HONEYWELL HOLDINGS PTY LTD
  '33000228231': 'agriculture',   // BIDFOOD AUSTRALIA LIMITED
  '66001671496': 'property',      // SCENTRE GROUP LIMITED
  '86000431827': 'banking',       // PERPETUAL LIMITED
  '61096995649': 'services',      // ACCENTURE AUSTRALIA HOLDINGS PTY LIMITED
  '26003430135': 'manufacturing', // CATERPILLAR HOLDINGS AUSTRALIA PTY LTD
  '54104888155': 'banking',       // J.P. MORGAN AUSTRALIA GROUP PTY LIMITED
  '58146674400': 'agriculture',   // AGRIUM SP HOLDINGS PTY LIMITED (Nutrien)
  '42006332949': 'manufacturing', // CUMMINS SOUTH PACIFIC PTY LTD
  '60126327624': 'utilities',     // SGSP (AUSTRALIA) ASSETS PTY LTD (Jemena)
  '75146444484': 'health',        // ASPEN ASIA PACIFIC PTY LTD
  '81618864958': 'agriculture',   // A2 INFANT NUTRITION LIMITED
  '23082467605': 'banking',       // SUSQUEHANNA PACIFIC PTY LTD
  '19108686040': 'hospitality',   // TATTS GROUP LIMITED
  '67108568038': 'transport',     // BAC HOLDINGS LIMITED (Brisbane Airport)
  '32000226228': 'property',      // LENDLEASE CORPORATION LTD

  // Keyword collisions found by sampling the classified output. Each of these
  // matched a rule on a word that means something else in its name, and each
  // was large enough to be visible in the Sectors and Concentration views.
  '83133081491': 'hospitality',   // PADDY POWER AUSTRALIA — a bookmaker, not a utility
  '85149629023': 'hospitality',   // THE STAR ENTERTAINMENT GROUP — a casino, not media
  '21081925706': 'hospitality',   // THE LOTTERY CORPORATION — was unclassified

  // MITSUBISHI DEVELOPMENT is the worst single miss the keyword rules make: it
  // is Mitsubishi's Queensland metallurgical-coal arm and a top-30 taxpayer at
  // $7.1b, but `DEVELOPMENT` fires the property rule, and it was single-handedly
  // 38% of the Property & construction sector — visibly wrong on both the
  // Sectors matrix and the Concentration treemap.
  '17009779873': 'mining',        // MITSUBISHI DEVELOPMENT PTY LTD
  '39062894464': 'mining',        // HUNTER VALLEY ENERGY COAL PTY LTD
  '34608495441': 'mining',        // MACH ENERGY AUSTRALIA PTY LTD
  '37067391511': 'hospitality',   // AUSTRALIAN LEISURE AND HOSPITALITY GROUP
  '99611437668': 'hospitality',   // EASYGO / STAKE
  '45603317559': 'utilities',     // AUSNET SERVICES — 'SERVICES' matched first
};

export function classifySector(name, abn) {
  const pinned = SECTOR_OVERRIDES[normaliseAbn(abn)];
  if (pinned) return pinned;
  const upper = String(name ?? '').toUpperCase();
  for (const [id, re] of SECTOR_RULES) if (re.test(upper)) return id;
  return 'other';
}

// ---------------------------------------------------------------------------
// Reconciliation gates
// ---------------------------------------------------------------------------

/**
 * Gates that must hold before anything is published.
 *
 * These are CORRECTNESS gates, not accuracy gates: each one is written where a
 * specific silent failure lives, and several of them assert that a guard is
 * load-bearing rather than merely that the output looks plausible. A gate that
 * only checks "the totals are positive" would have passed every single defect
 * this parser was written to avoid.
 */
export function runGates(panel, context) {
  const gates = [];
  const add = (id, title, ok, detail) => gates.push({ id, title, ok: Boolean(ok), detail });
  const totals = yearTotals(panel);
  const byYear = Object.fromEntries(totals.map((t) => [t.year, t]));

  add('years', 'All eleven income years are present and populated',
    panel.years.length === 11 && panel.years.every((y) => (byYear[y]?.entities ?? 0) > 0),
    panel.years.map((y) => `${y}: ${byYear[y]?.entities ?? 0}`).join(', '));

  // The triple-count guard, asserted where the failure lives. Reading every
  // sheet of the 2013-14 workbook must produce a MATERIALLY LARGER count than
  // reading only Combined — if it does not, the guard is not doing anything and
  // its removal would go unnoticed.
  const naive = context.naive2013Rows ?? 0;
  const guarded = context.guarded2013Rows ?? 0;
  add('triple-count-guard', 'The Combined-sheet guard is load-bearing',
    naive > guarded * 1.5 && guarded > 1000,
    `reading every 2013-14 sheet yields ${naive} rows; reading only Combined yields ${guarded}. `
    + 'The guard suppresses a duplicate read of the first year.');

  // No entity may hold two rows for one income year after the panel is folded.
  let dupes = 0;
  for (const e of panel.entities) {
    const seen = new Set();
    for (const r of e.rows) { if (seen.has(r.year)) dupes++; seen.add(r.year); }
  }
  add('no-duplicate-cells', 'No entity holds two rows for one income year', dupes === 0,
    `${dupes} duplicated entity-year cells`);

  // The phantom mega-entity guard. Blank-ABN rows must remain distinct
  // entities, so the number of name-keyed entities must be close to the number
  // of blank-ABN source rows — not one.
  const nameKeyed = panel.entities.filter((e) => e.key.startsWith('n:'));
  const blankAbnRows = context.blankAbnRows ?? 0;
  // An entity can hold at most one row per income year, so N blank-ABN rows can
  // never legitimately fold into fewer than N/11 entities. That lower bound is
  // what makes this a real check rather than "more than one survived".
  const floor = Math.ceil(blankAbnRows / panel.years.length);
  add('no-phantom-entity', 'Blank-ABN rows stay separate entities',
    blankAbnRows === 0
      || (nameKeyed.length >= Math.max(2, floor) && nameKeyed.every((e) => e.rows.length <= panel.years.length)),
    blankAbnRows === 0
      ? 'no rows in this dataset lack an ABN'
      : `${blankAbnRows} source rows have no ABN and resolve to ${nameKeyed.length} distinct entities `
      + `(at least ${floor} required; keying on ABN alone would collapse them into one).`);

  // Amendments must actually be flowing backwards into prior years, or the
  // prior-year routing is silently dropping them.
  add('prior-year-routing', 'Prior-year amendments are routed to their own income year',
    (context.crossYearRows ?? 0) > 0,
    `${context.crossYearRows ?? 0} rows carry an income year earlier than the workbook that ships them`);

  // No row may claim a year later than the workbook that published it.
  add('no-future-rows', 'No row post-dates the workbook that published it',
    (context.futureRows ?? 0) === 0, `${context.futureRows ?? 0} offending rows`);

  // Money sanity: nothing negative, nothing non-finite.
  let bad = 0;
  for (const e of panel.entities) {
    for (const r of e.rows) {
      for (const v of [r.total, r.taxable, r.payable]) {
        if (v !== null && (!Number.isFinite(v) || v < 0)) bad++;
      }
    }
  }
  add('money-finite', 'Every money value is finite and non-negative', bad === 0,
    `${bad} offending values`);

  // The threshold discontinuity must be VISIBLE, because the site's honesty
  // depends on it being declared rather than smoothed over.
  const before = byYear['2021-22']?.entities ?? 0;
  const after = byYear['2022-23']?.entities ?? 0;
  add('threshold-break', 'The 2022-23 reporting-threshold cut shows as a population break',
    after > before * 1.25,
    `entities reported: 2021-22 ${before} → 2022-23 ${after} `
    + `(+${before ? (((after / before) - 1) * 100).toFixed(1) : '—'}%). `
    + 'Counts must never be trended across this boundary unqualified.');

  // The threshold-stable subpopulation must be roughly flat across the break —
  // if it jumps too, the "$200m+ entities are comparable" claim is false and
  // every trend line on the site is unsafe.
  const stableBefore = byYear['2021-22']?.stableEntities ?? 0;
  const stableAfter = byYear['2022-23']?.stableEntities ?? 0;
  const stableJump = stableBefore ? Math.abs(stableAfter / stableBefore - 1) : 1;
  add('stable-cohort-continuous', 'The $200m+ cohort is continuous across the threshold change',
    stableJump < 0.15,
    `$200m+ entities: 2021-22 ${stableBefore} → 2022-23 ${stableAfter} `
    + `(${(stableJump * 100).toFixed(1)}% change — under 15% means comparable)`);

  // EXTERNAL ANCHORS. The only gate that can catch a parser which is internally
  // consistent and externally wrong. Checked against the figures the ATO states
  // in its own report commentary, for two independent years.
  //
  // Entity count, total income and tax payable are asserted TIGHTLY, because
  // those three reconcile with the ATO exactly and any drift is a real bug.
  // Taxable income deliberately is not — see the gate below it.
  const withinPct = (a, b, tol) => (b ? Math.abs(a / b - 1) <= tol : false);
  for (const anchor of context.anchors ?? []) {
    const got = byYear[anchor.year];
    if (!got) continue;

    if (anchor.year === context.latestYear) {
      // The newest year has not been amended by anything yet, so it must match
      // the ATO's published figures essentially exactly.
      add(`anchor-${anchor.year}`, `${anchor.year} matches the ATO's published headline figures exactly`,
        got.entities === anchor.entities
          && withinPct(got.total, anchor.total, 0.001)
          && withinPct(got.payable, anchor.payable, 0.001),
        `parsed ${got.entities} entities / $${(got.total / 1e9).toFixed(1)}b income / `
        + `$${(got.payable / 1e9).toFixed(1)}b tax payable; `
        + `ATO published ${anchor.entities} / $${(anchor.total / 1e9).toFixed(1)}b / `
        + `$${(anchor.payable / 1e9).toFixed(1)}b.`);
      continue;
    }

    /*
     * A PRIOR YEAR MUST HAVE GROWN, AND ONLY A LITTLE.
     *
     * Later reports carry late lodgers and amendments for earlier years, so the
     * panel's 2022-23 is legitimately BIGGER than the figure the ATO published
     * with the 2022-23 report — 4,064 entities against 3,985. Asserting
     * equality here would have been wrong, and "within 3%" alone would pass
     * even if amendments were being silently dropped, because 0 extra rows is
     * also within 3%. So the gate is DIRECTIONAL: strictly greater, and
     * bounded. That catches both a routing failure and a double-count.
     */
    const grew = got.entities > anchor.entities
      && got.total > anchor.total && got.payable >= anchor.payable;
    const bounded = withinPct(got.entities, anchor.entities, 0.05)
      && withinPct(got.total, anchor.total, 0.03)
      && withinPct(got.payable, anchor.payable, 0.03);
    add(`anchor-${anchor.year}`,
      `${anchor.year} exceeds its as-published figures by a bounded amount (amendments)`,
      grew && bounded,
      `panel holds ${got.entities} entities / $${(got.total / 1e9).toFixed(1)}b income / `
      + `$${(got.payable / 1e9).toFixed(1)}b tax; the ATO published `
      + `${anchor.entities} / $${(anchor.total / 1e9).toFixed(1)}b / $${(anchor.payable / 1e9).toFixed(1)}b `
      + `at the time. Growth of +${got.entities - anchor.entities} entities is late lodgers and `
      + 'amendments arriving in later reports — it must be positive and small.');
  }

  /*
   * THE TAXABLE-INCOME DIVERGENCE, PINNED RATHER THAN HIDDEN.
   *
   * Summing the "Taxable income $" column of the ATO's own published workbook
   * does NOT reproduce the aggregate taxable income the ATO quotes in the
   * commentary that ships with it. It is consistently HIGHER — by 6.2% in
   * 2022-23 ($403.6b against a published $380.1b) and 7.8% in 2023-24 ($394.1b
   * against $365.5b) — while total income and tax payable reconcile to within
   * 0.01% in the same years. The columns are therefore being read correctly and
   * the difference is a property of the source: the ATO's aggregate is derived
   * from the tax returns rather than by adding up the file it publishes.
   *
   * This gate exists so the divergence can never drift unnoticed and can never
   * be mistaken for a parsing regression. If it lands outside the observed band
   * the gate fails and a human has to look. The site states the discrepancy
   * wherever an aggregate taxable-income figure appears, and never presents a
   * summed taxable-income total as if it were the ATO's own.
   */
  for (const anchor of context.anchors ?? []) {
    const got = byYear[anchor.year];
    if (!got || !anchor.taxable) continue;
    const excess = got.taxable / anchor.taxable - 1;
    add(`taxable-divergence-${anchor.year}`,
      `${anchor.year}: the known taxable-income divergence is within its expected band`,
      excess > 0.03 && excess < 0.12,
      `summing the published column gives $${(got.taxable / 1e9).toFixed(1)}b against the ATO's `
      + `stated $${(anchor.taxable / 1e9).toFixed(1)}b — ${(excess * 100).toFixed(1)}% higher. `
      + 'Expected: consistently 3-12% higher. This is a documented property of the source, '
      + 'not a parse error; total income and tax payable reconcile exactly in the same year.');
  }

  // Sector coverage measured in DOLLARS, not entities — a classifier that names
  // 60% of companies but only 20% of the tax base is useless, and a count-based
  // coverage number hides that completely.
  const cov = context.sectorCoverage;
  if (cov) {
    add('sector-coverage', 'The sector classifier covers most of the tax base by value',
      cov.payableShare >= 0.75,
      `${(cov.entityShare * 100).toFixed(1)}% of entities and `
      + `${(cov.payableShare * 100).toFixed(1)}% of tax payable are classified `
      + '(the remainder is shown as Unclassified, never hidden).');
  }

  return gates;
}
