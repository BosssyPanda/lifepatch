import { BACKGROUNDS } from "./backgrounds";
import { mulberry32, strHash } from "./rng";
import type { RunState } from "./runEngine";

/**
 * The Daily Ledger — one world per day, the same one for everybody.
 *
 * Everything here is a pure function of a `YYYY-MM-DD` date string. The puzzle
 * number, the seed that fixes its markets and its cards, and the background it is
 * played from are all derived, never stored — so two devices that agree on the date
 * agree on the world without ever talking to each other, and a day's puzzle can be
 * recomputed years later from nothing but its date.
 *
 * ── UTC, and why it matters here ────────────────────────────────────────────
 * The date is UTC. `lib/cloud/streaks.ts` keys its streak on the LOCAL calendar
 * date, which is the right call there — a streak is about the player's own days.
 * A shared puzzle is the opposite: everyone has to be on the same one at the same
 * moment, and a local date would put Auckland a day ahead of Los Angeles on the
 * same board. The two disagree at the edges of the day by design; anything that
 * records "which daily did I play" keys on THIS date, never on `todayStr()`.
 *
 * ── The background rotates ──────────────────────────────────────────────────
 * A background is normally the player's choice, and it moves the starting numbers
 * enormously — $6,000 and no debt against $1,500 and a $24,000 loan. Letting each
 * player pick would make the daily board a comparison of openings rather than of
 * play. So the day fixes it, the same way it fixes the market: it is part of the
 * world, not a setting.
 */

/** Puzzle #1. Before this date there is no daily. */
export const DAILY_EPOCH = "2026-01-01";

/** Story is the daily's mode: fixed length, a real ending, a comparable number. */
export const DAILY_MODE = "story" as const;

const DAY_MS = 86_400_000;

/** Today's UTC calendar date as `YYYY-MM-DD`. */
export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Midnight UTC of a `YYYY-MM-DD` date, as epoch ms. NaN for anything malformed. */
function utcMs(date: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
}

/** Is this a date string this module can work with at all? */
export function isDailyDate(date: string): boolean {
  return Number.isFinite(utcMs(date));
}

/**
 * The puzzle number the player sees. Days since the epoch, one-based, so the epoch
 * itself is #1. Returns 0 for a date before the epoch or for junk — callers treat
 * anything below 1 as "there is no daily here".
 */
export function dailyNumber(date: string): number {
  const ms = utcMs(date);
  if (!Number.isFinite(ms)) return 0;
  const n = Math.round((ms - utcMs(DAILY_EPOCH)) / DAY_MS) + 1;
  return n < 1 ? 0 : n;
}

/** The seed range. Comfortably inside the integer `initRun` floors its seed to. */
const SEED_SPACE = 1_000_000_000;

/**
 * The day's world seed.
 *
 * `strHash` alone is NOT enough here, and a property test caught that: it is
 * `h = 31·h + charCode`, so two dates differing by one in their last character hash
 * to values differing by exactly one. Yesterday and today would be adjacent seeds —
 * and while the market model is a coordinate hash that scatters neighbours fine,
 * the year's cards come off a `mulberry32` stream seeded from `(seed, year)`, where
 * adjacent seeds are adjacent streams. Consecutive puzzles would have felt related,
 * which is the one thing a daily cannot afford.
 *
 * So the string hash is run through one `mulberry32` step, whose whole job is
 * avalanche: a one-bit change in the seed decorrelates the output completely.
 *
 * Non-negative, because `initRun` floors its seed and a negative one would still
 * work but reads like a bug in every log it appears in.
 */
export function dailySeed(date: string): number {
  return Math.floor(mulberry32(strHash(`lifepatch.daily.${date}`))() * SEED_SPACE);
}

/** The background the day is played from. Rotates with the date, same for everyone. */
export function dailyBackgroundId(date: string): string {
  const n = dailyNumber(date);
  const i = n > 0 ? (n - 1) % BACKGROUNDS.length : 0;
  return BACKGROUNDS[i].id;
}

/** Everything about one day's puzzle, resolved once. */
export type DailyPuzzle = {
  date: string;
  number: number;
  seed: number;
  backgroundId: string;
};

/** Null before the epoch, or for a date this module cannot read. */
export function dailyFor(date: string): DailyPuzzle | null {
  const number = dailyNumber(date);
  if (number < 1) return null;
  return { date, number, seed: dailySeed(date), backgroundId: dailyBackgroundId(date) };
}

/** Today's puzzle, or null if today is somehow before the epoch. */
export function todaysDaily(now: Date = new Date()): DailyPuzzle | null {
  return dailyFor(todayUTC(now));
}

/** Is this run a daily run — and if so, which day's? */
export function dailyOf(run: RunState | null | undefined): string | null {
  return run?.daily ?? null;
}
