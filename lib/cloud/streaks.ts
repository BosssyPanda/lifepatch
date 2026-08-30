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

/**
 * A guest's streak lives on the device, and this guard is what sends it there.
 *
 * `mastery.ts` and `profiles.ts` have had it since they were written; this file and
 * `results.ts` branched on `isCloud && supabase` alone, which is a different
 * question — "is there a cloud" rather than "does THIS player have a row in it".
 * A guest id is `device-<random>` (see `identity.ts`), not a uuid, so every call
 * below went to PostgREST and came back refused.
 *
 * The cost was not the wasted request. Both branches here are real: the cloud one,
 * and a `localStorage` one underneath it that a guest is supposed to get. Taking the
 * cloud branch and failing meant the local write was never reached — so on any build
 * with Supabase configured, which is production, a guest's streak was not saved
 * anywhere at all. It read as nothing every day, no matter how many days they played.
 * `qa:mp` found it: four refused `/rest/v1/streaks?user_id=eq.device-...` per client,
 * on a run where nobody had signed in.
 */
function cloudStreakFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

/**
 * Read the streak, or throw.
 *
 * supabase-js resolves rather than rejects on a failed request, so a discarded
 * `error` here does not read as zero — it reads as "this player has never played",
 * which is a different and much more expensive sentence. `bumpStreak` computes the
 * next value FROM this one: a read that fails during an expired session returns
 * EMPTY, `nextStreak` turns EMPTY into day one, and the upsert writes a 1 over a
 * streak of thirty. The failed WRITE the review flagged loses a day; this loses the
 * streak, and it is the same discarded `error` behind both.
 *
 * So the write path takes the strict read and `getStreak` keeps the lenient one —
 * a number nobody could fetch is worth showing as nothing, and is not worth
 * computing a write from.
 */
async function readStreak(userId: string): Promise<Streak> {
  if (supabase && cloudStreakFor(userId)) {
    const { data, error } = await supabase
      .from("streaks")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data) : EMPTY;
  }
  return readLocal(userId);
}

/** Display read. Nothing is written from this, so an unreachable row shows as none. */
export async function getStreak(userId: string): Promise<Streak> {
  try {
    return await readStreak(userId);
  } catch {
    return EMPTY;
  }
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
 * Record a play today and return the updated streak. THROWS when the cloud write
 * fails, and when the read it is computed from fails.
 *
 * The house rule `lib/saves.ts` states: supabase-js does not reject on a failed
 * request, it resolves with `{ error }`, and discarding that makes an RLS refusal,
 * an expired session and a network failure all look exactly like success. This
 * function returned the COMPUTED next streak either way, so the chip animated to
 * six days against a database still holding five and the next read put it back.
 *
 * `submitRunOnce` is the only caller and catches this deliberately: by the time the
 * streak is bumped the result row already exists, and a missed day is a smaller
 * loss than the duplicate result row a retry would post.
 */
export async function bumpStreak(userId: string): Promise<Streak> {
  const prev = await readStreak(userId);
  const next = nextStreak(prev, todayStr());
  if (next === prev) return prev;

  if (supabase && cloudStreakFor(userId)) {
    const { error } = await supabase.from("streaks").upsert(
      {
        user_id: userId,
        current: next.current,
        longest: next.longest,
        last_played_on: next.lastPlayedOn,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return next;
  }
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(next));
  } catch {}
  return next;
}
