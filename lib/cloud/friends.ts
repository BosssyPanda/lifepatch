import { isCloud, supabase } from "../supabase";
import { isGuestId } from "./identity";
import { getByFriendCode } from "./profiles";
import type { FriendEdge, FriendStatus } from "./types";

/**
 * Opt-in friend edges (added by code, never by search). Cloud → `friends` table;
 * dev → one localStorage key holding the same edge list (see `STORE_KEY`).
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

/**
 * One key for every edge, not one bucket per player — and that is a fix, not a
 * style choice.
 *
 * The old shape was `lifepatch.friends.<userId>`, a private bucket per player,
 * and it could not represent a friend request at all: `addByCode` wrote the edge
 * into the ASKER's bucket, and the person being asked reads their own, so the
 * request was invisible to the only person who could answer it. Nothing had ever
 * noticed because no caller existed — `addByCode` and `accept` were dead code
 * until the panel that ships with this change, and `listFriendIds` (the one live
 * reader) can only ever have returned an empty list.
 *
 * The cloud branch has one shared `friends` table and asks "am I either endpoint",
 * which is exactly what the read policy allows. This is that, in localStorage: one
 * list, filtered the same way. Nothing to migrate — the per-player key was never
 * written by anything.
 */
const STORE_KEY = "lifepatch.friends";

/**
 * Does this player have cloud friend edges to read or write?
 *
 * The same gate `lib/cloud/profiles.ts`, `mastery.ts` and `streaks.ts` already
 * draw, and it was missing here. A guest is `device-…`, which is not a uuid, so
 * `.or("user_id.eq.device-abc,…")` is not a predicate that matches nothing — it
 * is malformed input for type uuid and Postgres rejects the whole statement. Every
 * open of the Leaderboard's Friends tab as a cloud guest logged a failure and
 * returned an empty list that looked exactly like "you have no friends yet".
 *
 * `find_by_friend_code` is granted to `authenticated` alone (see supabase/schema.sql),
 * so a guest could not resolve a code either. Their edges live on the device, which
 * is where their profile and friend code already live.
 */
function cloudFriendsFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}

/**
 * Can this player have friends at all, or do they need an account first?
 *
 * The inverse of `cloudFriendsFor`, and deliberately not `isGuestId` on its own.
 * A guest in a build with no Supabase keys is the ONLY player there is — their
 * profile, their friend code and their edges all live in localStorage and the
 * whole feature works. A guest in a cloud deployment is a different thing: the
 * table is keyed on `auth.uid()` and their friend code exists in one browser, so
 * a code they hand out resolves for nobody. The panel says so rather than
 * offering a form that cannot work.
 */
export function friendsNeedAccount(userId: string): boolean {
  return Boolean(isCloud && isGuestId(userId));
}

function fromRow(row: Record<string, unknown>): FriendEdge {
  return {
    userId: String(row.user_id),
    friendId: String(row.friend_id),
    status: row.status as FriendStatus,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function readAll(): FriendEdge[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    // Shape-guarded, because a corrupted key must not produce edges whose
    // endpoints are `undefined` — those would match every `!mine.has(id)` test in
    // `partitionEdges` and render as a request from nobody.
    return Array.isArray(parsed)
      ? (parsed.filter(
          (e) =>
            !!e &&
            typeof (e as FriendEdge).userId === "string" &&
            typeof (e as FriendEdge).friendId === "string",
        ) as FriendEdge[])
      : [];
  } catch {
    return [];
  }
}

function writeAll(edges: FriendEdge[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(edges));
  } catch {}
}

/** Everything except the one edge `user → friend`. The local delete primitive. */
function without(edges: FriendEdge[], userId: string, friendId: string): FriendEdge[] {
  return edges.filter((e) => !(e.userId === userId && e.friendId === friendId));
}

export type AddFriendResult =
  /** Sent. `username` so the confirmation can name who it went to — a six-glyph
   *  code typed off a screenshot is exactly the kind of thing that goes to the
   *  wrong person, and "sent" alone gives the sender no way to notice. */
  | { ok: true; username: string }
  | { ok: false; reason: "not-found" | "self" | "exists" | "failed" };

/** Send a friend request by code. Creates a pending outgoing edge. */
export async function addByCode(userId: string, code: string): Promise<AddFriendResult> {
  const target = await getByFriendCode(code);
  if (!target) return { ok: false, reason: "not-found" };
  if (target.id === userId) return { ok: false, reason: "self" };

  if (cloudFriendsFor(userId) && supabase) {
    const { error } = await supabase
      .from("friends")
      .insert({ user_id: userId, friend_id: target.id, status: "pending" });
    // 23505 is the primary key: an edge to this person already exists, which is
    // the ordinary "you already asked" and not a failure. Anything else IS one,
    // and reporting it as "exists" told the sender their request was already on
    // its way when in fact nothing had been written at all.
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "exists" };
      console.error("addByCode: could not send the request", error);
      return { ok: false, reason: "failed" };
    }
    return { ok: true, username: target.username };
  }
  const edges = readAll();
  if (edges.some((e) => e.userId === userId && e.friendId === target.id)) {
    return { ok: false, reason: "exists" };
  }
  writeAll([
    ...edges,
    { userId, friendId: target.id, status: "pending", createdAt: new Date().toISOString() },
  ]);
  return { ok: true, username: target.username };
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
  if (cloudFriendsFor(userId) && supabase) {
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
  const edges = readAll();
  const isMine = (e: FriendEdge) => e.userId === userId && e.friendId === friendId;
  writeAll(
    edges.some(isMine)
      ? edges.map((e) => (isMine(e) ? { ...e, status: "accepted" } : e))
      : [...edges, { userId, friendId, status: "accepted", createdAt: new Date().toISOString() }],
  );
  return true;
}

/**
 * Dismiss a request somebody sent me.
 *
 * Deletes THEIR edge, which is the only row involved: I never wrote one, and
 * writing one now is what accepting means. The row-level policy permits deleting
 * an edge you are the target of precisely so this exists — a request with no
 * response other than "accept" is a demand.
 *
 * A dismiss, not a block. Nothing stops them asking again, and the UI says so
 * rather than implying a protection this schema does not have.
 */
export async function decline(userId: string, requesterId: string): Promise<boolean> {
  if (cloudFriendsFor(userId) && supabase) {
    const { error } = await supabase
      .from("friends")
      .delete()
      .eq("user_id", requesterId)
      .eq("friend_id", userId);
    if (error) {
      console.error("decline: could not dismiss the request", error);
      return false;
    }
    return true;
  }
  writeAll(without(readAll(), requesterId, userId));
  return true;
}

/**
 * Remove a friend, in both directions.
 *
 * A friendship is two edges (see the header), so deleting only mine would end it
 * — and leave theirs standing, which `listIncoming` would immediately re-present
 * as a brand-new request from the person I had just removed. Both rows go.
 */
export async function removeFriend(userId: string, friendId: string): Promise<boolean> {
  if (cloudFriendsFor(userId) && supabase) {
    const { error } = await supabase
      .from("friends")
      .delete()
      .or(
        `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`,
      );
    if (error) {
      console.error("removeFriend: could not remove the friendship", error);
      return false;
    }
    return true;
  }
  writeAll(without(without(readAll(), userId, friendId), friendId, userId));
  return true;
}

/** All edges where I'm the owner or the target (cloud RLS allows both sides). */
export async function listEdges(userId: string): Promise<FriendEdge[]> {
  if (cloudFriendsFor(userId) && supabase) {
    const { data, error } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    if (error) console.error("listEdges: cloud read failed", error);
    return (data ?? []).map(fromRow);
  }
  // The same predicate the cloud read policy allows: either endpoint is me.
  return readAll().filter((e) => e.userId === userId || e.friendId === userId);
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

/** The three lists a Friends panel renders, from one read of the table. */
export type FriendPartition = {
  /** An edge runs to them AND from them. */
  friends: string[];
  /** They wrote one to me and I have written none back. */
  incoming: string[];
  /** I wrote one to them and they have written none back. */
  outgoing: string[];
};

/**
 * Split my edges into the three states, in one pass.
 *
 * Pure, and exported, because the panel needs all three at once and the three
 * `list*` helpers below each perform their own `listEdges` round trip — asking
 * them in sequence is three reads of one table, and worse, three reads that can
 * disagree with each other if a request lands between them. The rule itself is
 * still written exactly once: those helpers now call this.
 */
export function partitionEdges(userId: string, edges: FriendEdge[]): FriendPartition {
  const { mine, theirs } = sides(userId, edges);
  return {
    friends: [...mine].filter((id) => theirs.has(id)),
    incoming: [...theirs].filter((id) => !mine.has(id)),
    outgoing: [...mine].filter((id) => !theirs.has(id)),
  };
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
  return partitionEdges(userId, await listEdges(userId)).friends;
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
  return partitionEdges(userId, await listEdges(userId)).incoming;
}

/** People I have asked who have not written an edge back yet. */
export async function listOutgoing(userId: string): Promise<string[]> {
  return partitionEdges(userId, await listEdges(userId)).outgoing;
}
