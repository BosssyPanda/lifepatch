"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { resolvePlayerId, resolveProgressId } from "@/lib/cloud/identity";
import { ensureProfile, updateUsername } from "@/lib/cloud/profiles";
import { getStreak } from "@/lib/cloud/streaks";
import { getMastery } from "@/lib/cloud/mastery";
import type { MasteryRow, Profile, Streak } from "@/lib/cloud/types";

/**
 * The current player's public profile + streak + mastery. Keyed off the resolved
 * player id (auth user when signed in, else a device id in dev), so the social
 * layer is live for everyone offline and upgrades to real accounts in the cloud.
 * Run-end result/streak submission is done by gameplay hooks calling lib/cloud.
 */
export function useProfile() {
  const { user } = useAuth();
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [mastery, setMastery] = useState<MasteryRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** The load rejected. Distinct from `loading` and from a null `profile`: it means
   *  we asked and were refused, which is a different sentence on screen. */
  const [failed, setFailed] = useState(false);

  // Resolve identity on the client (the device-id fallback needs localStorage).
  useEffect(() => {
    setPlayerId(resolveProgressId(user?.id ?? null));
  }, [user]);

  const load = useCallback(async (id: string) => {
    const [p, s, m] = await Promise.all([
      ensureProfile(id),
      getStreak(id),
      getMastery(id),
    ]);
    return { p, s, m };
  }, []);

  useEffect(() => {
    if (!playerId) {
      setProfile(null);
      setStreak(null);
      setMastery([]);
      setFailed(false);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const { p, s, m } = await load(playerId);
        if (!active) return;
        setProfile(p);
        setStreak(s);
        setMastery(m);
        setFailed(false);
      } catch (err) {
        // This had `finally` and no `catch`, so any rejection from the three
        // loaders became an unhandled promise rejection and `profile` stayed null
        // for the session with nothing on screen saying why. `ensureProfile` can
        // still legitimately fail — a real collision, or the cloud being down —
        // and the social strip needs to render a degraded state rather than a lie.
        if (!active) return;
        console.error("useProfile: could not load the player's profile", err);
        setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [playerId, load]);

  const refresh = useCallback(async () => {
    if (!playerId) return;
    try {
      const { p, s, m } = await load(playerId);
      setProfile(p);
      setStreak(s);
      setMastery(m);
      setFailed(false);
    } catch (err) {
      console.error("useProfile: refresh failed", err);
      setFailed(true);
    }
  }, [playerId, load]);

  const renameUsername = useCallback(
    async (username: string) => {
      if (!playerId) return;
      const updated = await updateUsername(playerId, username);
      setProfile(updated);
    },
    [playerId],
  );

  return { profile, streak, mastery, loading, failed, refresh, renameUsername };
}
