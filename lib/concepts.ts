/**
 * The financial-literacy concept taxonomy — the spine of the "Money Brain" map.
 * Concept ids are the strings persisted in mastery.concept_id (supabase/schema.sql).
 *
 * Most gameplay moments are tagged by deriving concepts from their existing lesson
 * text via `conceptsForText` (curated, specific keywords — precise over greedy).
 * Content can also carry an explicit optional `concepts?: string[]` to override.
 */

export type ConceptCategory = "earn" | "grow" | "protect" | "borrow" | "spend";

export type Concept = {
  id: string;
  title: string;
  def: string;
  category: ConceptCategory;
  /** Specific phrases that, found in a lesson, imply this concept. Lowercase. */
  keywords: string[];
};

export const CONCEPTS: Concept[] = [
  // ── EARN ───────────────────────────────────────────────────────────────────
  { id: "cashFlow", title: "Cash Flow", category: "earn",
    def: "What's left after the bills — the number that actually buys freedom.",
    keywords: ["cash flow", "cash-flow", "cashflow", "payday", "money left over"] },
  { id: "passiveIncome", title: "Passive Income", category: "earn",
    def: "Money that arrives without your daily labor.",
    keywords: ["passive income", "pays you without", "without your daily labor", "arrives without", "pays you to hold"] },
  { id: "assetVsLiability", title: "Assets vs Liabilities", category: "earn",
    def: "Assets put money in your pocket; liabilities take it out.",
    keywords: ["asset only when", "opposite of an asset", "doodad", "liability", "puts money in", "takes money out", "asset vs"] },
  { id: "negotiation", title: "Negotiation", category: "earn",
    def: "The ask is often worth more than a year of saving.",
    keywords: ["negotiat", "the ask", "ask for a raise", "never ask", "ask is often"] },

  // ── GROW ───────────────────────────────────────────────────────────────────
  { id: "compounding", title: "Compounding", category: "grow",
    def: "Interest earning interest — gains start generating their own gains.",
    keywords: ["compound", "interest earning interest", "snowball", "engine behind all long-term"] },
  { id: "indexInvesting", title: "Index Investing", category: "grow",
    def: "Owning the whole market cheaply quietly beats most stock-pickers.",
    keywords: ["index fund", "whole market", "owns the whole", "s&p", "low-cost index", "beats almost everyone"] },
  { id: "diversification", title: "Diversification", category: "grow",
    def: "Spread your bets so one bad outcome can't sink you.",
    keywords: ["diversif", "more units", "two tenants", "one basket", "spread the risk", "more resilient"] },
  { id: "timeInMarket", title: "Time in the Market", category: "grow",
    def: "Staying invested beats trying to time the dips.",
    keywords: ["time in", "timing", "doing nothing during a crash", "stay invested", "ride it out", "long-term money"] },
  { id: "dividends", title: "Dividends", category: "grow",
    def: "Some stocks pay you a slice of profit just for holding them.",
    keywords: ["dividend"] },
  { id: "riskReward", title: "Risk & Reward", category: "grow",
    def: "Higher possible reward rides with a higher chance of loss.",
    keywords: ["higher risk", "risk can mean", "higher reward", "down 80%", "the casino", "only bet what"] },
  { id: "dealAnalysis", title: "Deal Analysis", category: "grow",
    def: "Cash-on-cash return: annual cash flow ÷ the cash you put in.",
    keywords: ["cash-on-cash", "cash on cash", "return on", "%/yr", "down buys", "deal math"] },
  { id: "netWorth", title: "Net Worth", category: "grow",
    def: "Everything you own minus everything you owe.",
    keywords: ["net worth", "capital gain", "selling above your purchase"] },
  { id: "financialFreedom", title: "Financial Freedom", category: "grow",
    def: "When passive income covers your expenses, work becomes optional.",
    keywords: ["financial freedom", "escape the rat race", "passive income outgrows", "passive income > ", "break free", "work becomes optional", "work optional"] },
  { id: "windfall", title: "Windfalls", category: "grow",
    def: "Found money builds wealth only if it hits your portfolio, not your dopamine.",
    keywords: ["windfall", "found money", "inheritance", "bonus", "lump sum", "deployed into assets"] },

  // ── PROTECT ──────────────────────────────────────────────────────────────────
  { id: "emergencyFund", title: "Emergency Fund", category: "protect",
    def: "3–6 months of expenses that turn a crisis into an inconvenience.",
    keywords: ["emergency fund", "crisis into an inconvenience", "rainy day", "cash buffer", "months of expenses"] },
  { id: "insurance", title: "Insurance", category: "protect",
    def: "Pay a little, routinely, to avoid one catastrophic loss.",
    keywords: ["insurance", "insured", "boring until it isn't", "premium"] },
  { id: "scams", title: "Spotting Scams", category: "protect",
    def: "Guaranteed returns plus urgency equals bait. Always.",
    keywords: ["scam", "guaranteed return", "urgency equals bait", "too good to be true", "red flag", "ponzi"] },
  { id: "inflation", title: "Inflation", category: "protect",
    def: "The slow loss of money's purchasing power over time.",
    keywords: ["inflation", "purchasing power", "buys less", "loses to inflation"] },

  // ── BORROW ───────────────────────────────────────────────────────────────────
  { id: "creditScore", title: "Credit Score", category: "borrow",
    def: "Trust you build for free by paying in full, on time.",
    keywords: ["credit score", "credit is trust", "pay in full", "build credit", "on time"] },
  { id: "badDebtAPR", title: "High-Interest Debt", category: "borrow",
    def: "Credit-card and payday APR compounds against you, fast.",
    keywords: ["apr", "carrying a balance", "high-interest", "bank loan", "interest started compounding", "financing hurts", "payday loan", "minimum payment"] },

  // ── SPEND ────────────────────────────────────────────────────────────────────
  { id: "lifestyleCreep", title: "Lifestyle Creep", category: "spend",
    def: "Spending quietly rising to eat every raise.",
    keywords: ["lifestyle creep", "spending doesn't quietly rise", "spending quietly rise", "rise to meet it", "drift up"] },
  { id: "statusSpending", title: "Status Spending", category: "spend",
    def: "Looking rich and being rich are different line items.",
    keywords: ["status spending", "looking rich", "looked wealthy", "flex", "signal wealth", "immaculate"] },
  { id: "opportunityCost", title: "Opportunity Cost", category: "spend",
    def: "Every dollar spent is a dollar that wasn't working elsewhere.",
    keywords: ["opportunity cost", "stays working in the market", "down payment stays", "could have", "instead of"] },
];

export const CONCEPT_IDS: string[] = CONCEPTS.map((c) => c.id);

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

export function getConcept(id: string): Concept | undefined {
  return BY_ID.get(id);
}

export function conceptTitle(id: string): string {
  return BY_ID.get(id)?.title ?? id;
}

/** Derive concept ids from free teaching text via curated keyword match. */
export function conceptsForText(...texts: (string | undefined)[]): string[] {
  const hay = texts.filter(Boolean).join("  ").toLowerCase();
  if (!hay) return [];
  const out: string[] = [];
  for (const c of CONCEPTS) {
    if (c.keywords.some((k) => hay.includes(k))) out.push(c.id);
  }
  return out;
}

export const CATEGORY_META: Record<ConceptCategory, { label: string; hex: string }> = {
  earn: { label: "Earn", hex: "#c9a24a" },
  grow: { label: "Grow", hex: "#7f8b52" },
  protect: { label: "Protect", hex: "#5f7480" },
  borrow: { label: "Borrow", hex: "#a33218" },
  spend: { label: "Spend", hex: "#c8861e" },
};
