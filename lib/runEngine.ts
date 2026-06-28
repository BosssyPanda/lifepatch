import { getBackground } from "./backgrounds";
import { clamp } from "./format";
import { eligibleEvents, LIFE_EVENTS, type LifeChoice } from "./lifeEvents";
import {
  type AssetId,
  macroEvent,
  sp500Return,
  yearReturns,
} from "./markets";
import { getMode, type ModeId } from "./modes";

export type Life = {
  health: number;
  happiness: number;
  partner: boolean;
  kids: number;
  housing: "renting" | "owned";
};

export type YearRecord = {
  yearIndex: number;
  year: number;
  age: number;
  netWorth: number;
  indexReturn: number;
  portfolioDelta: number;
  cashFlow: number;
};

export type RunStatus = "playing" | "ended";
export type EndReason = "story-complete" | "retired" | "quit" | "died";

export type RunState = {
  mode: ModeId;
  startYear: number;
  endYear: number | null;
  year: number;
  age: number;
  name: string;
  backgroundId: string;
  cash: number;
  debt: number;
  salary: number;
  job: string;
  holdings: Record<AssetId, number>;
  life: Life;
  history: YearRecord[];
  usedEvents: string[];
  pendingEvents: string[]; // this year's events (stable until advance)
  yearChoices: Record<string, string>; // eventId -> choiceId, reset each year
  status: RunStatus;
  endReason?: EndReason;
  seed: number;
  lastDelta: number; // portfolio $ change from the most recent resolve (for HUD pulse)
};

const ALL_ASSETS: AssetId[] = [
  "savings", "bonds", "index", "realEstate", "gold", "crypto",
  "voltMotors", "forgeIndustrial", "heliosEnergy",
];

function emptyHoldings(): Record<AssetId, number> {
  return ALL_ASSETS.reduce((a, id) => ((a[id] = 0), a), {} as Record<AssetId, number>);
}

// deterministic RNG
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function yearIndex(s: RunState): number {
  return s.year - s.startYear + 1;
}

export function portfolioValue(s: RunState): number {
  return ALL_ASSETS.reduce((sum, id) => sum + (s.holdings[id] ?? 0), 0);
}

export function netWorth(s: RunState): number {
  return s.cash + portfolioValue(s) - s.debt;
}

function drawEvents(s: RunState): string[] {
  const rng = mulberry32(s.seed + s.year * 101);
  const pool = eligibleEvents(s.age, s.usedEvents);
  if (pool.length === 0) return [];
  // weighted shuffle, take 1 (sometimes 2)
  const weighted = pool.flatMap((e) => Array(e.weight ?? 1).fill(e.id));
  const picks: string[] = [];
  const want = rng() < 0.35 ? 2 : 1;
  let guard = 0;
  while (picks.length < want && guard < 40) {
    guard++;
    const id = weighted[Math.floor(rng() * weighted.length)];
    if (!picks.includes(id)) picks.push(id);
  }
  return picks;
}

export function initRun(mode: ModeId, backgroundId: string, name: string): RunState {
  const cfg = getMode(mode);
  const bg = getBackground(backgroundId);
  const seed = Math.floor(Math.random() * 1e9);
  const base: RunState = {
    mode,
    startYear: cfg.startYear,
    endYear: cfg.endYear,
    year: cfg.startYear,
    age: bg.startAge,
    name: name.trim() || "You",
    backgroundId,
    cash: bg.cash,
    debt: bg.debt,
    salary: bg.salary,
    job: bg.job,
    holdings: emptyHoldings(),
    life: { health: bg.health, happiness: bg.happiness, partner: false, kids: 0, housing: "renting" },
    history: [],
    usedEvents: [],
    pendingEvents: [],
    yearChoices: {},
    status: "playing",
    seed,
    lastDelta: 0,
  };
  base.pendingEvents = drawEvents(base);
  return base;
}

export function trade(s: RunState, asset: AssetId, dollars: number): RunState {
  const holdings = { ...s.holdings };
  let cash = s.cash;
  if (dollars > 0) {
    const amt = Math.min(dollars, cash);
    cash -= amt;
    holdings[asset] = (holdings[asset] ?? 0) + amt;
  } else {
    const amt = Math.min(-dollars, holdings[asset] ?? 0);
    cash += amt;
    holdings[asset] = (holdings[asset] ?? 0) - amt;
  }
  return { ...s, cash, holdings };
}

export function payDebt(s: RunState, dollars: number): RunState {
  const amt = Math.min(dollars, s.cash, s.debt);
  return { ...s, cash: s.cash - amt, debt: s.debt - amt };
}

export function allEventsResolved(s: RunState): boolean {
  return s.pendingEvents.every((id) => s.yearChoices[id]);
}

export function applyLifeChoice(s: RunState, eventId: string, choice: LifeChoice): RunState {
  if (s.yearChoices[eventId]) return s; // already chosen this year
  const e = choice.effect;
  let salary = s.salary;
  if (e.salaryPct) salary = Math.max(0, Math.round(salary * (1 + e.salaryPct / 100)));
  const life = {
    ...s.life,
    health: clamp(s.life.health + (e.health ?? 0), 0, 100),
    happiness: clamp(s.life.happiness + (e.happiness ?? 0), 0, 100),
  };
  // soft life-state flags from specific events
  if (eventId === "marriage") life.partner = true;
  if (eventId === "kid" && choice.id === "yes") life.kids = s.life.kids + 1;
  if (eventId === "rentOrBuy" && choice.id === "buy") life.housing = "owned";

  return {
    ...s,
    cash: s.cash + (e.cash ?? 0),
    debt: Math.max(0, s.debt + (e.debt ?? 0)),
    salary,
    life,
    usedEvents: s.usedEvents.includes(eventId) ? s.usedEvents : [...s.usedEvents, eventId],
    yearChoices: { ...s.yearChoices, [eventId]: choice.id },
  };
}

function annualExpenses(s: RunState): number {
  const housing = s.life.housing === "owned" ? 13000 : 14000;
  return 14000 + housing + s.life.kids * 9000;
}

function deathRoll(s: RunState): boolean {
  if (s.mode !== "infinite") return false;
  if (s.age < 55) return false;
  const rng = mulberry32(s.seed + s.year * 777);
  const base = (s.age - 55) * 0.012; // climbs with age
  const healthPenalty = (100 - s.life.health) * 0.0009;
  return rng() < base + healthPenalty;
}

/** Resolve the current year's market + cashflow, then advance to next year. */
export function advanceYear(s: RunState): RunState {
  const rets = yearReturns(s.year);
  const holdings = { ...s.holdings };
  const before = portfolioValue(s);
  for (const id of ALL_ASSETS) {
    holdings[id] = Math.max(0, (holdings[id] ?? 0) * (1 + (rets[id] ?? 0) / 100));
  }
  const after = ALL_ASSETS.reduce((sum, id) => sum + holdings[id], 0);
  const portfolioDelta = Math.round(after - before);

  // income & costs
  const takeHome = Math.round(s.salary * 0.78);
  const expenses = annualExpenses(s);
  let debt = s.debt * 1.07; // interest accrues
  let cash = s.cash + takeHome - expenses;
  if (cash < 0) {
    debt += -cash; // forced borrowing
    cash = 0;
  }
  debt = Math.round(debt);

  const draft: RunState = { ...s, holdings, cash, debt, lastDelta: portfolioDelta };
  const record: YearRecord = {
    yearIndex: yearIndex(s),
    year: s.year,
    age: s.age,
    netWorth: Math.round(netWorth(draft)),
    indexReturn: sp500Return(s.year),
    portfolioDelta,
    cashFlow: takeHome - expenses,
  };

  const nextYear = s.year + 1;
  const nextAge = s.age + 1;
  const salary = Math.round(s.salary * 1.02); // small drift

  let status: RunStatus = "playing";
  let endReason: EndReason | undefined;

  if (s.endYear !== null && nextYear > s.endYear) {
    status = "ended";
    endReason = "story-complete";
  } else if (deathRoll(draft)) {
    status = "ended";
    endReason = "died";
  }

  const next: RunState = {
    ...draft,
    year: nextYear,
    age: nextAge,
    salary,
    history: [...s.history, record],
    status,
    endReason,
    pendingEvents: [],
    yearChoices: {},
  };
  if (status === "playing") next.pendingEvents = drawEvents(next);
  return next;
}

export function retire(s: RunState): RunState {
  return { ...s, status: "ended", endReason: "retired" };
}
export function quitRun(s: RunState): RunState {
  return { ...s, status: "ended", endReason: "quit" };
}

export function canRetire(s: RunState): boolean {
  return s.age >= 60;
}

/** In-play, non-spoiler headline (hides the real year/event name). */
export function playHeadline(year: number, indexReturn: number): { text: string; tone: "good" | "bad" | "warning" | "neutral" } | null {
  if (indexReturn <= -20) return { text: "MARKET CRASH — everything is red.", tone: "bad" };
  if (indexReturn <= -8) return { text: "Rough year. Stocks slide.", tone: "warning" };
  if (indexReturn >= 28) return { text: "Boom year. The market rips higher.", tone: "good" };
  // surface a generic 'something happened' on historically eventful years without naming it
  return macroEvent(year) ? { text: "Headlines everywhere. Volatility spikes.", tone: "warning" } : null;
}

export { LIFE_EVENTS };
