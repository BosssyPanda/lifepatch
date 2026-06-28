/**
 * Real (curated, approximate) S&P 500 annual total returns 1957–2025, plus
 * derived annual returns for the other tradable assets and notable macro events.
 * Numbers are percentages (26.7 === +26.7%). Returns are intentionally
 * approximate and easy to refine — they exist to make the world feel real.
 */

export type AssetId =
  | "savings"
  | "bonds"
  | "index"
  | "realEstate"
  | "gold"
  | "crypto"
  | "voltMotors"
  | "forgeIndustrial"
  | "heliosEnergy";

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

// deterministic per-(asset,year) jitter in [-amp, amp]
function jitter(year: number, salt: number, amp: number): number {
  const x = Math.sin(year * 928.3 + salt * 13.7) * 43758.5453;
  return ((x - Math.floor(x)) * 2 - 1) * amp;
}

// sparse signature overrides keyed `${asset}:${year}`
const OVERRIDES: Record<string, number> = {
  // gold
  "gold:1972": 49, "gold:1973": 73, "gold:1974": 66, "gold:1979": 126, "gold:1980": 15,
  "gold:1981": -32, "gold:2005": 18, "gold:2007": 31, "gold:2008": 5, "gold:2009": 24,
  "gold:2010": 29, "gold:2011": 10, "gold:2013": -28, "gold:2019": 18, "gold:2020": 25, "gold:2022": 0, "gold:2024": 27,
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

function savingsRate(year: number): number {
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

export function assetReturn(asset: AssetId, year: number): number {
  const sp = SP500[year] ?? 8;
  const ov = OVERRIDES[`${asset}:${year}`];
  if (ov !== undefined) return ov;

  switch (asset) {
    case "index":
      return sp;
    case "savings":
      return savingsRate(year);
    case "bonds":
      return +(savingsRate(year) * 0.7 + 1.5 + jitter(year, 2, 2)).toFixed(1);
    case "gold":
      return +(2 + jitter(year, 5, 9)).toFixed(1);
    case "realEstate":
      return +(5 + sp * 0.12 + jitter(year, 7, 3)).toFixed(1);
    case "crypto":
      return year >= CRYPTO_FROM ? +(40 + jitter(year, 11, 30)).toFixed(1) : 0;
    case "voltMotors": // high-beta tech/growth
      return +(sp * 1.7 + jitter(year, 17, 12)).toFixed(1);
    case "forgeIndustrial": // steadier value
      return +(sp * 0.85 + 1 + jitter(year, 23, 5)).toFixed(1);
    case "heliosEnergy": // oil/energy, era tilts
      return +(sp * 0.6 + jitter(year, 29, 14)).toFixed(1);
  }
}

export function yearReturns(year: number): Record<AssetId, number> {
  const ids: AssetId[] = [
    "savings", "bonds", "index", "realEstate", "gold", "crypto",
    "voltMotors", "forgeIndustrial", "heliosEnergy",
  ];
  return ids.reduce((acc, id) => {
    acc[id] = assetReturn(id, year);
    return acc;
  }, {} as Record<AssetId, number>);
}

export function sp500Return(year: number): number {
  return SP500[year] ?? 8;
}

export function macroEvent(year: number): MacroEvent | null {
  return EVENTS[year] ?? null;
}
