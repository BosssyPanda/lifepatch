// Engine property tests — the gate the replay features stand on.
//
//   node scripts/qa/build-engine.mjs && node scripts/qa/engine-props.mjs
//
// These are properties, not examples: each one drives the real compiled engine over
// many seeds and asserts something that must hold for all of them. A failure here
// means a recorded run and its replay disagree, which is the one thing none of the
// verification features may ever do.
import { createRequire } from "module";
import { OUT } from "./build-engine.mjs";

const require = createRequire(`${OUT}/`);
const R = (m) => require(`${OUT}/lib/${m}.js`);

const rng = R("rng");
const markets = R("markets");

let failures = 0;
let checks = 0;

export function check(name, fn) {
  checks++;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

export function eq(a, b, what) {
  if (!Object.is(a, b)) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

export function deepEq(a, b, what) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what}:\n       ${sa}\n       ${sb}`);
}

// ── 1. The PRNG consolidation moved code without changing a single draw ──────
// The old implementations, transcribed from the three places they used to live:
// lib/runEngine.ts (mulberry32, strHash) and lib/markets.ts (hash01).
function oldMulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function oldStrHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
function oldHash01(year, salt, seed) {
  let h = Math.imul(year | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

console.log("\nPRNG parity (the move must not change one draw)");

check("mulberry32 identical over 200 seeds x 50 draws", () => {
  for (let s = -100; s < 100; s++) {
    const a = rng.mulberry32(s);
    const b = oldMulberry32(s);
    for (let i = 0; i < 50; i++) eq(a(), b(), `seed ${s} draw ${i}`);
  }
});

check("strHash identical over the salts the engine actually uses", () => {
  for (const str of ["no-shared-card", "", "a", "promotion:take", "−", "weak-spots", "x".repeat(64)]) {
    eq(rng.strHash(str), oldStrHash(str), `strHash(${JSON.stringify(str)})`);
  }
});

check("hash01 identical over 69 years x 96 salts x 40 seeds", () => {
  for (let y = 1957; y <= 2025; y++) {
    for (let salt = 0; salt < 96; salt += 4) {
      for (let seed = 0; seed < 40; seed++) {
        eq(rng.hash01(y, salt, seed), oldHash01(y, salt, seed), `hash01(${y},${salt},${seed})`);
      }
    }
  }
});

check("real history is still untouched by the seed", () => {
  // The market contract: SP500 and the override table are record, not model.
  for (const y of [1973, 1987, 1999, 2000, 2008, 2009, 2020, 2022]) {
    const base = markets.sp500Return(y, 0);
    for (const seed of [1, 7, 12345, 999999999]) {
      eq(markets.sp500Return(y, seed), base, `sp500Return(${y}) moved with the seed`);
    }
  }
});

export function report() {
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) report();

// ─────────────────────────────────────────────────────────────────────────────
// The journal + replay properties. These are the gate the ghost line and
// verified results stand on: if a recorded run and its replay ever disagree,
// every feature built on them is quietly reporting a number nothing generated.
// ─────────────────────────────────────────────────────────────────────────────

const engine = R("runEngine");
const replay = R("replay");
const protocol = R("mp/protocol");
const buildResult = R("cloud/buildResult");
const daily = R("daily");
const dailyShare = R("dailyShare");
const { BACKGROUNDS } = R("backgrounds");

/** Assets a player could actually have bought that year (crypto is gated to 2011+). */
function tradableIn(year) {
  const ids = ["savings", "bonds", "index", "realEstate", "gold"];
  return year >= 2011 ? [...ids, "crypto"] : ids;
}

/**
 * Play a whole life under a scripted policy, off its own seeded stream so the
 * whole suite is reproducible. Policies are deliberately varied: a run that never
 * trades and a run that thrashes exercise completely different clamp paths in
 * `trade`/`payDebt`, and those clamps are the reason the journal has to be ordered.
 */
function playRun({ seed, mode = "story", backgroundId = "student", policy = "chaos", maxYears = 60 }) {
  const rand = rng.mulberry32(seed ^ 0x5f3759df);
  let s = engine.initRun(mode, backgroundId, "Prop", seed);
  for (let n = 0; n < maxYears && s.status === "playing"; n++) {
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (!ev) continue;
      const pick = ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0];
      s = engine.applyLifeChoice(s, id, pick);
    }
    if (policy === "index") {
      s = replay.indexEverything(s);
    } else if (policy === "chaos") {
      const moves = Math.floor(rand() * 4);
      for (let i = 0; i < moves; i++) {
        const opts = tradableIn(s.year);
        const asset = opts[Math.floor(rand() * opts.length)];
        // Deliberately unclamped and sometimes absurd — asking for more than you
        // hold is exactly the path the journal has to record as INTENT.
        const dollars = Math.round((rand() * 2 - 0.7) * 20000);
        s = engine.trade(s, asset, dollars);
      }
      if (rand() < 0.3) s = engine.payDebt(s, Math.round(rand() * 6000));
    }
    if (policy === "quit" && n === 5) return engine.quitRun(s);
    if (policy === "retire" && engine.canRetire(s)) return engine.retire(s);
    s = engine.advanceYear(s);
  }
  return s;
}

const POLICIES = ["idle", "index", "chaos", "quit", "retire"];
const BG_IDS = BACKGROUNDS.map((b) => b.id);

console.log("\nJournal + replay");

check("P4 the journal invariant holds after every engine call", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const policy = POLICIES[seed % POLICIES.length];
    const bg = BG_IDS[seed % BG_IDS.length];
    const mode = seed % 3 === 0 ? "infinite" : "story";
    const s = playRun({ seed, mode, backgroundId: bg, policy, maxYears: 45 });
    if (!engine.hasFullJournal(s)) {
      throw new Error(`seed ${seed} ${mode}/${bg}/${policy}: journal ${s.journal?.length} vs history ${s.history.length}, status ${s.status}`);
    }
  }
});

check("P1 a run replays to itself, field for field, journal included", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const policy = POLICIES[seed % POLICIES.length];
    const bg = BG_IDS[seed % BG_IDS.length];
    const mode = seed % 3 === 0 ? "infinite" : "story";
    const s = playRun({ seed, mode, backgroundId: bg, policy, maxYears: 45 });
    const t = replay.ticketFor(s);
    if (!t) throw new Error(`seed ${seed}: no ticket`);
    const r = replay.replayRun(t);
    if (!r) throw new Error(`seed ${seed} ${mode}/${bg}/${policy}: replay refused`);
    deepEq(r, s, `seed ${seed} ${mode}/${bg}/${policy}`);
  }
});

check("P1b verifyResult accepts the true score and rejects a nudged one", () => {
  for (let seed = 200; seed < 240; seed++) {
    const s = playRun({ seed, policy: "chaos", maxYears: 45 });
    const t = replay.ticketFor(s);
    const nw = engine.netWorth(s);
    if (!replay.verifyResult(t, nw)) throw new Error(`seed ${seed}: true score rejected`);
    if (replay.verifyResult(t, nw + 1)) throw new Error(`seed ${seed}: +$1 accepted`);
    if (replay.verifyResult(t, nw - 1)) throw new Error(`seed ${seed}: -$1 accepted`);
  }
});

check("P2 rollOutcome ignores state — the ghost's whole basis", () => {
  // The same choice, at the same year, on the same seed, from two states that
  // differ in every money field. If this ever fails, a counterfactual is silently
  // a different life and the ghost line must not ship.
  let compared = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const base = engine.initRun("story", "student", "A", seed);
    for (const ev of engine.LIFE_EVENTS) {
      for (const choice of ev.choices) {
        if (choice.outcomes.length < 2) continue;
        const rich = { ...base, cash: 900000, debt: 0, salary: 400000, holdings: { ...base.holdings, index: 500000 }, pendingEvents: [ev.id] };
        const poor = { ...base, cash: 0, debt: 250000, salary: 1, holdings: base.holdings, pendingEvents: [ev.id] };
        const a = engine.applyLifeChoice(rich, ev.id, choice);
        const b = engine.applyLifeChoice(poor, ev.id, choice);
        eq(a.yearChoices[ev.id], b.yearChoices[ev.id], `${ev.id}/${choice.id} @ seed ${seed}`);
        compared++;
      }
    }
  }
  if (compared < 500) throw new Error(`only ${compared} outcome rolls compared`);
});

check("P3 acts do not commute once a clamp bites", () => {
  // The reason `acts` is an ordered list and not a map. If someone ever "simplifies"
  // it into per-asset totals, this fails.
  const base = engine.initRun("story", "student", "A", 42);
  const s = { ...base, cash: 1000, debt: 5000 };
  const tradeFirst = engine.payDebt(engine.trade(s, "index", 1000), 1000);
  const debtFirst = engine.trade(engine.payDebt(s, 1000), "index", 1000);
  if (tradeFirst.holdings.index === debtFirst.holdings.index && tradeFirst.debt === debtFirst.debt) {
    throw new Error("order stopped mattering — the clamp path is gone");
  }
  eq(tradeFirst.holdings.index, 1000, "trade-first put the cash in the index");
  eq(debtFirst.holdings.index, 0, "debt-first left nothing to invest");
});

check("P5 a run with no journal plays on, and every reader declines", () => {
  let s = engine.initRun("story", "hustler", "Legacy", 7);
  s = { ...s, journal: undefined }; // a v6 save, or a run back from a room
  for (let n = 0; n < 21 && s.status === "playing"; n++) {
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (ev) s = engine.applyLifeChoice(s, id, ev.choices[0]);
    }
    s = engine.trade(s, "index", 2500);
    s = engine.payDebt(s, 500);
    s = engine.advanceYear(s);
  }
  eq(s.journal, undefined, "journaling restarted mid-run");
  eq(engine.hasFullJournal(s), false, "hasFullJournal");
  eq(replay.ticketFor(s), null, "ticketFor");
  eq(replay.ghostFor(s), null, "ghostFor");
});

check("P4b the wire parser drops the journal, and that degrades to a decline", () => {
  // `lib/mp/protocol.parseRunState` rebuilds RunState field by field, and
  // `matchStore.loadMatch` runs this device's own record through it too. The
  // journal cannot survive that — the point is that it fails CLOSED.
  const s = playRun({ seed: 99, policy: "chaos", maxYears: 21 });
  if (!engine.hasFullJournal(s)) throw new Error("fixture has no journal");
  const wire = protocol.parseRunState(JSON.parse(JSON.stringify(s)));
  if (!wire) throw new Error("parseRunState rejected a valid run");
  eq(wire.journal, undefined, "journal survived the wire");
  eq(engine.hasFullJournal(wire), false, "hasFullJournal after the wire");
  eq(replay.ticketFor(wire), null, "ticketFor after the wire");
});

check("P6 the ghost is the same life, with different money", () => {
  let drawn = 0;
  for (let seed = 300; seed < 360; seed++) {
    const s = playRun({ seed, policy: seed % 2 ? "chaos" : "idle", maxYears: 45 });
    const g = replay.ghostFor(s);
    if (!g) continue;
    drawn++;
    if (g.points.length > s.history.length) throw new Error(`seed ${seed}: ghost outlived the run`);
    // Same cards, same choices — re-derive the counterfactual and compare its
    // per-year deal against the journal it was forced onto.
    const t = replay.ticketFor(s);
    const ghost = replay.replayRun(t, { allocate: replay.indexEverything });
    deepEq(ghost.life, s.life, `seed ${seed}: the ghost lived a different life`);
    eq(ghost.age, s.age, `seed ${seed}: age`);
    eq(ghost.history.length, s.history.length, `seed ${seed}: years lived`);
    eq(ghost.endReason, s.endReason, `seed ${seed}: ending`);
    eq(g.gap, Math.round(engine.netWorth(s)) - g.final, `seed ${seed}: gap arithmetic`);
  }
  if (drawn < 50) throw new Error(`only ${drawn} ghosts drawn`);
});

check("P6b spare cash never exceeds the cash on hand", () => {
  for (let seed = 400; seed < 440; seed++) {
    let s = engine.initRun("story", BG_IDS[seed % BG_IDS.length], "A", seed);
    for (let n = 0; n < 21 && s.status === "playing"; n++) {
      const spare = replay.spareCash(s);
      if (spare < 0) throw new Error(`seed ${seed} y${n}: negative spare ${spare}`);
      if (spare > Math.max(0, s.cash)) throw new Error(`seed ${seed} y${n}: spare ${spare} > cash ${s.cash}`);
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) s = engine.applyLifeChoice(s, id, ev.choices[0]);
      }
      s = engine.advanceYear(s);
    }
  }
});

// ── the result row a board actually stores ──────────────────────────────────
// P1b proves `verifyResult` can tell a true score from a nudged one. This proves
// the wiring above it: that a finished run's row carries what a reader needs to
// judge it, and that the replayed flag is claimed only when the replay ran.
check("P7 a finished run's result row carries its own provenance", () => {
  let verified = 0;
  for (let seed = 500; seed < 560; seed++) {
    const mode = seed % 2 ? "infinite" : "story";
    const bg = BG_IDS[seed % BG_IDS.length];
    const s = playRun({ seed, mode, backgroundId: bg, policy: POLICIES[seed % POLICIES.length], maxYears: 45 });
    if (s.status !== "ended") continue;
    const m = buildResult.resultFromRun(s).metrics;
    eq(m.seed, s.seed, `seed ${seed}: metrics.seed`);
    eq(m.backgroundId, bg, `seed ${seed}: metrics.backgroundId`);
    eq(m.engine, engine.RUN_VERSION, `seed ${seed}: metrics.engine`);
    // A run played through in one sitting always has its whole log, so this is the
    // path every new row takes.
    eq(m.verified, 1, `seed ${seed}: a complete run did not replay`);
    verified++;
    // The one thing the flag must never do is survive the log going missing —
    // that is what an older save, or a state that crossed the wire, looks like.
    const blind = buildResult.resultFromRun({ ...s, journal: undefined }).metrics;
    eq(blind.verified, undefined, `seed ${seed}: claimed a replay with no log`);
    eq(blind.seed, s.seed, `seed ${seed}: the seed is recorded either way`);
  }
  if (verified < 20) throw new Error(`only ${verified} finished runs checked`);
});

// ── the Daily Ledger ────────────────────────────────────────────────────────
// Everyone playing today has to be playing the SAME thing, and the grid they post
// afterwards has to give nothing away to anyone who has not played it yet.
check("P8 a date fixes the day's world, and nothing else does", () => {
  const seen = new Map();
  let d = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 800; i++, d += 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10);
    const a = daily.dailyFor(date);
    const b = daily.dailyFor(date);
    deepEq(a, b, `${date}: two calls disagreed`);
    eq(a.number, i + 1, `${date}: puzzle number`);
    eq(a.seed >= 0, true, `${date}: negative seed ${a.seed}`);
    // Adjacent days must not be adjacent seeds — that is the whole reason the seed
    // hashes the date instead of counting the puzzles.
    const prev = seen.get(i - 1);
    if (prev !== undefined && Math.abs(prev - a.seed) < 1000) {
      throw new Error(`${date}: seed ${a.seed} sits next to yesterday's ${prev}`);
    }
    for (const [j, s2] of seen) if (s2 === a.seed) throw new Error(`${date}: seed collides with day ${j + 1}`);
    seen.set(i, a.seed);
    // The background rotates through every background, so no start is over-served.
    eq(a.backgroundId, BG_IDS[i % BG_IDS.length], `${date}: background rotation`);
  }
  // Before the epoch there is no puzzle, and junk is not a date.
  eq(daily.dailyFor("2025-12-31"), null, "a date before the epoch");
  eq(daily.dailyFor("not-a-date"), null, "junk");
  eq(daily.dailyFor(""), null, "empty");
});

check("P8b two devices on one date deal the same first hand", () => {
  let d = Date.UTC(2026, 3, 1);
  for (let i = 0; i < 40; i++, d += 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10);
    const p = daily.dailyFor(date);
    const a = engine.initRun("story", p.backgroundId, "A", p.seed, false, { daily: date });
    const b = engine.initRun("story", p.backgroundId, "B", p.seed, false, { daily: date });
    deepEq(a.pendingEvents, b.pendingEvents, `${date}: the opening hand differs`);
    eq(a.daily, date, `${date}: the run does not know which day it is`);
    // A weak-spot bias would break exactly this — everyone's day must be identical.
    eq(a.weakSpots, undefined, `${date}: a daily carried a personal bias`);
    eq(a.sharedEvents, undefined, `${date}: a daily was dealt as a match`);
  }
});

check("P8c the share grid says how you played and nothing about the market", () => {
  let graded = 0;
  for (let seed = 700; seed < 760; seed++) {
    const date = new Date(Date.UTC(2026, 0, 1) + (seed - 700) * 86_400_000).toISOString().slice(0, 10);
    const p = daily.dailyFor(date);
    let s = engine.initRun("story", p.backgroundId, "A", p.seed, false, { daily: date });
    const rand = rng.mulberry32(seed);
    while (s.status === "playing") {
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
      }
      if (rand() < 0.5) s = engine.trade(s, "index", Math.round(rand() * 5000));
      s = engine.advanceYear(s);
    }
    const share = dailyShare.dailyShare(s, "https://example.test/r/1");
    if (!share) throw new Error(`${date}: a finished daily produced no grid`);
    graded++;
    // One cell per year the ghost survived to grade. It usually lives the whole run;
    // an all-index allocation does occasionally go under first, and then the grid
    // covers what could be compared and the screen says why it is short.
    const ghost = replay.ghostFor(s);
    eq(share.cells.length, Math.min(s.history.length, ghost.points.length), `${date}: a cell per graded year`);
    eq(share.years, s.history.length, `${date}: years lived`);
    eq(share.ungraded, s.history.length - share.cells.length, `${date}: ungraded years`);
    if (share.cells.length === 0) throw new Error(`${date}: an empty grid`);
    // The count of ungraded years never rides on the clipboard: it is a fact about
    // what the market did to an all-index life, and a stranger must not read it.
    if (share.ungraded > 0 && /index version|went under|ungraded/i.test(share.text)) {
      throw new Error(`${date}: the pasted grid explained why it was short`);
    }
    // The one thing the grid must never carry: a calendar year. Every year this run
    // crossed, checked against the whole block.
    for (const h of s.history) {
      if (share.text.includes(String(h.year))) {
        throw new Error(`${date}: the grid leaked the year ${h.year}`);
      }
    }
    // Nor the run's seed, which would hand someone the whole world.
    if (share.text.includes(String(p.seed))) throw new Error(`${date}: the grid leaked the seed`);
    // A run that never traded still grades: it is behind an index it never bought.
    for (const c of share.cells) {
      if (c !== "ahead" && c !== "level" && c !== "behind") throw new Error(`${date}: bad cell ${c}`);
    }
    // Not a daily, no grid.
    eq(dailyShare.dailyShare({ ...s, daily: undefined }), null, `${date}: a non-daily produced a grid`);
  }
  if (graded < 50) throw new Error(`only ${graded} grids graded`);
});

check("P8d a daily run's result row is filed under its day", () => {
  const date = "2026-05-05";
  const p = daily.dailyFor(date);
  let s = engine.initRun("story", p.backgroundId, "A", p.seed, false, { daily: date });
  while (s.status === "playing") {
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (ev) s = engine.applyLifeChoice(s, id, ev.choices[0]);
    }
    s = engine.advanceYear(s);
  }
  const m = buildResult.resultFromRun(s).metrics;
  eq(m.daily, date, "metrics.daily");
  eq(buildResult.resultFromRun(s).mode, "story", "a daily is still a story run");
  eq(m.backgroundId, p.backgroundId, "the day's background is on the row");
  eq(m.seed, p.seed, "the day's seed is on the row");
  eq(m.verified, 1, "a daily played straight through did not replay");
  // And an ordinary story run files under no day at all.
  const plain = engine.initRun("story", "student", "A", 4242);
  eq(plain.daily, undefined, "an ordinary run claimed a day");
});
