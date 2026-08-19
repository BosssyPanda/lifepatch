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

export async function getMastery(userId: string): Promise<MasteryRow[]> {
  if (isCloud && supabase) {
    const { data } = await supabase.from("mastery").select("*").eq("user_id", userId);
    return (data ?? []).map(fromRow);
  }
  return readLocal(userId);
}

export type MasteryGain = { conceptId: string; level: number; prevLevel: number; isFirst: boolean };

/** Raise mastery for each concept by one level (capped). Returns new levels. */
export async function recordConcepts(userId: string, conceptIds: string[]): Promise<MasteryGain[]> {
  const unique = Array.from(new Set(conceptIds)).filter(Boolean);
  if (unique.length === 0) return [];

  const current = await getMastery(userId);
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

  if (isCloud && supabase) {
    await supabase.from("mastery").upsert(
      updatedRows.map((r) => ({
        user_id: userId,
        concept_id: r.conceptId,
        level: r.level,
        updated_at: r.updatedAt,
      })),
      { onConflict: "user_id,concept_id" },
    );
    return gains;
  }

  const merged = new Map(byId);
  for (const r of updatedRows) merged.set(r.conceptId, r);
  writeLocal(userId, Array.from(merged.values()));
  return gains;
}
