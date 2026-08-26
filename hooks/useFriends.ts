"use client";

import { useCallback, useEffect, useState } from "react";
import {
  accept as acceptEdge,
  addByCode,
  decline as declineEdge,
  listEdges,
  partitionEdges,
  removeFriend as removeEdge,
  type AddFriendResult,
  type FriendPartition,
} from "@/lib/cloud/friends";
import { getProfiles } from "@/lib/cloud/profiles";
import type { Profile } from "@/lib/cloud/types";

const EMPTY: FriendPartition = { friends: [], incoming: [], outgoing: [] };

/**
 * The friends list, the requests waiting on me, and the requests waiting on
 * someone else — plus the four things you can do about them.
 *
 * `lib/cloud/friends.ts` has existed since the social layer landed and nothing
 * has ever called `addByCode`. This is the half that was missing: one read of the
 * table per refresh (`listEdges` + `partitionEdges`, not three separate `list*`
 * calls that could disagree with each other), the display names resolved in the
 * same pass, and every mutation followed by a refresh so the three lists move
 * together — accepting a request has to remove a row from one list and add it to
 * another, and doing that optimistically in the panel would be a second copy of
 * the both-edges rule sitting outside the module that owns it.
 *
 * Takes the player id rather than reading `useProfile()` itself. The Leaderboard
 * already holds a profile, and two independent `ensureProfile` calls on one screen
 * is exactly the kind of duplicate the guest guard in `lib/cloud/profiles.ts` was
 * added to stop.
 */
export function useFriends(userId: string | null) {
  const [partition, setPartition] = useState<FriendPartition>(EMPTY);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  /** We asked and were refused. Distinct from an empty list, which is a real state. */
  const [failed, setFailed] = useState(false);
  /**
   * Which control is mid-flight — the target's id, or `"add"` for the code form.
   *
   * Every mutation here is a read-modify-write of one list (a `friends` table
   * scoped to me, or one localStorage key), so two running at once lose an edge.
   * The panel therefore disables all of them while any one is in flight; this is
   * an id rather than a boolean so only the control actually working shows the
   * spinner, instead of all four going busy at once.
   */
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const part = partitionEdges(id, await listEdges(id));
    const ids = [...part.friends, ...part.incoming, ...part.outgoing];
    const profs = ids.length > 0 ? await getProfiles(ids) : {};
    return { part, profs };
  }, []);

  useEffect(() => {
    if (!userId) {
      setPartition(EMPTY);
      setProfiles({});
      setFailed(false);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const { part, profs } = await load(userId);
        if (!active) return;
        setPartition(part);
        setProfiles(profs);
        setFailed(false);
      } catch (err) {
        if (!active) return;
        console.error("useFriends: could not load the friend list", err);
        setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, load]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const { part, profs } = await load(userId);
      setPartition(part);
      setProfiles(profs);
      setFailed(false);
    } catch (err) {
      // Same reading as `useProfile.refresh`: a refresh runs over state that is
      // already correct, so a failure here keeps the last good lists rather than
      // replacing a working panel with an error plate.
      console.error("useFriends: refresh failed; keeping the last good lists", err);
    }
  }, [userId, load]);

  /** Send a request by code. Refreshes on success so the outgoing row appears. */
  const add = useCallback(
    async (code: string): Promise<AddFriendResult> => {
      if (!userId) return { ok: false, reason: "failed" };
      setBusy("add");
      try {
        const res = await addByCode(userId, code);
        if (res.ok) await refresh();
        return res;
      } catch (err) {
        console.error("useFriends: sending the request failed", err);
        return { ok: false, reason: "failed" };
      } finally {
        setBusy(null);
      }
    },
    [userId, refresh],
  );

  const accept = useCallback(
    async (friendId: string): Promise<boolean> => {
      if (!userId) return false;
      setBusy(friendId);
      try {
        const ok = await acceptEdge(userId, friendId);
        if (ok) await refresh();
        return ok;
      } catch (err) {
        // The module's own branches return false rather than throwing, but a
        // rejection from the client library would escape into `void onAccept(id)`
        // in the panel as an unhandled rejection — a failed action that never
        // reaches the sentence explaining it.
        console.error("useFriends: accepting failed", err);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [userId, refresh],
  );

  const decline = useCallback(
    async (requesterId: string): Promise<boolean> => {
      if (!userId) return false;
      setBusy(requesterId);
      try {
        const ok = await declineEdge(userId, requesterId);
        if (ok) await refresh();
        return ok;
      } catch (err) {
        // The module's own branches return false rather than throwing, but a
        // rejection from the client library would escape into `void onAccept(id)`
        // in the panel as an unhandled rejection — a failed action that never
        // reaches the sentence explaining it.
        console.error("useFriends: dismissing failed", err);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [userId, refresh],
  );

  const remove = useCallback(
    async (friendId: string): Promise<boolean> => {
      if (!userId) return false;
      setBusy(friendId);
      try {
        const ok = await removeEdge(userId, friendId);
        if (ok) await refresh();
        return ok;
      } catch (err) {
        // The module's own branches return false rather than throwing, but a
        // rejection from the client library would escape into `void onAccept(id)`
        // in the panel as an unhandled rejection — a failed action that never
        // reaches the sentence explaining it.
        console.error("useFriends: removing failed", err);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [userId, refresh],
  );

  return {
    friends: partition.friends,
    incoming: partition.incoming,
    outgoing: partition.outgoing,
    profiles,
    loading,
    failed,
    busy,
    refresh,
    add,
    accept,
    decline,
    remove,
  };
}
