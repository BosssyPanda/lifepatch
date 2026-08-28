"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { resolvePlayerId } from "@/lib/cloud/identity";
import { netWorth, type RunState } from "@/lib/runEngine";
import { isCloud, supabase } from "@/lib/supabase";

/**
 * Resolve the per-run share URL (Addendum §13 #9): once the finished run's
 * result row lands in the cloud (AppShell's submitRunOnce), the share card / QR
 * points at /r/{row-id} so the link unfurls as THIS run's statement. The row id
 * is minted server-side, so we look it up. Insert + lookup race → short poll.
 * Local / anonymous play has no public row → plain origin, same as before.
 *
 * The row used to be found by `(user_id, mode, score)`, which is not a key: two
 * runs of one mode that end on the same net worth are the same row to that query,
 * and the newer one silently stole the older one's link. A run's seed IS unique to
 * it, so rows that carry one are found by seed instead. Rows written before the
 * seed was recorded still fall back to the score match — the old behaviour, kept
 * for them rather than losing their links entirely.
 */

const ATTEMPTS = 5;
const RETRY_MS = 1200;

export function useShareUrl(run: RunState): string {
  return useShareUrlFor(run.mode, netWorth(run), run.seed);
}

/**
 * The mode-agnostic form. The Rat Race recap has no `RunState`, and no seed to key
 * on, so it resolves its statement URL through this directly and falls back to the
 * score match.
 */
export function useShareUrlFor(mode: string, score: number, seed?: number): string {
  const auth = useAuth();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://lifepatch.app";
  const [url, setUrl] = useState(origin);

  const playerId = resolvePlayerId(auth.user?.id ?? null);

  useEffect(() => {
    if (!isCloud || !supabase || !playerId) return;
    let cancelled = false;
    // The retry has to be cancellable, not just its callback. `cancelled` is only
    // read after the await, and the timer that schedules the next attempt was
    // never cleared — so leaving the report mid-poll fired the remaining attempts
    // anyway, several seconds of queries on behalf of a component that is gone.
    let timer: ReturnType<typeof setTimeout> | null = null;

    const lookup = async (attempt: number): Promise<void> => {
      if (cancelled) return;
      let q = supabase!
        .from("results")
        .select("id")
        .eq("user_id", playerId)
        .eq("mode", mode);
      // `metrics->>seed` is Postgres' own text arrow, which PostgREST exposes as a
      // filterable column — no migration, no new column.
      q = seed === undefined ? q.eq("score", score) : q.eq("metrics->>seed", String(seed));
      const { data } = await q.order("created_at", { ascending: false }).limit(1);
      if (cancelled) return;
      const id = data?.[0]?.id;
      if (id) {
        setUrl(`${origin}/r/${id}`);
        return;
      }
      if (attempt < ATTEMPTS) timer = setTimeout(() => void lookup(attempt + 1), RETRY_MS);
    };

    void lookup(1);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [playerId, mode, score, seed, origin]);

  return url;
}
