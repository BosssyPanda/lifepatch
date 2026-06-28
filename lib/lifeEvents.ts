import type { Tone } from "./markets";

export type LifeEffect = Partial<{
  cash: number;
  debt: number;
  salaryPct: number; // multiply salary by (1 + pct/100)
  health: number;
  happiness: number;
}>;

export type LifeChoice = {
  id: string;
  label: string;
  blurb: string;
  effect: LifeEffect;
  tone: Tone;
  consequence: string;
  lesson?: string;
};

export type LifeEvent = {
  id: string;
  tag: string;
  prompt: string;
  minAge?: number;
  maxAge?: number;
  once?: boolean; // never repeats in a run
  weight?: number;
  choices: LifeChoice[];
};

export const LIFE_EVENTS: LifeEvent[] = [
  {
    id: "promotion",
    tag: "Career",
    prompt: "Your manager pulls you aside. There's a promotion on the table — more money, more meetings, more of your soul.",
    minAge: 24,
    weight: 2,
    choices: [
      { id: "take", label: "Take it", blurb: "+25% salary, −health", effect: { salaryPct: 25, health: -6, happiness: 3 }, tone: "good", consequence: "Bigger paycheck, bigger inbox. Lifestyle creep is now legally allowed to hunt you.", lesson: "A raise only builds wealth if your spending doesn't rise to meet it." },
      { id: "negotiate", label: "Negotiate harder", blurb: "Risky: +40% or nothing", effect: { salaryPct: 38, happiness: 2 }, tone: "good", consequence: "You asked for the top of the band and got most of it. The worst they say is no.", lesson: "Most people never ask. The ask is usually worth more than the year of saving." },
      { id: "decline", label: "Stay in your lane", blurb: "Keep your evenings", effect: { happiness: 6, health: 4 }, tone: "neutral", consequence: "You keep your sanity and your weekends. Money isn't the only currency.", lesson: "Burnout has a price too. Sometimes 'enough' is the smart trade." },
    ],
  },
  {
    id: "layoff",
    tag: "Career",
    prompt: "Restructuring. Your role is 'no longer aligned with company priorities.' Translation: you're out.",
    minAge: 25,
    weight: 1,
    choices: [
      { id: "scramble", label: "Take any job fast", blurb: "−15% salary, keep cash", effect: { salaryPct: -15, happiness: -4 }, tone: "warning", consequence: "You land something quickly. Less pay, but the bills don't wait for your dream role.", lesson: "An emergency fund turns a layoff from a crisis into an inconvenience." },
      { id: "upskill", label: "Retrain for 6 months", blurb: "−cash now, +salary later", effect: { cash: -6000, salaryPct: 20, health: -3 }, tone: "good", consequence: "You burn savings to level up, then come back worth more. A bet on yourself.", lesson: "Downturns are when skills compound fastest — if you can afford the runway." },
    ],
  },
  {
    id: "rentOrBuy",
    tag: "Housing",
    prompt: "Rent keeps climbing. A starter home is in reach — if you can stomach the down payment and the mortgage.",
    minAge: 27,
    once: true,
    weight: 2,
    choices: [
      { id: "buy", label: "Buy the house", blurb: "−$40k cash, +$200k debt", effect: { cash: -40000, debt: 200000, happiness: 8 }, tone: "warning", consequence: "Keys in hand. You own a home and a 30-year obligation. Welcome to property tax.", lesson: "A house is shelter first, investment second. Don't buy more than your income can carry." },
      { id: "rent", label: "Keep renting, invest the rest", blurb: "Stay liquid", effect: { happiness: -2 }, tone: "neutral", consequence: "No yard, no maintenance, full flexibility. The down payment stays in the market.", lesson: "Renting isn't 'throwing money away' — it's buying flexibility and dodging upkeep." },
    ],
  },
  {
    id: "marriage",
    tag: "Family",
    prompt: "Things are serious. There's a ring-sized decision ahead — and a wedding-sized invoice behind it.",
    minAge: 26,
    once: true,
    weight: 2,
    choices: [
      { id: "bigWedding", label: "The big wedding", blurb: "−$30k, big happiness", effect: { cash: -30000, happiness: 14 }, tone: "good", consequence: "One unforgettable day, one forgettable bank balance. Worth it? You decide.", lesson: "A wedding is one day; the marriage is the asset. Don't finance day one." },
      { id: "courthouse", label: "Courthouse + a party", blurb: "−$3k, still happy", effect: { cash: -3000, happiness: 11 }, tone: "good", consequence: "Same marriage, fraction of the cost. The honeymoon fund thanks you.", lesson: "Status spending and happiness aren't the same line item." },
      { id: "wait", label: "Not yet", blurb: "Keep it simple", effect: { happiness: -3 }, tone: "neutral", consequence: "You hold off. Fewer photos, more optionality.", lesson: "Big commitments compound — make them on your timeline, not the algorithm's." },
    ],
  },
  {
    id: "kid",
    tag: "Family",
    prompt: "A tiny human is on the way. Joy, terror, and an 18-year subscription you cannot cancel.",
    minAge: 28,
    maxAge: 44,
    once: true,
    weight: 1,
    choices: [
      { id: "yes", label: "Start a family", blurb: "−cash/yr, +happiness", effect: { cash: -12000, happiness: 16, health: -4 }, tone: "good", consequence: "Sleep is gone; meaning arrives. Daycare costs more than your first car.", lesson: "Kids are a values choice, not a math one — but budget for the math anyway." },
      { id: "no", label: "Not for you", blurb: "Keep the freedom", effect: { happiness: 2 }, tone: "neutral", consequence: "You keep your time, money, and uninterrupted sleep. Valid.", lesson: "There's no 'correct' life ledger. Optimize for your actual goals." },
    ],
  },
  {
    id: "creditCard",
    tag: "Debt",
    prompt: "A shiny rewards card slides into your mailbox. Points! Perks! A 24% APR in the fine print.",
    minAge: 21,
    weight: 1,
    choices: [
      { id: "autopay", label: "Use it, autopay in full", blurb: "Build credit, no interest", effect: { happiness: 1 }, tone: "good", consequence: "You earn points and pay zero interest. The card works for you, not the bank.", lesson: "Credit cards are free money — only if you pay the full balance every month." },
      { id: "carry", label: "Treat it like income", blurb: "+$4k now, +debt", effect: { cash: 4000, debt: 5000, happiness: 3, health: -3 }, tone: "bad", consequence: "New stuff today, 24% interest forever. The minimum payment is a trap with a bow on it.", lesson: "Carrying a balance turns every purchase into a more expensive purchase." },
    ],
  },
  {
    id: "medical",
    tag: "Health",
    prompt: "A health scare and a hospital bill that looks like a phone number. The insurance maze opens its doors.",
    minAge: 30,
    weight: 1,
    choices: [
      { id: "pay", label: "Pay it down", blurb: "−cash, −stress", effect: { cash: -9000, health: 5, happiness: -2 }, tone: "warning", consequence: "It hurts the account, but you're not dodging collections at 2am.", lesson: "Health is the asset everything else rests on. Insurance is boring until it isn't." },
      { id: "ignore", label: "Push it to a payment plan", blurb: "+debt, +stress", effect: { debt: 9000, health: -4, happiness: -5 }, tone: "bad", consequence: "You kick it down the road. The road has interest.", lesson: "Medical debt is still debt. 'Later' is rarely cheaper." },
    ],
  },
  {
    id: "scamDM",
    tag: "The Feed",
    prompt: "A DM: 'I turned $1k into $80k with an AI trading bot. Spots closing. Just send the starter fee.'",
    minAge: 18,
    weight: 1,
    choices: [
      { id: "send", label: "Send the starter fee", blurb: "−$1k, gone", effect: { cash: -1000, happiness: -4, health: -2 }, tone: "bad", consequence: "The dashboard shows fake gains. Withdrawals 'require a fee.' The money is gone.", lesson: "Guaranteed returns plus urgency equals bait. Always." },
      { id: "report", label: "Report and block", blurb: "+sanity", effect: { happiness: 3 }, tone: "good", consequence: "You flag it and move on. Somewhere, a scammer's spreadsheet stays empty.", lesson: "If you can name the trick, you're much harder to trick." },
    ],
  },
  {
    id: "inheritance",
    tag: "Windfall",
    prompt: "A distant relative remembered you in the will. A lump sum just landed in your account.",
    minAge: 30,
    once: true,
    weight: 1,
    choices: [
      { id: "invest", label: "Invest most of it", blurb: "+$25k cash", effect: { cash: 25000, happiness: 4 }, tone: "good", consequence: "You resist the urge to blow it. Future-you is quietly grateful.", lesson: "Windfalls build wealth only if they hit your portfolio, not your dopamine." },
      { id: "splurge", label: "Treat yourself big", blurb: "+$25k, −$18k fun", effect: { cash: 7000, happiness: 12, health: 2 }, tone: "warning", consequence: "New everything. Incredible month, ordinary decade.", lesson: "A windfall spent is a one-time high; invested, it's a raise that lasts." },
    ],
  },
  {
    id: "burnout",
    tag: "Health",
    prompt: "You've been running on caffeine and ambition for years. The tank is hitting empty.",
    minAge: 26,
    weight: 1,
    choices: [
      { id: "sabbatical", label: "Take a real break", blurb: "−cash, +health", effect: { cash: -5000, health: 12, happiness: 8, salaryPct: -3 }, tone: "good", consequence: "You step back, recover, and remember why you started. The salary dip is worth it.", lesson: "You can't compound returns from a hospital bed. Recovery is a financial decision too." },
      { id: "grind", label: "Push through", blurb: "+salary, −health", effect: { salaryPct: 8, health: -12, happiness: -6 }, tone: "bad", consequence: "You hit the numbers and miss the warning signs. The body keeps score.", lesson: "Trading all your health for money is the one trade you can't reverse." },
    ],
  },
  {
    id: "businessOffer",
    tag: "Career",
    prompt: "A friend wants you to co-found a startup. Equity, upside, ramen, and a real chance of zero.",
    minAge: 25,
    maxAge: 50,
    once: true,
    weight: 1,
    choices: [
      { id: "jump", label: "Jump in", blurb: "−salary now, big maybe", effect: { salaryPct: -40, cash: -5000, happiness: 6, health: -4 }, tone: "warning", consequence: "You trade a steady check for a lottery ticket with skill attached. High variance, high learning.", lesson: "Bet on yourself only with money and time you can afford to lose." },
      { id: "advise", label: "Help on the side", blurb: "Keep the day job", effect: { happiness: 3, salaryPct: 2 }, tone: "neutral", consequence: "You keep the safety net and dip a toe in. Less upside, fewer sleepless nights.", lesson: "You can pursue upside without setting your stability on fire." },
    ],
  },
  {
    id: "subscriptions",
    tag: "Leaks",
    prompt: "An audit of your statements: nine subscriptions, three you forgot existed. Death by a thousand $14.99s.",
    minAge: 20,
    weight: 1,
    choices: [
      { id: "cancel", label: "Cancel the dead ones", blurb: "+cash flow", effect: { cash: 1500, happiness: 2 }, tone: "good", consequence: "Ten minutes of clicking buys back real money every month. A raise you gave yourself.", lesson: "Plugging small leaks is a guaranteed, tax-free return. Best 'investment' going." },
      { id: "keep", label: "Eh, leave them", blurb: "−cash flow", effect: { cash: -800, happiness: 1 }, tone: "warning", consequence: "The little charges keep nibbling, polite and relentless.", lesson: "'It's only $15' is the most expensive sentence in personal finance." },
    ],
  },
];

export function eligibleEvents(age: number, used: string[]): LifeEvent[] {
  return LIFE_EVENTS.filter((e) => {
    if (e.minAge && age < e.minAge) return false;
    if (e.maxAge && age > e.maxAge) return false;
    if (e.once && used.includes(e.id)) return false;
    return true;
  });
}
