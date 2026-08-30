// The rename limiter's decision, asked every question that matters.
//
//   node scripts/qa/rename-limit.mjs
//
// WHAT THIS IS FOR. `rename` answers 409 for "that name is taken" and 400 for "that
// name is refused", and both answers are honest and worth keeping — a player who
// picks a taken name needs to be told it is taken. Two distinguishable answers plus
// unlimited attempts is an enumeration oracle, so the ATTEMPTS are bounded instead,
// and that bound is the only thing standing between a signed-in account and a walk
// of the whole username space.
//
// It used to be untestable. The decision lived inside an Edge Function handler
// between a `select` and an `update`, so reaching it meant a real account, a real
// JWT and a live round trip — which is to say it was never reached, and what got
// verified was that the function deployed. `supabase/functions/_shared/renameLimit.ts`
// is that decision as a pure function of (row, clock), and this asks it the six or
// seven things a limiter has to get right.
//
// The clock is a PARAMETER, not `Date.now()`, which is what makes "fifty-nine
// minutes in" and "an hour and a second in" ordinary assertions rather than a gate
// that sleeps for an hour.
import {
  decideRenameAttempt,
  RENAME_LIMIT,
  RENAME_WINDOW_MS,
} from "../../supabase/functions/_shared/renameLimit.ts";

let checks = 0;
let failures = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

function eq(a, b, what) {
  if (!Object.is(a, b)) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

const T0 = Date.parse("2026-08-30T12:00:00.000Z");
const iso = (t) => new Date(t).toISOString();

/** Walk n attempts through the limiter the way the function does, carrying the row
 *  forward exactly as the database would after each write. */
function spend(n, { startAt = T0, step = 1000 } = {}) {
  let row = { rename_window_start: null, rename_attempts: 0 };
  const out = [];
  for (let i = 0; i < n; i++) {
    const now = startAt + i * step;
    const d = decideRenameAttempt(row, now);
    out.push(d);
    if (d.ok && d.write) row = { ...row, ...d.write };
  }
  return { results: out, row };
}

console.log("RENAME LIMITER — the ceiling that keeps 409 honest\n");

check("the first attempt opens a window and counts one", () => {
  const d = decideRenameAttempt({ rename_window_start: null, rename_attempts: 0 }, T0);
  ok(d.ok, "first attempt refused");
  eq(d.write.rename_attempts, 1, "attempts");
  eq(d.write.rename_window_start, iso(T0), "window start");
});

check(`${RENAME_LIMIT} attempts are allowed and the ${RENAME_LIMIT + 1}th is not`, () => {
  const { results } = spend(RENAME_LIMIT + 1);
  for (let i = 0; i < RENAME_LIMIT; i++) ok(results[i].ok, `attempt ${i + 1} was refused`);
  ok(!results[RENAME_LIMIT].ok, `attempt ${RENAME_LIMIT + 1} was allowed`);
});

check("the refusal says how long, in whole seconds, at least one", () => {
  const { results } = spend(RENAME_LIMIT + 1);
  const last = results.at(-1);
  ok(!last.ok, "expected a refusal");
  ok(Number.isInteger(last.retryAfter), `retryAfter not an integer: ${last.retryAfter}`);
  ok(last.retryAfter >= 1, `retryAfter below 1: ${last.retryAfter}`);
  ok(
    last.retryAfter <= RENAME_WINDOW_MS / 1000,
    `retryAfter longer than the window: ${last.retryAfter}`,
  );
});

// The failure this is really guarding against: a limiter that re-stamps the window
// on every attempt never closes, because the hour restarts before it can elapse.
check("a continuing window keeps its original start", () => {
  const { row } = spend(RENAME_LIMIT, { step: 10 * 60 * 1000 }); // 10 min apart
  eq(row.rename_window_start, iso(T0), "window start moved");
  eq(row.rename_attempts, RENAME_LIMIT, "attempts");
});

check("spreading attempts across the hour does not buy a sixth", () => {
  // Five attempts at 0, 12, 24, 36, 48 minutes — then one at 59.
  const { row } = spend(RENAME_LIMIT, { step: 12 * 60 * 1000 });
  const d = decideRenameAttempt(row, T0 + 59 * 60 * 1000);
  ok(!d.ok, "a sixth attempt inside the window was allowed");
});

check("one second before the hour is still refused", () => {
  const { row } = spend(RENAME_LIMIT);
  const d = decideRenameAttempt(row, T0 + RENAME_WINDOW_MS - 1000);
  ok(!d.ok, "refused window expired early");
});

check("the window expires and the budget comes back", () => {
  const { row } = spend(RENAME_LIMIT);
  const later = T0 + RENAME_WINDOW_MS + 1000;
  const d = decideRenameAttempt(row, later);
  ok(d.ok, "still refused after the window elapsed");
  eq(d.write.rename_attempts, 1, "counter did not reset");
  eq(d.write.rename_window_start, iso(later), "window did not restart");
});

// ── The rows that are not the happy shape ────────────────────────────────────

check("a pre-migration row (both columns null) is a fresh window", () => {
  const d = decideRenameAttempt({ rename_window_start: null, rename_attempts: null }, T0);
  ok(d.ok, "refused a row that predates the limiter");
  eq(d.write.rename_attempts, 1, "attempts");
});

check("a row that could not be read fails OPEN and writes nothing", () => {
  const d = decideRenameAttempt(null, T0);
  ok(d.ok, "an unreadable row refused the rename");
  eq(d.write, null, "wrote to a row it could not read");
});

check("an unparseable window start is treated as no window", () => {
  const d = decideRenameAttempt({ rename_window_start: "not a date", rename_attempts: 4 }, T0);
  ok(d.ok, "refused on a corrupt timestamp");
  eq(d.write.rename_attempts, 1, "did not restart the count");
  eq(d.write.rename_window_start, iso(T0), "did not open a fresh window");
});

check("a nonsense counter cannot be spent as credit", () => {
  for (const attempts of [-99, Number.NaN, 2.7]) {
    const d = decideRenameAttempt({ rename_window_start: iso(T0), rename_attempts: attempts }, T0 + 60_000);
    ok(d.ok, `refused outright on attempts=${attempts}`);
    ok(
      d.write.rename_attempts >= 1 && Number.isInteger(d.write.rename_attempts),
      `attempts=${attempts} produced ${d.write.rename_attempts}`,
    );
  }
});

// A future timestamp cannot be written by this code, but a clock skew between the
// database and an edge isolate can produce one. It must not read as an expired
// window, which would hand out a fresh budget on every attempt.
check("a window start in the future does not reset the budget", () => {
  const row = { rename_window_start: iso(T0 + 10 * 60 * 1000), rename_attempts: RENAME_LIMIT };
  const d = decideRenameAttempt(row, T0);
  ok(!d.ok, "a future window start handed back the budget");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
