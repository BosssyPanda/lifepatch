"use client";

/**
 * What you keep getting wrong.
 *
 * The game already tracks mastery (`lib/cloud/mastery.ts`), a 0–5 level that only
 * ever goes UP — it records that you applied a concept well. That cannot answer the
 * question this feature asks, because level 0 means both "never met this" and "met
 * it four times and blew it every time", and those two players need opposite things
 * from the next run.
 *
 * So this keeps the other half of the record: per concept, how many tagged moments
 * you met it in, and how many of those went badly.
 *
 * ── The counting rule ───────────────────────────────────────────────────────
 * A `good` outcome is a hit. A `bad` or `warning` outcome is a miss. `neutral`
 * counts as NEITHER — a neutral outcome is a card where the writing declined to
 * grade the decision, and scoring it either way would put noise in a number the
 * report states out loud.
 *
 * ── Where it lives ──────────────────────────────────────────────────────────
 * Local, under the progress id. That is a real limitation and the report does not
 * pretend otherwise: your weak spots do not follow you to another device. Putting
 * them in Supabase would mean a new table, and the posture for this whole pass is
 * that everything works guest and offline with no new SQL.
 */

const PREFIX = "lifepatch.weakSpots.";

/**
 * Attempts before a concept can be called a weak spot.
 *
 * One bad outcome is a bad night, not a gap. Two is the smallest number that can
 * distinguish them, and the report says the words "keep getting" — which has to be
 * true when it is printed.
 */
export const MIN_ATTEMPTS = 2;

/** How many the report names, and the draw favours. */
export const WEAK_SPOT_COUNT = 2;

export type ConceptTally = { hit: number; miss: number };
export type Tallies = Record<string, ConceptTally>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTallies(progressId: string): Tallies {
  const store = storage();
  if (!store || !progressId) return {};
  try {
    const raw = store.getItem(PREFIX + progressId);
    const parsed = raw ? (JSON.parse(raw) as Tallies) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTallies(progressId: string, t: Tallies): void {
  const store = storage();
  if (!store || !progressId) return;
  try {
    store.setItem(PREFIX + progressId, JSON.stringify(t));
  } catch {}
}

/**
 * Record one tagged moment against every concept it touched.
 *
 * `neutral` is not passed here at all — the caller drops it — but the signature
 * takes an explicit hit/miss rather than a tone so the rule above lives in exactly
 * one place and cannot be re-decided at a second call site.
 */
export function recordAttempt(progressId: string, conceptIds: string[], hit: boolean): void {
  if (!progressId || conceptIds.length === 0) return;
  const t = readTallies(progressId);
  for (const id of new Set(conceptIds)) {
    const prev = t[id] ?? { hit: 0, miss: 0 };
    t[id] = hit ? { ...prev, hit: prev.hit + 1 } : { ...prev, miss: prev.miss + 1 };
  }
  writeTallies(progressId, t);
}

/**
 * How badly one concept is going, 0 (never wrong) to 1 (always wrong).
 *
 * Laplace-smoothed: `(miss + 1) / (attempts + 2)`. Without it, one miss out of one
 * attempt scores a perfect 1.0 and outranks four misses out of six — the loudest
 * weak spot would be whichever concept you had met least. The +1/+2 pulls a thin
 * record toward the middle, so evidence has to accumulate before it can win.
 */
export function missRate(t: ConceptTally): number {
  return (t.miss + 1) / (t.hit + t.miss + 2);
}

export type WeakSpot = { conceptId: string; tally: ConceptTally; rate: number };

/**
 * The concepts going worst, worst first.
 *
 * Only concepts you have actually MET at least `MIN_ATTEMPTS` times and got wrong
 * at least once. That is what makes the report's sentence literally true: it names
 * a gap you have demonstrated, never one you have simply never been shown, and
 * never a concept you have only ever got right.
 *
 * Ties break on the raw miss count, then on the concept id, so the list is stable
 * between two calls — the report and the next run's draw have to agree.
 */
export function rankWeakSpots(tallies: Tallies, limit = WEAK_SPOT_COUNT): WeakSpot[] {
  return Object.entries(tallies)
    .filter(([, t]) => t.miss > 0 && t.hit + t.miss >= MIN_ATTEMPTS)
    .map(([conceptId, tally]) => ({ conceptId, tally, rate: missRate(tally) }))
    .sort((a, b) => b.rate - a.rate || b.tally.miss - a.tally.miss || a.conceptId.localeCompare(b.conceptId))
    .slice(0, limit);
}

/** The ids alone — what `initRun` snapshots into the run. */
export function weakSpotIds(progressId: string, limit = WEAK_SPOT_COUNT): string[] {
  return rankWeakSpots(readTallies(progressId), limit).map((w) => w.conceptId);
}
