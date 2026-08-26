import { isCloud, supabase } from "../supabase";
import { generateAvatarSeed, generateFriendCode, generateUsername } from "./generate";
import { isGuestId } from "./identity";
import type { FriendCodeMatch, Profile } from "./types";

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

/**
 * What a username may be made of. Mirrors `profiles_username_charset` in
 * supabase/schema.sql — the database is the enforcement, this is the error
 * message.
 *
 * The length bounds were the only rule, and length is not the interesting axis.
 * A username renders on a public leaderboard and inside a 1200x630 share card,
 * where two things unrestricted text buys an attacker are impersonation by
 * homoglyph (a Cyrillic `а` in someone else's name reads identically) and RTL
 * override characters, which reorder the row's other text around them. Every
 * generated name (`brave-otter-421`) passes.
 */
const USERNAME_CHARSET = /^[A-Za-z0-9 _-]+$/;

export async function updateUsername(userId: string, username: string): Promise<Profile> {
  const clean = username.trim().slice(0, USERNAME_MAX);
  if (clean.length < USERNAME_MIN) {
    throw new Error(`Username must be at least ${USERNAME_MIN} characters.`);
  }
  if (!USERNAME_CHARSET.test(clean)) {
    throw new Error("Usernames can use letters, numbers, spaces, hyphens and underscores.");
  }
  if (cloudProfileFor(userId) && supabase) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ username: clean })
      .eq("id", userId)
      .select("*")
      .single();
    // The raw Postgres message names the table, the column and the constraint
    // that rejected it, and this string is shown to the player. A unique
    // violation is the one case worth translating; everything else is a failure
    // they can only retry.
    if (error || !data) {
      if (error?.code === "23505") throw new Error("That username is taken.");
      console.error("updateUsername: cloud update failed", error);
      throw new Error("Could not save that username. Try again in a moment.");
    }
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
 * Whose friend code is this?
 *
 * Through an RPC, not a table read, and that is the whole point. `friend_code`
 * used to be a readable column on a world-readable table, which meant the code
 * was not a secret and "adding by code" had no consent step in it at all — you
 * could walk the table, collect every code (and every `auth.users` id alongside
 * it), and request everyone. `find_by_friend_code` is `security definer`: it
 * answers for ONE code at a time, returns only an id and a username, and cannot
 * be turned into a listing.
 *
 * Not rate-limited, which is worth writing down rather than implying. The code
 * space is 31^6 (about 887 million) over a confusable-free alphabet, so guessing
 * one is not a practical attack, but a determined caller can still make requests
 * as fast as the API allows. Supabase's own limits are the only thing in front of
 * it today.
 */
export async function getByFriendCode(code: string): Promise<FriendCodeMatch | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  if (isCloud && supabase) {
    const { data, error } = await supabase.rpc("find_by_friend_code", { code: clean });
    if (error) {
      console.error("getByFriendCode: lookup failed", error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { id: String(row.id), username: String(row.username) } : null;
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
        return { id: p.id, username: String(p.username ?? "") };
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
    // A function taking the ids, not a table read. This resolves OTHER PEOPLE'S
    // rows, and `profiles` used to be `select using (true)` over a table whose
    // primary key is `auth.users.id` — so anyone could walk it and collect every
    // player's account id and friend code. `profiles_for` answers only for ids
    // the caller already names, which every real caller already has: this one is
    // resolving the names behind a page of leaderboard rows it just fetched.
    const { data, error } = await supabase.rpc("profiles_for", { ids: cloudIds });
    if (error) console.error("getProfiles: cloud read failed", error);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      out[String(row.id)] = {
        id: String(row.id),
        username: String(row.username),
        avatarSeed: String(row.avatar_seed),
        // No friend code and no created_at: the lookup does not carry them, and a
        // leaderboard row has never had a use for either.
        createdAt: "",
      };
    }
  }
  for (const id of isCloud && supabase ? localIds : unique) {
    const p = await getProfile(id);
    if (p) out[id] = p;
  }
  return out;
}
