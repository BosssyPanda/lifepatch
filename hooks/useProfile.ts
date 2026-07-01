"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { resolvePlayerId } from "@/lib/cloud/identity";
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

  // Resolve identity on the client (the device-id fallback needs localStorage).
  useEffect(() => {
    setPlayerId(resolvePlayerId(user?.id ?? null));
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
    const { p, s, m } = await load(playerId);
    setProfile(p);
    setStreak(s);
    setMastery(m);
  }, [playerId, load]);

  const renameUsername = useCallback(
    async (username: string) => {
      if (!playerId) return;
      const updated = await updateUsername(playerId, username);
      setProfile(updated);
    },
    [playerId],
  );

  return { profile, streak, mastery, loading, refresh, renameUsername };
}
