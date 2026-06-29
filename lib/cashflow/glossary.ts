// Plain-English glossary — the course's reference shelf, openable any time.

export type GlossaryTerm = { term: string; def: string; example?: string };

export const GLOSSARY: GlossaryTerm[] = [
  {
    term: "Asset",
    def: "Anything that puts money INTO your pocket — even while you sleep.",
    example: "A rental property, a dividend stock, a business you don't run day-to-day.",
  },
  {
    term: "Liability",
    def: "Anything that takes money OUT of your pocket.",
    example: "A mortgage, a car loan, a credit-card balance.",
  },
  {
    term: "Income Statement",
    def: "A summary of money coming in (income) versus money going out (expenses) over a month.",
  },
  {
    term: "Balance Sheet",
    def: "A snapshot of everything you OWN (assets) versus everything you OWE (liabilities).",
  },
  {
    term: "Passive Income",
    def: "Money that arrives without trading your time for it — the engine of financial freedom.",
    example: "Rent, dividends, royalties, business profit.",
  },
  {
    term: "Earned Income",
    def: "Money you get for your labor. It stops the moment you stop working.",
    example: "Your salary or hourly wage.",
  },
  {
    term: "Cash Flow",
    def: "What's left after expenses: Total Income − Total Expenses. Positive is the goal.",
  },
  {
    term: "Payday",
    def: "In this game, the moment you collect your monthly cash flow by passing a Payday square.",
  },
  {
    term: "Down Payment",
    def: "The cash you put in to buy an asset; the rest is financed with a loan (mortgage).",
    example: "$5,000 down on a $45,000 house; the other $40,000 is the mortgage.",
  },
  {
    term: "Mortgage",
    def: "A loan secured by property. Its payment is already subtracted from a rental's cash-flow figure.",
  },
  {
    term: "Dividend",
    def: "A share of a company's profit paid to shareholders — passive income from stocks.",
  },
  {
    term: "Capital Gain",
    def: "Profit from selling an asset for more than you paid. A lump sum, not ongoing income.",
    example: "Buy a stock at $8, sell at $30 — the $22/share difference is a capital gain.",
  },
  {
    term: "Cash-on-Cash Return",
    def: "Annual cash flow ÷ the cash you invested, as a percent. Compares deals fairly.",
    example: "$2,400/yr on $5,000 invested = 48%.",
  },
  {
    term: "Doodad",
    def: "A non-essential purchase that produces no income — a liability dressed up as a treat.",
  },
  {
    term: "Good Debt vs. Bad Debt",
    def: "Good debt buys assets that pay you more than the debt costs. Bad debt buys doodads.",
  },
  {
    term: "Net Worth",
    def: "Total assets minus total liabilities — what you'd have left if you sold everything and paid every debt.",
  },
];
