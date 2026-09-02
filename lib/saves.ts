import { isGuestId } from "./cloud/identity";
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

/**
 * Where this player's saves live.
 *
 * A guest is the anonymous device id, and there is no auth session behind it — the
 * `saves` table is row-level-secured on `auth.uid()`, so a cloud write would be
 * refused and the run would silently fail to persist. Guest saves therefore stay on
 * the device even when Supabase keys are configured, which is exactly what the gate
 * promises them.
 */
function cloudSavesFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

/**
 * Persist a run. THROWS when the write fails — cloud or local.
 *
 * supabase-js does not reject on a failed request — it resolves with `{ error }`.
 * Discarding that meant an RLS refusal, an expired session, a network failure and
 * a quota rejection all looked exactly like success: `persist` cleared `saving`
 * and the player was shown a saved run that did not exist. The asymmetry is what
 * marks it as an oversight rather than a policy — `submitResult` checks and throws,
 * and `getProfiles` has a whole documented fallback built on reading `error`.
 * Saves were the one write path that looked away, and they are the one whose
 * failure costs a player their run.
 */
export async function saveRun(userId: string, mode: ModeId, state: RunState): Promise<void> {
  if (cloudSavesFor(userId)) {
    const { error } = await supabase!
      .from("saves")
      .upsert(
        { user_id: userId, mode, state, updated_at: new Date().toISOString() },
        { onConflict: "user_id,mode" },
      );
    if (error) throw new Error(error.message);
    return;
  }
  // ...and THROWS when the local write fails, for exactly the reason above. The
  // cloud half of this was fixed and the local half was not, which left the bug
  // intact for the players most exposed to it: a guest has no second copy
  // anywhere. `localStorage.setItem` throws on a full quota and in a private
  // window, and swallowing that meant `persist` cleared `saving`, never set
  // `saveFailed`, and `YearHud` printed "Saved" over a run that was written
  // nowhere — the precise failure YearHud.tsx:170 already documents having fixed
  // once. Both callers are ready for it: `persist` catches and raises the
  // "Not saved" flag, and `adoptGuestSaves` marks the adoption incomplete so it
  // is retried rather than silently marked done.
  try {
    localStorage.setItem(
      localKey(userId, mode),
      JSON.stringify({ mode, state, updatedAt: new Date().toISOString() } satisfies SaveRow),
    );
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Could not write the local save.");
  }
}

/** Reads a run back. Throws for the same reason `saveRun` does: "we could not
 *  reach your save" and "you have no save" must not arrive as the same answer —
 *  the gate offers "Begin a new life" over the second one. */
export async function loadRun(userId: string, mode: ModeId): Promise<RunState | null> {
  if (cloudSavesFor(userId)) {
    const { data, error } = await supabase!
      .from("saves")
      .select("state")
      .eq("user_id", userId)
      .eq("mode", mode)
      .maybeSingle();
    if (error) throw new Error(error.message);
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
  if (cloudSavesFor(userId)) {
    const { data } = await supabase!
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
  if (cloudSavesFor(userId)) {
    await supabase!.from("saves").delete().eq("user_id", userId).eq("mode", mode);
    return;
  }
  try {
    localStorage.removeItem(localKey(userId, mode));
  } catch {}
}

/**
 * Carry a guest's on-device runs onto a real account the first time they sign in.
 *
 * Signing in must never read as "my save vanished" — the same reasoning that made
 * `signIn` merge local mastery across. Existing saves on the account always win
 * (this only ever fills an empty slot), a save the current engine cannot read is
 * skipped rather than resurrected, and every step is best-effort: a failure here
 * leaves the guest copy exactly where it was.
 */
export async function adoptGuestSaves(guestId: string, userId: string): Promise<void> {
  if (!guestId || !userId || guestId === userId || !isGuestId(guestId)) return;
  // Once per account. Without this every page load of a player who ever played as a
  // guest would re-read both modes from the cloud to discover there is nothing to do.
  const done = `lifepatch.adopted.${userId}`;
  try {
    if (localStorage.getItem(done) === "1") return;
  } catch {}
  let complete = true;
  for (const mode of ["story", "infinite"] as ModeId[]) {
    try {
      const raw = localStorage.getItem(localKey(guestId, mode));
      if (!raw) continue;
      const state = (JSON.parse(raw) as SaveRow).state;
      if (!isCompatibleSave(state)) continue;
      if (await loadRun(userId, mode)) continue; // never overwrite the account's own run
      await saveRun(userId, mode, state);
    } catch {
      // A transient cloud failure on the one page load where the magic link lands
      // must not permanently mark this account adopted — that would strand the
      // guest's run on the device with nothing left to trigger another attempt.
      complete = false;
    }
  }
  if (!complete) return;
  try {
    localStorage.setItem(done, "1");
  } catch {}
}
