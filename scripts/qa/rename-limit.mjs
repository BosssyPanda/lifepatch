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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideRenameAttempt,
  RENAME_LIMIT,
  RENAME_WINDOW_MS,
} from "../../supabase/functions/_shared/renameLimit.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

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

// ── The race, and the statement that closes it ──────────────────────────────
//
// Everything above asks `decideRenameAttempt` the questions a limiter has to get
// right, and it answers all of them. It was still bypassable, because being right
// was never the problem: the handler READ the row, asked this function, and WROTE
// back an absolute `spent + 1` across two round trips with nothing holding the row
// in between. The checks below are about the spend, not the decision.

check("CONTROL — concurrent callers all read 0 and all write 1 (the bypass)", () => {
  // Exactly what a `Promise.all` of N renames did: one row, N readers, none of
  // them seeing another's write. This is a property of the SHAPE of a
  // read-modify-write, so it is demonstrated rather than asserted away — a fix
  // that made this control stop firing would mean the control had stopped
  // measuring, which is the failure mode this repo has been bitten by before.
  const row = { rename_window_start: null, rename_attempts: 0 };
  const N = 200;
  const writes = [];
  for (let i = 0; i < N; i++) {
    const d = decideRenameAttempt(row, T0); // the row never changes: nobody committed yet
    ok(d.ok, `attempt ${i} was refused before any write landed`);
    writes.push(d.write.rename_attempts);
  }
  // Every one of them allowed, and every one of them wrote 1.
  eq(Math.max(...writes), 1, "the highest counter any concurrent caller would write");
  ok(
    N > RENAME_LIMIT,
    "the control has to issue more than the ceiling for the bypass to mean anything",
  );
});

check("the atomic spend is a single UPDATE, and the ceiling is in its WHERE", () => {
  const sql = readFileSync(
    join(HERE, "../../supabase/migrations/2026-09-02_09_rename_limit_atomic.sql"),
    "utf8",
  );
  ok(/create or replace function public\.spend_rename_attempt\(uid uuid\)/.test(sql), "no RPC defined");
  // One UPDATE — not a select-then-update wearing a function's clothes.
  eq((sql.match(/^\s*update public\.profiles/gm) ?? []).length, 1, "UPDATE statements in the RPC");
  // Unqualified: a SET clause names the column, not `alias.column`.
  ok(/^\s*rename_attempts = case/m.test(sql), "the counter is not set inside the UPDATE");
  ok(/p\.rename_attempts < limit_n/.test(sql), "the ceiling is not in the UPDATE's WHERE");
  ok(/security definer/.test(sql) && /set search_path = public/.test(sql), "not a pinned security-definer");
  ok(
    /revoke all on function public\.spend_rename_attempt\(uuid\)\s+from public, anon, authenticated;/.test(sql),
    "EXECUTE was not revoked from the client roles",
  );
});

check("the SQL constants and the TS constants have not drifted", () => {
  // They are duplicated on purpose — the pure function stays the fallback path, so
  // it cannot read them out of the migration. This is the check that makes the
  // duplication survivable rather than a bug waiting for one of them to move.
  const sql = readFileSync(
    join(HERE, "../../supabase/migrations/2026-09-02_09_rename_limit_atomic.sql"),
    "utf8",
  );
  const limit = Number(/limit_n\s+constant int := (\d+)/.exec(sql)?.[1]);
  eq(limit, RENAME_LIMIT, "limit_n in SQL vs RENAME_LIMIT in TS");
  const hours = Number(/window_i constant interval := interval '(\d+) hour'/.exec(sql)?.[1]);
  eq(hours * 60 * 60 * 1000, RENAME_WINDOW_MS, "window_i in SQL vs RENAME_WINDOW_MS in TS");
});

check("the handler calls the RPC and still keeps the pure function as its fallback", () => {
  const fn = readFileSync(join(HERE, "../../supabase/functions/profile/index.ts"), "utf8");
  ok(/rpc\("spend_rename_attempt", \{ uid: userId \}\)/.test(fn), "the handler does not call the RPC");
  ok(
    /decideRenameAttempt\(error \? null : data, Date\.now\(\)\)/.test(fn),
    "the fallback path is gone — a project without migration 09 would lose rename entirely",
  );
  // The RPC's answer has to be consulted BEFORE the fallback, or the fallback is
  // the only path that ever runs and nothing was fixed.
  ok(
    fn.indexOf('rpc("spend_rename_attempt"') < fn.indexOf("decideRenameAttempt("),
    "the fallback is reached before the RPC",
  );
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
