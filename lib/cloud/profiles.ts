import { isCloud, supabase } from "../supabase";
import { isGuestId } from "./identity";
// `@/supabase/...` is the repository directory, not `lib/supabase.ts` above. Both
// files live under the Edge Function's `_shared` directory because the `profile`
// function imports them and Deno can only follow relative paths inside
// `supabase/functions`; their own headers carry the full reasoning.
import { generateAvatarSeed, generateFriendCode, generateUsername } from "@/supabase/functions/_shared/generate";
import { checkUsername } from "@/supabase/functions/_shared/username";
import type { Profile, PublicProfile } from "./types";

/**
 * Public player identity. Cloud → `profiles` table; dev → namespaced localStorage.
 * Mirrors the hybrid switch in lib/saves.ts.
 *
 * WHO WRITES THIS TABLE. Not this file, in the cloud — the `profile` Edge Function
 * does. Username screening used to run only here, in the browser, which is not
 * where the write happens: `profiles` was written straight to PostgREST under a
 * policy asserting `auth.uid() = id` and nothing about the value, so a PATCH (or,
 * more easily, the INSERT at signup) put any string on the public leaderboard. The
 * function runs the same `checkUsername` this file does — literally the same
 * module, not a second copy — and mints the friend code, which a client must never
 * choose for itself. `2026-08-28_05_username_gate.sql` is what takes the direct
 * write away; see `fromFunction` for what happens before it is applied.
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

/**
 * Is this player's profile a cloud row, or a device-local one?
 *
 * The same predicate `lib/saves.ts` uses, and it was missing here. `useProfile`
 * resolves its id with `resolveProgressId`, which hands a GUEST a `device-…` id on
 * purpose — mastery has to keep working without an account. That id then went
 * straight into `.eq("id", …)` and `.insert({ id: … })` against a `uuid` column,
 * so on any cloud deployment every guest spent five failed round trips per mount
 * and `ensureProfile` finished by throwing into an IIFE that had no catch. Guests
 * belong on the local branch, and now that the cloud branch calls an Edge Function
 * that requires a signed-in JWT, sending them down it would be worse than wrong.
 */
function cloudProfileFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

/**
 * The `profile` Edge Function, which is the only writer of this table.
 *
 * Returns the row on success, and THROWS the function's own sentence on a refusal
 * — the player must see the same words whether the browser caught the name or the
 * server did, which is the property a second implementation would have destroyed.
 *
 * Returns null in exactly one case: the function could not be reached at all (not
 * deployed on this project, or the request never landed). The caller then takes
 * the direct write, which still works until `2026-08-28_05_username_gate.sql` is
 * applied and cannot work after. That is deliberate, and it is the same reasoning
 * `getProfiles` states below: ordering a code deploy against a hand-run migration
 * is a coordination problem, and not needing the ordering beats getting it right.
 * It is also not a hole — an attacker was never going to route through this file
 * anyway; the grant is the thing that stops them, and 05 is the grant.
 */
async function fromFunction(body: Record<string, unknown>): Promise<Profile | null> {
  const { data, error, response } = await supabase!.functions.invoke("profile", { body });
  if (!error) {
    const row = (data as { profile?: Record<string, unknown> } | null)?.profile;
    return row ? fromRow(row) : null;
  }
  // No response at all ⇒ never reached the function. 404 ⇒ not deployed here yet.
  const status = response?.status ?? 0;
  if (status === 0 || status === 404) return null;
  let message = "Could not save that. Try again in a moment.";
  try {
    // Not `body` — that is this function's own parameter, and shadowing it here
    // would be the same trap `advanceYear` had with `record`.
    const payload = (await response!.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error) message = payload.error;
  } catch {}
  throw new Error(message);
}

export async function getProfile(userId: string): Promise<Profile | null> {
  if (cloudProfileFor(userId)) {
    const { data } = await supabase!.from("profiles").select("*").eq("id", userId).maybeSingle();
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

  if (cloudProfileFor(userId)) {
    const made = await fromFunction({ action: "ensure" });
    if (made) return made;
    // The function is not deployed on this project yet. See `fromFunction`.
    // Retry to dodge username/friend_code unique-constraint collisions.
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const candidate = {
        id: userId,
        username: generateUsername(),
        avatar_seed: generateAvatarSeed(),
        friend_code: generateFriendCode(),
      };
      const { data, error } = await supabase!.from("profiles").insert(candidate).select("*").single();
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
export { USERNAME_MIN, USERNAME_MAX } from "@/supabase/functions/_shared/username";

/**
 * Rename the player.
 *
 * Throws with a message meant for the player, rather than truncating. The old code
 * did `slice(0, USERNAME_MAX)`, which silently renamed them to something they had
 * not typed; "that name is too long" is a better answer than a different name.
 *
 * The check below is not made redundant by the one in the Edge Function. It is the
 * same module, so the two cannot disagree, and running it here answers the player
 * without a round trip — the server copy exists because the browser is skippable,
 * not because this one is wrong.
 */
export async function updateUsername(userId: string, username: string): Promise<Profile> {
  const checked = checkUsername(username);
  if (!checked.ok) throw new Error(checked.message);
  const clean = checked.value;
  if (cloudProfileFor(userId)) {
    const renamed = await fromFunction({ action: "rename", username: clean });
    if (renamed) return renamed;
    // The function is not deployed on this project yet. See `fromFunction`.
    const { data, error } = await supabase!
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
    const { data, error } = await supabase
      .from("profiles_public")
      .select("id,username,avatar_seed,created_at")
      .in("id", unique);
    if (!error) {
      for (const row of data ?? []) {
        const p = fromPublicRow(row);
        out[p.id] = p;
      }
      return out;
    }
    /**
     * The view does not exist yet.
     *
     * `profiles_public` is created by migration 01 and read by this build, so the
     * two have to meet — and a deploy that lands first would otherwise draw a
     * leaderboard of blank names with nothing anywhere the player could see saying
     * why, because the error was being discarded. Ordering a code deploy against a
     * hand-run migration is a coordination problem; not needing the ordering is
     * better than getting it right.
     *
     * The fallback names the four public columns rather than `select("*")`, so it
     * cannot reproduce the friend-code leak the view exists to close, whichever
     * order the two actually land in. Once migration 02 lands, `profiles` narrows
     * to the reader's own row — but by then the view exists, the branch above
     * returns, and this one is unreachable.
     */
    const { data: base } = await supabase
      .from("profiles")
      .select("id,username,avatar_seed,created_at")
      .in("id", unique);
    for (const row of base ?? []) {
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
