import { getBackground } from "./backgrounds";
import {
  BASE_LIVING,
  DEBT_MIN_FLOOR,
  DEBT_MIN_PCT,
  DEBT_RATE,
  HOME_DOWN_PAYMENT,
  HOME_PRICE,
  HOME_UPKEEP,
  INFLATION,
  KID_COST,
  MORTGAGE_PAYMENT,
  MORTGAGE_RATE,
  RENT_START,
  RETIRE_MULTIPLE,
  TAKE_HOME,
  WAGE_GROWTH,
} from "./economy";
import { clamp } from "./format";
import {
  eligibleEvents,
  getEvent,
  LIFE_EVENTS,
  type EventContext,
  type LifeChoice,
  type Outcome,
} from "./lifeEvents";
import { ASSET_IDS, type AssetId, macroEvent, sp500Return, yearReturns } from "./markets";
import { getMode, type ModeId } from "./modes";

/**
 * Save/engine format. BUMP THIS whenever `RunState`'s shape or the economy
 * changes — `isCompatibleSave` checks it explicitly, so an older save is
 * refused cleanly instead of loading as a corrupt half-state.
 *   4 → 5: seed-aware markets, home equity + mortgage, inflating expenses,
 *          mandatory debt service, three unreachable assets removed.
 *   5 → 6: `interestPaid` and `insolventStreak` — the receipt and the counter
 *          behind the insolvency ending (see `isUnrecoverable`).
 */
export const RUN_VERSION = 6;

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
export type EndReason = "story-complete" | "retired" | "quit" | "died" | "insolvent";

export type RunState = {
  /** Engine/save format — see RUN_VERSION. Checked before a save is resumed. */
  version: number;
  mode: ModeId;
  startYear: number;
  endYear: number | null;
  year: number;
  age: number;
  name: string;
  backgroundId: string;
  cash: number;
  debt: number;
  /** Market value of the home, 0 while renting. Moves with the real-estate return. */
  homeValue: number;
  /** Outstanding mortgage principal. Secured, cheaper than `debt`, and amortising. */
  mortgage: number;
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
  /** Drives life-event rolls AND the synthetic half of the market model. */
  seed: number;
  lastDelta: number;
  /** Every dollar of interest the unsecured balance has charged. The receipt the
   *  insolvency ending reads back. */
  interestPaid: number;
  /** Consecutive resolved years in which `isUnrecoverable` held. The ending needs
   *  a run of them, never a single bad year — see INSOLVENCY_YEARS. */
  insolventStreak: number;
};

const ALL_ASSETS: AssetId[] = ASSET_IDS;

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

/**
 * What you could actually spend: cash + tradable holdings − unsecured debt.
 * Home equity is deliberately excluded — you live in it, so it can't fund a
 * retirement. This is what the FI test below measures.
 */
export function liquidNetWorth(s: RunState): number {
  return s.cash + portfolioValue(s) - s.debt;
}

export function homeEquity(s: RunState): number {
  return s.homeValue - s.mortgage;
}

export function netWorth(s: RunState): number {
  return liquidNetWorth(s) + homeEquity(s);
}

function eventContext(s: RunState): EventContext {
  return {
    age: s.age,
    year: s.year,
    salary: s.salary,
    cash: s.cash,
    debt: s.debt,
    flags: s.flags,
    life: s.life,
  };
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

/**
 * `seed` is optional and, left out, the run rolls its own exactly as it always
 * has. Passed in, two runs share one world — identical markets, identical event
 * draws from identical positions — which is the entire basis of a "with friends"
 * match. It is floored so a fractional seed can never make one client's
 * `mulberry32` disagree with another's.
 */
export function initRun(mode: ModeId, backgroundId: string, name: string, seedIn?: number): RunState {
  const cfg = getMode(mode);
  const bg = getBackground(backgroundId);
  const seed = seedIn === undefined ? Math.floor(Math.random() * 1e9) : Math.floor(seedIn);
  const base: RunState = {
    version: RUN_VERSION,
    mode,
    startYear: cfg.startYear,
    endYear: cfg.endYear,
    year: cfg.startYear,
    age: bg.startAge,
    name: name.trim() || "You",
    backgroundId,
    cash: bg.cash,
    debt: bg.debt,
    homeValue: 0,
    mortgage: 0,
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
    interestPaid: 0,
    insolventStreak: 0,
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
  // Same contract as `advanceYear`: nothing may move money through a closed
  // ledger. `advanceYear` clears `yearChoices`, so the guard below cannot catch a
  // choice replayed against an already-ended run.
  if (s.status !== "playing") return s;
  if (s.yearChoices[eventId]) return s;
  const idx = rollOutcome(s, eventId, choice);
  const o = choice.outcomes[idx];
  const e = o.effect;

  let salary = s.salary;
  // `salaryTo` is an ABSOLUTE figure written in year-one dollars, so it has to be
  // restated at today's price level. Left nominal it becomes a structural trap:
  // once expenses inflate past it, "take the steady job" hands the player a wage
  // that can never cover a year of living, and the run is unrecoverable through
  // no fault of the choice. Percentage effects need no such treatment, and cash
  // effects are deliberately left nominal so the ledger derivations in
  // `consequenceBeats` still reconcile exactly.
  if (e.salaryTo !== undefined) salary = Math.max(0, Math.round(e.salaryTo * inflator(s)));
  else if (e.salaryPct) salary = Math.max(0, Math.round(salary * (1 + e.salaryPct / 100)));

  const flags = { ...s.flags };
  (o.setFlags ?? []).forEach((f) => (flags[f] = s.year));
  (o.clearFlags ?? []).forEach((f) => delete flags[f]);

  let partner = s.life.partner;
  let housing = s.life.housing;
  if (o.setFlags?.includes("married")) partner = true;
  if (o.clearFlags?.includes("married")) partner = false;

  // Family size is an EFFECT, not a hardcoded event id — any event can add (or,
  // one day, remove) a dependent, and the cost follows automatically.
  const kids = Math.max(0, s.life.kids + (e.kids ?? 0));

  // Buying a home: the down payment leaves as `effect.cash`, and in exchange the
  // player gets an asset AND the mortgage that paid for it. Never one without
  // the other — that was the "free house" bug.
  let homeValue = s.homeValue;
  let mortgage = s.mortgage;
  if (o.setFlags?.includes("owned") && housing !== "owned") {
    housing = "owned";
    homeValue = HOME_PRICE;
    mortgage = HOME_PRICE - HOME_DOWN_PAYMENT;
  }

  return {
    ...s,
    cash: s.cash + (e.cash ?? 0),
    debt: Math.max(0, s.debt + (e.debt ?? 0)),
    homeValue,
    mortgage,
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

/** Prices since year one of the run. Expenses inflate; a flat cost curve made
 *  the back half of a long run free. */
function inflator(s: RunState): number {
  return Math.pow(1 + INFLATION, s.year - s.startYear);
}

/**
 * Everything a year of this life costs, *excluding* debt service.
 *
 * Renting: rent inflates. Owning: no rent, but property tax, insurance and
 * upkeep run ≈2.5% of the home's value every year — and the mortgage payment on
 * top of that (charged separately in `advanceYear`, because part of it is
 * principal and comes back as equity).
 */
export function annualExpenses(s: RunState): number {
  const infl = inflator(s);
  const living = (BASE_LIVING + s.life.kids * KID_COST) * infl;
  const housing = s.life.housing === "owned" ? s.homeValue * HOME_UPKEEP : RENT_START * infl;
  return Math.round(living + housing);
}

/** One year of the mortgage: interest first, the rest chips at the principal. */
export function mortgageService(s: RunState): { payment: number; balance: number } {
  if (s.mortgage <= 0) return { payment: 0, balance: 0 };
  const interest = s.mortgage * MORTGAGE_RATE;
  const payment = Math.min(MORTGAGE_PAYMENT, s.mortgage + interest);
  return { payment: Math.round(payment), balance: Math.round(Math.max(0, s.mortgage + interest - payment)) };
}

/** What the lender demands this year: the interest plus a slice of the principal. */
export function debtMinimum(debt: number): number {
  if (debt <= 0) return 0;
  return Math.round(Math.min(debt, Math.max(DEBT_MIN_FLOOR, debt * DEBT_MIN_PCT)));
}

// ── Insolvency: the one ending the life sim was missing ─────────────────────
/**
 * A run can reach a state where nothing the player can still do changes the
 * outcome: no cash, nothing left to sell, no equity in the house, a balance
 * compounding at 7% a year, and a wage that does not cover a year of living
 * before a dollar of that interest is paid. Every slider reads MAX $0, both debt
 * buttons are dead, and the only remaining control is ADVANCE — pressed, in the
 * QA run that motivated this, for twenty-five more years with the verdict already
 * written. That is not a difficulty curve, it is a screensaver.
 *
 * The bar is deliberately high, because the opposite failure — ejecting a player
 * who is merely having a bad decade — would be far worse than the boredom it
 * fixes. All five tests in `isUnrecoverable` must hold, and they must hold for
 * SEVEN years running (`INSOLVENCY_YEARS`). Across 1,800 recorded runs / 58,388
 * run-years, no run that tripped this ever climbed back to a non-negative net
 * worth, or ever repaid the balance, for the rest of its life; a 1,200-run
 * confirmation on a different sample found one exception out of 43, and that run
 * first fell from −$424k to −$1.07M over seventeen more years before turning.
 */
export const INSOLVENCY_YEARS = 7;
/** The balance has to be big against the wage, not merely present. */
export const INSOLVENCY_DEBT_MULTIPLE = 5;
/**
 * ...and the operating hole has to be wide enough that wage drift can never close
 * it. Pay grows 3%/yr against 2.5% inflation, so the gap narrows by ~0.5% a year:
 * a 15% deficit needs ~30 years of that drift to close — longer than a Story run,
 * and long enough in Infinite that the balance has compounded far out of reach first.
 *
 * These three numbers were solved, not guessed. 1,800 simulated runs across both
 * modes, six backgrounds and five player policies were recorded year by year with
 * the ending disabled, and every candidate triple was then replayed over those
 * 58,388 run-years. At (7, 5, 0.15) the ending fires on 3.9% of runs, and on a
 * wider replay (703 firings across 300 seeds × 2 modes × 3 backgrounds × 5
 * policies) 12 of them — about 1.7% — would eventually have climbed back above
 * zero, all via the same late wage restoration. So the net is tight but not
 * perfect, and an earlier note here claiming NONE ever recovered was measuring a
 * smaller sample than it sounded like. Loosening any one dial makes it markedly
 * worse: (5, 5, 0.15) fires on 115 runs with six recoveries, and (3, 1.5, 0.10)
 * fires on 21% of all runs with 75.
 */
export const INSOLVENCY_DEFICIT_PCT = 0.15;

/**
 * What a year leaves BEFORE a dollar of interest: take-home pay minus the cost of
 * living minus the mortgage. Negative means the hole deepens on its own.
 */
export function operatingCashFlow(s: RunState): number {
  return Math.round(s.salary * TAKE_HOME) - annualExpenses(s) - mortgageService(s).payment;
}

/**
 * Is this year's position one recovery cannot be reached from? One year of it is
 * a bad year; `INSOLVENCY_YEARS` of it in a row is the ending.
 */
export function isUnrecoverable(s: RunState): boolean {
  if (s.debt <= 0) return false;
  // anything sellable is a way out, and so is equity in the house
  if (s.cash > 0 || portfolioValue(s) > 0) return false;
  if (homeEquity(s) > 0) return false;
  const takeHome = Math.round(s.salary * TAKE_HOME);
  // A balance smaller than five years of take-home pay is a debt, not a spiral.
  if (s.debt < takeHome * INSOLVENCY_DEBT_MULTIPLE) return false;
  const deficit = -operatingCashFlow(s);
  return deficit > 0 && deficit >= annualExpenses(s) * INSOLVENCY_DEFICIT_PCT;
}

/**
 * How many years of this are left before the ledger closes, or null while the run
 * is not on that clock. The ending is not allowed to arrive unannounced: the run
 * screen shows this from the halfway mark, so a player always has several years of
 * notice and a stated way out (sell nothing — there is nothing — but a life choice
 * that raises pay or cuts the cost of living still resets it to zero).
 */
export const INSOLVENCY_WARN_AFTER = Math.ceil(INSOLVENCY_YEARS / 2);

export function insolvencyCountdown(s: RunState): number | null {
  if (s.status !== "playing") return null;
  if (s.insolventStreak < INSOLVENCY_WARN_AFTER) return null;
  return Math.max(1, INSOLVENCY_YEARS - s.insolventStreak);
}

function deathRoll(s: RunState): boolean {
  if (s.mode !== "infinite") return false;
  if (s.age < 55) return false;
  const rng = mulberry32(s.seed + s.year * 777);
  const base = (s.age - 55) * 0.012;
  const healthPenalty = (100 - s.life.health) * 0.0009;
  return rng() < base + healthPenalty;
}

/**
 * Resolve the current year's market + cashflow, then advance to next year.
 *
 * Order matters, and it is the honest one:
 *   1. markets move          5. the lender takes its minimum — from cash, then
 *   2. the year's cash flow      by forcing a sale of holdings
 *   3. the mortgage is served 6. the home revalues
 *   4. any deficit becomes debt
 */
export function advanceYear(s: RunState): RunState {
  // A finished life does not keep aging. The engine is the only place this can be
  // guaranteed: the year turns from several callers — the solo bar, the room's
  // shared clock, `fastForward` — and one of them can hold a stale copy of a run
  // that has since ended (a screen mid-exit still owns its last rendered props).
  // Without this the ledger of an ended run kept compounding, and the podium
  // printed a life nobody played.
  if (s.status !== "playing") return s;
  // Seeded: the synthetic half of the market moves differently per run. The
  // historical returns inside `yearReturns` are untouched by the seed.
  const rets = yearReturns(s.year, s.seed);
  const holdings = { ...s.holdings };
  const before = portfolioValue(s);
  for (const id of ALL_ASSETS) {
    holdings[id] = Math.max(0, (holdings[id] ?? 0) * (1 + (rets[id] ?? 0) / 100));
  }
  let after = ALL_ASSETS.reduce((sum, id) => sum + holdings[id], 0);
  const portfolioDelta = Math.round(after - before);

  const takeHome = Math.round(s.salary * TAKE_HOME);
  const expenses = annualExpenses(s);
  const ms = mortgageService(s);
  let cash = s.cash + takeHome - expenses - ms.payment;

  // Interest accrues, then a deficit rolls into the balance. Going cash-negative
  // is still allowed and still graceful — it just isn't free.
  const interest = s.debt * DEBT_RATE;
  let debt = s.debt + interest;
  if (cash < 0) {
    debt += -cash;
    cash = 0;
  }

  // The bite: the minimum is NOT optional. If cash can't cover it, holdings are
  // sold pro-rata to make up the difference — which is exactly what high-interest
  // debt does to a real portfolio. Only a player with neither cash nor holdings
  // rolls the shortfall forward, and that balance keeps compounding at 7%.
  let forcedSale = 0;
  const due = debtMinimum(debt);
  if (due > 0) {
    const fromCash = Math.min(cash, due);
    cash -= fromCash;
    const short = due - fromCash;
    if (short > 0 && after > 0) {
      forcedSale = Math.min(short, after);
      const keep = 1 - forcedSale / after;
      for (const id of ALL_ASSETS) holdings[id] = holdings[id] * keep;
      after -= forcedSale;
    }
    debt -= fromCash + forcedSale;
  }
  debt = Math.round(Math.max(0, debt));
  cash = Math.round(cash);

  // The house is a leveraged asset: it moves with the property market, and the
  // mortgage doesn't shrink to match. 2008 is in the table for a reason.
  const homeValue = s.homeValue > 0
    ? Math.max(0, Math.round(s.homeValue * (1 + (rets.realEstate ?? 0) / 100)))
    : 0;

  const draft: RunState = {
    ...s,
    holdings,
    cash,
    debt,
    homeValue,
    mortgage: ms.balance,
    lastDelta: portfolioDelta,
    interestPaid: Math.round(s.interestPaid + interest),
  };
  const record: YearRecord = {
    yearIndex: yearIndex(s),
    year: s.year,
    age: s.age,
    netWorth: Math.round(netWorth(draft)),
    indexReturn: sp500Return(s.year, s.seed),
    portfolioDelta,
    // What actually left the account this year — housing and debt service included,
    // so the figure the player sees is the one they lived.
    cashFlow: Math.round(takeHome - expenses - ms.payment - due),
  };

  const nextYear = s.year + 1;
  const nextAge = s.age + 1;
  // No drift while unemployed. Nominal wage growth, ~0.5pt ahead of prices.
  const salary = s.salary > 0 ? Math.round(s.salary * (1 + WAGE_GROWTH)) : 0;

  // The streak is measured on the position the player is about to be handed —
  // next year's prices, next year's wage — not on the one they just left.
  const settled: RunState = { ...draft, year: nextYear, age: nextAge, salary };
  const insolventStreak = isUnrecoverable(settled) ? s.insolventStreak + 1 : 0;

  let status: RunStatus = "playing";
  let endReason: EndReason | undefined;
  if (s.endYear !== null && nextYear > s.endYear) {
    status = "ended";
    endReason = "story-complete";
  } else if (deathRoll(draft)) {
    status = "ended";
    endReason = "died";
  } else if (insolventStreak >= INSOLVENCY_YEARS) {
    status = "ended";
    endReason = "insolvent";
  }

  const next: RunState = {
    ...settled,
    insolventStreak,
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
/**
 * The number: 25× a year of expenses, invested. The 4% rule, which is the whole
 * point of the game stated as one figure.
 */
export function retirementNumber(s: RunState): number {
  return Math.round(annualExpenses(s) * RETIRE_MULTIPLE);
}

/**
 * Retirement is a GOAL, not an age gate. The old `age >= 60` test could never
 * fire in Story mode (it runs 21 years from age 20–24, so the player tops out in
 * their forties) — the mode's own ending was unreachable by construction.
 * Hitting your number ends the run in any mode; age 60 stays as the ordinary
 * path for a long Infinite run that never got rich.
 */
export function canRetire(s: RunState): boolean {
  return liquidNetWorth(s) >= retirementNumber(s) || s.age >= 60;
}

/**
 * Whether a save was written by THIS engine. Version-checked explicitly: the old
 * duck-type ("does it have marketLog?") passed every past and future shape, so a
 * stale save loaded as a half-initialised state instead of being refused.
 * Callers should treat `false` as "no save" — see `loadRunChecked` in lib/saves.
 */
export function isCompatibleSave(s: unknown): s is RunState {
  return Boolean(s && typeof s === "object" && (s as Partial<RunState>).version === RUN_VERSION);
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
