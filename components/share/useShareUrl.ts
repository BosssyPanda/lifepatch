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
 * is minted server-side, so we look it up: own newest row for this mode whose
 * score matches the run's net worth exactly. Insert + lookup race → short poll.
 * Local / anonymous play has no public row → plain origin, same as before.
 */

const ATTEMPTS = 5;
const RETRY_MS = 1200;

export function useShareUrl(run: RunState): string {
  return useShareUrlFor(run.mode, netWorth(run));
}

/**
 * The mode-agnostic form. The Rat Race recap has no `RunState` — its result row is
 * keyed on passive income — so it resolves its statement URL through this directly.
 */
export function useShareUrlFor(mode: string, score: number): string {
  const auth = useAuth();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://lifepatch.app";
  const [url, setUrl] = useState(origin);

  const playerId = resolvePlayerId(auth.user?.id ?? null);

  useEffect(() => {
    if (!isCloud || !supabase || !playerId) return;
    let cancelled = false;

    const lookup = async (attempt: number): Promise<void> => {
      const { data } = await supabase!
        .from("results")
        .select("id")
        .eq("user_id", playerId)
        .eq("mode", mode)
        .eq("score", score)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const id = data?.[0]?.id;
      if (id) {
        setUrl(`${origin}/r/${id}`);
        return;
      }
      if (attempt < ATTEMPTS) setTimeout(() => void lookup(attempt + 1), RETRY_MS);
    };

    void lookup(1);
    return () => {
      cancelled = true;
    };
  }, [playerId, mode, score, origin]);

  return url;
}
