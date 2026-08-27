import { isCloud, supabase } from "../supabase";
import { getByFriendCode } from "./profiles";
import type { FriendEdge, FriendStatus } from "./types";

/**
 * Opt-in friend edges (added by code, never by search). Cloud → `friends` table;
 * dev → namespaced localStorage. Lean for Phase 0: request / accept / list.
 *
 * MUTUAL BY CONSTRUCTION. The old comment here claimed "RLS lets each user write
 * only their own side, so friendship is mutual-accepted" — the premise was true
 * and the conclusion did not follow. Owning your side says nothing about the
 * `status` you write there, so anyone could insert an `accepted` edge onto any
 * player and be counted by `listFriendIds`, invisibly: `listIncoming` only ever
 * surfaces `pending`, so there was no request to decline. The policies now permit
 * `accepted` only where the reciprocal edge already exists (supabase/schema.sql,
 * "friends - write own side"), which is what actually makes it mutual.
 *
 * A request is an edge them → me; ACCEPTING WRITES THE RECIPROCAL EDGE me → them.
 * That is why `accept` inserts rather than updates.
 */

const PREFIX = "lifepatch.friends.";

/** A uuid and nothing else — see `listEdges`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

function fromRow(row: Record<string, unknown>): FriendEdge {
  return {
    userId: String(row.user_id),
    friendId: String(row.friend_id),
    status: row.status as FriendStatus,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function readLocal(userId: string): FriendEdge[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    return raw ? (JSON.parse(raw) as FriendEdge[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string, edges: FriendEdge[]): void {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(edges));
  } catch {}
}

/**
 * Every locally-stored edge this player is either side of.
 *
 * Dev-mode parity with the cloud's `or(user_id.eq, friend_id.eq)`. `readLocal` is
 * keyed BY OWNER, so it only ever returns edges you wrote — which meant
 * `listIncoming` filtered for `friendId === userId` over a list where that is
 * true only of a self-edge, and therefore reported no incoming requests, ever.
 * A request sent in dev could not be seen, let alone accepted.
 */
function readLocalInvolving(userId: string): FriendEdge[] {
  const mine = readLocal(userId);
  const seen = new Set(mine.map((e) => `${e.userId}>${e.friendId}`));
  const out = [...mine];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX) || key === localKey(userId)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const edges = JSON.parse(raw) as FriendEdge[];
      if (!Array.isArray(edges)) continue;
      for (const e of edges) {
        if (!e || typeof e.userId !== "string" || typeof e.friendId !== "string") continue;
        if (e.friendId !== userId) continue;
        const k = `${e.userId}>${e.friendId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
  } catch {}
  return out;
}

export type AddFriendResult = { ok: boolean; reason?: "not-found" | "self" | "exists" };

/** Send a friend request by code. Creates a pending outgoing edge. */
export async function addByCode(userId: string, code: string): Promise<AddFriendResult> {
  const target = await getByFriendCode(code);
  if (!target) return { ok: false, reason: "not-found" };
  if (target.id === userId) return { ok: false, reason: "self" };

  if (isCloud && supabase) {
    const { error } = await supabase
      .from("friends")
      .insert({ user_id: userId, friend_id: target.id, status: "pending" });
    if (error) return { ok: false, reason: "exists" };
    return { ok: true };
  }
  const edges = readLocal(userId);
  if (edges.some((e) => e.friendId === target.id)) return { ok: false, reason: "exists" };
  writeLocal(userId, [
    ...edges,
    { userId, friendId: target.id, status: "pending", createdAt: new Date().toISOString() },
  ]);
  return { ok: true };
}

/**
 * Accept an incoming request by writing my own accepted edge back to them.
 *
 * An upsert, not an update: there is normally no me → them row to update, because
 * a request is their edge pointing at me. What stops this inventing a friendship
 * out of nothing is the policy, not the verb — the cloud refuses an `accepted`
 * insert unless their edge already exists, and the local branch below now checks
 * the same thing rather than trusting the caller.
 *
 * Returns whether the accept actually happened, instead of swallowing the answer:
 * a refusal is the interesting case and the caller cannot see it otherwise.
 */
export async function accept(userId: string, friendId: string): Promise<boolean> {
  if (isCloud && supabase) {
    const { error } = await supabase
      .from("friends")
      .upsert(
        { user_id: userId, friend_id: friendId, status: "accepted" },
        { onConflict: "user_id,friend_id" },
      );
    // An RLS refusal here means there was no incoming request to accept.
    return !error;
  }
  // Same rule as the policy, so dev and cloud agree about what an accept is.
  const incoming = readLocalInvolving(userId).some(
    (e) => e.userId === friendId && e.friendId === userId,
  );
  if (!incoming) return false;
  const edges = readLocal(userId);
  const existing = edges.find((e) => e.friendId === friendId);
  const nextEdges: FriendEdge[] = existing
    ? edges.map((e) => (e.friendId === friendId ? { ...e, status: "accepted" } : e))
    : [...edges, { userId, friendId, status: "accepted", createdAt: new Date().toISOString() }];
  writeLocal(userId, nextEdges);
  return true;
}

/** All edges where I'm the owner or the target (cloud RLS allows both sides). */
export async function listEdges(userId: string): Promise<FriendEdge[]> {
  if (isCloud && supabase) {
    // `.or()` takes a filter EXPRESSION, not a value, and commas, dots and
    // parentheses are structural inside it. This is the one place in the codebase
    // that builds a query grammar by concatenation. `userId` is auth-derived and a
    // uuid in practice, so it is not exploitable today — it is one careless caller
    // (a device id, a future guest path) away from being so, and a value that
    // cannot be a uuid is structure rather than an id.
    if (!UUID_RE.test(userId)) return [];
    const { data } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    return (data ?? []).map(fromRow);
  }
  return readLocalInvolving(userId);
}

/** Accepted friend ids (either direction counts as friends). */
export async function listFriendIds(userId: string): Promise<string[]> {
  const edges = await listEdges(userId);
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.status !== "accepted") continue;
    ids.add(e.userId === userId ? e.friendId : e.userId);
  }
  return Array.from(ids);
}

/** Incoming pending requests (someone added me, I haven't accepted yet). */
export async function listIncoming(userId: string): Promise<string[]> {
  const edges = await listEdges(userId);
  return edges
    .filter((e) => e.friendId === userId && e.status === "pending")
    .map((e) => e.userId);
}
