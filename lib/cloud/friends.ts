import { isCloud, supabase } from "../supabase";
import { getByFriendCode } from "./profiles";
import type { FriendEdge, FriendStatus } from "./types";

/**
 * Opt-in friend edges (added by code, never by search). Cloud → `friends` table;
 * dev → namespaced localStorage. Lean for Phase 0: request / accept / list. RLS
 * lets each user write only their own side, so friendship is mutual-accepted.
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

/** Accept an incoming request: mark my own edge to that friend accepted. */
export async function accept(userId: string, friendId: string): Promise<void> {
  if (isCloud && supabase) {
    await supabase
      .from("friends")
      .upsert(
        { user_id: userId, friend_id: friendId, status: "accepted" },
        { onConflict: "user_id,friend_id" },
      );
    return;
  }
  const edges = readLocal(userId);
  const existing = edges.find((e) => e.friendId === friendId);
  const nextEdges: FriendEdge[] = existing
    ? edges.map((e) => (e.friendId === friendId ? { ...e, status: "accepted" } : e))
    : [...edges, { userId, friendId, status: "accepted", createdAt: new Date().toISOString() }];
  writeLocal(userId, nextEdges);
}

/** All edges where I'm the owner or the target (cloud RLS allows both sides). */
export async function listEdges(userId: string): Promise<FriendEdge[]> {
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    return (data ?? []).map(fromRow);
  }
  return readLocal(userId);
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
