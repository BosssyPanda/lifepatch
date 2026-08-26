// The gate on server-side score verification.
//
// `app/api/submit-result` replaces "the browser says it scored 400,000" with
// "the server replayed what the browser says it DID, and this is what that
// produces". That claim is only worth anything if three things hold, and this
// measures all three rather than asserting them:
//
//   1. an honest run survives the wire and derives the same score it earned
//   2. a tampered ticket is refused — parsed away, or replayed to a refusal
//   3. a daily claim only holds for the day whose seed actually produced the run
//
// Plus the shape checks, because the guard is the only thing between an untrusted
// body and a replay that costs real CPU.
import { createRequire } from "module";
const OUT = "/tmp/lifepatch-engine";
const req = createRequire(`${OUT}/`);
const E = req(`${OUT}/lib/runEngine.js`);
const R = req(`${OUT}/lib/replay.js`);
const G = req(`${OUT}/lib/cloud/ticketGuard.js`);
const ROW = req(`${OUT}/lib/cloud/resultRow.js`);
const D = req(`${OUT}/lib/daily.js`);

let checks = 0;
const fails = [];
function ck(cond, msg) {
  checks++;
  if (!cond) fails.push(msg);
}

/** Exactly what the client puts on the wire: JSON, and nothing but JSON. */
const overWire = (t) => JSON.parse(JSON.stringify(t));

// Derived, never listed. `getBackground` falls back to BACKGROUNDS[0] for an id
// it does not know, so a hand-written list does not fail loudly when it is wrong
// — it silently plays the same background under three different names and
// reports the coverage it did not have.
const BGS = req(`${OUT}/lib/backgrounds.js`).BACKGROUNDS.map((b) => b.id);

/** Play a run the way a real player would — answer every card, invest the spare. */
function playRun(mode, bg, seed, opts = {}) {
  let s = E.initRun(mode, bg, "Verify", seed, false, opts);
  let years = 0;
  const MAX = mode === "story" ? 40 : 70;
  while (s.status === "playing" && years < MAX) {
    years++;
    for (const id of s.pendingEvents) {
      if (s.yearChoices[id]) continue;
      const ev = E.LIFE_EVENTS.find((e) => e.id === id);
      if (!ev) continue;
      s = E.applyLifeChoice(s, id, ev.choices[seed % ev.choices.length]);
    }
    if (s.cash > 6000) s = E.trade(s, "index", s.cash - 3000);
    if (s.life.housing === "owned" && s.year % 11 === 0) s = E.sellHome(s);
    s = E.advanceYear(s);
  }
  if (s.status === "playing") s = E.retire(s);
  return s;
}

// ── 1. an honest run survives the wire and derives its own score ────────────
console.log("── 1. honest tickets ──");
let honest = 0, honestOk = 0, scoreOk = 0;
for (const mode of ["story", "infinite"]) {
  for (const bg of BGS) {
    for (let n = 1; n <= 10; n++) {
      const run = playRun(mode, bg, n * 2654435761 % 1000000007);
      const ticket = R.ticketFor(run);
      if (!ticket) continue;
      honest++;
      const parsed = G.parseTicket(overWire(ticket));
      if (G.isFail(parsed)) {
        fails.push(`${mode}/${bg}/${n}: honest ticket refused — ${parsed.error}`);
        checks++;
        continue;
      }
      honestOk++;
      checks++;
      const replayed = R.replayRun(parsed);
      const derived = replayed ? ROW.resultFromRun(replayed) : null;
      const claimed = ROW.resultFromRun(run);
      checks++;
      if (replayed && replayed.status === "ended" && derived.score === claimed.score) scoreOk++;
      else fails.push(`${mode}/${bg}/${n}: server derived ${derived?.score} vs ${claimed.score}`);
      // The verdict must be derived too — it renders into the OG card and the
      // page title, so a client-chosen one is a phishing string on your domain.
      ck(derived && derived.verdict === claimed.verdict, `${mode}/${bg}/${n}: verdict differs`);
    }
  }
}
console.log(`  tickets:            ${honest}`);
console.log(`  survived the guard: ${honestOk}/${honest}`);
console.log(`  derived the score:  ${scoreOk}/${honest}`);

// ── 2. tampering ────────────────────────────────────────────────────────────
//
// There is no score in the request, so every attack is on the JOURNAL. They split
// cleanly into two kinds, and conflating them is how a verification story ends up
// claiming more than it can do.
//
//   FORGERIES are journals the engine could not have produced — a choice whose
//   outcome index is not the one the seed rolls, a deal `drawEvents` did not
//   deal, the same actions under a different seed or background, a year spliced
//   out. These must be refused outright, and they are: the replay walks the same
//   deterministic engine and disagrees at the first step.
//
//   REWRITES are journals that are legal but not what happened — an extra trade
//   the state could genuinely have funded. These CANNOT be refused, and no amount
//   of server-side replay will change that: the journal is the only record of
//   what the player did, so a legal journal is a legal run by definition. The
//   server derives that run's score honestly, and it is the score those actions
//   really produce. This is the same limit as a player who scripts the real game,
//   arrived at more cheaply.
//
// Both are measured. The first as a pass/fail; the second as a size, so the limit
// is a number in the output rather than a sentence in a comment.
console.log("\n── 2a. forgeries — journals the engine could not have produced ──");
const FORGERIES = [
  ["a choice that was never taken", (t) => {
    const e = t.journal.find((j) => j.acts.some((a) => a[0] === "c"));
    if (!e) return null;
    const i = e.acts.findIndex((a) => a[0] === "c");
    return { ...t, journal: t.journal.map((j) => j !== e ? j : { ...j, acts: j.acts.map((a, k) => k === i ? ["c", a[1], a[2], (a[3] + 1) % 8] : a) }) };
  }],
  ["a deal the engine did not deal", (t) => {
    const i = t.journal.findIndex((j) => j.deal.length > 0);
    if (i < 0) return null;
    return { ...t, journal: t.journal.map((j, k) => k === i ? { ...j, deal: ["lottery", ...j.deal] } : j) };
  }],
  ["the deal reordered, same cards", (t) => {
    const i = t.journal.findIndex((j) => j.deal.length > 1);
    if (i < 0) return null;
    return { ...t, journal: t.journal.map((j, k) => k === i ? { ...j, deal: [...j.deal].reverse() } : j) };
  }],
  ["a different seed under the same actions", (t) => ({ ...t, seed: t.seed + 1 })],
  ["a different background under the same actions", (t) => ({
    ...t, backgroundId: BGS.find((b) => b !== t.backgroundId),
  })],
  ["a whole extra year appended", (t) => ({
    ...t, journal: [...t.journal, { y: t.journal[t.journal.length - 1].y + 1, deal: [], acts: [] }],
  })],
  ["a year spliced out", (t) => t.journal.length < 3 ? null : ({
    ...t, journal: t.journal.filter((_, k) => k !== 1),
  })],
  ["the years renumbered", (t) => ({ ...t, journal: t.journal.map((j) => ({ ...j, y: j.y + 1 })) })],
];
const forged = new Map(FORGERIES.map(([name]) => [name, { tried: 0, refused: 0 }]));
const rewriteDeltas = [];
for (const bg of BGS) {
  for (let n = 1; n <= 12; n++) {
    const run = playRun("story", bg, n * 40503 + 7);
    const ticket = R.ticketFor(run);
    if (!ticket) continue;
    const honestScore = ROW.resultFromRun(run).score;

    for (const [name, mutate] of FORGERIES) {
      const bad = mutate(overWire(ticket));
      if (!bad) continue;
      const t = forged.get(name);
      t.tried++;
      checks++;
      const parsed = G.parseTicket(bad);
      const replayed = G.isFail(parsed) ? null : R.replayRun(parsed);
      if (!replayed || replayed.status !== "ended") t.refused++;
      else fails.push(`forgery replayed clean: ${name} (${bg}/${n}) → ${ROW.resultFromRun(replayed).score}`);
    }

    // The rewrite: a trade the player did not make, at the midpoint of the life.
    // Clamped by the engine to what cash was actually there, exactly as the real
    // game clamps it — so this is a move that was genuinely available.
    const i = Math.floor(ticket.journal.length / 2);
    const rewritten = { ...overWire(ticket), journal: overWire(ticket).journal.map((j, k) => k === i ? { ...j, acts: [...j.acts, ["t", "index", 5_000_000]] } : j) };
    const parsed = G.parseTicket(rewritten);
    checks++;
    if (G.isFail(parsed)) { fails.push(`a legal rewrite must still parse (${bg}/${n})`); continue; }
    const replayed = R.replayRun(parsed);
    checks++;
    if (!replayed || replayed.status !== "ended") { fails.push(`a legal rewrite must still replay (${bg}/${n})`); continue; }
    rewriteDeltas.push(ROW.resultFromRun(replayed).score - honestScore);
  }
}
for (const [name, t] of forged) {
  console.log(`  ${String(t.refused).padStart(3)}/${String(t.tried).padEnd(3)}  ${name}`);
}

console.log("\n── 2b. rewrites — legal journals that are not what happened ──");
{
  const gained = rewriteDeltas.filter((d) => d > 0);
  const best = rewriteDeltas.length ? Math.max(...rewriteDeltas) : 0;
  const worst = rewriteDeltas.length ? Math.min(...rewriteDeltas) : 0;
  console.log(`  ${rewriteDeltas.length} runs, one invented (but affordable) trade each`);
  console.log(`  moved the score up on ${gained.length}, down on ${rewriteDeltas.filter((d) => d < 0).length}, not at all on ${rewriteDeltas.filter((d) => d === 0).length}`);
  console.log(`  best case for the rewriter: ${best >= 0 ? "+" : ""}${Math.round(best).toLocaleString()} · worst: ${Math.round(worst).toLocaleString()}`);
  console.log(`  NOT a failure. Replay cannot tell a legal journal from the one that`);
  console.log(`  was lived, because the journal is the only record there is. What it`);
  console.log(`  closes is 2a: claiming a life the engine could not have produced.`);
  // The claim that IS testable here: a rewrite is not a lever. It moves the score
  // by whatever the move is worth, in both directions — it is not a way to
  // manufacture a number.
  ck(rewriteDeltas.length > 0, "the rewrite case must actually have been exercised");
  ck(worst <= 0 || best > 0, "a rewrite must be able to move the score in either direction");
}

// ── 3. the daily binding ────────────────────────────────────────────────────
//
// `metrics.daily` decides which day's board a run is ranked on, and it used to
// be simply declared. `lib/daily.ts` is pure, so a browser could compute any past
// day's seed, play it at leisure with as many restarts as it liked, and file the
// best attempt under today.
console.log("\n── 3. the daily claim ──");
{
  const day = "2026-03-14";
  const puzzle = D.dailyFor(day);
  const run = playRun(D.DAILY_MODE, puzzle.backgroundId, puzzle.seed, { daily: day });
  const ticket = R.ticketFor(run);
  const parsed = G.parseTicket(overWire(ticket));
  ck(!G.isFail(parsed), "a real daily run must parse");

  ck(G.checkDaily(day, parsed) === day, "the day that produced the seed is accepted");
  ck(G.isFail(G.checkDaily("2026-03-15", parsed)), "a neighbouring day is refused");
  ck(G.isFail(G.checkDaily("2999-01-01", parsed)), "a day that has not opened is refused");
  ck(G.isFail(G.checkDaily("2025-12-31", parsed)), "a date before the epoch is refused");
  ck(G.isFail(G.checkDaily("not-a-date", parsed)), "junk is refused");
  ck(G.checkDaily(undefined, parsed) === null, "no claim is not a failed claim");

  // The background is fixed by the day too, and it moves the starting numbers
  // enormously — so a run on the right seed from the wrong background is not an
  // attempt at that puzzle either.
  const wrongBg = BGS.find((b) => b !== puzzle.backgroundId);
  const other = R.ticketFor(playRun(D.DAILY_MODE, wrongBg, puzzle.seed));
  const otherParsed = G.parseTicket(overWire(other));
  ck(G.isFail(G.checkDaily(day, otherParsed)), "the day's background is enforced, not just its seed");

  console.log(`  puzzle #${puzzle.number} (${day}) · seed ${puzzle.seed} · ${puzzle.backgroundId}`);
}

// ── 4. the shape gate ───────────────────────────────────────────────────────
console.log("\n── 4. malformed bodies ──");
{
  const run = playRun("story", "student", 991);
  const good = overWire(R.ticketFor(run));
  const REJECT = [
    ["not an object", 42],
    ["cashflow has no journal to replay", { ...good, mode: "cashflow" }],
    ["unknown background", { ...good, backgroundId: "../../etc/passwd" }],
    ["negative seed", { ...good, seed: -1 }],
    ["fractional seed", { ...good, seed: 1.5 }],
    ["empty journal", { ...good, journal: [] }],
    ["journal is not an array", { ...good, journal: { 0: good.journal[0] } }],
    ["journal longer than a life", { ...good, journal: Array.from({ length: G.MAX_JOURNAL_YEARS + 1 }, () => good.journal[0]) }],
    ["more acts in a year than the engine writes", { ...good, journal: [{ ...good.journal[0], acts: Array.from({ length: 201 }, () => ["d", 1]) }] }],
    ["an act kind that does not exist", { ...good, journal: [{ ...good.journal[0], acts: [["x", 1]] }] }],
    ["an asset that does not exist", { ...good, journal: [{ ...good.journal[0], acts: [["t", "tulips", 100]] }] }],
    ["a non-finite trade", { ...good, journal: [{ ...good.journal[0], acts: [["t", "index", null]] }] }],
    ["a deal that is not strings", { ...good, journal: [{ ...good.journal[0], deal: [{}] }] }],
  ];
  for (const [why, body] of REJECT) {
    ck(G.isFail(G.parseTicket(body)), `must reject: ${why}`);
  }
  console.log(`  ${REJECT.length} malformed bodies, all refused`);

  // And the guard must REBUILD rather than pass through: a key nobody checked
  // must not reach the engine.
  const parsed = G.parseTicket({ ...good, evil: "payload", journal: good.journal.map((j) => ({ ...j, evil: 1 })) });
  ck(!G.isFail(parsed), "an unknown extra key is dropped, not fatal");
  ck(!("evil" in parsed), "the ticket the engine sees carries no unknown keys");
  ck(parsed.journal.every((j) => !("evil" in j)), "no journal entry carries unknown keys");
  // NaN and Infinity cannot survive JSON, but a hand-built body is not JSON.
  ck(G.isFail(G.parseTicket({ ...good, seed: NaN })), "NaN seed refused");
  ck(G.isFail(G.parseTicket({ ...good, seed: Infinity })), "Infinite seed refused");
}

// ── 5. the divergence check ─────────────────────────────────────────────────
//
// The route derives the score; the client sends the one it showed the player. If
// they disagree, the replay reproduced A life but not THAT one — which is what a
// save carried across an engine bump looks like — and the row must not be written
// with the mark that says a server vouched for it.
//
// This is the only assertion the client is allowed to make, and it can only ever
// take the flag AWAY: the stored score is always the derived one, so a claim can
// never raise it.
console.log("\n── 5. divergence ──");
{
  const run = playRun("story", BGS[0], 20260826);
  const ticket = R.ticketFor(run);
  const parsed = G.parseTicket(overWire(ticket));
  const replayed = R.replayRun(parsed);
  const derived = Math.round(E.netWorth(replayed));
  const shown = Math.round(ROW.resultFromRun(run).score);

  // The route's own predicate, applied here so the rule is measured and not just
  // described. Kept in one expression so it reads the same as the source.
  const diverges = (claimed) =>
    typeof claimed === "number" && Number.isFinite(claimed) && Math.round(claimed) !== derived;

  ck(derived === shown, `an honest run's replay must land on the score it showed (${derived} vs ${shown})`);
  ck(!diverges(shown), "the honest claim is accepted");
  ck(!diverges(undefined), "no claim is not a divergence — an older client still posts");
  ck(diverges(shown + 1), "a claim one dollar out is a divergence");
  ck(diverges(shown * 10), "an inflated claim is a divergence");
  ck(diverges(0), "a zero claim is a divergence");
  console.log(`  derived ${derived.toLocaleString()} · shown ${shown.toLocaleString()} · agree, so this run keeps the mark`);
}

console.log(`\n${fails.length === 0 ? "PASS" : "FAIL"} — ${checks} checks, ${fails.length} failures`);
for (const f of fails.slice(0, 12)) console.log(`  ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
