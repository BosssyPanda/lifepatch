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

/** Where a save actually landed. `"failed"` means nowhere — the only value a
 *  caller must react to. */
export type SaveOutcome = "cloud" | "local" | "failed";

function writeLocalSave(userId: string, mode: ModeId, state: RunState, at: string): boolean {
  try {
    localStorage.setItem(
      localKey(userId, mode),
      JSON.stringify({ mode, state, updatedAt: at } satisfies SaveRow),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist a run, and say where it went.
 *
 * The cloud branch used to `await` the upsert and drop the `{ error }` on the
 * floor, then `return`. Every failure mode — RLS refusing the row, the session
 * having expired, the network being down — produced a resolved promise that was
 * indistinguishable from success, so the autosave indicator said "saved" while the
 * year the player had just finished existed nowhere at all.
 *
 * Two changes. The error is read, and a failed cloud write falls back to the
 * device rather than evaporating: `loadRun` now reconciles the two by timestamp,
 * so a run saved through an outage comes back when the connection does.
 */
export async function saveRun(userId: string, mode: ModeId, state: RunState): Promise<SaveOutcome> {
  const at = new Date().toISOString();
  if (cloudSavesFor(userId)) {
    const { error } = await supabase!
      .from("saves")
      .upsert({ user_id: userId, mode, state, updated_at: at }, { onConflict: "user_id,mode" });
    if (!error) return "cloud";
    console.error(`saveRun: cloud write failed for ${mode}, keeping a local copy`, error);
    return writeLocalSave(userId, mode, state, at) ? "local" : "failed";
  }
  return writeLocalSave(userId, mode, state, at) ? "local" : "failed";
}

function readLocalSave(userId: string, mode: ModeId): SaveRow | null {
  try {
    const raw = localStorage.getItem(localKey(userId, mode));
    if (!raw) return null;
    const row = JSON.parse(raw) as SaveRow;
    return row && row.state ? row : null;
  } catch {
    return null;
  }
}

/**
 * The newest save for this player and mode.
 *
 * A cloud player is read from the cloud, and then reconciled against any local
 * copy `saveRun` left behind during an outage — whichever is newer wins. Without
 * that comparison the fallback write would be unreachable: the cloud row would
 * always be returned, and the newer offline run would sit on the device forever.
 */
export async function loadRun(userId: string, mode: ModeId): Promise<RunState | null> {
  if (cloudSavesFor(userId)) {
    const { data, error } = await supabase!
      .from("saves")
      .select("state, updated_at")
      .eq("user_id", userId)
      .eq("mode", mode)
      .maybeSingle();
    // supabase-js returns `{ data: null, error }` for a failed read and
    // `{ data: null, error: null }` for a genuinely empty one, and conflating them
    // is worse than either failure alone: the reconcile below would serve a stale
    // local copy as if it were the newest save, and the next `saveRun` would upsert
    // that older state straight over a newer cloud row. "I could not reach the
    // cloud" is not "you have no save", so it is thrown — which is the contract
    // `loadRunChecked` documents, and `AuthGate` already has a `.catch` for it.
    if (error) throw new Error(`loadRun: could not read the cloud save for ${mode}: ${error.message}`);
    const local = readLocalSave(userId, mode);
    const cloudAt = data ? String(data.updated_at ?? "") : null;
    if (local && (cloudAt === null || local.updatedAt > cloudAt)) return local.state;
    return (data?.state as RunState) ?? local?.state ?? null;
  }
  return readLocalSave(userId, mode)?.state ?? null;
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

const SAVE_MODES: ModeId[] = ["story", "infinite"];

/**
 * Every mode this player has a save for, newest timestamp per mode.
 *
 * Reconciled the same way `loadRun` is, and for the same reason: a run that only
 * exists in the local backstop must still be OFFERED, or the fallback write is a
 * copy nothing ever shows the player a way back to.
 */
export async function listSaves(userId: string): Promise<{ mode: ModeId; updatedAt: string }[]> {
  const byMode = new Map<ModeId, string>();
  if (cloudSavesFor(userId)) {
    const { data, error } = await supabase!
      .from("saves")
      .select("mode, updated_at")
      .eq("user_id", userId);
    // Same reasoning as `loadRun`: advertising the local fallback as the whole
    // picture, when the cloud simply could not be reached, offers a stale run as
    // resumable and loses the newer one the moment it is saved over.
    if (error) throw new Error(`listSaves: could not read cloud saves: ${error.message}`);
    for (const r of data ?? []) byMode.set(r.mode as ModeId, String(r.updated_at));
  }
  for (const mode of SAVE_MODES) {
    const local = readLocalSave(userId, mode);
    if (!local) continue;
    const seen = byMode.get(mode);
    if (!seen || local.updatedAt > seen) byMode.set(mode, local.updatedAt);
  }
  return [...byMode].map(([mode, updatedAt]) => ({ mode, updatedAt }));
}

export async function deleteSave(userId: string, mode: ModeId): Promise<void> {
  if (cloudSavesFor(userId)) {
    const { error } = await supabase!.from("saves").delete().eq("user_id", userId).eq("mode", mode);
    if (error) console.error(`deleteSave: cloud delete failed for ${mode}`, error);
  }
  // Always clear the device copy too. `saveRun` can leave one behind on a failed
  // cloud write, and a delete that removed only the cloud row would resurrect the
  // run on the next `loadRun` reconcile.
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
