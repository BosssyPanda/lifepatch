import { getBackground } from "./backgrounds";
import {
  BASE_LIVING,
  DEBT_MIN_FLOOR,
  DEBT_MIN_PCT,
  DEBT_RATE,
  HOME_DOWN_PAYMENT,
  HOME_PRICE,
  HOME_SALE_COST,
  HOME_UPKEEP,
  INFLATION,
  KID_COST,
  MORTGAGE_PAYMENT,
  MORTGAGE_PAYMENT_RATE,
  MORTGAGE_RATE,
  RENT_START,
  RETIRE_MULTIPLE,
  TAKE_HOME,
  WAGE_GROWTH,
} from "./economy";
import { eventTeachesAny } from "./eventConcepts";
import { clamp } from "./format";
import {
  eligibleEvents,
  getEvent,
  LIFE_EVENTS,
  type EventContext,
  type LifeChoice,
  type LifeEvent,
  type Outcome,
} from "./lifeEvents";
import { ASSET_IDS, type AssetId, macroEvent, sp500Return, yearReturns } from "./markets";
import { getMode, type ModeId } from "./modes";
import { mulberry32, strHash } from "./rng";

/**
 * Save/engine format. BUMP THIS whenever `RunState`'s shape or the economy
 * changes — `isCompatibleSave` checks it explicitly, so an older save is
 * refused cleanly instead of loading as a corrupt half-state.
 *   4 → 5: seed-aware markets, home equity + mortgage, inflating expenses,
 *          mandatory debt service, three unreachable assets removed.
 *   5 → 6: `interestPaid` and `insolventStreak` — the receipt and the counter
 *          behind the insolvency ending (see `isUnrecoverable`).
 *   6 → 6: `journal`, `weakSpots` and `daily` were added as OPTIONAL fields and
 *          deliberately did NOT bump this. A save written before them carries none
 *          of them, and every path that reads one treats absent as "decline" — the
 *          draw falls back to the weights it always used, and replay/ghost/verify
 *          return null. Same reasoning `sharedEvents` already makes below. Bumping
 *          would have invalidated every live save to buy nothing.
 *   6 → 7: the home stops being a fixed nominal price. `HOME_PRICE` is restated to
 *          the price level at purchase, the mortgage payment is derived from the
 *          loan actually signed and carried in `mortgagePayment`, and `sellHome`
 *          exists. This one HAS to bump: a v6 save carries no `mortgagePayment`,
 *          and every engine fix in this change alters what a replayed run resolves
 *          to, so old rows must be marked non-comparable rather than quietly mixed
 *          into a leaderboard beside new ones.
 */
export const RUN_VERSION = 7;

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

/**
 * One recorded action inside a year, in the order it was applied.
 *
 * Tuples, not `{kind, …}` records. This rides in every save: a 21-year story
 * journal is ~5KB encoded this way and roughly three times that as objects, and an
 * Infinite run has no fixed length.
 *
 * A trade records the dollars the player ASKED FOR, never the clamped amount.
 * `trade` floors against `Math.max(0, cash)` — so the clamp is a function of the
 * state it lands in, and a counterfactual replay lands in a different state on
 * purpose. Recording the intent lets the clamp be recomputed; recording the outcome
 * would bake one life's cash position into another's.
 */
export type JournalAct =
  | readonly ["c", eventId: string, choiceId: string, outcomeIdx: number]
  | readonly ["t", asset: AssetId, dollars: number]
  | readonly ["d", dollars: number]
  /** Sold the house. Carries nothing: the proceeds are a pure function of the
   *  state at the moment it happened, so recording them would be recording a
   *  derivation the replay must compute anyway — and a second source of truth
   *  that can disagree with the first. */
  | readonly ["h"];

/**
 * What one year of a life actually consisted of.
 *
 * `deal` exists because `drawEvents` reads this life's own cash (see its note): a
 * replay that re-draws is handed different cards, and is therefore not the same
 * life. `acts` is ORDERED because `trade` and `payDebt` clamp against cash and stop
 * commuting the moment a clamp bites — a map keyed by event id cannot express a year.
 */
export type YearJournal = {
  /** The calendar year this entry covers. Entry `i` must be `startYear + i`. */
  y: number;
  /** Exactly what `drawEvents` dealt for this year. */
  deal: string[];
  /** Choices, trades and debt payments, in the order they happened. */
  acts: JournalAct[];
  /**
   * Set only on a year the run ENDED inside. `retire` and `quitRun` never call
   * `advanceYear`, so this entry has no matching `history` record — but its acts
   * did move money into the final net worth, and a replay has to apply them. This
   * is why the journal cannot be checked by length alone.
   */
  end?: "retire" | "quit";
};

/**
 * A ceiling on one year's actions. A year past it is a script, not a player.
 *
 * Blowing it DROPS the journal rather than truncating it. A truncated journal is
 * the one genuinely dangerous state: it still passes every structural check while
 * replaying to a different number. Absent is honest; partial is a lie.
 */
export const MAX_ACTS_PER_YEAR = 200;

export type RunStatus = "playing" | "ended";
export type EndReason = "story-complete" | "retired" | "quit" | "died" | "insolvent";

export type RunState = {
  /** Engine/save format — see RUN_VERSION. Checked before a save is resumed. */
  version: number;
  /**
   * Set only on a run carried forward by `migrateSave`, and set to the version it
   * was carried FROM. A migrated run is playable — that is the whole point — but it
   * is not comparable: most of its years were resolved under the older economy, so
   * ranking it against runs played entirely under the current one is the exact
   * mixing `comparabilityMarker` exists to prevent. `resultFromRun` stamps this
   * instead of `RUN_VERSION` when it is present, so the run keeps its own share
   * page and simply does not appear on today's board.
   */
  migratedFrom?: number;
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
  /**
   * The level annual payment on the loan this player actually signed. 0 while
   * renting.
   *
   * In the state rather than a constant because the price is restated to the price
   * level at purchase: a loan taken out in year 40 is several times the size of one
   * taken out in year 1, and a fixed payment against it would never cover the
   * interest — the balance would grow every year and the house would never be paid
   * off. Set once, at purchase, and never re-derived: a mortgage is a contract.
   */
  mortgagePayment: number;
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
  /**
   * Match runs only: deal the year's card from the WHOLE deck, so everyone at the
   * table turns over the same one.
   *
   * Optional on purpose — absent means solo, which is every save written before
   * rooms existed, so no version bump is needed and solo draws exactly as it
   * always has. See `drawEvents` for why this matters: without it two players in
   * one room stop sharing a world the moment their lives differ at all.
   */
  sharedEvents?: boolean;
  /**
   * Every year of this life, as it was actually played — the one thing the seed
   * does not already fix.
   *
   * Optional, and its absence is MEANINGFUL: it means "written by an engine that
   * did not journal, or round-tripped through a parser that drops it".
   * `lib/mp/protocol.ts` rebuilds `RunState` field by field, and
   * `lib/mp/matchStore` loads this device's own record through that same parser, so
   * a run that came back from a room has no journal and never will.
   *
   * Journaling NEVER starts mid-run. A journal covering part of a run is worse than
   * none, because there is exactly one moment at which it passes a naive check.
   * Every reader goes through `hasFullJournal` and declines otherwise.
   */
  journal?: YearJournal[];
  /**
   * The concepts this run was told to favour, snapshotted at `initRun`.
   *
   * In the STATE rather than read live, so the same run replays to the same draws
   * on any machine and at any later date. Ignored entirely when `sharedEvents` is
   * set — a per-player bias would desynchronise a room.
   */
  weakSpots?: string[];
  /** The UTC date of the Daily Ledger puzzle this run is an attempt at. */
  daily?: string;
};

const ALL_ASSETS: AssetId[] = ASSET_IDS;

function emptyHoldings(): Record<AssetId, number> {
  return ALL_ASSETS.reduce((a, id) => ((a[id] = 0), a), {} as Record<AssetId, number>);
}

/**
 * Append to the OPEN year's entry.
 *
 * Silently no-ops on a state with no journal, and that IS the compatibility story:
 * a v6 save and a run that came back through `parseRunState` both keep playing
 * exactly as they did, and every reader downstream declines rather than guessing.
 */
function record(s: RunState, act: JournalAct): RunState {
  const j = s.journal;
  if (!j || j.length === 0) return s;
  const open = j[j.length - 1];
  if (open.y !== s.year || open.end) return s;
  if (open.acts.length >= MAX_ACTS_PER_YEAR) return { ...s, journal: undefined };
  return { ...s, journal: [...j.slice(0, -1), { ...open, acts: [...open.acts, act] }] };
}

/** Mark the open year on a run that ended without ever turning it. */
function sealEnd(s: RunState, end: "retire" | "quit"): YearJournal[] | undefined {
  const j = s.journal;
  if (!j || j.length === 0) return j;
  const open = j[j.length - 1];
  if (open.y !== s.year || open.end) return j;
  return [...j.slice(0, -1), { ...open, end }];
}

/**
 * Does this journal cover the whole run? The precondition for every reader.
 *
 * The check is per-entry YEAR IDENTITY, not length. Length alone gets three of the
 * five terminal states wrong — a live run, a retired run and a quit run each carry
 * one open entry past `history` — and it can be satisfied by a journal that
 * restarted mid-run: a room snapshot delivered at year one, re-journalled from
 * there and fast-forwarded, marches both counters together forever while describing
 * a life that began somewhere else. `y[i] === startYear + i` closes that.
 */
export function hasFullJournal(s: RunState): s is RunState & { journal: YearJournal[] } {
  const j = s.journal;
  if (!j || j.length === 0) return false;
  for (let i = 0; i < j.length; i++) if (j[i].y !== s.startYear + i) return false;
  const openTail = s.status === "playing" || j[j.length - 1].end !== undefined;
  return j.length === s.history.length + (openTail ? 1 : 0);
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

/**
 * How many slots an event gets in the solo pool.
 *
 * `WEAK_SPOT_WEIGHT` is deliberately small. This is a nudge, not a curriculum: at
 * ×2 a weak-spot card is roughly twice as likely to be dealt as it was, which is
 * enough to be felt over a run and not enough to turn a life sim into a drill. The
 * player is told it is happening (`components/screens/LifeReport.tsx`), which is
 * the other half of the deal — a silent bias on the cards you are dealt would be a
 * game lying about its own randomness.
 *
 * Reads `s.weakSpots`, which `initRun` SNAPSHOTS at the start of the run and
 * nothing mutates afterwards. That is what keeps `drawEvents` a pure function of
 * the run state, and therefore keeps a replay valid: a live read of localStorage
 * would make the same seed deal different cards on a different day.
 */
export const WEAK_SPOT_WEIGHT = 2;

/**
 * How many slots this event occupies in the draw pool.
 *
 * The result feeds `Array(n)`, which is unforgiving in two directions a bare
 * `e.weight ?? 1` never checked: `Array(0)` contributes nothing, and a pool that
 * ends up empty makes `weighted[Math.floor(rng() * 0)]` an `undefined` that is
 * pushed into `pendingEvents` and travels into the journal and onto the wire;
 * `Array(0.5)` throws `RangeError` at draw time instead. Every authored weight is
 * already a positive integer, so this clamp is a no-op on today's content and
 * `scripts/qa/golden-draws.json` still pins byte-identical draws — it is here so
 * that authoring a bad weight is a dull card rather than a broken year.
 */
function weightFor(e: LifeEvent, s: RunState): number {
  const base = poolSlots(e.weight);
  const weak = s.weakSpots;
  if (!weak || weak.length === 0) return base;
  return eventTeachesAny(e.id, weak) ? base * WEAK_SPOT_WEIGHT : base;
}

/** A weight as `Array()` can actually use it: an integer, at least one. */
function poolSlots(weight: number | undefined): number {
  const n = Math.floor(weight ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * The year's cards.
 *
 * Solo draws from the hand this life can actually be dealt, as it always has.
 *
 * A MATCH draws from the whole deck instead, and that difference is the entire
 * point. Every player shares one `seed`, so the shared stream turns over the same
 * card for everyone — but a pool built per player desynchronises the moment two
 * lives differ by a single predicate: the pools are different lengths, the same
 * random number indexes a different card, and from there the two players are
 * living in unrelated worlds. Measured over 400 seeded matches that was 21% of
 * all years dealing different cards, one player in six handed something the
 * others could never be offered, and up to $71k of final net worth decided by it.
 *
 * A card that genuinely cannot apply — a rent hike for an owner, a promotion for
 * someone with no job — is replaced from what this life CAN face, drawn off a
 * side stream keyed to the card that didn't fit. The room's own sequence is never
 * touched by a substitution, so every player's shared draws stay in lockstep no
 * matter how many of them had to be swapped. Wealth gates (the deposit you saved
 * for) are left exactly as they are: that is a door you opened by playing, not a
 * card fate dealt you.
 *
 * Pure and fully determined by (seed, year, this life's own state) — which is
 * what lets an absent player be ghost-played and a returning one catch up to
 * byte-identical state.
 */
function drawEvents(s: RunState): string[] {
  const rng = mulberry32(s.seed + s.year * 101);
  const mine = eligibleEvents(eventContext(s), s.usedEvents);
  if (mine.length === 0) return [];

  const picks: string[] = [];
  const want = rng() < 0.35 ? 2 : 1;

  if (!s.sharedEvents) {
    // Solo: the same draw it has always been, with one addition — cards about the
    // concepts this player keeps getting wrong come up more often.
    //
    // The multiplier is an INTEGER on the existing weight, so the pool is still
    // built the same way and the stream is still spent in the same order; a card
    // with no weak-spot concept occupies exactly the slots it always did. With an
    // empty `weakSpots` (a match, the daily, a player with no record yet) every
    // weight is multiplied by one and the draw is byte-identical to before — which
    // `scripts/qa/golden-draws.json` pins over 120 runs.
    const weighted = mine.flatMap((e) => Array(weightFor(e, s)).fill(e.id));
    let guard = 0;
    while (picks.length < want && guard < 60) {
      guard++;
      const id = weighted[Math.floor(rng() * weighted.length)];
      if (!picks.includes(id)) picks.push(id);
    }
    return picks;
  }

  // A match deals one RUNNING ORDER for the whole table — the same sequence of
  // cards, in the same order, for every player — and each life takes the first
  // ones it can actually face. Two players are handed different cards only where
  // one of them genuinely could not have been dealt the other's.
  //
  // Substituting per player was tried first and is much worse: each life swaps to
  // a card of its own and they end up nowhere near each other. Walking one shared
  // order instead means agreement is the default and divergence has to be earned.
  //
  // The stream is re-seeded from (seed, year) every year, so it does not matter
  // that two lives stop reading this order at different points — next year they
  // both start again from the same first card.
  const weighted = LIFE_EVENTS.flatMap((e) => Array(poolSlots(e.weight)).fill(e.id));
  const canFace = new Set(mine.map((e) => e.id));
  for (let i = 0; i < 400 && picks.length < want; i++) {
    const id = weighted[Math.floor(rng() * weighted.length)];
    if (!picks.includes(id) && canFace.has(id)) picks.push(id);
  }
  if (picks.length === 0) {
    // The order never turned up a card this life could face. It still gets a year:
    // fall back to its own hand, off a side stream so nothing above is disturbed.
    const own = mine.flatMap((e) => Array(poolSlots(e.weight)).fill(e.id));
    const side = mulberry32(s.seed + s.year * 101 + strHash("no-shared-card"));
    picks.push(own[Math.floor(side() * own.length)]);
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
export function initRun(
  mode: ModeId,
  backgroundId: string,
  name: string,
  seedIn?: number,
  sharedEvents?: boolean,
  /** Additive: a sixth positional would have been a trap for the next caller. */
  opts?: { weakSpots?: string[]; daily?: string },
): RunState {
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
    mortgagePayment: 0,
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
    // Written only when true, so a solo save is byte-for-byte what it always was.
    ...(sharedEvents ? { sharedEvents: true } : {}),
    ...(opts?.weakSpots?.length ? { weakSpots: [...opts.weakSpots] } : {}),
    ...(opts?.daily ? { daily: opts.daily } : {}),
  };
  base.pendingEvents = drawEvents(base);
  // Year one's entry opens here, and journaling only ever begins here — a journal
  // that starts mid-run is the one shape that can pass a check while lying.
  base.journal = [{ y: base.year, deal: [...base.pendingEvents], acts: [] }];
  return base;
}

/**
 * Move money between cash and one holding. A transfer, never a source: whatever
 * leaves one side arrives on the other, and neither side may go below zero.
 *
 * The zero floors are load-bearing, not defensive dressing. Cash is legitimately
 * NEGATIVE while a year is open — a life event can overdraw you, and the portfolio
 * says so out loud ("overspent — becomes debt when the year advances"). Clamping a
 * buy to a negative `cash` used to yield a negative `amt`, which paid cash UP to
 * zero and pushed the holding DOWN below it; `advanceYear` then floored the holding
 * at zero and the difference was money that never existed. Paying debt from an
 * overdraft did the mirror of it and grew the debt it was sent to shrink.
 */
export function trade(s: RunState, asset: AssetId, dollars: number): RunState {
  const holdings = { ...s.holdings };
  let cash = s.cash;
  if (dollars > 0) {
    const amt = Math.min(dollars, Math.max(0, cash));
    cash -= amt;
    holdings[asset] = (holdings[asset] ?? 0) + amt;
  } else {
    const amt = Math.min(-dollars, Math.max(0, holdings[asset] ?? 0));
    cash += amt;
    holdings[asset] = (holdings[asset] ?? 0) - amt;
  }
  // The dollars ASKED FOR, not `amt` — see `JournalAct`.
  return record({ ...s, cash, holdings }, ["t", asset, dollars]);
}

export function payDebt(s: RunState, dollars: number): RunState {
  // See `trade`: cash can be negative mid-year, and an unfloored min() turned a
  // repayment into a loan.
  const amt = Math.min(dollars, Math.max(0, s.cash), Math.max(0, s.debt));
  return record({ ...s, cash: s.cash - amt, debt: s.debt - amt }, ["d", dollars]);
}

/**
 * What selling the house right now would put in the player's hand.
 *
 * Negative means underwater: the sale does not clear the mortgage and the
 * shortfall follows you as unsecured debt. That is what "the mortgage doesn't
 * shrink when prices do" — the lesson `rentOrBuy` already prints — actually costs,
 * and 2007–2011 is in the returns table precisely so it can happen.
 */
export function homeSaleProceeds(s: RunState): number {
  if (s.life.housing !== "owned") return 0;
  return Math.round(s.homeValue * (1 - HOME_SALE_COST)) - s.mortgage;
}

/**
 * Sell the house.
 *
 * The engine had three places that could write `housing`/`homeValue`/`mortgage`
 * — `initRun`, the buy branch, the annual revaluation — and none of them could
 * ever reverse it. That made two things untrue at once. `isUnrecoverable`'s own
 * comment says "equity in the house is a way out", and refuses the insolvency
 * ending to any homeowner; with no way to reach that equity it was not a way out,
 * it was a reason the ending could never fire. And upkeep is `homeValue *
 * HOME_UPKEEP` on a value compounding faster than wages, so a long Infinite run
 * eventually spends more on the house than it earns, with no lever left but
 * ADVANCE. This is the lever.
 *
 * It is not free: `HOME_SALE_COST` comes off the top, so a house flipped the year
 * after it was bought loses money, and the run goes back to paying inflating rent.
 */
export function sellHome(s: RunState): RunState {
  if (s.status !== "playing") return s;
  if (s.life.housing !== "owned") return s;
  const net = homeSaleProceeds(s);
  return record({
    ...s,
    // Underwater, the bank is still owed the difference, and it joins the balance
    // that compounds at DEBT_RATE. Nothing here can be lost quietly.
    cash: s.cash + Math.max(0, net),
    debt: net < 0 ? s.debt - net : s.debt,
    homeValue: 0,
    mortgage: 0,
    mortgagePayment: 0,
    life: { ...s.life, housing: "renting" },
  }, ["h"]);
}

export function allEventsResolved(s: RunState): boolean {
  return s.pendingEvents.every((id) => s.yearChoices[id]);
}

/** The index of the outcome this choice rolls, or **-1** for a choice that has no
 *  outcomes to roll. Callers must treat -1 as "refuse", never as an index: the
 *  loop below fell through to `length - 1` on an empty list, and `outcomes[-1].effect`
 *  threw four frames later. `lib/mp/autoResolve.ts` already contemplates this shape. */
function rollOutcome(s: RunState, eventId: string, choice: LifeChoice): number {
  if (choice.outcomes.length === 0) return -1;
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
  // A choice with no outcomes is refused the same way an out-of-phase choice is:
  // by returning the state untouched. That is already the engine's "I will not do
  // that" signal — `useRun.commit` suppresses it and `replayRun` reads it as a
  // desync — so a malformed card costs a card, never a run.
  if (idx < 0) return s;
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
  //
  // The PRICE is restated to today's level, for the same reason `salaryTo` is. Left
  // nominal it was the largest exploit in the sim: `annualExpenses` inflates rent
  // every year while the house stayed $220,000 with a fixed $13,376/yr mortgage, so
  // by Infinite year 60 a $44,000 down payment bought a permanent $42,700/yr saving
  // — a guaranteed ~97% annual return, available to anyone who waited.
  //
  // The DOWN PAYMENT stays nominal, which is deliberate and is the honest half of
  // the same story: it is the figure the card quotes and the figure `requires`
  // gates on, so the ledger the player reads is the money that actually moves.
  // What changes is the leverage — buy in year one and you own 20% of the house;
  // buy in year forty and you own 5% of a much larger one, with a payment to match.
  let homeValue = s.homeValue;
  let mortgage = s.mortgage;
  let mortgagePayment = s.mortgagePayment;
  if (o.setFlags?.includes("owned") && housing !== "owned") {
    housing = "owned";
    homeValue = Math.round(HOME_PRICE * inflator(s));
    mortgage = Math.max(0, homeValue - HOME_DOWN_PAYMENT);
    // The contract, signed once. `mortgageService` amortises against this and never
    // recomputes it — a level payment is what makes a mortgage a mortgage.
    mortgagePayment = Math.round(mortgage * MORTGAGE_PAYMENT_RATE);
  }

  // A repayment can only spend what it actually retires.
  //
  // Cash and debt move independently and the balance floors at zero, so an effect
  // that pairs `cash: -8000` with `debt: -8000` charged the full $8,000 against a
  // balance of $2,000 — or of nothing — and the difference simply ceased to exist.
  // `studentLoans` now carries a balance gate so this cannot be reached on today's
  // content and no draw or number changes; the guard is here so the next card that
  // pairs the two fields cannot reintroduce it. The refund is proportional, which
  // is the only reading that keeps the ledger's ratio honest: retire a quarter of
  // what the card offered to retire, pay a quarter of what it asked.
  const debtDelta = e.debt ?? 0;
  const cashDelta = e.cash ?? 0;
  let cashOut = cashDelta;
  if (debtDelta < 0 && cashDelta < 0) {
    const retired = Math.min(-debtDelta, Math.max(0, s.debt));
    cashOut = -Math.round(-cashDelta * (retired / -debtDelta));
  }

  return record({
    ...s,
    cash: s.cash + cashOut,
    debt: Math.max(0, s.debt + debtDelta),
    homeValue,
    mortgage,
    mortgagePayment,
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
  }, ["c", eventId, choice.id, idx]);
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
  // This loan's own level payment. A floor at one year of interest keeps the
  // invariant that a mortgage amortises: a state that somehow carried a payment
  // smaller than its interest would grow the balance every year forever, which is
  // not a mortgage, it is the debt spiral wearing a house.
  const level = Math.max(s.mortgagePayment, interest + 1);
  const payment = Math.min(level, s.mortgage + interest);
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
  let debtPaid = 0;
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
    debtPaid = fromCash + forcedSale;
    debt -= debtPaid;
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
    //
    // `due` is what the lender ASKED for; `debtPaid` is what it actually got. The
    // two part company for exactly the player this row matters most to. Broke, no
    // holdings, nothing to take: the shortfall rolls forward onto the balance and
    // not a dollar moves, yet the row used to print the full minimum as though it
    // had been paid — and it printed it on top of a deficit that had ALREADY been
    // charged, once as the negative operating line and again as the debt it became.
    // The same year was billed twice and the receipt disagreed with the ledger.
    cashFlow: Math.round(takeHome - expenses - ms.payment - debtPaid),
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
  // The year just resolved needs nothing: its acts were appended as they happened.
  // All that is left is to open the next one, with the hand it was dealt.
  if (s.journal && status === "playing") {
    next.journal = [...s.journal, { y: nextYear, deal: [...next.pendingEvents], acts: [] }];
  }
  return next;
}

// Both of these end a life INSIDE a year rather than by turning it, so the open
// journal entry has no matching `history` row — and its acts still moved money into
// the final number. It is marked, not dropped; a replay has to apply it and then stop.
//
// Both also carry `advanceYear`'s guard, and for a reason that is reachable rather
// than theoretical: `AnimatePresence mode="wait"` keeps `AdvanceBar` mounted
// through its exit animation, so a run that has just ended still has a live Retire
// and a live Quit under the player's thumb for the length of that transition. A tap
// there used to rewrite `endReason` — "died" became "quit", and `deriveVerdict`
// silently reclassified the run. An ended life cannot end again.
export function retire(s: RunState): RunState {
  if (s.status !== "playing") return s;
  return { ...s, status: "ended", endReason: "retired", journal: sealEnd(s, "retire") };
}
export function quitRun(s: RunState): RunState {
  if (s.status !== "playing") return s;
  return { ...s, status: "ended", endReason: "quit", journal: sealEnd(s, "quit") };
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

/**
 * Carry a v6 save into v7, or say it cannot be carried.
 *
 * The 6 → 7 bump exists because the home stopped being a fixed nominal price, and
 * the only genuinely NEW field is `mortgagePayment`. For a v6 save that field is
 * not unknown — it is exactly `MORTGAGE_PAYMENT`, the fixed constant those loans
 * were already being charged every year. So the upgrade is lossless and derives
 * nothing: it writes down a number the old engine was already using.
 *
 * Refusing these instead would have been the cheaper change and the wrong one.
 * `isCompatibleSave` is checked before a save is resumed, so every player with a
 * run in progress would have met OUTDATED_SAVE_MESSAGE on deploy and lost it, to
 * buy a strictness that a one-line backfill provides for free.
 *
 * The honest caveat, written here rather than discovered later: a migrated run
 * FINISHES under the new economy — a home bought before the fix keeps its old
 * price, and every year after it is priced the new way. Its journal therefore no
 * longer replays clean end to end, so `verifyResult` returns false and the run
 * posts without the Replayed flag. That is the correct reading of a run played
 * across two economies, not a failure: an absent flag makes no claim either way,
 * which is precisely what `buildResult` documents it to mean.
 *
 * The same fact is why `migratedFrom` is stamped below. A run played across two
 * economies is not comparable to one played entirely under the current one, and
 * the leaderboard filter that was added alongside this migration would have been
 * defeated by the very saves it was written to keep out — `resultFromRun` reads
 * `migratedFrom` so the row carries `engine: 6` and is ranked with its own kind.
 *
 * Returns null for anything that is neither v6 nor v7 — those genuinely cannot be
 * carried, and `"outdated"` is reserved for them.
 */
export function migrateSave(s: unknown): RunState | null {
  if (!s || typeof s !== "object") return null;
  const raw = s as Partial<RunState>;
  if (raw.version === RUN_VERSION) return raw as RunState;
  if (raw.version !== 6) return null;
  return {
    ...(raw as RunState),
    version: RUN_VERSION,
    // A renter had no loan and no payment; an owner was paying the flat constant.
    mortgagePayment: (raw.mortgage ?? 0) > 0 ? MORTGAGE_PAYMENT : 0,
    // Remember where it came from. Without this the run would post `engine: 7` and
    // rank beside runs that never saw the old nominal $220k house — see the field's
    // own note on `RunState`.
    migratedFrom: 6,
  };
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
