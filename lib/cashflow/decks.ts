import type {
  BusinessDeal,
  Deal,
  DoodadCard,
  FastTrackDeal,
  MarketCard,
  RealEstateDeal,
  StockDeal,
} from "./types";

// All names, tickers, and numbers below are invented for this game.

// ── SMALL DEALS — affordable; how most players first build passive income ──────
export const SMALL_DEALS: Deal[] = [
  {
    kind: "realestate",
    id: "sd-house-1",
    label: "3Br/2Ba Starter House",
    propertyType: "house",
    price: 45000,
    downPayment: 5000,
    mortgage: 40000,
    cashFlow: 220,
    units: 1,
    lesson: "A rental's cash flow is what's left AFTER the mortgage. $5k down buys $220/mo — that's a 53% cash-on-cash return.",
  },
  {
    kind: "realestate",
    id: "sd-house-2",
    label: "2Br Fixer-Upper",
    propertyType: "house",
    price: 30000,
    downPayment: 3000,
    mortgage: 27000,
    cashFlow: 140,
    units: 1,
    lesson: "Small down payment, small but real cash flow. Many small deals beat waiting for one big one.",
  },
  {
    kind: "realestate",
    id: "sd-duplex-1",
    label: "Tidy Duplex",
    propertyType: "duplex",
    price: 65000,
    downPayment: 8000,
    mortgage: 57000,
    cashFlow: 340,
    units: 2,
    lesson: "Two tenants under one roof. More units usually means more resilient cash flow.",
  },
  {
    kind: "realestate",
    id: "sd-condo-1",
    label: "Downtown Condo",
    propertyType: "house",
    price: 52000,
    downPayment: 6000,
    mortgage: 46000,
    cashFlow: 180,
    units: 1,
    lesson: "Lower cash-on-cash (36%). Compare every deal — not all assets are equal.",
  },
  {
    kind: "business",
    id: "sd-laundromat",
    label: "Corner Laundromat",
    price: 28000,
    downPayment: 4000,
    liability: 24000,
    cashFlow: 260,
    lesson: "A business is an asset only when it pays YOU without your daily labor. This one nets $260/mo.",
  },
  {
    kind: "business",
    id: "sd-vending",
    label: "Vending Machine Route",
    price: 12000,
    downPayment: 2000,
    liability: 10000,
    cashFlow: 110,
    lesson: "Tiny ticket, instant cash flow. Cash-on-cash of 66% — cheap deals can be powerful.",
  },
  {
    kind: "stock",
    id: "sd-stk-grid",
    symbol: "GRID",
    name: "GridWorks Utility",
    price: 30,
    dividend: 0.4,
    range: [22, 48],
    lesson: "A dividend stock pays you to hold it. 100 shares = $3,000 → $40/mo passive income.",
  },
  {
    kind: "stock",
    id: "sd-stk-orbit",
    symbol: "ORBT",
    name: "Orbital Microsystems",
    price: 8,
    dividend: 0,
    range: [3, 35],
    lesson: "No dividend — it pays you nothing to hold it. You profit only if the quote rises and you SELL at The Market. That's a capital gain, not passive income, and it does nothing for your Freedom meter until you take it.",
  },
  {
    kind: "stock",
    id: "sd-stk-harvest",
    symbol: "HRVS",
    name: "Harvest Foods",
    price: 20,
    dividend: 0.25,
    range: [14, 40],
    lesson: "Steady dividend payer. Buy more shares to grow the monthly check.",
  },
  {
    kind: "stock",
    id: "sd-stk-pulse",
    symbol: "PLSE",
    name: "Pulse Biotech",
    price: 5,
    dividend: 0,
    range: [1, 60],
    lesson: "Cheap and violently volatile. Big upside, big risk, zero income while you wait — never bet money you need to live on.",
  },
];

// ── The quote board ───────────────────────────────────────────────────────────
// Every stock in the deck has a live price that moves at The Market, so a
// non-dividend ticker can actually deliver (or destroy) the capital gain its card
// promises. Without this, stocks were valued at cost forever and ORBT/PLSE were
// pure traps: the lesson told you to sell for a gain the game could not produce.
export const STOCK_CATALOG: StockDeal[] = SMALL_DEALS.filter(
  (d): d is StockDeal => d.kind === "stock",
);

/** The opening quote board: every ticker at its deck price. */
export function initialStockPrices(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of STOCK_CATALOG) out[d.symbol] = d.price;
  return out;
}

// ── BIG DEALS — larger capital, larger cash flow ───────────────────────────────
export const BIG_DEALS: Deal[] = [
  {
    kind: "realestate",
    id: "bd-8plex",
    label: "8-Unit Apartment Building",
    propertyType: "plex",
    price: 240000,
    downPayment: 30000,
    mortgage: 210000,
    cashFlow: 1400,
    units: 8,
    lesson: "Big deals move the needle fast: $1,400/mo from one purchase. But you need the down payment first.",
  },
  {
    kind: "realestate",
    id: "bd-20plex",
    label: "20-Unit Complex",
    propertyType: "plex",
    price: 520000,
    downPayment: 70000,
    mortgage: 450000,
    cashFlow: 3200,
    units: 20,
    lesson: "Scale changes everything — $3,200/mo can escape most professions in a single deal.",
  },
  {
    kind: "business",
    id: "bd-carwash",
    label: "Automated Car Wash",
    price: 160000,
    downPayment: 24000,
    liability: 136000,
    cashFlow: 1100,
    lesson: "Automated = it runs without you. That's the difference between an asset and a job.",
  },
  {
    kind: "business",
    id: "bd-franchise",
    label: "Coffee Franchise (3 stores)",
    price: 300000,
    downPayment: 45000,
    liability: 255000,
    cashFlow: 2100,
    lesson: "A franchise buys a proven system. Cash-on-cash of 56% — leverage working for you.",
  },
  {
    kind: "realestate",
    id: "bd-land",
    label: "40 Acres Near a New Highway",
    propertyType: "land",
    price: 90000,
    downPayment: 90000,
    mortgage: 0,
    cashFlow: 0,
    units: 0,
    lesson: "Raw land has NO cash flow — it ties up cash hoping for a future capital gain. Speculation, not income.",
  },
  {
    kind: "realestate",
    id: "bd-commercial",
    label: "Strip Mall (5 tenants)",
    propertyType: "commercial",
    price: 380000,
    downPayment: 55000,
    mortgage: 325000,
    cashFlow: 2600,
    units: 5,
    lesson: "Commercial tenants sign long leases — durable cash flow, but a bigger entry ticket.",
  },
];

// ── DOODADS — the lifestyle spending that quietly drains payday ─────────────────
export const DOODADS: DoodadCard[] = [
  { id: "dd-tv", label: "New Big-Screen TV", cost: 600, flavor: "It was on sale. Sort of.", lesson: "A doodad costs you cash and produces nothing. The opposite of an asset." },
  { id: "dd-boat", label: "Used Jet Ski", cost: 1800, flavor: "Summer toy, year-round payments.", lesson: "Toys feel like wealth but shrink it. Buy assets first, toys from the cash flow they throw off." },
  { id: "dd-phone", label: "Latest Phone Upgrade", cost: 900, flavor: "The camera is incredible, apparently.", lesson: "Small, frequent doodads add up to a fortune over a lifetime." },
  { id: "dd-dining", label: "Fancy Dinner Out", cost: 250, flavor: "The tasting menu got out of hand.", lesson: "Convenience and treats are fine — just fund them from passive income, not your seed capital." },
  { id: "dd-vet", label: "Pet Emergency Vet Bill", cost: 700, flavor: "Mr. Whiskers ate something he shouldn't have.", lesson: "Surprise expenses are why an emergency cash buffer matters." },
  { id: "dd-gym", label: "Annual Gym Membership", cost: 800, flavor: "New year, new you (again).", lesson: "Recurring subscriptions are doodads on autopilot. Audit them." },
  { id: "dd-clothes", label: "Designer Shopping Spree", cost: 1100, flavor: "The fit was immaculate.", lesson: "Status spending is the fastest way to look rich and be broke." },
  { id: "dd-repair", label: "Car Transmission Repair", cost: 1400, flavor: "That noise was not nothing.", lesson: "Maintenance is unavoidable — plan for it so it doesn't force a bank loan." },
];

// ── MARKET — chances to realize gains (or eat a loss) ──────────────────────────
// Every sale card quotes a MULTIPLE of what the holding cost, ± a spread resolved
// off the run's RNG, so no card is a standing arbitrage. Several centre below 1.0:
// selling has to be able to hurt, or "sell high" is not a lesson, it's a button.
export const MARKET_CARDS: MarketCard[] = [
  {
    kind: "propertySale",
    id: "mk-house-buyer",
    title: "Buyer Hunting Starter Homes",
    propertyType: "house",
    multiple: 1.16,
    spread: 0.22,
    flavor: "A relocating family will pay top dollar for a turnkey house.",
    lesson: "Selling above your purchase price is a CAPITAL GAIN. You give up the cash flow for a lump sum — and the offer is never the same twice.",
  },
  {
    kind: "propertySale",
    id: "mk-duplex-buyer",
    title: "Investor Wants Small Multifamily",
    propertyType: "duplex",
    multiple: 1.12,
    spread: 0.2,
    flavor: "A fund is rolling up duplexes in your area.",
    lesson: "Sell or hold? A bird in the hand (cash) vs. ongoing cash flow. There's no wrong answer — only trade-offs.",
  },
  {
    kind: "propertySale",
    id: "mk-plex-buyer",
    title: "REIT Acquiring Apartment Buildings",
    propertyType: "plex",
    multiple: 1.1,
    spread: 0.18,
    flavor: "A real-estate trust is paying a premium for plexes.",
    lesson: "Big assets attract big buyers. A timely sale can fund your down payment on something even larger — but you're handing over the cash flow that got you here.",
  },
  {
    kind: "propertySale",
    id: "mk-land-buyer",
    title: "Developer Circling Your Land",
    propertyType: "land",
    multiple: 1.2,
    spread: 0.55,
    flavor: "The highway broke ground. Whether your acreage is on the right side of it is another matter.",
    lesson: "Land has no cash flow, so the ONLY outcome is the sale price — and this one swings from a deep loss to a fat gain. That is what speculation actually feels like.",
  },
  {
    kind: "propertySale",
    id: "mk-soft-market",
    title: "Soft Market — Cash Buyers Only",
    propertyType: "house",
    multiple: 0.82,
    spread: 0.14,
    flavor: "Rates jumped. The only offers are from people smelling blood.",
    lesson: "Assets do not always go up. Sell here and you crystallize a real loss — this is why cash flow beats hoping for a price.",
  },
  {
    kind: "businessSale",
    id: "mk-biz-buyer",
    title: "Chain Acquiring Local Businesses",
    multiple: 1.3,
    spread: 0.25,
    flavor: "A national chain is buying out independents at a premium.",
    lesson: "Building a business and selling it is one of the fastest ways to a lump sum of capital — when the buyer likes the numbers.",
  },
  {
    kind: "businessSale",
    id: "mk-biz-distress",
    title: "Distressed Buyer Lowballs You",
    multiple: 0.75,
    spread: 0.2,
    flavor: "They know you might need the cash more than they need the business.",
    lesson: "A forced seller is a price-taker. Never let your debts decide when you sell.",
  },
  {
    kind: "stockMarket",
    id: "mk-stk-rally",
    title: "Market Rally",
    drift: 0.18,
    flavor: "Every quote on the board is green today.",
    lesson: "A stock with no dividend pays you nothing while you hold it. The gain is only real once you SELL — and the price is only there today.",
  },
  {
    kind: "stockMarket",
    id: "mk-stk-selloff",
    title: "Market Selloff",
    drift: -0.16,
    flavor: "Somebody blinked, and the whole board went red.",
    lesson: "The same volatility that hands you a capital gain can take it back. Dividends keep paying through a selloff; a price does not.",
  },
  { kind: "windfall", id: "mk-tax-refund", title: "Tax Refund", cash: 1200, flavor: "You overpaid. The government noticed.", lesson: "Found money is best deployed into assets, not doodads." },
  { kind: "windfall", id: "mk-inheritance", title: "Small Inheritance", cash: 5000, flavor: "A great-aunt remembered you fondly.", lesson: "A capital injection is a chance to buy a deal you couldn't reach before." },
  { kind: "windfall", id: "mk-lawsuit", title: "Surprise Lawsuit", cash: -2000, flavor: "A frivolous claim still costs real legal fees.", lesson: "Risk is real. Insurance and a cash buffer protect your assets." },
  { kind: "windfall", id: "mk-rate-cut", title: "Interest Rates Drop", cash: 800, flavor: "Refinancing freed up a little cash.", lesson: "Rates ripple through every loan you hold — watch them." },
];

// ── FAST TRACK — big businesses bought with cash for huge monthly cash flow ────
export const FAST_TRACK_DEALS: FastTrackDeal[] = [
  { id: "ft-software", label: "SaaS Company", price: 180000, cashFlow: 9000, flavor: "Recurring revenue, near-zero marginal cost." },
  { id: "ft-apartments", label: "200-Unit Apartment Tower", price: 300000, cashFlow: 14000, flavor: "A whole building of tenants paying you rent." },
  { id: "ft-franchise", label: "12-Store Franchise Group", price: 250000, cashFlow: 12000, flavor: "A regional empire of proven storefronts." },
  { id: "ft-patent", label: "License a Patent Portfolio", price: 120000, cashFlow: 7000, flavor: "Royalties roll in while you sleep." },
  { id: "ft-storage", label: "Self-Storage Facility", price: 200000, cashFlow: 10000, flavor: "Low maintenance, high margin, sticky tenants." },
  { id: "ft-energy", label: "Solar Farm", price: 220000, cashFlow: 11000, flavor: "Sell power back to the grid for decades." },
];
