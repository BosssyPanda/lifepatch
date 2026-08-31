"use client";

import { useEffect, useState } from "react";
import { LedgerRow } from "@/components/ui/report";
import { useAuth } from "@/hooks/useAuth";
import { resolveProgressId } from "@/lib/cloud/identity";
import { myBest } from "@/lib/cloud/results";
import type { GameMode } from "@/lib/cloud/types";
import { currency } from "@/lib/format";
import { bestLabel } from "@/lib/scoreLabel";

/**
 * The player's record for this mode, printed on the statement that just set or
 * missed it.
 *
 * `myBest` was written with real care — a five-row window rather than `.limit(1)`,
 * so an unrankable row sorting above every real score cannot make a player look
 * like they have no best run — and it had no callers at all. A finished run is the
 * one moment a personal best is worth reading, and "their personal best" is one of
 * the three things the guest-identity fix restored, so this is where the claim gets
 * to be true rather than a function nobody calls.
 *
 * RESOLVED THE WAY THE SUBMIT RESOLVES IT — `resolveProgressId` — so a guest reads
 * the device list they are now writing to, and a signed-in player reads the cloud.
 *
 * THE RACE IS DESIGNED OUT, not waited out. This mounts in the same commit that
 * fires `submitRunOnce`, so the fetch may or may not already include the run on
 * screen. `Math.max` makes the FIGURE identical either way, and `>=` makes the
 * "this run" mark identical either way: if the row landed first the fetched best
 * equals this score, and if it did not it is strictly below. No poll, no flicker.
 */
export function PersonalBestRow({ mode, score }: { mode: GameMode; score: number }) {
  const { user } = useAuth();
  const [prev, setPrev] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    // An unrankable score has no honest comparison to draw — the same test the
    // board and the cap apply before letting a number stand for a run.
    if (!Number.isFinite(score)) return;
    let active = true;
    void (async () => {
      try {
        const row = await myBest(resolveProgressId(user?.id ?? null), mode);
        if (active) setPrev(row ? row.score : null);
      } catch {
        // Nothing on this statement depends on the record being reachable, and a
        // `void`-ed rejection has nobody left to tell. Print no row rather than a
        // number this device could not actually read.
        if (active) setPrev(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, mode, score]);

  // Unresolved — still fetching, or a read that failed — holds the row's height
  // rather than returning null. `StreakChip` settled this question already: a row
  // that appears late shoves everything under it down, and on this screen that is
  // the chart. An invisible copy of itself costs one row of blank statement and
  // shifts nothing, in either direction.
  if (prev === undefined || !Number.isFinite(score)) {
    return (
      <div aria-hidden className="invisible">
        <LedgerRow label={bestLabel(mode)} size="0.95rem" value="—" />
      </div>
    );
  }

  const best = Math.max(prev ?? score, score);
  const isThisRun = score >= (prev ?? score);

  return (
    <LedgerRow
      label={bestLabel(mode)}
      size="0.95rem"
      tone={isThisRun ? "text-gain" : "text-ink"}
      value={
        <>
          {currency(best)}
          {isThisRun && <span className="ml-1.5 text-[0.72em] text-secondary">· this run</span>}
        </>
      }
    />
  );
}
