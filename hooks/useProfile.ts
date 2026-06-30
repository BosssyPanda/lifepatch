"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { ensureProfile, updateUsername } from "@/lib/cloud/profiles";
import { getStreak } from "@/lib/cloud/streaks";
import { getMastery } from "@/lib/cloud/mastery";
import type { MasteryRow, Profile, Streak } from "@/lib/cloud/types";

/**
 * The signed-in player's public profile + streak + mastery, keyed off useAuth().
 * Works fully offline in dev (localStorage) and upgrades to Supabase when keys
 * land — no call-site change. Result/streak submission on run-end is wired by
 * gameplay hooks (useCashflow, report screens) that call lib/cloud directly.
 */
export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [mastery, setMastery] = useState<MasteryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (userId: string) => {
    const [p, s, m] = await Promise.all([
      ensureProfile(userId),
      getStreak(userId),
      getMastery(userId),
    ]);
    return { p, s, m };
  }, []);

  useEffect(() => {
    if (!user) {
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
        const { p, s, m } = await load(user.id);
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
  }, [user, load]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { p, s, m } = await load(user.id);
    setProfile(p);
    setStreak(s);
    setMastery(m);
  }, [user, load]);

  const renameUsername = useCallback(
    async (username: string) => {
      if (!user) return;
      const updated = await updateUsername(user.id, username);
      setProfile(updated);
    },
    [user],
  );

  return { profile, streak, mastery, loading, refresh, renameUsername };
}
