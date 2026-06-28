"use client";

import { useCallback, useState } from "react";
import type { ModeId } from "@/lib/modes";
import {
  advanceYear,
  applyLifeChoice,
  initRun,
  payDebt,
  quitRun,
  retire,
  trade,
  type RunState,
} from "@/lib/runEngine";
import { saveRun } from "@/lib/saves";
import type { AssetId } from "@/lib/markets";
import type { LifeChoice } from "@/lib/lifeEvents";

export type Phase = "intro" | "mode" | "auth" | "setup" | "run" | "report";

export function useRun(userId: string | null) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [mode, setMode] = useState<ModeId | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [saving, setSaving] = useState(false);

  const persist = useCallback(
    async (r: RunState) => {
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
        if (next.status === "ended") setPhase("report");
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

    start: useCallback(
      (m: ModeId, backgroundId: string, name: string) => {
        const r = initRun(m, backgroundId, name);
        setMode(m);
        setRun(r);
        setPhase("run");
        void persist(r);
      },
      [persist],
    ),

    resume: useCallback((r: RunState) => {
      setMode(r.mode);
      setRun(r);
      setPhase(r.status === "ended" ? "report" : "run");
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

    reset: useCallback(() => {
      setRun(null);
      setMode(null);
      setPhase("mode");
    }, []),
    toTitle: useCallback(() => {
      setRun(null);
      setMode(null);
      setPhase("intro");
    }, []),
  };
}
