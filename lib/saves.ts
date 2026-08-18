import type { ModeId } from "./modes";
import { isCompatibleSave, type RunState } from "./runEngine";
import { isCloud, supabase } from "./supabase";

export type SaveRow = {
  mode: ModeId;
  state: RunState;
  updatedAt: string;
};

/**
 * The result of looking for a save, with "there isn't one" and "there is one but
 * this engine can't read it" kept apart — they need different words on screen.
 */
export type SaveLookup =
  | { kind: "ok"; state: RunState }
  | { kind: "none" }
  | { kind: "outdated" };

/**
 * What to tell a player whose save predates the current engine. Not an error:
 * the game changed under them, and the only cost is this one run.
 */
export const OUTDATED_SAVE_MESSAGE =
  "This save is from an older version of the game and can't be continued. Your progress elsewhere is safe — start a fresh run to play the updated economy.";

function localKey(userId: string, mode: ModeId) {
  return `lifepatch.save.${userId}.${mode}`;
}

export async function saveRun(userId: string, mode: ModeId, state: RunState): Promise<void> {
  if (isCloud && supabase) {
    await supabase
      .from("saves")
      .upsert(
        { user_id: userId, mode, state, updated_at: new Date().toISOString() },
        { onConflict: "user_id,mode" },
      );
    return;
  }
  try {
    localStorage.setItem(
      localKey(userId, mode),
      JSON.stringify({ mode, state, updatedAt: new Date().toISOString() } satisfies SaveRow),
    );
  } catch {}
}

export async function loadRun(userId: string, mode: ModeId): Promise<RunState | null> {
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("saves")
      .select("state")
      .eq("user_id", userId)
      .eq("mode", mode)
      .maybeSingle();
    return (data?.state as RunState) ?? null;
  }
  try {
    const raw = localStorage.getItem(localKey(userId, mode));
    if (!raw) return null;
    return (JSON.parse(raw) as SaveRow).state;
  } catch {
    return null;
  }
}

/**
 * `loadRun`, but it tells you WHY there's nothing to resume.
 *
 * `isCompatibleSave` now checks `RunState.version` explicitly instead of
 * duck-typing three key names, so a save written by an older engine is refused
 * here rather than resuming as a half-initialised state (missing `homeValue`,
 * `mortgage`, `seed`…) and corrupting the run. A rejection is not an error —
 * pair `"outdated"` with OUTDATED_SAVE_MESSAGE and a "Begin a new life" button.
 * A genuine load FAILURE still throws, so callers can keep telling that apart.
 */
export async function loadRunChecked(userId: string, mode: ModeId): Promise<SaveLookup> {
  const state = await loadRun(userId, mode);
  if (state === null) return { kind: "none" };
  return isCompatibleSave(state) ? { kind: "ok", state } : { kind: "outdated" };
}

export async function listSaves(userId: string): Promise<{ mode: ModeId; updatedAt: string }[]> {
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("saves")
      .select("mode, updated_at")
      .eq("user_id", userId);
    return (data ?? []).map((r) => ({ mode: r.mode as ModeId, updatedAt: r.updated_at as string }));
  }
  const out: { mode: ModeId; updatedAt: string }[] = [];
  for (const mode of ["story", "infinite"] as ModeId[]) {
    try {
      const raw = localStorage.getItem(localKey(userId, mode));
      if (raw) out.push({ mode, updatedAt: (JSON.parse(raw) as SaveRow).updatedAt });
    } catch {}
  }
  return out;
}

export async function deleteSave(userId: string, mode: ModeId): Promise<void> {
  if (isCloud && supabase) {
    await supabase.from("saves").delete().eq("user_id", userId).eq("mode", mode);
    return;
  }
  try {
    localStorage.removeItem(localKey(userId, mode));
  } catch {}
}
