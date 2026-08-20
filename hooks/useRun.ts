"use client";

import { useCallback, useRef, useState } from "react";
import type { ModeId } from "@/lib/modes";
import {
  advanceYear,
  applyLifeChoice,
  initRun,
  isCompatibleSave,
  payDebt,
  quitRun,
  retire,
  trade,
  type RunState,
} from "@/lib/runEngine";
import { saveRun } from "@/lib/saves";
import { loadMatch, saveMatch } from "@/lib/mp/matchStore";
import type { AssetId } from "@/lib/markets";
import type { LifeChoice } from "@/lib/lifeEvents";

export type Phase = "intro" | "mode" | "auth" | "setup" | "run" | "recap" | "report" | "lobby" | "podium";

/**
 * Extras for a "with friends" run. Absent — which is every solo start — the run
 * behaves exactly as it always has: its own random seed, its own save slot, the
 * cinematic recap on the way out.
 */
export type RunOpts = {
  /** The room's shared world. Every player in a match starts from this number. */
  seed?: number;
  /** Set for a match run: routes persistence to the room's store, ending to the podium. */
  matchCode?: string;
  /** Whose seat this run is. The room's store stamps it so a rejoin can't resume
   *  a record another player on this device wrote (`lib/mp/matchStore.ts`). */
  matchPlayerId?: string;
};

export function useRun(userId: string | null) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [mode, setMode] = useState<ModeId | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [saving, setSaving] = useState(false);
  /** The room this run belongs to, or null for a solo run. */
  const matchCodeRef = useRef<string | null>(null);
  /** Our player id inside that room — the owner stamp on every match save. */
  const matchPlayerIdRef = useRef<string | null>(null);

  const persist = useCallback(
    async (r: RunState) => {
      const code = matchCodeRef.current;
      const playerId = matchPlayerIdRef.current;
      // The room code alone decides this branch: a match run must never fall
      // through to the solo store just because its owner id is missing.
      if (code) {
        // A match run must NEVER reach `lib/saves.ts`. That store is keyed
        // (user_id, mode) and a match run is still `mode: "story"`, so routing one
        // through it would overwrite the player's own story save with a run they
        // were handed the host's background and seed for. The room keeps its own
        // localStorage namespace instead.
        //
        // The config comes from the record `useMatch` writes on each advance; until
        // that first write lands — or while the record on that key belongs to
        // another player on this device — there is nothing to key a room save by,
        // and the write is simply skipped (the run is one advance away from being
        // saved anyway, and a rejoin can always rebuild it from the shared seed).
        if (!playerId) return;
        const cfg = loadMatch(code, playerId)?.config;
        if (cfg) saveMatch(code, playerId, cfg, r);
        return;
      }
      if (!userId) return;
      setSaving(true);
      try {
        await saveRun(userId, r.mode, r);
      } finally {
        setSaving(false);
      }
    },
    [userId],
  );

  // local mutation (no save) — used for trades within a year
  const mutate = useCallback((fn: (s: RunState) => RunState) => {
    setRun((prev) => (prev ? fn(prev) : prev));
  }, []);

  // mutation that also persists + may end the run
  const commit = useCallback(
    (fn: (s: RunState) => RunState) => {
      setRun((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        // A match run goes to the room's podium first — the standings are the point,
        // and the player's own cinematic recap is one tap away from there.
        if (next.status === "ended") setPhase(matchCodeRef.current ? "podium" : "recap");
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  return {
    phase,
    mode,
    run,
    saving,
    setPhase,

    goMode: useCallback(() => setPhase("mode"), []),
    chooseMode: useCallback((m: ModeId) => {
      setMode(m);
      setPhase("auth");
    }, []),
    toSetup: useCallback(() => setPhase("setup"), []),

    /** Returns the fresh run so a caller that needs it (a match's first standings
     *  row) doesn't have to wait a render for `run`. */
    start: useCallback(
      (m: ModeId, backgroundId: string, name: string, opts?: RunOpts) => {
        matchCodeRef.current = opts?.matchCode ?? null;
        matchPlayerIdRef.current = opts?.matchPlayerId ?? null;
        const r = initRun(m, backgroundId, name, opts?.seed);
        setMode(m);
        setRun(r);
        setPhase("run");
        void persist(r);
        return r;
      },
      [persist],
    ),

    resume: useCallback((r: RunState, opts?: RunOpts) => {
      matchCodeRef.current = opts?.matchCode ?? null;
      matchPlayerIdRef.current = opts?.matchPlayerId ?? null;
      setMode(r.mode);
      // Second line of defence: AuthGate already filters incompatible saves out
      // before offering "Continue", but a version mismatch must never reach the
      // year loop — a save from an older engine has no `homeValue`/`mortgage`
      // and would run as a corrupt half-state.
      if (!isCompatibleSave(r)) {
        setPhase("setup"); // stale save — start fresh for this mode
        return;
      }
      setRun(r);
      // A finished match run belongs on the room's podium, not straight in the report.
      setPhase(r.status === "ended" ? (opts?.matchCode ? "podium" : "report") : "run");
    }, []),

    // year actions
    trade: useCallback((asset: AssetId, dollars: number) => mutate((s) => trade(s, asset, dollars)), [mutate]),
    payDebt: useCallback((dollars: number) => mutate((s) => payDebt(s, dollars)), [mutate]),
    choose: useCallback(
      (eventId: string, choice: LifeChoice) => mutate((s) => applyLifeChoice(s, eventId, choice)),
      [mutate],
    ),
    advance: useCallback(() => commit((s) => advanceYear(s)), [commit]),
    retire: useCallback(() => commit((s) => retire(s)), [commit]),
    quit: useCallback(() => commit((s) => quitRun(s)), [commit]),

    toReport: useCallback(() => setPhase("report"), []),

    reset: useCallback(() => {
      matchCodeRef.current = null;
      matchPlayerIdRef.current = null;
      setRun(null);
      setMode(null);
      setPhase("mode");
    }, []),
    toTitle: useCallback(() => {
      matchCodeRef.current = null;
      matchPlayerIdRef.current = null;
      setRun(null);
      setMode(null);
      setPhase("intro");
    }, []),
  };
}
