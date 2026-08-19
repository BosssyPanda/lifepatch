import { isCloud } from "../supabase";

/**
 * Player identity resolution. Signed-in players use their auth id. Anonymous
 * players in dev get a stable per-device id so leaderboards/streaks work with
 * zero sign-in friction — the social layer is playable immediately and upgrades
 * to real cross-device accounts when Supabase keys land.
 */

const DEVICE_KEY = "lifepatch.deviceId";

/** A stable per-device player id for offline/dev play (no sign-in required). */
export function localPlayerId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "device-anon";
  }
}

/**
 * Is this id the anonymous device, rather than a real account?
 *
 * Guest play hands `localPlayerId()` straight to the run/save layer as the player
 * id, so everything downstream needs one honest way to ask "is there an account
 * behind this?" — saves must stay local for a guest even when Supabase keys are
 * present, and a leaderboard row keyed on a device id would be refused by RLS.
 */
export function isGuestId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("device-");
}

/**
 * The id to attribute results/streaks to.
 * - Signed-in → the auth user id (works in cloud + dev).
 * - Guest / anonymous → a device id in dev; null in cloud, where RLS requires a
 *   real auth user, so callers should prompt sign-in instead of writing.
 */
export function resolvePlayerId(authUserId: string | null): string | null {
  if (authUserId && !isGuestId(authUserId)) return authUserId;
  return isCloud ? null : localPlayerId();
}

/**
 * The id to attribute LEARNING progress to.
 *
 * Unlike a leaderboard row, mastery has a local store and no server to refuse it,
 * so a guest keeps earning it in cloud deployments too — `resolvePlayerId` returns
 * null there, and routing progress through that would have reproduced, for every
 * cloud guest, exactly the bug the auth refactor was written to kill: a report
 * announcing "this run sharpened Compounding, Windfalls…" above a Money Brain
 * reading 0% with every concept locked.
 */
export function resolveProgressId(authUserId: string | null): string {
  if (authUserId && !isGuestId(authUserId)) return authUserId;
  return localPlayerId();
}
