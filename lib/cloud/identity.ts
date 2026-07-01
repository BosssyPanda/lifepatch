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
 * The id to attribute results/streaks to.
 * - Signed-in → the auth user id (works in cloud + dev).
 * - Anonymous → a device id in dev; null in cloud, where RLS requires a real
 *   auth user, so callers should prompt sign-in instead of writing.
 */
export function resolvePlayerId(authUserId: string | null): string | null {
  if (authUserId) return authUserId;
  return isCloud ? null : localPlayerId();
}
