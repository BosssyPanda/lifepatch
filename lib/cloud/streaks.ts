import { isCloud, supabase } from "../supabase";
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

export async function getStreak(userId: string): Promise<Streak> {
  if (isCloud && supabase) {
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

/** Record a play today and return the updated streak. */
export async function bumpStreak(userId: string): Promise<Streak> {
  const prev = await getStreak(userId);
  const next = nextStreak(prev, todayStr());
  if (next === prev) return prev;

  if (isCloud && supabase) {
    await supabase.from("streaks").upsert(
      {
        user_id: userId,
        current: next.current,
        longest: next.longest,
        last_played_on: next.lastPlayedOn,
      },
      { onConflict: "user_id" },
    );
    return next;
  }
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(next));
  } catch {}
  return next;
}
