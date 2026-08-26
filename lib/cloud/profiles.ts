import { isCloud, supabase } from "../supabase";
import { generateAvatarSeed, generateFriendCode, generateUsername } from "./generate";
import { isGuestId } from "./identity";
import type { Profile } from "./types";

/**
 * Public player identity. Cloud → `profiles` table; dev → namespaced localStorage.
 * Mirrors the hybrid switch in lib/saves.ts. Friend code + avatar seed are
 * generated here; username editing/profanity screening lands in Phase 2.
 */

const PROFILE_PREFIX = "lifepatch.profile.";
const MAX_CREATE_ATTEMPTS = 5;

/**
 * Does this player have a cloud profile to read or write?
 *
 * A guest is the anonymous device id (`device-…`) with no auth session behind it.
 * `profiles` is row-level-secured on `auth.uid()`, and a `device-…` string is not
 * even a uuid, so every cloud call for a guest is refused twice over. Without this
 * gate `ensureProfile` spent all five of its attempts on inserts that could never
 * land, re-read after each one, and then THREW — into `useProfile`'s effect, which
 * had no catch. The result was ten guaranteed-failing requests and a permanently
 * null profile on every guest page load in a cloud deployment.
 *
 * `lib/cloud/mastery.ts` and `lib/saves.ts` already draw this exact line; this is
 * the same rule, finally applied to the table that needed it most.
 */
function cloudProfileFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

function localKey(userId: string): string {
  return `${PROFILE_PREFIX}${userId}`;
}

function fromRow(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    username: String(row.username),
    avatarSeed: String(row.avatar_seed),
    friendCode: String(row.friend_code),
    createdAt: String(row.created_at),
  };
}

export async function getProfile(userId: string): Promise<Profile | null> {
  if (cloudProfileFor(userId) && supabase) {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    return data ? fromRow(data) : null;
  }
  try {
    const raw = localStorage.getItem(localKey(userId));
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

/** Get-or-create the player's public profile. Idempotent. */
export async function ensureProfile(userId: string): Promise<Profile> {
  const existing = await getProfile(userId);
  if (existing) return existing;

  if (cloudProfileFor(userId) && supabase) {
    // Retry to dodge username/friend_code unique-constraint collisions.
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const candidate = {
        id: userId,
        username: generateUsername(),
        avatar_seed: generateAvatarSeed(),
        friend_code: generateFriendCode(),
      };
      const { data, error } = await supabase.from("profiles").insert(candidate).select("*").single();
      if (!error && data) return fromRow(data);
      // A concurrent insert may have won — re-read before retrying.
      const reread = await getProfile(userId);
      if (reread) return reread;
    }
    throw new Error("Could not create profile after multiple attempts");
  }

  const profile: Profile = {
    id: userId,
    username: generateUsername(),
    avatarSeed: generateAvatarSeed(),
    friendCode: generateFriendCode(),
    createdAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(profile));
  } catch {}
  return profile;
}

/** Username bounds — also enforced by a CHECK constraint in supabase/schema.sql. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

export async function updateUsername(userId: string, username: string): Promise<Profile> {
  const clean = username.trim().slice(0, USERNAME_MAX);
  if (clean.length < USERNAME_MIN) {
    throw new Error(`Username must be at least ${USERNAME_MIN} characters.`);
  }
  if (cloudProfileFor(userId) && supabase) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ username: clean })
      .eq("id", userId)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Username update failed");
    return fromRow(data);
  }
  const existing = await getProfile(userId);
  if (!existing) throw new Error("No profile to update");
  const updated: Profile = { ...existing, username: clean };
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(updated));
  } catch {}
  return updated;
}

export async function getByFriendCode(code: string): Promise<Profile | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("friend_code", clean)
      .maybeSingle();
    return data ? fromRow(data) : null;
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROFILE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const p = JSON.parse(raw) as Partial<Profile>;
      // Shape-guard: a stale/corrupted key must not yield a phantom Profile whose
      // fields are undefined (which would create an edge with friend_id "undefined").
      if (p && typeof p.id === "string" && typeof p.friendCode === "string" && p.friendCode === clean) {
        return p as Profile;
      }
    }
  } catch {}
  return null;
}

/** Resolve display info for a set of user ids (leaderboard rendering). */
export async function getProfiles(userIds: string[]): Promise<Record<string, Profile>> {
  const unique = Array.from(new Set(userIds));
  const out: Record<string, Profile> = {};
  if (unique.length === 0) return out;

  // Guest ids are `device-…`, not uuids. Passing one to `.in("id", …)` does not
  // merely fail to match it — Postgres rejects the whole predicate as malformed
  // input for type uuid, so ONE guest id in the list returns zero profiles and the
  // entire leaderboard renders as "anonymous". They are split out and resolved on
  // the device, which is the only place a guest profile has ever existed.
  const cloudIds = unique.filter((id) => !isGuestId(id));
  const localIds = unique.filter((id) => isGuestId(id));

  if (isCloud && supabase && cloudIds.length > 0) {
    const { data, error } = await supabase.from("profiles").select("*").in("id", cloudIds);
    if (error) console.error("getProfiles: cloud read failed", error);
    for (const row of data ?? []) {
      const p = fromRow(row);
      out[p.id] = p;
    }
  }
  for (const id of isCloud && supabase ? localIds : unique) {
    const p = await getProfile(id);
    if (p) out[id] = p;
  }
  return out;
}
