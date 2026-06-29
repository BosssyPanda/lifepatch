// Course-like teaching content. Heavy by design: a guided tutorial, a coach line
// for every square, a quiz bank, and milestone lessons.

export type TutorialStep = {
  id: string;
  title: string;
  body: string;
  target?: "statement" | "freedom" | "board" | "roll"; // which UI element to spotlight
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "goal",
    title: "The only goal that matters",
    body: "You start in the Rat Race, living on a salary. Win by making your PASSIVE INCOME (money that arrives without your labor) bigger than your TOTAL EXPENSES. When it does, you're financially free — and you escape to the Fast Track.",
    target: "freedom",
  },
  {
    id: "statement",
    title: "Your financial statement",
    body: "This panel is the real game. The Income Statement (top) shows money in vs. money out. The Balance Sheet (bottom) shows what you own (Assets) vs. what you owe (Liabilities). Rich people grow the Assets column.",
    target: "statement",
  },
  {
    id: "passive",
    title: "Income has two flavors",
    body: "Your SALARY is earned income — it stops if you stop working. DIVIDENDS, RENT, and BUSINESS profit are passive income — they keep paying you. Every asset you buy moves you toward freedom.",
    target: "statement",
  },
  {
    id: "payday",
    title: "Payday",
    body: "Each time you pass a Payday square you collect your monthly cash flow (Total Income − Total Expenses). Notice: if your expenses exceed your income, passing Payday HURTS. Debt cuts both ways.",
    target: "board",
  },
  {
    id: "deals",
    title: "Opportunities & doodads",
    body: "Land on an Opportunity to buy assets (deals). Land on a Doodad and you must pay for some shiny thing that earns you nothing. Tell the difference and you'll already beat most people.",
    target: "board",
  },
  {
    id: "roll",
    title: "Take your first turn",
    body: "Roll the die to move. Read every deal carefully — the coach will show you the numbers. Buy assets, dodge debt, and watch the Freedom meter climb. Good luck.",
    target: "roll",
  },
];

// One-line coach prompts shown the first time a player lands on each square type.
export const SQUARE_COACH: Record<string, { title: string; body: string }> = {
  deal: {
    title: "Opportunity",
    body: "Choose a Small Deal (cheap, frequent) or a Big Deal (pricey, powerful). Either way: only buy if it produces cash flow or a likely capital gain.",
  },
  doodad: {
    title: "Doodad",
    body: "A doodad is a liability disguised as a treat. You must pay. If you're short, the bank covers it — at a painful 10%/month. This is how good incomes go broke.",
  },
  charity: {
    title: "Charity",
    body: "Give 10% of your income and you may roll one OR two dice for the next 3 turns — more control over where you land. Generosity with a strategic upside.",
  },
  payday: {
    title: "Payday",
    body: "You collected your monthly cash flow. The bigger your passive income, the more every lap pays you.",
  },
  market: {
    title: "The Market",
    body: "The market moves. Sometimes a buyer appears for an asset you own — a chance to take a capital gain. Sometimes a surprise cost hits. React, don't panic.",
  },
  baby: {
    title: "New Baby",
    body: "Congratulations! Children add a recurring monthly expense. Real life raises your bar to freedom — plan for it.",
  },
  downsized: {
    title: "Downsized",
    body: "You lost your job: pay a full month of expenses and skip 2 turns. This is exactly why passive income matters — it doesn't get laid off.",
  },
};

export type QuizQuestion = {
  id: string;
  concept: string;
  question: string;
  options: { label: string; correct: boolean }[];
  explain: string;
};

export const QUIZ_BANK: QuizQuestion[] = [
  {
    id: "q-asset",
    concept: "Assets vs. liabilities",
    question: "Which of these is an ASSET?",
    options: [
      { label: "A rental house that nets $200/mo", correct: true },
      { label: "A new TV you financed", correct: false },
      { label: "Your monthly gym membership", correct: false },
    ],
    explain: "An asset puts money IN your pocket. The rental pays you $200/mo; the TV and gym only take money out.",
  },
  {
    id: "q-passive",
    concept: "Passive income",
    question: "What counts as passive income?",
    options: [
      { label: "Dividends from stocks you own", correct: true },
      { label: "Your salary", correct: false },
      { label: "A tax refund", correct: false },
    ],
    explain: "Passive income arrives without your labor and keeps coming. A salary stops when you stop working; a refund is one-time.",
  },
  {
    id: "q-escape",
    concept: "Financial freedom",
    question: "You escape the Rat Race when…",
    options: [
      { label: "Passive income exceeds total expenses", correct: true },
      { label: "Your salary doubles", correct: false },
      { label: "You pay off your car loan", correct: false },
    ],
    explain: "Freedom isn't a big salary — it's passive income covering your whole life. That's the entire game.",
  },
  {
    id: "q-bankloan",
    concept: "Bad debt",
    question: "Why is a bank loan dangerous here?",
    options: [
      { label: "It costs 10% of the balance every month", correct: true },
      { label: "It lowers your salary", correct: false },
      { label: "It removes a child expense", correct: false },
    ],
    explain: "Bank loans charge 10%/month. Borrow only to buy an asset that pays you more than the loan costs.",
  },
  {
    id: "q-coc",
    concept: "Cash-on-cash return",
    question: "$5,000 down on a rental that nets $200/mo. Roughly what's the annual cash-on-cash return?",
    options: [
      { label: "About 48%", correct: true },
      { label: "About 4%", correct: false },
      { label: "About 200%", correct: false },
    ],
    explain: "$200 × 12 = $2,400 a year ÷ $5,000 invested = 48%. Cash-on-cash compares the cash you get to the cash you put in.",
  },
  {
    id: "q-doodad",
    concept: "Doodads",
    question: "What's the smartest way to pay for fun 'doodads'?",
    options: [
      { label: "From the cash flow your assets produce", correct: true },
      { label: "With a bank loan", correct: false },
      { label: "By selling your only rental", correct: false },
    ],
    explain: "Buy assets first; let them generate income; then enjoy the doodads that income buys. That order keeps you wealthy.",
  },
];

export const MILESTONE_LESSONS: Record<string, { title: string; body: string }> = {
  firstDeal: {
    title: "Your first asset",
    body: "That purchase just added passive income to your statement. Do that enough times and the Payday number takes care of you for life.",
  },
  halfway: {
    title: "Halfway free",
    body: "Your passive income now covers half your expenses. Notice it didn't require a raise — just assets. Keep stacking.",
  },
  almost: {
    title: "One more deal",
    body: "You're within reach. One solid cash-flowing deal could push passive income past expenses and break you out of the Rat Race.",
  },
};
