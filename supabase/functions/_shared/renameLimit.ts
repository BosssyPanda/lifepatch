/**
 * The rename limiter's decision, separated from the two queries around it.
 *
 * WHY THIS IS ITS OWN FILE. The limiter is a security control — it is what stops a
 * signed-in account walking the username space one 409 at a time — and it lived
 * inside an Edge Function handler, between a `select` and an `update`. That put it
 * out of reach of every gate in this repo: exercising it meant a real user, a real
 * JWT and a real round trip to production, so what actually got verified was that
 * the function deployed without a syntax error. A control nothing can test is a
 * control nobody knows the state of.
 *
 * So the decision is here, where it is a pure function of two values — the row as
 * stored, and the clock — and `scripts/qa/rename-limit.mjs` can ask it every
 * question that matters: a first attempt, the fifth, the sixth, one that arrives
 * fifty-nine minutes in, one that arrives an hour and a second in, and a row whose
 * columns are null because it predates the migration that added them.
 *
 * The caller is left with the part that genuinely needs a database: read the row,
 * apply `write` if there is one. Nothing about WHEN to refuse lives there any more.
 *
 * Shared with the browser? No — and deliberately not. This is a server-side ceiling.
 * A copy in the client would be advisory at best and misleading at worst, because
 * the attack this exists for does not run the client.
 */

/** Renames allowed per window. Past anything a person does; renaming is rare. */
export const RENAME_LIMIT = 5;

/** The window, one hour. 5/hour turns walking the space into 120 guesses a day. */
export const RENAME_WINDOW_MS = 60 * 60 * 1000;

/** What the limiter reads. Both columns are nullable/defaulted — a row written
 *  before `2026-08-30_07_rename_rate_limit.sql` has neither. */
export type RenameRow = {
  rename_window_start?: string | null;
  rename_attempts?: number | null;
};

/**
 * `ok: false` refuses the attempt and says for how long. `ok: true` allows it, and
 * `write` is the row update that records it — `null` when there is nothing to
 * record, which is the fail-open case below.
 */
export type RenameDecision =
  | { ok: true; write: { rename_window_start: string; rename_attempts: number } | null }
  | { ok: false; retryAfter: number };

/**
 * @param row   the profile's two limiter columns, or `null` if it could not be read
 * @param now   `Date.now()` at the moment of the attempt
 *
 * FAILS OPEN, ON PURPOSE. A row that cannot be read yields "allowed, record
 * nothing". The alternative — refusing when the limiter cannot see — turns a
 * transient database hiccup, or a deploy that landed before the migration, into
 * every player losing the ability to name themselves. The thing being protected is
 * an enumeration ORACLE, not an account: the cost of failing open is that a walk
 * stays cheap during an outage, and the cost of failing closed is that the feature
 * is gone. `rename` has its own 404 for a genuinely missing profile, so this is not
 * the place that answer belongs either.
 */
export function decideRenameAttempt(row: RenameRow | null, now: number): RenameDecision {
  if (!row) return { ok: true, write: null };

  const startedAt = row.rename_window_start ? Date.parse(row.rename_window_start) : NaN;
  // An unparseable or absent start is a window that never began, so this attempt
  // opens one. Same branch covers the pre-migration row and a corrupted timestamp.
  const fresh = !Number.isFinite(startedAt) || now - startedAt >= RENAME_WINDOW_MS;

  const stored = Number(row.rename_attempts ?? 0);
  // A negative or non-finite count must not read as "credit". Nothing can write one
  // — the column is `int not null default 0` and only this function updates it —
  // but a limiter that trusts its own storage to be sane is a limiter with a hole
  // in it the day something else touches the table.
  const spent = fresh || !Number.isFinite(stored) ? 0 : Math.max(0, Math.trunc(stored));

  if (spent >= RENAME_LIMIT) {
    // Reachable only when `fresh` is false, so `startedAt` is finite here: a fresh
    // window sets `spent` to 0, and 0 is never >= a positive limit.
    return { ok: false, retryAfter: Math.max(1, Math.ceil((startedAt + RENAME_WINDOW_MS - now) / 1000)) };
  }

  return {
    ok: true,
    write: {
      // A continuing window keeps its original start, so five attempts spread over
      // the hour cannot walk the window forward and buy a sixth.
      rename_window_start: fresh ? new Date(now).toISOString() : (row.rename_window_start as string),
      rename_attempts: spent + 1,
    },
  };
}
