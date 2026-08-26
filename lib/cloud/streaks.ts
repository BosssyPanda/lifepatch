import { isCloud, supabase } from "../supabase";
import { isGuestId } from "./identity";
import type { Streak } from "./types";

/**
 * Daily streak (loss-aversion habit loop). Cloud → `streaks` table; dev →
 * namespaced localStorage. Consecutive-day logic lives in the pure `nextStreak`
 * so both branches and unit tests share it.
 */

const PREFIX = "lifepatch.streak.";
const DAY_MS = 86_400_000;
const EMPTY: Streak = { current: 0, longest: 0, lastPlayedOn: null };

function localKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/** A guest's streak lives on the device — RLS has no row for `device-…`. Same
 *  gate as `lib/cloud/mastery.ts` and `lib/cloud/profiles.ts`. */
function cloudStreakFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

function fromRow(row: Record<string, unknown>): Streak {
  return {
    current: Number(row.current ?? 0),
    longest: Number(row.longest ?? 0),
    lastPlayedOn: (row.last_played_on as string | null) ?? null,
  };
}

/** Local calendar date as YYYY-MM-DD. */
export function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole-day gap between two YYYY-MM-DD dates (rounds across DST). */
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.round((db.getTime() - da.getTime()) / DAY_MS);
}

function readLocal(userId: string): Streak {
  try {
    const raw = localStorage.getItem(localKey(userId));
    return raw ? (JSON.parse(raw) as Streak) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function getStreak(userId: string): Promise<Streak> {
  if (cloudStreakFor(userId) && supabase) {
    const { data } = await supabase.from("streaks").select("*").eq("user_id", userId).maybeSingle();
    return data ? fromRow(data) : EMPTY;
  }
  return readLocal(userId);
}

/** Pure: compute the streak after a play on `today`. Same day = no change. */
export function nextStreak(prev: Streak, today: string): Streak {
  if (prev.lastPlayedOn === today) return prev;
  const gap = prev.lastPlayedOn ? daysBetween(prev.lastPlayedOn, today) : null;
  const current = gap === 1 ? prev.current + 1 : 1;
  return {
    current,
    longest: Math.max(prev.longest, current),
    lastPlayedOn: today,
  };
}

/**
 * Record a play today and return the updated streak.
 *
 * The cloud branch is one statement, computed in the database from the row that
 * is actually there. It used to be a read, a computation here, and a write back
 * — and the gap between the read and the write is real: two tabs finishing a run
 * in the same minute both read `current = 4`, both compute 5, and a day is eaten.
 * The same round trip is also what let a caller write any streak it liked, since
 * the value arriving at the table was simply whatever the client had decided.
 *
 * The local branch keeps `nextStreak`, which is the same rule in TypeScript, and
 * is why that function stays exported and pure: it is the readable statement of
 * what `bump_streak` does in SQL.
 */
export async function bumpStreak(userId: string): Promise<Streak> {
  if (cloudStreakFor(userId) && supabase) {
    // The date is the player's own local calendar date, deliberately unlike the
    // Daily Ledger's UTC one — a streak is about their days, not the world's. It
    // is passed in rather than read from `now()` in the function for exactly that
    // reason: the server does not know which day it is where they are.
    const { data, error } = await supabase.rpc("bump_streak", { today: todayStr() });
    // A dropped streak bump is not worth interrupting a finished run over, but it
    // must not be indistinguishable from a successful one either — the caller used
    // to get the incremented value back regardless and show the player a streak the
    // server had never agreed to.
    if (error || !data) {
      console.error("bumpStreak: cloud bump failed", error);
      return getStreak(userId);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ? fromRow(row as Record<string, unknown>) : getStreak(userId);
  }

  const prev = await getStreak(userId);
  const next = nextStreak(prev, todayStr());
  if (next === prev) return prev;
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(next));
  } catch {}
  return next;
}
