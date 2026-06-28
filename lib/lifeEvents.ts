import type { Tone } from "./markets";

export type LifeEffect = Partial<{
  cash: number;
  debt: number;
  salaryPct: number; // multiply salary by (1 + pct/100)
  salaryTo: number; // set salary to an absolute value (overrides salaryPct)
  health: number;
  happiness: number;
}>;

/** One possible result of a choice. Multiple outcomes => rolled by weight. */
export type Outcome = {
  weight: number;
  note?: string; // short verdict shown on reveal, e.g. "They said yes."
  effect: LifeEffect;
  tone: Tone;
  consequence: string;
  lesson?: string;
  setFlags?: string[];
  clearFlags?: string[];
};

export type LifeChoice = {
  id: string;
  label: string;
  blurb: string;
  outcomes: Outcome[];
};

export type EventContext = {
  age: number;
  year: number;
  salary: number;
  flags: Record<string, number>;
  life: { health: number; happiness: number; partner: boolean; kids: number; housing: "renting" | "owned" };
};

export type LifeEvent = {
  id: string;
  tag: string;
  prompt: string;
  minAge?: number;
  maxAge?: number;
  once?: boolean;
  weight?: number;
  requires?: (c: EventContext) => boolean;
};

// flag set within the last `within` years?
export function recent(flags: Record<string, number>, key: string, year: number, within: number): boolean {
  const y = flags[key];
  return y !== undefined && year - y <= within;
}
const employed = (c: EventContext) => c.salary > 0;

export const LIFE_EVENTS: (LifeEvent & { choices: LifeChoice[] })[] = [
  {
    id: "promotion",
    tag: "Career",
    prompt: "Your manager hints at a promotion review. More money, more meetings, more of your soul on the line.",
    minAge: 24,
    weight: 2,
    requires: (c) => employed(c) && !recent(c.flags, "laidOff", c.year, 2) && !recent(c.flags, "promoted", c.year, 2),
    choices: [
      {
        id: "take",
        label: "Go for the promotion",
        blurb: "Put your name in.",
        outcomes: [
          { weight: 65, note: "Promoted.", effect: { salaryPct: 22, health: -5, happiness: 3 }, tone: "good", setFlags: ["promoted"], consequence: "You get the title and the raise. The inbox doubles, but so does the paycheck.", lesson: "A raise only builds wealth if your spending doesn't quietly rise to meet it." },
          { weight: 35, note: "Passed over.", effect: { happiness: -6, health: -2 }, tone: "warning", consequence: "They gave it to someone else. Sting now — but you learned where you actually stand.", lesson: "Promotions aren't owed; they're won or negotiated. Know your leverage before you bank on it." },
        ],
      },
      { id: "stay", label: "Don't chase it", blurb: "Protect your evenings.", outcomes: [{ weight: 100, effect: { happiness: 6, health: 4 }, tone: "neutral", consequence: "You keep your weekends and your sanity. Money isn't the only currency.", lesson: "Burnout has a price too. Sometimes 'enough' is the smart trade." }] },
    ],
  },
  {
    id: "negotiate",
    tag: "Career",
    prompt: "Review season. You could push for a real raise — or take what they offer and avoid the awkward conversation.",
    minAge: 23,
    weight: 2,
    requires: employed,
    choices: [
      {
        id: "push",
        label: "Negotiate hard",
        blurb: "Ask for the top of the band.",
        outcomes: [
          { weight: 50, note: "They said yes.", effect: { salaryPct: 18, happiness: 4 }, tone: "good", consequence: "You made the case with numbers and they met it. The worst they could say was no.", lesson: "Most people never ask. The ask is often worth more than a year of saving." },
          { weight: 35, note: "Met halfway.", effect: { salaryPct: 7 }, tone: "neutral", consequence: "Not the full ask, but a real bump. Negotiation rarely gives everything — it gives more than silence.", lesson: "A partial win still beats not asking. Anchor high, settle higher than they offered." },
          { weight: 15, note: "It backfired.", effect: { happiness: -7, health: -2 }, tone: "bad", consequence: "Bad timing. They felt cornered and the room got cold. No raise, and now it's awkward.", lesson: "Negotiation is real risk, not a cheat code. Read the room and have your receipts." },
        ],
      },
      { id: "accept", label: "Take what's offered", blurb: "Keep the peace.", outcomes: [{ weight: 100, effect: { salaryPct: 3 }, tone: "neutral", consequence: "You take the standard bump. Safe, quiet, and a little less than you were worth.", lesson: "Avoiding the conversation has a cost — it just doesn't show up on a receipt." }] },
    ],
  },
  {
    id: "layoff",
    tag: "Career",
    prompt: "Restructuring. Your role is 'no longer aligned with priorities.' Translation: you're out.",
    minAge: 25,
    weight: 1,
    requires: (c) => employed(c) && !recent(c.flags, "promoted", c.year, 1),
    choices: [
      { id: "accept", label: "Take the package", blurb: "Severance, then job-hunt.", outcomes: [{ weight: 100, note: "Unemployed.", effect: { cash: 4000, salaryTo: 0, happiness: -8 }, tone: "bad", setFlags: ["laidOff", "unemployed"], consequence: "You pocket severance and join the job market. No income until you land something.", lesson: "An emergency fund turns a layoff from a crisis into an inconvenience." }] },
    ],
  },
  {
    id: "newJob",
    tag: "Career",
    prompt: "You've been job-hunting. Two offers finally appear — one safe, one a swing.",
    weight: 3,
    requires: (c) => c.salary === 0,
    choices: [
      { id: "safe", label: "Take the steady job", blurb: "Reliable paycheck.", outcomes: [{ weight: 100, note: "Re-employed.", effect: { salaryTo: 38000, happiness: 5, health: 3 }, tone: "good", clearFlags: ["unemployed"], consequence: "Back on a payroll. Less glamour, more stability. The bills can be paid again.", lesson: "Income stability is underrated. You can't invest a paycheck you don't have." }] },
      {
        id: "swing",
        label: "Bet on the startup",
        blurb: "Lower base, big maybe.",
        outcomes: [
          { weight: 45, note: "It's working.", effect: { salaryTo: 52000, happiness: 6, health: -3 }, tone: "good", clearFlags: ["unemployed"], consequence: "The gamble pays — higher pay and real upside. Stressful, but you're climbing.", lesson: "Higher risk can mean higher reward — only bet what your stability can absorb." },
          { weight: 55, note: "Rocky start.", effect: { salaryTo: 30000, happiness: -2, health: -4 }, tone: "warning", clearFlags: ["unemployed"], consequence: "Underpaid and overworked while it finds its feet. Could pay off later — or not.", lesson: "Startups are lottery tickets with a job attached. Know the odds before you buy in." },
        ],
      },
    ],
  },
  {
    id: "rentOrBuy",
    tag: "Housing",
    prompt: "Rent keeps climbing. A starter home is just in reach — if you can stomach the down payment and the mortgage.",
    minAge: 27,
    once: true,
    weight: 2,
    requires: (c) => c.life.housing === "renting" && c.salary > 0,
    choices: [
      { id: "buy", label: "Buy the house", blurb: "Down payment + a mortgage.", outcomes: [{ weight: 100, effect: { cash: -40000, debt: 200000, happiness: 8 }, tone: "warning", setFlags: ["owned"], consequence: "Keys in hand — and a 30-year obligation. Welcome to property tax and leaky roofs.", lesson: "A house is shelter first, investment second. Don't buy more than your income can carry." }] },
      { id: "rent", label: "Keep renting, invest the rest", blurb: "Stay flexible and liquid.", outcomes: [{ weight: 100, effect: { happiness: -2 }, tone: "neutral", consequence: "No yard, no upkeep, full flexibility. The down payment stays working in the market.", lesson: "Renting isn't 'throwing money away' — it buys flexibility and dodges maintenance." }] },
    ],
  },
  {
    id: "rentHike",
    tag: "Housing",
    prompt: "Landlord email, subject 'small update :)'. The small update is +$300/month.",
    weight: 1,
    requires: (c) => c.life.housing === "renting",
    choices: [
      { id: "pay", label: "Absorb it", blurb: "Stay put, eat the cost.", outcomes: [{ weight: 100, effect: { cash: -3600, happiness: -4 }, tone: "warning", consequence: "Same place, less margin. Housing creep quietly shrinks every other choice.", lesson: "Housing is usually your biggest lever. Letting it drift up costs you everywhere else." }] },
      {
        id: "negotiate",
        label: "Negotiate / threaten to leave",
        blurb: "Cite your perfect record.",
        outcomes: [
          { weight: 55, note: "They blinked.", effect: { cash: -600, happiness: 2, health: 1 }, tone: "good", consequence: "A polite, firm email and they meet you halfway. A good tenant is cheaper than a vacancy.", lesson: "Almost everything is negotiable — most people just never ask." },
          { weight: 45, note: "No dice.", effect: { cash: -3600, happiness: -3 }, tone: "warning", consequence: "They hold firm. You pay up or move. This time, asking didn't win it.", lesson: "Negotiation improves your odds; it doesn't guarantee them. Have a backup plan." },
        ],
      },
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
      { id: "big", label: "The big wedding", blurb: "Go all out.", outcomes: [{ weight: 100, effect: { cash: -30000, happiness: 14 }, tone: "good", setFlags: ["married"], consequence: "One unforgettable day, one forgettable balance. Worth it? You decide.", lesson: "A wedding is one day; the marriage is the asset. Try not to finance day one." }] },
      { id: "small", label: "Courthouse + a party", blurb: "Same vows, less cost.", outcomes: [{ weight: 100, effect: { cash: -3000, happiness: 11 }, tone: "good", setFlags: ["married"], consequence: "Same marriage, a fraction of the cost. The honeymoon fund says thank you.", lesson: "Status spending and happiness are not the same line item." }] },
    ],
  },
  {
    id: "kid",
    tag: "Family",
    prompt: "A tiny human is on the way. Joy, terror, and an 18-year subscription you can't cancel.",
    minAge: 28,
    maxAge: 44,
    once: true,
    weight: 1,
    choices: [
      { id: "yes", label: "Start a family", blurb: "Life changes forever.", outcomes: [{ weight: 100, effect: { cash: -12000, happiness: 16, health: -4 }, tone: "good", consequence: "Sleep is gone; meaning arrives. Daycare costs more than your first car.", lesson: "Kids are a values choice, not a math one — but budget for the math anyway." }] },
      { id: "no", label: "Not for you", blurb: "Keep your freedom.", outcomes: [{ weight: 100, effect: { happiness: 2 }, tone: "neutral", consequence: "You keep your time, money, and uninterrupted sleep. Completely valid.", lesson: "There's no 'correct' life ledger. Optimize for your actual goals." }] },
    ],
  },
  {
    id: "divorce",
    tag: "Family",
    prompt: "The marriage has run its course. Lawyers are circling, and so is the asset split.",
    minAge: 30,
    once: true,
    weight: 1,
    requires: (c) => c.life.partner,
    choices: [
      {
        id: "split",
        label: "End it",
        blurb: "Painful but honest.",
        outcomes: [
          { weight: 70, note: "Clean-ish break.", effect: { cash: -20000, happiness: -10, health: -4 }, tone: "bad", clearFlags: ["married"], consequence: "Half of everything, gone, plus legal fees. Brutal — but the right call beats a wrong life.", lesson: "Divorce is one of the biggest wealth events there is. Prenups and honesty are cheaper than lawyers." },
          { weight: 30, note: "It got ugly.", effect: { cash: -45000, happiness: -14, health: -6 }, tone: "bad", clearFlags: ["married"], consequence: "Contested, drawn out, expensive. The lawyers won this round.", lesson: "Conflict is the most expensive line item in any breakup." },
        ],
      },
      { id: "work", label: "Try counseling", blurb: "Fight for it.", outcomes: [
        { weight: 55, note: "It held.", effect: { cash: -4000, happiness: 6 }, tone: "good", consequence: "Hard work, but you rebuild something real. Money well spent.", lesson: "Sometimes the highest-return spend isn't financial at all." },
        { weight: 45, note: "It still ended.", effect: { cash: -24000, happiness: -8 }, tone: "warning", clearFlags: ["married"], consequence: "You tried; it ended anyway. No regrets, lighter wallet.", lesson: "Not every cost buys the outcome you wanted — but trying has its own value." },
      ] },
    ],
  },
  {
    id: "medical",
    tag: "Health",
    prompt: "A health scare and a hospital bill shaped like a phone number. The insurance maze opens its doors.",
    minAge: 28,
    weight: 1,
    choices: [
      {
        id: "checkup",
        label: "Get it checked properly",
        blurb: "Pay for real care.",
        outcomes: [
          { weight: 75, note: "Caught early.", effect: { cash: -6000, health: 8 }, tone: "good", consequence: "Expensive, but caught early and handled. Your future self exhales.", lesson: "Health is the asset everything else rests on. Insurance is boring until it isn't." },
          { weight: 25, note: "Bigger than expected.", effect: { cash: -6000, debt: 8000, health: 4 }, tone: "warning", consequence: "More serious than hoped — but treatable, and you acted in time.", lesson: "Acting early is almost always cheaper than acting late, in money and in years." },
        ],
      },
      { id: "ignore", label: "Walk it off", blurb: "Hope it passes.", outcomes: [
        { weight: 55, effect: { happiness: 1 }, tone: "neutral", consequence: "It fades on its own this time. You got lucky.", lesson: "Ignoring health is a gamble that pays out until it really, really doesn't." },
        { weight: 45, note: "It got worse.", effect: { debt: 14000, health: -12, happiness: -6 }, tone: "bad", consequence: "It wasn't nothing. Now it's an ER bill and a longer recovery.", lesson: "The cheapest medical bill is the one you prevent." },
      ] },
    ],
  },
  {
    id: "burnout",
    tag: "Health",
    prompt: "You've run on caffeine and ambition for years. The tank is hitting empty.",
    minAge: 26,
    weight: 1,
    requires: (c) => c.life.health < 70 || c.life.happiness < 55,
    choices: [
      { id: "rest", label: "Take a real break", blurb: "Recover, lose a little pay.", outcomes: [{ weight: 100, effect: { cash: -5000, health: 12, happiness: 8, salaryPct: -3 }, tone: "good", consequence: "You step back and recover. The small salary dip buys back your health.", lesson: "You can't compound returns from a hospital bed. Recovery is a financial decision too." }] },
      { id: "grind", label: "Push through", blurb: "Hit the numbers anyway.", outcomes: [
        { weight: 50, note: "You held on.", effect: { salaryPct: 8, health: -10, happiness: -6 }, tone: "warning", consequence: "You hit the targets and pay for it in sleep. The body keeps score.", lesson: "Trading all your health for money is the one trade you can't reverse." },
        { weight: 50, note: "You crashed.", effect: { salaryPct: 4, health: -18, happiness: -10, cash: -3000 }, tone: "bad", consequence: "The grind broke you — forced time off, medical costs, the works.", lesson: "Burnout isn't toughness; it's a withdrawal from an account you can't refill cheaply." },
      ] },
    ],
  },
  {
    id: "creditCard",
    tag: "Debt",
    prompt: "A shiny rewards card slides into your mailbox. Points! Perks! A 24% APR in the fine print.",
    minAge: 21,
    once: true,
    weight: 1,
    choices: [
      { id: "autopay", label: "Use it, autopay in full", blurb: "Points, no interest.", outcomes: [{ weight: 100, effect: { happiness: 1 }, tone: "good", consequence: "You earn rewards and pay zero interest. The card works for you, not the bank.", lesson: "Credit cards are free money — only if you pay the full balance every month." }] },
      { id: "carry", label: "Treat it like income", blurb: "Spend now, pay 'later'.", outcomes: [{ weight: 100, effect: { cash: 4000, debt: 5000, happiness: 3, health: -3 }, tone: "bad", consequence: "New stuff today, 24% interest forever. The minimum payment is a trap with a bow on it.", lesson: "Carrying a balance turns every purchase into a more expensive purchase." }] },
    ],
  },
  {
    id: "paydayLoan",
    tag: "Debt",
    prompt: "Cash is tight and a 'No credit check! $500 in minutes!' lender is smiling at you.",
    weight: 1,
    requires: (c) => c.salary > 0,
    choices: [
      { id: "take", label: "Take the fast cash", blurb: "Solve today's problem.", outcomes: [{ weight: 100, effect: { cash: 500, debt: 900, health: -3, happiness: -2 }, tone: "bad", consequence: "Quick relief, then a 390% APR vampire attaches itself to your paycheck.", lesson: "Payday loans solve a small problem by creating a much larger, faster-growing one." }] },
      { id: "avoid", label: "Find another way", blurb: "Cut costs, ask for help.", outcomes: [{ weight: 100, effect: { happiness: -2, health: -1 }, tone: "neutral", consequence: "Tight month, but you dodge the trap. Beans-and-rice beats 390% APR.", lesson: "Almost anything beats high-interest debt — including being temporarily uncomfortable." }] },
    ],
  },
  {
    id: "scamDM",
    tag: "The Feed",
    prompt: "A DM: 'I turned $1k into $80k with an AI trading bot. Spots closing. Just send the starter fee.'",
    minAge: 18,
    weight: 1,
    choices: [
      { id: "send", label: "Send the starter fee", blurb: "What if it's real?", outcomes: [{ weight: 100, effect: { cash: -1000, happiness: -4, health: -2 }, tone: "bad", consequence: "The dashboard shows fake gains; withdrawals 'require a fee.' The money is gone.", lesson: "Guaranteed returns plus urgency equals bait. Always." }] },
      { id: "report", label: "Report and block", blurb: "Not today.", outcomes: [{ weight: 100, effect: { happiness: 3 }, tone: "good", consequence: "You flag it and move on. Somewhere, a scammer's spreadsheet stays empty.", lesson: "If you can name the trick, you're much harder to trick." }] },
    ],
  },
  {
    id: "marketTip",
    tag: "The Feed",
    prompt: "Your loudest friend swears a single stock is 'about to rip.' He's never been right, but he's very confident.",
    weight: 1,
    choices: [
      {
        id: "yolo",
        label: "Throw cash at it",
        blurb: "Confidence is a strategy, right?",
        outcomes: [
          { weight: 30, note: "It ripped.", effect: { cash: 6000, happiness: 6, health: -2 }, tone: "good", consequence: "Against all odds, it worked. You feel like a genius. (You were lucky.)", lesson: "Don't confuse a lucky outcome with a good decision — the process was still a coin flip." },
          { weight: 70, note: "It tanked.", effect: { cash: -4000, happiness: -5 }, tone: "bad", consequence: "It cratered a week later. Your friend has gone suspiciously quiet.", lesson: "Tips from confident amateurs are entertainment, not a strategy." },
        ],
      },
      { id: "pass", label: "Stick to your plan", blurb: "Index and chill.", outcomes: [{ weight: 100, effect: { happiness: 1 }, tone: "neutral", consequence: "You nod, smile, and keep buying the boring index. Drama avoided.", lesson: "Boring, diversified, and consistent beats exciting and concentrated over a lifetime." }] },
    ],
  },
  {
    id: "subscriptions",
    tag: "Leaks",
    prompt: "An audit of your statements: nine subscriptions, three you forgot existed. Death by a thousand $14.99s.",
    minAge: 20,
    weight: 1,
    choices: [
      { id: "cancel", label: "Cancel the dead ones", blurb: "Reclaim the cash flow.", outcomes: [{ weight: 100, effect: { cash: 1500, happiness: 2 }, tone: "good", consequence: "Ten minutes of clicking buys back real money every month — a raise you gave yourself.", lesson: "Plugging small leaks is a guaranteed, tax-free return. Best 'investment' going." }] },
      { id: "keep", label: "Leave them, who cares", blurb: "It's only a few bucks.", outcomes: [{ weight: 100, effect: { cash: -800, happiness: 1 }, tone: "warning", consequence: "The little charges keep nibbling, polite and relentless.", lesson: "'It's only $15' is the most expensive sentence in personal finance." }] },
    ],
  },
  {
    id: "inheritance",
    tag: "Windfall",
    prompt: "A distant relative remembered you in the will. A lump sum just landed.",
    minAge: 30,
    once: true,
    weight: 1,
    choices: [
      { id: "invest", label: "Invest most of it", blurb: "Future-you's gift.", outcomes: [{ weight: 100, effect: { cash: 25000, happiness: 4 }, tone: "good", consequence: "You resist the urge to blow it. Future-you is quietly grateful.", lesson: "Windfalls build wealth only if they hit your portfolio, not your dopamine." }] },
      { id: "splurge", label: "Treat yourself big", blurb: "You only live once.", outcomes: [{ weight: 100, effect: { cash: 7000, happiness: 12, health: 2 }, tone: "warning", consequence: "New everything. Incredible month, ordinary decade.", lesson: "A windfall spent is a one-time high; invested, it's a raise that lasts." }] },
    ],
  },
  {
    id: "bonus",
    tag: "Windfall",
    prompt: "Surprise year-end bonus. It's sitting in your account, radiating temptation.",
    weight: 1,
    requires: employed,
    choices: [
      { id: "invest", label: "Invest it", blurb: "Pretend it never came.", outcomes: [{ weight: 100, effect: { cash: 5000, happiness: 2 }, tone: "good", consequence: "Straight to the portfolio. The compounding starts tonight.", lesson: "Treat windfalls as investment capital by default — you won't miss what you never spent." }] },
      { id: "spend", label: "Enjoy it", blurb: "You earned it.", outcomes: [{ weight: 100, effect: { cash: 1500, happiness: 7 }, tone: "neutral", consequence: "A nice splurge and some left over. Balance is allowed.", lesson: "Spending on purpose is fine. Autopilot spending is the only real enemy." }] },
    ],
  },
  {
    id: "carBreaks",
    tag: "Curveball",
    prompt: "Your car dies on the highway. The mechanic sucks air through his teeth before quoting you.",
    weight: 1,
    choices: [
      { id: "fix", label: "Repair it", blurb: "Pay to keep it running.", outcomes: [{ weight: 100, effect: { cash: -2500, happiness: -2 }, tone: "warning", consequence: "Painful, but you're mobile again. This is exactly what an emergency fund is for.", lesson: "Cars, roofs, and bodies break on their schedule, not yours. Budget for surprises." }] },
      { id: "finance", label: "Finance a newer one", blurb: "Treat yourself to an upgrade.", outcomes: [{ weight: 100, effect: { cash: -2000, debt: 22000, happiness: 6 }, tone: "bad", consequence: "Shiny new ride, shiny new five-year loan. The smell fades faster than the payments.", lesson: "A car is a depreciating asset on a loan — one of the great wealth-killers of normal life." }] },
    ],
  },
  {
    id: "startBusiness",
    tag: "Career",
    prompt: "A friend wants you to co-found a startup. Equity, upside, ramen, and a real chance of zero.",
    minAge: 25,
    maxAge: 52,
    once: true,
    weight: 1,
    requires: employed,
    choices: [
      {
        id: "jump",
        label: "Quit and build it",
        blurb: "Burn the boats.",
        outcomes: [
          { weight: 30, note: "Traction.", effect: { salaryTo: 60000, cash: -8000, happiness: 10, health: -5 }, tone: "good", consequence: "It's working. Brutal hours, but you own something real now.", lesson: "Founders trade stability for ownership. The upside is uncapped; so is the downside." },
          { weight: 70, note: "It fizzled.", effect: { salaryTo: 0, cash: -8000, happiness: -6, health: -5 }, tone: "bad", setFlags: ["unemployed"], consequence: "Ran out of runway. You learned a ton and lost your savings doing it.", lesson: "Most startups fail. Only bet money and time you can genuinely afford to lose." },
        ],
      },
      { id: "advise", label: "Help on the side", blurb: "Keep the day job.", outcomes: [{ weight: 100, effect: { happiness: 3, salaryPct: 1 }, tone: "neutral", consequence: "You keep your safety net and dip a toe in. Less upside, far fewer sleepless nights.", lesson: "You can chase upside without setting your stability on fire." }] },
    ],
  },
  {
    id: "upskill",
    tag: "Career",
    prompt: "A pricey certification could open new doors — if you can spare the cash and the nights.",
    minAge: 22,
    weight: 1,
    requires: employed,
    choices: [
      {
        id: "study",
        label: "Pay for the course",
        blurb: "Invest in yourself.",
        outcomes: [
          { weight: 70, note: "Paid off.", effect: { cash: -5000, salaryPct: 15, health: -3 }, tone: "good", consequence: "The new skill lands you better work. The best returns came from your own head.", lesson: "Skills compound like investments and can't be taxed or crash overnight." },
          { weight: 30, note: "Didn't move the needle.", effect: { cash: -5000, happiness: -2 }, tone: "warning", consequence: "Useful knowledge, but it didn't change your pay. Not every bet hits.", lesson: "Investing in yourself has odds too — pick skills the market actually pays for." },
        ],
      },
      { id: "skip", label: "Skip it for now", blurb: "Save the money.", outcomes: [{ weight: 100, effect: {}, tone: "neutral", consequence: "You keep the cash and the free time. No bet placed, no bet lost.", lesson: "Doing nothing is a valid move — just don't let it become the only move." }] },
    ],
  },
  {
    id: "taxes",
    tag: "Curveball",
    prompt: "Tax season. Your records are... a shoebox of vibes. A letter with a government seal arrives.",
    minAge: 24,
    weight: 1,
    choices: [
      {
        id: "diy",
        label: "Wing it yourself",
        blurb: "How hard can it be?",
        outcomes: [
          { weight: 60, effect: { cash: -200 }, tone: "neutral", consequence: "You muddle through and file on time. Stressful, but fine.", lesson: "Organized records turn a yearly panic into a 20-minute chore." },
          { weight: 40, note: "Audited.", effect: { cash: -3500, happiness: -5, health: -2 }, tone: "bad", consequence: "A mistake triggers a review, plus penalties. The shoebox method has a price.", lesson: "Sloppy records are a tax on your future time and money. Keep receipts." },
        ],
      },
      { id: "pro", label: "Pay an accountant", blurb: "Buy peace of mind.", outcomes: [{ weight: 100, effect: { cash: -600, happiness: 3 }, tone: "good", consequence: "Filed clean, a few deductions found, zero anxiety. Money well spent.", lesson: "Sometimes paying an expert is the cheapest option once you count your time and risk." }] },
    ],
  },
  {
    id: "friendLoan",
    tag: "Family",
    prompt: "A close friend in a rough spot asks to borrow a chunk of money. They mean it when they say they'll pay you back.",
    minAge: 24,
    weight: 1,
    choices: [
      {
        id: "lend",
        label: "Lend it",
        blurb: "They'd do it for you.",
        outcomes: [
          { weight: 50, note: "Repaid.", effect: { happiness: 4 }, tone: "good", consequence: "They got back on their feet and paid you back in full. Friendship intact, karma banked.", lesson: "Lending to friends works — sometimes. Only lend what you can afford to gift." },
          { weight: 50, note: "Ghosted.", effect: { cash: -3000, happiness: -6 }, tone: "bad", consequence: "Life happened, the money didn't come back, and now it's weird. You lost cash and a bit of the friendship.", lesson: "The safest way to lend to a friend is to treat it as a gift from the start." },
        ],
      },
      { id: "decline", label: "Offer help, not cash", blurb: "Protect both of you.", outcomes: [{ weight: 100, effect: { happiness: -1 }, tone: "neutral", consequence: "You help them job-hunt and budget instead. Awkward now, friendship safer later.", lesson: "Money and friendship mix poorly under pressure. Boundaries protect both." }] },
    ],
  },
];

export function eligibleEvents(ctx: EventContext, used: string[]): (LifeEvent & { choices: LifeChoice[] })[] {
  return LIFE_EVENTS.filter((e) => {
    if (e.minAge && ctx.age < e.minAge) return false;
    if (e.maxAge && ctx.age > e.maxAge) return false;
    if (e.once && used.includes(e.id)) return false;
    if (e.requires && !e.requires(ctx)) return false;
    return true;
  });
}

export function getEvent(id: string) {
  return LIFE_EVENTS.find((e) => e.id === id);
}
