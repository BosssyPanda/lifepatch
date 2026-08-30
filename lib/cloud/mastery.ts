import { isGuestId } from "./identity";
import { isCloud, supabase } from "../supabase";
import type { MasteryRow } from "./types";

/**
 * Concept mastery progress (the "Money Brain" map). Cloud → `mastery` table;
 * dev → namespaced localStorage. Levels rise on repeated correct application,
 * capped at MAX_MASTERY_LEVEL. Concept IDs come from lib/concepts.ts (Phase 3).
 */

const PREFIX = "lifepatch.mastery.";
export const MAX_MASTERY_LEVEL = 5;

function localKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

function fromRow(row: Record<string, unknown>): MasteryRow {
  return {
    conceptId: String(row.concept_id),
    level: Number(row.level ?? 0),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function readLocal(userId: string): MasteryRow[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    return raw ? (JSON.parse(raw) as MasteryRow[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string, rows: MasteryRow[]): void {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(rows));
  } catch {}
}

/**
 * Carry anonymous progress onto a real account.
 *
 * A player can earn mastery before they ever sign in — the Rat Race never asks,
 * and the landing's concept toasts fire on the way through. That progress is
 * filed under the device id, so without this it would appear to vanish the
 * moment they enter an email. Levels take the higher of the two, so signing in
 * can only ever add to what you had.
 *
 * Local-only: in cloud mode an anonymous player has no rows to carry.
 */
export function mergeLocalMastery(fromId: string, toId: string): void {
  if (isCloud || fromId === toId) return;
  const from = readLocal(fromId);
  if (from.length === 0) return;
  const to = readLocal(toId);
  const byId = new Map(to.map((r) => [r.conceptId, r]));
  for (const row of from) {
    const existing = byId.get(row.conceptId);
    if (!existing || row.level > existing.level) byId.set(row.conceptId, row);
  }
  writeLocal(toId, [...byId.values()]);
  try {
    localStorage.removeItem(localKey(fromId));
  } catch {}
}

/** A guest's progress lives on the device — there is no cloud row to read or write. */
function cloudMasteryFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

/**
 * Read this player's rows, or throw.
 *
 * The same asymmetry `lib/saves.ts` documents: supabase-js resolves with `{ error }`
 * rather than rejecting, so a discarded error here does not read as "could not
 * fetch" — it reads as "this player has mastered nothing". `recordConcepts` computes
 * the next level FROM this, as `prevLevel + 1`, so one failed read turns a level-4
 * concept into a level-1 upsert and the progress is gone. A wrong read is worse than
 * a failed write, because a wrong read becomes a confident write.
 */
async function readMastery(userId: string): Promise<MasteryRow[]> {
  if (supabase && cloudMasteryFor(userId)) {
    const { data, error } = await supabase.from("mastery").select("*").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow);
  }
  return readLocal(userId);
}

/** Display read. Nothing is written from this, so an unreachable map shows as empty. */
export async function getMastery(userId: string): Promise<MasteryRow[]> {
  try {
    return await readMastery(userId);
  } catch {
    return [];
  }
}

export type MasteryGain = { conceptId: string; level: number; prevLevel: number; isFirst: boolean };

/**
 * What `recordConcepts` learned, and whether the database agrees.
 *
 * `saved` is the half that was missing. The write reported success on an RLS
 * refusal, an expired session or a network failure and then handed back the
 * COMPUTED levels, so the Money Brain played its level-up flourish and marked a
 * concept mastered while the database held neither — and the next read silently
 * put it back. `gains` is still returned when `saved` is false: it is what the run
 * earned, which is worth showing; it is only the ceremony that has to wait for a
 * server that actually took it.
 */
export type MasteryResult = { gains: MasteryGain[]; saved: boolean };

/** Raise mastery for each concept by one level (capped). Returns new levels. */
export async function recordConcepts(
  userId: string,
  conceptIds: string[],
): Promise<MasteryResult> {
  const unique = Array.from(new Set(conceptIds)).filter(Boolean);
  if (unique.length === 0) return { gains: [], saved: true };

  let current: MasteryRow[];
  try {
    current = await readMastery(userId);
  } catch {
    // Nothing is written from a read that failed — see `readMastery`. No gains are
    // claimed either: without the previous levels there is no honest one to claim.
    return { gains: [], saved: false };
  }
  const byId = new Map(current.map((r) => [r.conceptId, r]));
  const now = new Date().toISOString();
  const gains: MasteryGain[] = [];
  const updatedRows: MasteryRow[] = [];

  for (const conceptId of unique) {
    const prev = byId.get(conceptId);
    const prevLevel = prev?.level ?? 0;
    const level = Math.min(prevLevel + 1, MAX_MASTERY_LEVEL);
    gains.push({ conceptId, level, prevLevel, isFirst: !prev });
    updatedRows.push({ conceptId, level, updatedAt: now });
  }

  if (supabase && cloudMasteryFor(userId)) {
    const { error } = await supabase.from("mastery").upsert(
      updatedRows.map((r) => ({
        user_id: userId,
        concept_id: r.conceptId,
        level: r.level,
        updated_at: r.updatedAt,
      })),
      { onConflict: "user_id,concept_id" },
    );
    return { gains, saved: !error };
  }

  const merged = new Map(byId);
  for (const r of updatedRows) merged.set(r.conceptId, r);
  writeLocal(userId, Array.from(merged.values()));
  return { gains, saved: true };
}
