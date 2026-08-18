/**
 * Market data + market model.
 *
 * ── WHAT IS REAL vs WHAT IS SYNTHETIC ──────────────────────────────────────
 *
 * REAL (curated, approximate history — identical for every player, NEVER seeded):
 *   • `SP500[year]`        1957–2025 annual total returns.
 *   • `OVERRIDES[a:y]`     the signature years for gold, bonds, real estate and
 *                          crypto (1979 gold, 2008 housing, 2022 crypto, …).
 *   • `savingsRate(year)`  the era's deposit/policy rate.
 *   These are the history the game teaches from. They must stay truthful, and a
 *   run's seed must never move them.
 *
 * SYNTHETIC (a model, not a record — seeded, so two players don't live the same
 * market noise):
 *   • `jitter()` / `gauss()` — the small per-asset wobble layered on the derived
 *     series in years the override table doesn't name.
 *   • `futureReturn()` — the post-`LAST_YEAR` regime, where there is no history
 *     to read at all. It has a real mean, real variance and real crash years;
 *     every asset can lose money, and crypto can lose most of it.
 *
 * Percentages throughout (26.7 === +26.7%). `seed` defaults to 0 so the landing
 * page's reference toys (CompoundToy, TitleTicker) keep one stable series.
 */

export type AssetId =
  | "savings"
  | "bonds"
  | "index"
  | "realEstate"
  | "gold"
  | "crypto";

export type Tone = "good" | "bad" | "warning" | "neutral";

export const FIRST_YEAR = 1957;
export const LAST_YEAR = 2025;
export const CRYPTO_FROM = 2011;

// S&P 500 total return % by year (approx).
const SP500: Record<number, number> = {
  1957: -10.8, 1958: 43.4, 1959: 12.0, 1960: 0.5, 1961: 26.9, 1962: -8.7,
  1963: 22.8, 1964: 16.5, 1965: 12.5, 1966: -10.1, 1967: 24.0, 1968: 11.1,
  1969: -8.5, 1970: 4.0, 1971: 14.3, 1972: 19.0, 1973: -14.7, 1974: -26.5,
  1975: 37.2, 1976: 23.8, 1977: -7.2, 1978: 6.6, 1979: 18.4, 1980: 32.4,
  1981: -4.9, 1982: 21.6, 1983: 22.6, 1984: 6.3, 1985: 31.7, 1986: 18.7,
  1987: 5.3, 1988: 16.6, 1989: 31.7, 1990: -3.1, 1991: 30.5, 1992: 7.6,
  1993: 10.1, 1994: 1.3, 1995: 37.6, 1996: 23.0, 1997: 33.4, 1998: 28.6,
  1999: 21.0, 2000: -9.1, 2001: -11.9, 2002: -22.1, 2003: 28.7, 2004: 10.9,
  2005: 4.9, 2006: 15.8, 2007: 5.5, 2008: -37.0, 2009: 26.5, 2010: 15.1,
  2011: 2.1, 2012: 16.0, 2013: 32.4, 2014: 13.7, 2015: 1.4, 2016: 12.0,
  2017: 21.8, 2018: -4.4, 2019: 31.5, 2020: 18.4, 2021: 28.7, 2022: -18.1,
  2023: 26.3, 2024: 25.0, 2025: 12.0,
};

export type MacroEvent = { title: string; blurb: string; tone: Tone };

const EVENTS: Record<number, MacroEvent> = {
  1962: { title: "The Kennedy Slide", blurb: "Stocks shed a quarter of their value in months. No internet to panic on — they panicked by phone.", tone: "bad" },
  1973: { title: "Oil Embargo & Bear Market", blurb: "Gas lines, stagflation, and a market that bled for two straight years. Hard assets win.", tone: "bad" },
  1974: { title: "The Bottom", blurb: "The worst of the '73–74 bear. Gold soars while paper assets get torched.", tone: "bad" },
  1980: { title: "Volcker's Rates", blurb: "Interest rates near 20%. Savers feast, borrowers starve, gold goes parabolic then pops.", tone: "warning" },
  1987: { title: "Black Monday", blurb: "−22% in a single day. The year still closed green. Time in the market, not timing.", tone: "warning" },
  1995: { title: "Dot-Com Boom Begins", blurb: "The internet gold rush. Tech names go vertical. This will end well. (It will not.)", tone: "good" },
  1999: { title: "Peak Mania", blurb: "Pets.com IPOs. Your barber is giving stock tips. Euphoria is a sound, and it's deafening.", tone: "warning" },
  2000: { title: "The Bubble Pops", blurb: "Dot-coms implode. The names that 10x'd now 90% off. Hype is not a moat.", tone: "bad" },
  2001: { title: "Recession & 9/11", blurb: "Markets shut, then fall. A grim, uncertain year for everything.", tone: "bad" },
  2002: { title: "Capitulation", blurb: "The third straight down year. Everyone swears off stocks forever — right at the bottom.", tone: "bad" },
  2008: { title: "Global Financial Crisis", blurb: "Lehman falls. Housing craters. The S&P loses 37%. Bonds and cash are heroes.", tone: "bad" },
  2009: { title: "The Generational Bottom", blurb: "March lows. Everyone's terrified. It was the buy of a lifetime.", tone: "good" },
  2013: { title: "Taper Tantrum Bull", blurb: "Stocks rip +32%. Bonds and gold get left behind. Boring index wins.", tone: "good" },
  2020: { title: "COVID Crash & Melt-Up", blurb: "−34% in a month, then a historic rip. Whiplash for anyone who flinched.", tone: "warning" },
  2021: { title: "Everything Bubble", blurb: "Meme stocks, crypto, NFTs. Free money everywhere. Enjoy it while it lasts.", tone: "good" },
  2022: { title: "Inflation Reckoning", blurb: "Stocks AND bonds fall together. Crypto −64%. The 60/40 portfolio breaks.", tone: "bad" },
};

// ── synthetic layer ────────────────────────────────────────────────────────
// Everything below this line is a MODEL. None of it is historical record.

/** Deterministic uniform in [0,1) from (year, salt, seed). Same inputs → same draw. */
function hash01(year: number, salt: number, seed: number): number {
  let h = Math.imul(year | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic per-(asset, year, run) jitter in [-amp, amp]. Synthetic noise, not data. */
function jitter(year: number, salt: number, amp: number, seed: number): number {
  return (hash01(year, salt, seed) * 2 - 1) * amp;
}

/** Approx standard normal, bounded to ±3.46σ (Irwin–Hall, n = 4). Synthetic. */
function gauss(year: number, salt: number, seed: number): number {
  const u =
    hash01(year, salt, seed) +
    hash01(year, salt + 1, seed) +
    hash01(year, salt + 2, seed) +
    hash01(year, salt + 3, seed);
  return (u - 2) / 0.5773502691896258;
}

/** Salt bases, spaced by 4 so `gauss`'s four draws never collide. */
const SALT = {
  bonds: 8, gold: 20, realEstate: 32,
  futIndex: 56, futCrash: 60, futDepth: 64, futRate: 68,
  futBonds: 72, futGold: 76, futRe: 80, cryptoRegime: 84, cryptoDraw: 88,
} as const;

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// sparse signature overrides keyed `${asset}:${year}`
const OVERRIDES: Record<string, number> = {
  // gold — now continuous 1972→2024. The 1982–2004 stretch used to fall through to
  // the synthetic `2 ± 9` wobble, which quietly gave gold a positive mean through
  // a two-decade bear market it actually spent losing money. That single gap made
  // "all-in gold" the best play in any run ending around 2010; the real series
  // (London PM fix, year-over-year, approximate) removes it.
  "gold:1972": 49, "gold:1973": 73, "gold:1974": 66, "gold:1979": 126, "gold:1980": 15,
  "gold:1981": -32, "gold:1982": 15, "gold:1983": -15, "gold:1984": -19, "gold:1985": 6,
  "gold:1986": 19, "gold:1987": 24, "gold:1988": -16, "gold:1989": -2,
  "gold:1990": -3, "gold:1991": -10, "gold:1992": -6, "gold:1993": 17, "gold:1994": -2,
  "gold:1995": 1, "gold:1996": -5, "gold:1997": -21, "gold:1998": -1, "gold:1999": 1,
  "gold:2000": -6, "gold:2001": 2, "gold:2002": 25, "gold:2003": 20, "gold:2004": 5,
  "gold:2005": 18, "gold:2006": 23, "gold:2007": 31, "gold:2008": 5, "gold:2009": 24,
  "gold:2010": 29, "gold:2011": 10, "gold:2012": 8, "gold:2013": -28, "gold:2014": -2,
  "gold:2015": -10, "gold:2016": 8, "gold:2017": 13, "gold:2018": -1,
  "gold:2019": 18, "gold:2020": 25, "gold:2021": -4, "gold:2022": 0, "gold:2023": 13, "gold:2024": 27,
  // bonds
  "bonds:1994": -3, "bonds:2008": 5, "bonds:2009": 6, "bonds:2013": -2, "bonds:2022": -13,
  // real estate
  "realEstate:2006": 1, "realEstate:2007": -3, "realEstate:2008": -18, "realEstate:2009": -12,
  "realEstate:2010": -4, "realEstate:2011": -4, "realEstate:2020": 10, "realEstate:2021": 18, "realEstate:2022": -6,
  // crypto
  "crypto:2011": 1473, "crypto:2012": 186, "crypto:2013": 5400, "crypto:2014": -58, "crypto:2015": 35,
  "crypto:2016": 125, "crypto:2017": 1331, "crypto:2018": -73, "crypto:2019": 87, "crypto:2020": 303,
  "crypto:2021": 60, "crypto:2022": -64, "crypto:2023": 155, "crypto:2024": 120, "crypto:2025": 40,
};

/** REAL: the era's deposit rate through LAST_YEAR; a modelled cycle after it. */
function savingsRate(year: number, seed = 0): number {
  if (year > LAST_YEAR) {
    // SYNTHETIC: a slow policy cycle (0.25%–9%) rather than a flat forever-rate.
    const cycle = 3.4 + 2.3 * Math.sin((year - LAST_YEAR) / 5.5);
    return r1(clamp(cycle + gauss(year, SALT.futRate, seed) * 1.2, 0.25, 9));
  }
  if (year < 1970) return 4;
  if (year < 1979) return 6;
  if (year < 1985) return 10.5;
  if (year < 1991) return 7;
  if (year < 2001) return 5;
  if (year < 2008) return 3.5;
  if (year < 2016) return 0.4;
  if (year < 2020) return 2;
  if (year < 2022) return 0.4;
  return 5;
}

/**
 * SYNTHETIC: the index in a year history doesn't cover.
 * ~13% ± 14 in an ordinary year, with a ~1-in-9 crash of −15% to −40%.
 * Arithmetic mean ≈ +8.5%/yr, σ ≈ 18.5, about one losing year in three — i.e.
 * the shape of real equity returns, not the old risk-free "8% forever".
 */
const CRASH_P = 0.11;
function futureIndex(year: number, seed: number): number {
  if (hash01(year, SALT.futCrash, seed) < CRASH_P) {
    return -(15 + hash01(year, SALT.futDepth, seed) * 25);
  }
  return 13 + gauss(year, SALT.futIndex, seed) * 14;
}

/**
 * SYNTHETIC: crypto after the historical table runs out. Four regimes —
 * the old `40 + jitter` printer is gone, and so is any memorisable answer.
 *   20%  bubble pops   −80% … −40%
 *   20%  long winter   −30% …  −5%
 *   40%  chop          −10% … +50%
 *   20%  mania         +70% … +260%
 * Arithmetic mean ≈ +25%/yr but the COMPOUNDED mean is only ≈ +3%/yr — the
 * volatility-drag lesson, priced in. A 50%+ loss lands in ~14% of years.
 */
function futureCrypto(year: number, seed: number): number {
  const regime = hash01(year, SALT.cryptoRegime, seed);
  const u = hash01(year, SALT.cryptoDraw, seed);
  if (regime < 0.20) return -(40 + u * 40);
  if (regime < 0.40) return -(5 + u * 25);
  if (regime < 0.80) return -10 + u * 60;
  return 70 + u * 190;
}

/** SYNTHETIC: every asset's post-`LAST_YEAR` regime. All of them can lose money. */
function futureReturn(asset: AssetId, year: number, seed: number): number {
  const sp = futureIndex(year, seed);
  switch (asset) {
    case "index":
      return r1(sp);
    case "savings":
      return savingsRate(year, seed);
    case "bonds":
      return r1(savingsRate(year, seed) * 0.7 + 1.2 + gauss(year, SALT.futBonds, seed) * 3);
    case "gold":
      return r1(3 + gauss(year, SALT.futGold, seed) * 16);
    case "realEstate":
      return r1(3.5 + sp * 0.35 + gauss(year, SALT.futRe, seed) * 6);
    case "crypto":
      return r1(futureCrypto(year, seed));
  }
}

export function assetReturn(asset: AssetId, year: number, seed = 0): number {
  // REAL first: a curated year is a fact and outranks every model below it.
  const ov = OVERRIDES[`${asset}:${year}`];
  if (ov !== undefined) return ov;
  if (year > LAST_YEAR) return futureReturn(asset, year, seed);

  const sp = SP500[year] ?? 8;
  switch (asset) {
    case "index": // REAL
      return sp;
    case "savings": // REAL
      return savingsRate(year);
    // The rest are REAL anchors (the era's rate, the index) plus SYNTHETIC wobble.
    case "bonds":
      return r1(savingsRate(year) * 0.7 + 1.5 + jitter(year, SALT.bonds, 2, seed));
    case "gold":
      return r1(2 + jitter(year, SALT.gold, 9, seed));
    case "realEstate":
      return r1(5 + sp * 0.12 + jitter(year, SALT.realEstate, 3, seed));
    case "crypto":
      // 2011–2025 are all curated in OVERRIDES above. Any *other* in-table year has
      // no record to read, so it gets the model — never a flat "+40% and up".
      return year >= CRYPTO_FROM ? r1(futureCrypto(year, seed)) : 0;
  }
}

export const ASSET_IDS: AssetId[] = ["savings", "bonds", "index", "realEstate", "gold", "crypto"];

export function yearReturns(year: number, seed = 0): Record<AssetId, number> {
  return ASSET_IDS.reduce((acc, id) => {
    acc[id] = assetReturn(id, year, seed);
    return acc;
  }, {} as Record<AssetId, number>);
}

export function sp500Return(year: number, seed = 0): number {
  if (year > LAST_YEAR) return r1(futureIndex(year, seed)); // SYNTHETIC
  return SP500[year] ?? 8; // REAL
}

export function macroEvent(year: number): MacroEvent | null {
  return EVENTS[year] ?? null;
}
