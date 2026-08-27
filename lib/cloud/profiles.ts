import { isCloud, supabase } from "../supabase";
import { generateAvatarSeed, generateFriendCode, generateUsername } from "./generate";
import { checkUsername } from "./profanity";
import type { Profile, PublicProfile } from "./types";

/**
 * Public player identity. Cloud → `profiles` table; dev → namespaced localStorage.
 * Mirrors the hybrid switch in lib/saves.ts. Friend code + avatar seed are
 * generated here; username screening lives in ./profanity, which the database
 * backs with a matching charset CHECK.
 *
 * WHAT IS AND IS NOT READABLE. `profiles` is now select-own-row-only, so
 * `getProfile` / `ensureProfile` / `updateUsername` — all of which operate on the
 * signed-in player's own row — return a full `Profile` with its friend code, and
 * anything about ANOTHER player comes back as a `PublicProfile` from the
 * `profiles_public` view or the `profile_by_friend_code` RPC.
 */

const PROFILE_PREFIX = "lifepatch.profile.";
const MAX_CREATE_ATTEMPTS = 5;

function localKey(userId: string): string {
  return `${PROFILE_PREFIX}${userId}`;
}

/** A row from `profiles` — your own, and the only shape that carries a friend code. */
function fromRow(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    username: String(row.username),
    avatarSeed: String(row.avatar_seed),
    friendCode: String(row.friend_code),
    createdAt: String(row.created_at),
  };
}

/**
 * A row from `profiles_public` or from `profile_by_friend_code`.
 *
 * Separate from `fromRow` on purpose. Running the full mapper over a row that has
 * no `friend_code` does not fail — it produces the STRING "undefined", which then
 * travels as if it were a real code. `createdAt` is optional for the same reason:
 * the RPC returns three columns, and a missing one should read as absent rather
 * than as the word "undefined" on a leaderboard row.
 */
function fromPublicRow(row: Record<string, unknown>): PublicProfile {
  return {
    id: String(row.id),
    username: String(row.username),
    avatarSeed: String(row.avatar_seed),
    createdAt: row.created_at == null ? "" : String(row.created_at),
  };
}

export async function getProfile(userId: string): Promise<Profile | null> {
  if (isCloud && supabase) {
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

  if (isCloud && supabase) {
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

/** Username bounds — also enforced by CHECK constraints in supabase/schema.sql. */
export { USERNAME_MIN, USERNAME_MAX } from "./profanity";

/**
 * Rename the player.
 *
 * Throws with a message meant for the player, rather than truncating. The old code
 * did `slice(0, USERNAME_MAX)`, which silently renamed them to something they had
 * not typed; "that name is too long" is a better answer than a different name.
 */
export async function updateUsername(userId: string, username: string): Promise<Profile> {
  const checked = checkUsername(username);
  if (!checked.ok) throw new Error(checked.message);
  const clean = checked.value;
  if (isCloud && supabase) {
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

/**
 * Resolve a friend code to the player it belongs to.
 *
 * Cloud goes through the `profile_by_friend_code` RPC, not a table filter. The
 * filter used to run against `profiles` under a `using (true)` policy, which meant
 * the same grant that answered this question also answered "give me everyone" —
 * `select=username,friend_code` with the publishable key returned the entire player
 * base and every code in it. The RPC takes a code and returns at most one row with
 * no code in it, so there is nothing to page through and no result that seeds the
 * next lookup.
 *
 * Returns a `PublicProfile`: the caller (`addByCode`) needs the id, and nobody is
 * entitled to a stranger's own-row fields.
 */
export async function getByFriendCode(code: string): Promise<PublicProfile | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  if (isCloud && supabase) {
    const { data, error } = await supabase
      .rpc("profile_by_friend_code", { code: clean })
      .maybeSingle();
    if (error || !data) return null;
    return fromPublicRow(data as Record<string, unknown>);
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

/**
 * Resolve display info for a set of user ids (leaderboard rendering).
 *
 * Reads the `profiles_public` VIEW, never the table. A leaderboard needs a name and
 * an avatar; it has never needed a friend code, and the old `select("*")` against
 * `profiles` was handing one over for every row it drew.
 */
export async function getProfiles(userIds: string[]): Promise<Record<string, PublicProfile>> {
  const unique = Array.from(new Set(userIds));
  const out: Record<string, PublicProfile> = {};
  if (unique.length === 0) return out;
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("profiles_public")
      .select("id,username,avatar_seed,created_at")
      .in("id", unique);
    for (const row of data ?? []) {
      const p = fromPublicRow(row);
      out[p.id] = p;
    }
    return out;
  }
  for (const id of unique) {
    const p = await getProfile(id);
    if (p) out[id] = p;
  }
  return out;
}
