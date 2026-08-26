import { isCloud, supabase } from "../supabase";
import { getByFriendCode } from "./profiles";
import type { FriendEdge, FriendStatus } from "./types";

/**
 * Opt-in friend edges (added by code, never by search). Cloud → `friends` table;
 * dev → namespaced localStorage.
 *
 * ── What a friendship is ───────────────────────────────────────────────────
 * An edge means "I want to be connected to you". A FRIENDSHIP is two of them,
 * one in each direction. Nothing else counts, and that structural rule is the
 * consent model — not the `status` column, which is a label on top of it.
 *
 * The old rule was that ONE accepted edge in EITHER direction made you friends,
 * and the old insert policy let a client choose its own `status`. Those two
 * together meant a single request — `{user_id: me, friend_id: anyone, status:
 * "accepted"}` — silently made you someone's friend, with their board and their
 * streak on your Friends tab and nothing at all on theirs. The database now
 * refuses a self-authored edge that is not `pending`; this module refuses to
 * read one edge as a friendship. Either fix alone would close it. Both are here
 * because the client is not the place that decides who your friends are.
 *
 * `status` still earns its place: `pending` on your own edge means you asked and
 * they have not written one back, and `accepted` means you have seen theirs and
 * said yes. It is what the UI reads to tell a request from a friend.
 */

const PREFIX = "lifepatch.friends.";

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
 * Accept an incoming request.
 *
 * Writes MY edge back to them, which is the half that was missing — their
 * request was one edge, and one edge is not a friendship. The `accepted` status
 * is the label; the row existing is the consent.
 *
 * The database only permits `accepted` here because their edge already exists
 * (see the update policy in supabase/schema.sql). If it somehow does not, the
 * upsert is refused and this returns false rather than inventing a friendship.
 */
export async function accept(userId: string, friendId: string): Promise<boolean> {
  if (isCloud && supabase) {
    const { error } = await supabase
      .from("friends")
      .upsert(
        { user_id: userId, friend_id: friendId, status: "accepted" },
        { onConflict: "user_id,friend_id" },
      );
    if (error) {
      console.error("accept: could not accept the friend request", error);
      return false;
    }
    return true;
  }
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
    const { data, error } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    if (error) console.error("listEdges: cloud read failed", error);
    return (data ?? []).map(fromRow);
  }
  return readLocal(userId);
}

/**
 * The two halves of "who is connected to me": people I wrote an edge to, and
 * people who wrote one to me. Every question this module answers is a set
 * operation on these, which is why they are computed in one place.
 */
function sides(userId: string, edges: FriendEdge[]): { mine: Set<string>; theirs: Set<string> } {
  const mine = new Set<string>();
  const theirs = new Set<string>();
  for (const e of edges) {
    if (e.userId === userId) mine.add(e.friendId);
    else if (e.friendId === userId) theirs.add(e.userId);
  }
  return { mine, theirs };
}

/**
 * Friends: the people an edge runs to AND from.
 *
 * Both directions, always. A single edge — whatever status it carries — is a
 * request, not a friendship, because only one person wrote it. This is the read
 * side of the rule the insert policy enforces on the write side; see this file's
 * header for what the old one-edge reading allowed.
 */
export async function listFriendIds(userId: string): Promise<string[]> {
  const { mine, theirs } = sides(userId, await listEdges(userId));
  return [...mine].filter((id) => theirs.has(id));
}

/**
 * Incoming requests: they wrote an edge to me and I have written none back.
 *
 * Keyed on the absence of my edge rather than on their `status`, and that is the
 * fix for a real gap. A request whose sender had already marked their own side
 * `accepted` — which the old insert policy allowed, and which a legacy row can
 * still carry — matched neither the friend list (I never wrote an edge) nor the
 * incoming list (their status was not `pending`). It was invisible from both
 * sides: they were waiting on someone who was never shown the request.
 */
export async function listIncoming(userId: string): Promise<string[]> {
  const { mine, theirs } = sides(userId, await listEdges(userId));
  return [...theirs].filter((id) => !mine.has(id));
}

/** People I have asked who have not written an edge back yet. */
export async function listOutgoing(userId: string): Promise<string[]> {
  const { mine, theirs } = sides(userId, await listEdges(userId));
  return [...mine].filter((id) => !theirs.has(id));
}
