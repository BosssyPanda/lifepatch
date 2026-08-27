// Engine property tests — the gate the replay features stand on.
//
//   node scripts/qa/build-engine.mjs && node scripts/qa/engine-props.mjs
//
// These are properties, not examples: each one drives the real compiled engine over
// many seeds and asserts something that must hold for all of them. A failure here
// means a recorded run and its replay disagree, which is the one thing none of the
// verification features may ever do.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { engineDir } from "./build-engine.mjs";

// Builds the engine if the tree has moved past what is compiled — see build-engine.mjs.
const OUT = engineDir();
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

// Deliberately NOT reported here — see the bottom of the file. This block used to
// be the whole gate, and reporting where it ends is what broke it.

// ─────────────────────────────────────────────────────────────────────────────
// The journal + replay properties. These are the gate the ghost line and
// verified results stand on: if a recorded run and its replay ever disagree,
// every feature built on them is quietly reporting a number nothing generated.
// ─────────────────────────────────────────────────────────────────────────────

const engine = R("runEngine");
const replay = R("replay");
const protocol = R("mp/protocol");
const buildResult = R("cloud/buildResult");
const format = R("format");
const daily = R("daily");
const dailyShare = R("dailyShare");
const eventConcepts = R("eventConcepts");
const economy = R("economy");
const lifeEvents = R("lifeEvents");
const cashflow = R("cashflow/engine");
const dreams = R("cashflow/dreams");
const professions = R("cashflow/professions");
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

check("P6c the ghost repays the debt the player repaid", () => {
  // The ghost changes ONE variable: where the investable money went. It replays the
  // player's voluntary debt payments verbatim, because letting it skip those too
  // would make it a different debt strategy as well — carrying 7% interest the
  // player had cleared — and the gap on the report would stop isolating anything.
  //
  // Asserted by removing them: a ticket with its "d" acts stripped must produce a
  // DIFFERENT ghost. If the driver were quietly skipping them, the two would agree.
  let tested = 0;
  for (let seed = 700; seed < 800 && tested < 12; seed++) {
    let st = engine.initRun("story", BG_IDS[seed % BG_IDS.length], "A", seed);
    const rand = rng.mulberry32(seed);
    while (st.status === "playing") {
      for (const id of [...st.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) st = engine.applyLifeChoice(st, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
      }
      // Pay down debt whenever there is both a balance and the cash to touch it.
      if (st.debt > 0 && st.cash > 2000) st = engine.payDebt(st, Math.min(st.debt, Math.floor(st.cash / 2)));
      st = engine.advanceYear(st);
    }
    const t = replay.ticketFor(st);
    if (!t) continue;
    const paid = t.journal.reduce((n, y) => n + y.acts.filter((a) => a[0] === "d").length, 0);
    if (paid === 0) continue;
    tested++;

    const withPayments = replay.replayRun(t, { allocate: replay.indexEverything });
    const stripped = replay.replayRun(
      { ...t, journal: t.journal.map((y) => ({ ...y, acts: y.acts.filter((a) => a[0] !== "d") })) },
      { allocate: replay.indexEverything },
    );
    if (!withPayments || !stripped) throw new Error(`seed ${seed}: a ghost would not replay`);
    const a = Math.round(engine.netWorth(withPayments));
    const b = Math.round(engine.netWorth(stripped));
    if (a === b) {
      throw new Error(`seed ${seed}: dropping ${paid} debt payments changed nothing — the ghost is skipping them`);
    }
  }
  if (tested < 8) throw new Error(`only ${tested} runs actually repaid debt — the check proved little`);
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

// ── weak spots ──────────────────────────────────────────────────────────────
// A bias on the cards you are dealt is the most dangerous thing in this pass: it
// touches `drawEvents`, which every replay, every verification and every match
// stands on. These four checks are the fence around it.
check("P9 a run with no weak spots deals exactly what it dealt before", () => {
  const golden = JSON.parse(readFileSync(new URL("./golden-draws.json", import.meta.url), "utf8"));
  for (let seed = 1; seed <= 120; seed++) {
    const mode = seed % 2 ? "infinite" : "story";
    let s = engine.initRun(mode, BG_IDS[seed % 3], "G", seed);
    const rand = rng.mulberry32(seed);
    const deals = [];
    let n = 0;
    while (s.status === "playing" && n < 30) {
      deals.push(s.pendingEvents.join(","));
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
      }
      if (rand() < 0.5) s = engine.trade(s, "index", Math.round(rand() * 4000));
      s = engine.advanceYear(s);
      n++;
    }
    eq(deals.join("|"), golden[seed - 1], `seed ${seed}: the draw moved`);
  }
});

check("P9b a match is dealt in lockstep however the seats differ", () => {
  // The regression the bias could cause, and the one the docblock on drawEvents
  // quantifies: 21% of years dealing different cards, up to $71k of net worth.
  const spots = Object.keys(
    engine.LIFE_EVENTS.reduce((acc, e) => {
      for (const c of eventConcepts.conceptsForEvent(e.id)) acc[c] = 1;
      return acc;
    }, {}),
  );
  if (spots.length < 4) throw new Error(`only ${spots.length} concepts are reachable from events`);
  for (let seed = 900; seed < 940; seed++) {
    let a = engine.initRun("story", "student", "A", seed, true, { weakSpots: [spots[0], spots[1]] });
    let b = engine.initRun("story", "student", "B", seed, true, { weakSpots: [spots[2], spots[3]] });
    let c = engine.initRun("story", "student", "C", seed, true);
    const answer = (s) => {
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) s = engine.applyLifeChoice(s, id, ev.choices[0]);
      }
      return engine.advanceYear(s);
    };
    for (let y = 0; y < 21 && a.status === "playing"; y++) {
      deepEq(a.pendingEvents, b.pendingEvents, `seed ${seed} y${y}: two seats, different cards`);
      deepEq(a.pendingEvents, c.pendingEvents, `seed ${seed} y${y}: a seat with no weak spots drifted`);
      a = answer(a);
      b = answer(b);
      c = answer(c);
    }
  }
});

check("P9c the bias actually favours the cards it says it does", () => {
  // Pick a concept several events teach, so the effect is measurable.
  const byConcept = {};
  for (const e of engine.LIFE_EVENTS) {
    for (const c of eventConcepts.conceptsForEvent(e.id)) (byConcept[c] ??= []).push(e.id);
  }
  const [concept, ids] = Object.entries(byConcept).sort((x, y) => y[1].length - x[1].length)[0];
  const target = new Set(ids);

  const count = (weakSpots) => {
    let hits = 0;
    let dealt = 0;
    for (let seed = 1; seed <= 400; seed++) {
      let s = engine.initRun("story", BG_IDS[seed % 3], "A", seed, false, weakSpots ? { weakSpots } : undefined);
      for (let y = 0; y < 21 && s.status === "playing"; y++) {
        for (const id of s.pendingEvents) {
          dealt++;
          if (target.has(id)) hits++;
        }
        for (const id of [...s.pendingEvents]) {
          const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
          if (ev) s = engine.applyLifeChoice(s, id, ev.choices[0]);
        }
        s = engine.advanceYear(s);
      }
    }
    return hits / dealt;
  };

  const before = count(null);
  const after = count([concept]);
  console.log(`       "${concept}" (${ids.length} cards): ${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}% of draws`);
  if (!(after > before * 1.15)) throw new Error(`the bias did nothing: ${before} → ${after}`);
  // A nudge, not a curriculum. Past this it stops being a life sim.
  if (after > 0.75) throw new Error(`the bias took over the deck: ${after}`);
});

check("P9d a replay reproduces a biased run exactly", () => {
  const byConcept = {};
  for (const e of engine.LIFE_EVENTS) {
    for (const c of eventConcepts.conceptsForEvent(e.id)) (byConcept[c] ??= []).push(e.id);
  }
  const spots = Object.keys(byConcept).slice(0, 2);
  for (let seed = 950; seed < 990; seed++) {
    let s = engine.initRun("story", BG_IDS[seed % 3], "A", seed, false, { weakSpots: spots });
    const rand = rng.mulberry32(seed);
    while (s.status === "playing") {
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
      }
      if (rand() < 0.5) s = engine.trade(s, "index", Math.round(rand() * 4000));
      s = engine.advanceYear(s);
    }
    const t = replay.ticketFor(s);
    deepEq(t.weakSpots, spots, `seed ${seed}: the ticket lost the bias`);
    const again = replay.replayRun(t);
    if (!again) throw new Error(`seed ${seed}: a biased run would not replay`);
    eq(Math.round(engine.netWorth(again)), Math.round(engine.netWorth(s)), `seed ${seed}: replayed to a different number`);
    eq(replay.verifyResult(t, engine.netWorth(s)), true, `seed ${seed}: verification declined`);
  }
});

// ── rule gates ──────────────────────────────────────────────────────────────
// Four cards used to contradict the rule they were written to teach. Each check
// below is the rule, stated as a property, so the card cannot drift back.

check("P10 a debt card is never dealt to a player who owes nothing", () => {
  // "Your student loans sit there compounding" was dealt regardless of balance,
  // and "Attack the debt" then spent $8,000 against $0. Two properties in one:
  // the card only comes up against a real balance, and the payment can never
  // exceed it even if the balance is cleared after the deal.
  let seen = 0;
  for (let seed = 1; seed <= 400; seed++) {
    let s = engine.initRun("infinite", BG_IDS[seed % BG_IDS.length], "A", seed);
    const rand = rng.mulberry32(seed);
    let n = 0;
    while (s.status === "playing" && n < 40) {
      if (s.pendingEvents.includes("studentLoans")) {
        seen++;
        if (s.debt <= 0) throw new Error(`seed ${seed} y${s.year}: dealt with $0 owed`);
      }
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
      }
      if (rand() < 0.4) s = engine.trade(s, "index", Math.round(rand() * 5000));
      s = engine.advanceYear(s);
      n++;
    }
  }
  if (seen < 50) throw new Error(`only ${seen} draws of studentLoans — the check proved little`);

  const card = engine.LIFE_EVENTS.find((e) => e.id === "studentLoans");
  const attack = card.choices.find((c) => c.id === "attack");
  const minimum = card.choices.find((c) => c.id === "minimum");
  const at = (owed) => ({
    ...engine.initRun("story", "student", "A", 5),
    debt: owed,
    cash: 40000,
    pendingEvents: ["studentLoans"],
  });

  // Clear the balance with the debt button AFTER the card is dealt, and the option
  // locks rather than spending $8,000 on nothing. Same mechanism as the house.
  for (const owed of [0, 1, 2000, 7999]) {
    const s = at(owed);
    eq(engine.applyLifeChoice(s, "studentLoans", attack), s, `owed ${owed}: the attack was allowed`);
    deepEq(
      lifeEvents.availableChoices(card, engine.eventContext(s)).map((c) => c.id),
      ["minimum"],
      `owed ${owed}: the locked option was still on the table`,
    );
    // ...and the card is still answerable, so the year is not lost.
    eq(engine.allEventsResolved(engine.applyLifeChoice(s, "studentLoans", minimum)), true, `owed ${owed}: the year hung`);
  }
  // With the balance there, it pays in full and the receipt is exact — which is the
  // whole reason the gate is `>= 8000` and not `> 0`.
  for (const owed of [8000, 25000]) {
    const s = at(owed);
    const after = engine.applyLifeChoice(s, "studentLoans", attack);
    eq(owed - after.debt, 8000, `owed ${owed}: balance cleared`);
    eq(s.cash - after.cash, 8000, `owed ${owed}: cash spent`);
  }

  // THE ENGINE CLAMP is now reachable only by the ghost, which is exempt from the
  // gate above and arrives with a balance of its own. Without it a counterfactual
  // would pay full price for relief it could not use.
  for (const owed of [0, 2000, 8000, 25000]) {
    const s = at(owed);
    const after = engine.applyLifeChoice(s, "studentLoans", attack, { counterfactual: true });
    const cleared = owed - after.debt;
    eq(cleared, Math.min(owed, 8000), `ghost owed ${owed}: balance cleared`);
    eq(s.cash - after.cash, cleared, `ghost owed ${owed}: cash spent equals balance cleared`);
  }
});

check("P11 a card this build no longer has does not hold the year open", () => {
  // `pendingEvents` is restored from a save and forced by a journal, so it can
  // name a retired event. `YearLoop` renders nothing for it, so an id that still
  // counted toward "all resolved" disabled Advance for the rest of that life.
  const s = engine.initRun("story", "student", "A", 11);
  const ghostCard = { ...s, pendingEvents: ["anEventThisBuildRetired"] };
  eq(engine.allEventsResolved(ghostCard), true, "an unknown id blocked the year");
  // A card it DOES have still has to be answered.
  const real = { ...s, pendingEvents: ["studentLoans"], yearChoices: {} };
  eq(engine.allEventsResolved(real), false, "a real card stopped counting");
  eq(engine.allEventsResolved({ ...real, yearChoices: { studentLoans: "attack|0" } }), true, "an answered card still blocked");
  // Mixed: the known one is what decides.
  eq(engine.allEventsResolved({ ...s, pendingEvents: ["studentLoans", "gone"] }), false, "the known card was skipped too");
});

check("P12 the house cannot be bought with money already spent", () => {
  const card = engine.LIFE_EVENTS.find((e) => e.id === "rentOrBuy");
  const buy = card.choices.find((c) => c.id === "buy");
  const rent = card.choices.find((c) => c.id === "rent");
  const dealt = {
    ...engine.initRun("story", "student", "A", 12),
    age: 30,
    cash: economy.HOME_DOWN_PAYMENT,
    salary: 60000,
    pendingEvents: ["rentOrBuy"],
  };
  // Affordable at the deal: the purchase goes through, house and mortgage together.
  const bought = engine.applyLifeChoice(dealt, "rentOrBuy", buy);
  eq(bought.life.housing, "owned", "an affordable buy was refused");
  eq(bought.cash, 0, "the down payment did not leave");
  eq(bought.mortgage, economy.HOME_PRICE - economy.HOME_DOWN_PAYMENT, "no mortgage came with the house");

  // The same card, after the money went into the market. This is the actual bug:
  // the gate was read once at deal time and never again.
  const spent = engine.trade(dealt, "index", economy.HOME_DOWN_PAYMENT);
  eq(spent.cash, 0, "the trade did not take the cash");
  const refused = engine.applyLifeChoice(spent, "rentOrBuy", buy);
  eq(refused, spent, "a house was bought with money that was gone");
  eq(lifeEvents.availableChoices(card, engine.eventContext(spent)).map((c) => c.id).join(","), "rent", "the locked option was still on the table");
  // ...and the card is still answerable, so the year is not lost.
  eq(engine.allEventsResolved(spent), false, "the card vanished instead of locking");
  const rented = engine.applyLifeChoice(spent, "rentOrBuy", rent);
  eq(engine.allEventsResolved(rented), true, "renting did not answer the card");
});

check("P13 the ghost still replays a life that bought a house", () => {
  // The gate above is a rule about the life that was LIVED. Applied to the
  // counterfactual — which puts the money somewhere else and therefore arrives at
  // the card with different cash — it made `replayRun` refuse the choice and
  // return null, taking the report's comparison and the daily share grid with it.
  let tested = 0;
  for (let seed = 300; seed < 460 && tested < 10; seed++) {
    let s = engine.initRun("story", BG_IDS[seed % BG_IDS.length], "A", seed);
    const rand = rng.mulberry32(seed);
    while (s.status === "playing") {
      for (const id of [...s.pendingEvents]) {
        const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
        if (!ev) continue;
        // Always buy when the house is on the table — that is the case under test.
        const pick = id === "rentOrBuy"
          ? ev.choices.find((c) => c.id === "buy")
          : ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0];
        s = engine.applyLifeChoice(s, id, pick);
      }
      if (rand() < 0.6) s = engine.trade(s, "index", Math.round(rand() * 6000));
      s = engine.advanceYear(s);
    }
    if (s.life.housing !== "owned") continue;
    tested++;
    const t = replay.ticketFor(s);
    if (!t) throw new Error(`seed ${seed}: no ticket`);
    if (!replay.replayRun(t)) throw new Error(`seed ${seed}: verification replay refused a bought house`);
    if (!replay.replayRun(t, { allocate: replay.indexEverything })) {
      throw new Error(`seed ${seed}: the ghost refused a house the player bought`);
    }
  }
  if (tested < 6) throw new Error(`only ${tested} runs bought a house — the check proved little`);
});

// ── Rat Race scoring ────────────────────────────────────────────────────────
check("P14 winning the Rat Race is not a demotion", () => {
  const dream = dreams.DREAMS.find((d) => d.id === "dinner"); // the cheapest, $400,000
  const prof = professions.PROFESSIONS[0].id;
  const base = cashflow.initCashflow(prof, dream.id, "A", 7);
  // Standing on the DREAM square with the price plus a little.
  const holding = { ...base, track: "fast", position: 0, status: "playing", cash: dream.cost + 25000 };

  const declined = buildResult.cashflowScore(holding);
  const won = buildResult.cashflowScore(cashflow.buyDream(holding));
  eq(cashflow.buyDream(holding).status, "won", "buying the dream did not win");
  eq(won, declined, "the win condition moved the score");
  if (won < 0) throw new Error(`a winner scored ${won}`);

  // Every dream, not just the cheap one — the credit has to track what was bought.
  for (const d of dreams.DREAMS) {
    const h = { ...cashflow.initCashflow(prof, d.id, "A", 7), track: "fast", position: 0, cash: d.cost };
    eq(
      buildResult.cashflowScore(cashflow.buyDream(h)),
      buildResult.cashflowScore(h),
      `${d.id} ($${d.cost}): buying it moved the score`,
    );
  }
});

check("P14b a Fast Track deal is scored on its merits, not its price", () => {
  const prof = professions.PROFESSIONS[0].id;
  const holding = {
    ...cashflow.initCashflow(prof, "dinner", "A", 7),
    track: "fast",
    position: 0,
    cash: 600000,
  };
  const before = buildResult.cashflowScore(holding);
  // A year of the cash flow bought, minus the price. Same yardstick `payday` gets.
  // The last pair pays back exactly its price in a year, so it is score-neutral
  // by construction — the yardstick stated as an example.
  for (const [price, monthly, sign] of [[200000, 20000, 1], [200000, 5000, -1], [120000, 10000, 0]]) {
    const deal = { id: "d", title: "t", blurb: "b", price, cashFlow: monthly };
    const after = buildResult.cashflowScore(cashflow.buyFastTrackDeal(holding, deal));
    eq(after - before, 12 * monthly - price, `$${price} for $${monthly}/mo: wrong delta`);
    if (Math.sign(after - before) !== sign) {
      throw new Error(`$${price} for $${monthly}/mo scored ${after - before}, expected sign ${sign}`);
    }
  }
  // And the row carries what it takes to recompute the number.
  const bought = cashflow.buyFastTrackDeal(holding, { id: "d", title: "t", blurb: "b", price: 200000, cashFlow: 20000 });
  const m = buildResult.resultFromCashflow(bought).metrics;
  eq(m.scoreVersion, buildResult.CASHFLOW_SCORE_VERSION, "the row lost its score version");
  eq(m.fastTrackCashflow, 20000, "the row lost the Fast Track cash flow");
});

// ── the score column's bound is only as good as the number it was measured from ──
// `results_score_sane` refuses anything outside ±1e15, and that bound was chosen
// from a headless sweep of the engine's most aggressive honest line. A bound picked
// once from a measurement is a bound that goes stale the next time the economy is
// tuned: raise a return, add an asset, extend the mortality curve, and the honest
// ceiling moves while the SQL does not. Then the constraint starts refusing real
// runs, and it does it at the database, at submit time, on a finished game.
//
// So this re-derives the ceiling every run and asserts the headroom is still there.
// It is deliberately cheaper than the 12,000-run sweep that set the bound (that
// number is in the migration header); it only has to catch an economy that has
// moved by orders of magnitude.
check("P15 an honest score stays far inside the database's bound", () => {
  const BOUND = 1e15; // supabase/migrations/2026-08-27_01b_score_bounds.sql
  const MIN_HEADROOM = 1000; // if an honest run gets within 1000x, re-measure and widen
  let worst = 0;
  let where = null;
  for (let seed = 9000; seed < 9400; seed++) {
    const bg = BG_IDS[seed % BG_IDS.length];
    const mode = seed % 2 ? "infinite" : "story";
    // `index` is the compounding policy — the one that actually grows a portfolio.
    const s = playRun({ seed, mode, backgroundId: bg, policy: "index", maxYears: 120 });
    if (s.status !== "ended") continue;
    const { score } = buildResult.resultFromRun(s);
    if (!Number.isFinite(score)) {
      throw new Error(`seed ${seed} ${mode}/${bg}: honest play produced a non-finite score (${score})`);
    }
    if (Math.abs(score) > worst) {
      worst = Math.abs(score);
      where = `seed ${seed} ${mode}/${bg} age ${s.age}`;
    }
  }
  if (worst === 0) throw new Error("no run finished — the check proved nothing");
  const headroom = BOUND / worst;
  if (headroom < MIN_HEADROOM) {
    throw new Error(
      `honest scores have grown into the CHECK: max ${Math.round(worst).toLocaleString()} ` +
      `(${where}) leaves only ${Math.round(headroom)}x headroom under ${BOUND.toExponential()}. ` +
      `Re-measure and widen results_score_sane before this refuses a real run.`,
    );
  }
});

// ── and the formatter refuses to print a number that is not one ─────────────
// The CHECK stops new rows. Rows already in the table, and every other client-written
// figure that reaches a render site, are stopped here instead — see lib/format.ts.
check("P16 the money formatter never prints NaN or Infinity", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const money = format.currency(bad);
    if (/NaN|Infinity|∞/.test(money)) throw new Error(`currency(${bad}) printed ${money}`);
    const pct = format.percent(bad);
    if (/NaN|Infinity|∞/.test(pct)) throw new Error(`percent(${bad}) printed ${pct}`);
  }
  // and it still prints the honest extremes it was guarding
  eq(format.currency(0), "$0", "currency(0)");
  eq(format.currency(-3711410), "−$3,711,410", "currency at the measured honest minimum");
  eq(format.currency(15511231154), "$15,511,231,154", "currency at the measured honest maximum");
});

// ─────────────────────────────────────────────────────────────────────────────
// One report, after everything.
//
// This file used to call `report()` at the end of the PRNG block, which was correct
// while that block WAS the file. The journal and replay properties were appended
// below it, and the call stayed where it was — so the gate printed "4/4 checks
// passed", ran the other eighteen, and exited 0 whether they passed or failed. A
// deliberately broken assertion confirmed it: `FAIL P9d …` on stdout, exit code 0.
//
// A gate that cannot fail is worse than no gate, because it is trusted. The report
// belongs at the bottom, after the last check, and nowhere else.
// ─────────────────────────────────────────────────────────────────────────────
report();
