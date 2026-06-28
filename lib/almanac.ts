/** Authored educational content for the Almanac. Sharp, plain-English, in-voice. */

export type WealthMethod = { name: string; how: string; pros: string[]; cons: string[] };
export type MythFact = { claim: string; verdict: "Myth" | "Fact" | "It depends"; explain: string };
export type Geo = { situation: string; ripple: string[]; everyone: string; mitigation: string };
export type Term = { term: string; def: string };

export const WEALTH_METHODS: WealthMethod[] = [
  {
    name: "Index fund investing",
    how: "Buy the whole market through a low-cost index fund and hold it for decades.",
    pros: ["Beats most professionals over time", "Dirt-cheap fees", "Zero stock-picking skill needed", "Compounds quietly while you live your life"],
    cons: ["Boring — no overnight 10x", "You still ride the crashes down", "Requires patience most people don't have"],
  },
  {
    name: "Owning a home",
    how: "Buy property, build equity as you pay the mortgage and prices drift up.",
    pros: ["Forced savings every month", "A place to live that can appreciate", "Inflation hedge"],
    cons: ["Huge, illiquid bet on one asset", "Maintenance, taxes, insurance never stop", "Crashes (2008) can trap you underwater"],
  },
  {
    name: "Starting a business",
    how: "Build something that earns money without trading every hour of your time.",
    pros: ["Uncapped upside", "You own the asset and the leverage", "Skills compound fast"],
    cons: ["Most fail", "Brutal hours, real stress", "Income is spiky and uncertain"],
  },
  {
    name: "Climbing the career ladder",
    how: "Raise your income through skills, promotions, and switching jobs strategically.",
    pros: ["Your biggest early-life lever is your salary", "Lower risk than investing or founding", "Skills can't crash to zero"],
    cons: ["Caps out eventually", "Trades time for money", "Lifestyle inflation can eat every raise"],
  },
  {
    name: "Side income & freelancing",
    how: "Stack extra income streams on top of a day job.",
    pros: ["Diversifies your income", "Can become a business", "More to invest each month"],
    cons: ["Burnout risk", "Taxes get complicated", "Often trades more time for marginal cash"],
  },
  {
    name: "High-risk bets (single stocks, crypto)",
    how: "Concentrate money in volatile assets hoping for outsized returns.",
    pros: ["Genuine chance of huge gains", "Exciting", "Small bets can pay off big"],
    cons: ["Most concentrated bets underperform a boring index", "Can go to zero", "Emotionally drives bad timing"],
  },
];

export const MYTH_FACTS: MythFact[] = [
  { claim: "You need a high income to build wealth.", verdict: "Myth", explain: "Wealth is income minus spending, invested over time. Plenty of high earners are broke; plenty of modest earners retire rich. The gap is the habit, not the salary." },
  { claim: "Renting is throwing money away.", verdict: "It depends", explain: "Rent buys flexibility and zero maintenance. Owning builds equity but ties up cash and adds costs. Neither is automatically smarter — it depends on price, time horizon, and the alternative use of the money." },
  { claim: "Carrying a small credit-card balance helps your credit score.", verdict: "Myth", explain: "Paying in full builds credit and costs nothing. Carrying a balance just hands the bank 20%+ interest for no benefit." },
  { claim: "Time in the market beats timing the market.", verdict: "Fact", explain: "Missing just the best handful of days over decades wrecks your returns — and those days often come right after crashes. Staying invested usually beats trying to jump in and out." },
  { claim: "Gold is a safe investment.", verdict: "It depends", explain: "Gold can spike in panics and during inflation, but it produces no income and can go nowhere for years. It's insurance, not a growth engine." },
  { claim: "Buying a brand-new car is a good use of money.", verdict: "Myth", explain: "Cars are depreciating assets — often financed. A new car loses value the moment you drive it off the lot. It's a lifestyle choice, not wealth-building." },
  { claim: "Compound interest is the most powerful force in finance.", verdict: "Fact", explain: "Small amounts invested early grow exponentially. Starting at 22 vs 32 can literally double your final number for the same effort. Time is the cheat code." },
  { claim: "You should pay off all debt before investing.", verdict: "It depends", explain: "Kill high-interest debt (cards, payday loans) first — it's a guaranteed loss. But low-interest debt (some mortgages, student loans) can coexist with investing." },
];

export const GEOPOLITICS: Geo[] = [
  {
    situation: "A war or conflict disrupts a major oil-producing region.",
    ripple: ["Oil prices spike", "Gas, shipping, and food cost more (everything moves on energy)", "Inflation rises → central banks hike interest rates", "Borrowing gets expensive; stocks and housing cool"],
    everyone: "You don't need to live near the conflict to feel it — a farmer in Kansas, a commuter in Lagos, and a student in Seoul all pay more at the pump and the grocery store. Energy is the bloodstream of the global economy.",
    mitigation: "Keep an emergency fund so a price shock doesn't force panic decisions. Stay diversified (a crash in one region rarely hits everything equally). Avoid timing the news — markets price it in faster than you can react.",
  },
  {
    situation: "Two large economies impose tariffs and trade restrictions on each other.",
    ripple: ["Imported goods get more expensive", "Supply chains scramble to reroute", "Companies' costs rise → prices rise or profits fall", "Markets wobble on uncertainty"],
    everyone: "Tariffs are a tax that ultimately lands on ordinary buyers everywhere — your phone, your clothes, your car parts. A factory worker, a small importer, and a shopper all absorb a slice.",
    mitigation: "Don't over-concentrate in companies dependent on one supply chain. Broad index funds spread the risk. Long-term, the economy adapts — patience beats panic.",
  },
  {
    situation: "A financial crisis starts in one country's banks.",
    ripple: ["Lenders pull back globally (fear is contagious)", "Credit dries up; businesses can't borrow", "Layoffs rise, spending falls", "A local problem becomes a worldwide recession (see 2008)"],
    everyone: "Modern finance is wired together. A mortgage meltdown in one country can cost a teacher in another her job, because money and confidence cross borders instantly.",
    mitigation: "Cash reserves and low personal debt are your shock absorbers. Crashes are also historically the best buying opportunities for the patient — if you can stay employed and invested.",
  },
  {
    situation: "A pandemic or natural disaster halts global activity.",
    ripple: ["Demand and supply both collapse, then whipsaw back", "Governments flood the system with money", "Inflation often follows the recovery", "Some industries die, others boom"],
    everyone: "A shutdown anywhere ripples to everywhere — a closed port in Asia empties shelves in Europe. Nobody is fully insulated from a truly global shock.",
    mitigation: "Resilience beats prediction: emergency fund, diversified investments, adaptable skills. You can't forecast the shock — you can be the person who isn't forced to sell at the bottom.",
  },
];

export const TERMS: Term[] = [
  { term: "Compound interest", def: "Interest earning interest. Your gains start generating their own gains — the engine behind all long-term wealth." },
  { term: "Inflation", def: "The slow loss of money's purchasing power. $100 today buys less in ten years. Cash under the mattress quietly shrinks." },
  { term: "Net worth", def: "Everything you own minus everything you owe. The single number that actually measures your financial position." },
  { term: "Diversification", def: "Not putting all your eggs in one basket. Spreading money across assets so one bad bet doesn't sink you." },
  { term: "Liquidity", def: "How fast you can turn something into cash without losing value. A savings account is liquid; a house is not." },
  { term: "APR", def: "Annual Percentage Rate — the yearly cost of borrowing. A 24% APR card turns small balances into big ones, fast." },
  { term: "Index fund", def: "A fund that owns a whole market (like the S&P 500) at very low cost. The boring, winning default for most investors." },
  { term: "Bull / Bear market", def: "Bull = prices rising and optimistic. Bear = prices falling 20%+ and fearful. Both are normal and temporary." },
  { term: "Recession", def: "A broad economic slowdown — falling output, rising unemployment. Painful, cyclical, and always eventually followed by recovery." },
  { term: "Emergency fund", def: "3–6 months of expenses in cash. The thing that turns a disaster into an inconvenience and keeps you from selling investments at the worst time." },
  { term: "Equity", def: "Ownership. Stock is equity in a company; home equity is the part of your house you actually own." },
  { term: "Interest rate", def: "The price of money. When central banks raise rates, borrowing gets pricey and asset prices usually cool." },
];

export const ALMANAC_SECTIONS = [
  { id: "wealth", label: "Build wealth" },
  { id: "myths", label: "Myth or Fact" },
  { id: "geo", label: "Geopolitics" },
  { id: "terms", label: "Key terms" },
] as const;

export type AlmanacSectionId = (typeof ALMANAC_SECTIONS)[number]["id"];
