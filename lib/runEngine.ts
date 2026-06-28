import { getBackground } from "./backgrounds";
import { clamp } from "./format";
import {
  eligibleEvents,
  getEvent,
  LIFE_EVENTS,
  type EventContext,
  type LifeChoice,
  type Outcome,
} from "./lifeEvents";
import { type AssetId, macroEvent, sp500Return, yearReturns } from "./markets";
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

export type MarketYear = { year: number; returns: Record<AssetId, number> };

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
  marketLog: MarketYear[];
  flags: Record<string, number>;
  usedEvents: string[];
  pendingEvents: string[];
  yearChoices: Record<string, string>; // eventId -> "choiceId|outcomeIdx"
  status: RunStatus;
  endReason?: EndReason;
  seed: number;
  lastDelta: number;
};

const ALL_ASSETS: AssetId[] = [
  "savings", "bonds", "index", "realEstate", "gold", "crypto",
  "voltMotors", "forgeIndustrial", "heliosEnergy",
];

function emptyHoldings(): Record<AssetId, number> {
  return ALL_ASSETS.reduce((a, id) => ((a[id] = 0), a), {} as Record<AssetId, number>);
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
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

function eventContext(s: RunState): EventContext {
  return { age: s.age, year: s.year, salary: s.salary, flags: s.flags, life: s.life };
}

function drawEvents(s: RunState): string[] {
  const rng = mulberry32(s.seed + s.year * 101);
  const pool = eligibleEvents(eventContext(s), s.usedEvents);
  if (pool.length === 0) return [];
  const weighted = pool.flatMap((e) => Array(e.weight ?? 1).fill(e.id));
  const picks: string[] = [];
  const want = rng() < 0.35 ? 2 : 1;
  let guard = 0;
  while (picks.length < want && guard < 60) {
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
    marketLog: [],
    flags: {},
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

function rollOutcome(s: RunState, eventId: string, choice: LifeChoice): number {
  if (choice.outcomes.length === 1) return 0;
  const rng = mulberry32(s.seed + s.year * 131 + strHash(`${eventId}:${choice.id}`));
  const total = choice.outcomes.reduce((t, o) => t + o.weight, 0);
  let r = rng() * total;
  for (let i = 0; i < choice.outcomes.length; i++) {
    r -= choice.outcomes[i].weight;
    if (r <= 0) return i;
  }
  return choice.outcomes.length - 1;
}

/** Resolve a chosen event back to its choice + rolled outcome (for the UI). */
export function chosenOutcome(s: RunState, eventId: string): { choice: LifeChoice; outcome: Outcome } | null {
  const raw = s.yearChoices[eventId];
  if (!raw) return null;
  const [cid, idxStr] = raw.split("|");
  const ev = getEvent(eventId);
  const choice = ev?.choices.find((c) => c.id === cid);
  if (!choice) return null;
  const outcome = choice.outcomes[Number(idxStr)] ?? choice.outcomes[0];
  return { choice, outcome };
}

export function applyLifeChoice(s: RunState, eventId: string, choice: LifeChoice): RunState {
  if (s.yearChoices[eventId]) return s;
  const idx = rollOutcome(s, eventId, choice);
  const o = choice.outcomes[idx];
  const e = o.effect;

  let salary = s.salary;
  if (e.salaryTo !== undefined) salary = Math.max(0, Math.round(e.salaryTo));
  else if (e.salaryPct) salary = Math.max(0, Math.round(salary * (1 + e.salaryPct / 100)));

  const flags = { ...s.flags };
  (o.setFlags ?? []).forEach((f) => (flags[f] = s.year));
  (o.clearFlags ?? []).forEach((f) => delete flags[f]);

  let partner = s.life.partner;
  let housing = s.life.housing;
  let kids = s.life.kids;
  if (o.setFlags?.includes("married")) partner = true;
  if (o.clearFlags?.includes("married")) partner = false;
  if (o.setFlags?.includes("owned")) housing = "owned";
  if (eventId === "kid" && choice.id === "yes") kids += 1;

  return {
    ...s,
    cash: s.cash + (e.cash ?? 0),
    debt: Math.max(0, s.debt + (e.debt ?? 0)),
    salary,
    life: {
      ...s.life,
      health: clamp(s.life.health + (e.health ?? 0), 0, 100),
      happiness: clamp(s.life.happiness + (e.happiness ?? 0), 0, 100),
      partner,
      housing,
      kids,
    },
    flags,
    usedEvents: s.usedEvents.includes(eventId) ? s.usedEvents : [...s.usedEvents, eventId],
    yearChoices: { ...s.yearChoices, [eventId]: `${choice.id}|${idx}` },
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
  const base = (s.age - 55) * 0.012;
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

  const takeHome = Math.round(s.salary * 0.78);
  const expenses = annualExpenses(s);
  let debt = s.debt * 1.07;
  let cash = s.cash + takeHome - expenses;
  if (cash < 0) {
    debt += -cash;
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
  const salary = s.salary > 0 ? Math.round(s.salary * 1.02) : 0; // no drift while unemployed

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
    marketLog: [...s.marketLog, { year: s.year, returns: rets }],
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

/** Whether a save is from a compatible (v4) engine. */
export function isCompatibleSave(s: unknown): s is RunState {
  return Boolean(s && typeof s === "object" && "marketLog" in s && "flags" in s && "yearChoices" in s);
}

export function playHeadline(year: number, indexReturn: number): { text: string; tone: "good" | "bad" | "warning" | "neutral" } | null {
  if (indexReturn <= -20) return { text: "MARKET CRASH — everything is red.", tone: "bad" };
  if (indexReturn <= -8) return { text: "Rough year. Stocks slide.", tone: "warning" };
  if (indexReturn >= 28) return { text: "Boom year. The market rips higher.", tone: "good" };
  return macroEvent(year) ? { text: "Headlines everywhere. Volatility spikes.", tone: "warning" } : null;
}

/** Cumulative price index (start 100) per asset, from resolved years. */
export function priceSeries(s: RunState, asset: AssetId): number[] {
  const out = [100];
  let v = 100;
  for (const m of s.marketLog) {
    v = v * (1 + (m.returns[asset] ?? 0) / 100);
    out.push(v);
  }
  return out;
}

export function lastAssetReturn(s: RunState, asset: AssetId): number | null {
  const last = s.marketLog[s.marketLog.length - 1];
  return last ? (last.returns[asset] ?? 0) : null;
}

export { LIFE_EVENTS };
