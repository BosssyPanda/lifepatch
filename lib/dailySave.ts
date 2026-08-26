"use client";

import { isDailyDate } from "./daily";
import { isCompatibleSave, type RunState } from "./runEngine";

/**
 * Where a daily run lives.
 *
 * Deliberately NOT `lib/saves.ts`. That store is keyed `(userId, mode)` and the
 * cloud table behind it is `unique(user_id, mode)` — a daily is still
 * `mode: "story"`, so routing one through it would overwrite the player's own
 * ongoing Story life with a run they never chose to replace it with. The daily gets
 * its own key, one per day.
 *
 * It is local and it does not sync, which is a real limitation and worth stating
 * plainly: play the daily on a second device and you get a second attempt. The
 * one-attempt rule here is a courtesy the game extends to a player who wants the
 * puzzle to mean something, not a lock. Nothing in the UI will call it one.
 *
 * The save exists so a refresh, a crashed tab or a closed browser does not cost you
 * the day — not so the run can be carried around.
 */

const PREFIX = "lifepatch.daily.";
/** Days of history worth keeping. Past this, a record is only taking up quota. */
const KEEP_DAYS = 10;

export type DailyRecord = {
  date: string;
  state: RunState;
  updatedAt: string;
};

function key(date: string): string {
  return `${PREFIX}${date}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * One day's record, or null.
 *
 * A record whose state this engine cannot read is treated as absent rather than
 * offered up: `isCompatibleSave` is the same gate `AuthGate` puts in front of
 * "Continue", and a daily has nowhere to show an "outdated save" message. Losing
 * one day to an engine change is the honest outcome; resuming a corrupt half-state
 * into a scored, one-attempt run is not.
 *
 * Deliberately NOT migrated, unlike `lib/saves.ts`. `migrateSave` carries an
 * ordinary run forward losslessly, but a migrated run finishes across two
 * economies — and the whole point of a daily is that everyone plays the SAME seed
 * under the same rules on the same day. A carried save would be ranked on that
 * day's board against runs it is not comparable to, which is the exact fault the
 * version filter on `topResults` exists to prevent. One lost day is the cheaper
 * error.
 */
export function readDaily(date: string): DailyRecord | null {
  const store = storage();
  if (!store || !isDailyDate(date)) return null;
  try {
    const raw = store.getItem(key(date));
    if (!raw) return null;
    const rec = JSON.parse(raw) as DailyRecord;
    if (!rec || rec.date !== date || !isCompatibleSave(rec.state)) return null;
    return rec;
  } catch {
    return null;
  }
}

export function writeDaily(date: string, state: RunState): void {
  const store = storage();
  if (!store || !isDailyDate(date)) return;
  try {
    store.setItem(
      key(date),
      JSON.stringify({ date, state, updatedAt: new Date().toISOString() } satisfies DailyRecord),
    );
  } catch {
    // Quota. The day is still playable; it just will not survive a refresh.
  }
}

// There is deliberately no second "posted" flag here. `submitRunOnce`
// (`lib/cloud/results.ts`) already keys its durable dedupe on the run seed, and a
// daily's seed IS the day — one guarantee, one mechanism, one place to be wrong.

/**
 * Drop records older than `KEEP_DAYS`.
 *
 * Every daily writes a whole `RunState` — with its journal, a few kilobytes — under
 * a key that never comes back. Without this, a year of play is 365 dead records in
 * a 5MB budget shared with saves, results and mastery, and the first thing to break
 * is the player's actual save. Called wherever the daily is read, so it costs one
 * key scan per visit and no scheduling.
 */
export function pruneDailies(today: string, keepDays: number = KEEP_DAYS): number {
  const store = storage();
  if (!store || !isDailyDate(today)) return 0;
  const cutoff = Date.parse(`${today}T00:00:00Z`) - keepDays * 86_400_000;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const date = k.slice(PREFIX.length);
      const ms = isDailyDate(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
      // A key that is not a date at all is not ours to interpret — leave it.
      if (Number.isFinite(ms) && ms < cutoff) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    return 0;
  }
  return doomed.length;
}

/** How today's daily stands, for the one strip that offers it. */
export type DailyStanding =
  | { kind: "fresh" }
  | { kind: "playing"; state: RunState; year: number }
  | { kind: "done"; state: RunState };

export function dailyStanding(date: string): DailyStanding {
  pruneDailies(date);
  const rec = readDaily(date);
  if (!rec) return { kind: "fresh" };
  if (rec.state.status === "ended") return { kind: "done", state: rec.state };
  return { kind: "playing", state: rec.state, year: rec.state.history.length + 1 };
}
