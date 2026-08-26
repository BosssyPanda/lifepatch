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
  sellHome,
  trade,
  type RunState,
} from "@/lib/runEngine";
import { resolveProgressId } from "@/lib/cloud/identity";
import { writeDaily } from "@/lib/dailySave";
import { weakSpotIds } from "@/lib/weakSpots";
import { saveRun } from "@/lib/saves";
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
  /** Set for a match run: the room owns this run's persistence, and its ending
   *  goes to the podium rather than to the solo recap. */
  matchCode?: string;
  /** `YYYY-MM-DD` (UTC): this is the Daily Ledger's run for that day. */
  daily?: string;
};

export function useRun(userId: string | null) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [mode, setMode] = useState<ModeId | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [saving, setSaving] = useState(false);
  /** The room this run belongs to, or null for a solo run. */
  const matchCodeRef = useRef<string | null>(null);
  /**
   * The live run, readable from a closure that is holding a STALE copy of it.
   *
   * A screen on its way out keeps the props of its last render for the length of
   * the exit animation (`AnimatePresence mode="wait"`), and its effects keep
   * firing while the context around it changes. `run` in such a copy still says
   * "playing" long after the life ended; this ref never does.
   */
  const liveRef = useRef<RunState | null>(null);

  const persist = useCallback(
    async (r: RunState) => {
      // The room code alone decides this branch: a match run must never fall
      // through to the solo store just because something else about it is missing.
      if (matchCodeRef.current) {
        // A match run must NEVER reach `lib/saves.ts`. That store is keyed
        // (user_id, mode) and a match run is still `mode: "story"`, so routing one
        // through it would overwrite the player's own story save with a run they
        // were handed the host's background and seed for.
        //
        // It writes nothing HERE either: the room owns its own record, keyed
        // (room, playerId), and `useMatch`'s `report()` is its one writer. That
        // covers everything this used to — `components/AppShell.tsx` reports every
        // new year, retirement, quit and ending off the run signature, and
        // `onStartRun` reports the opening state — and it writes behind the seat
        // fence, so a second tab of the same device that presence has NOT seated
        // cannot overwrite the life a rejoin will resume. Saving from here as well
        // put two writers on that one key with only one of them fenced, and which
        // life came back was a race between the tab the player was really in and
        // the tab that was auto-playing itself.
        return;
      }
      // A daily run is `mode: "story"` too, and `lib/saves.ts` is keyed
      // (userId, mode) — so letting one through here would overwrite the player's
      // own Story life with the day's puzzle. The fence reads the RUN, not a ref:
      // a ref can go stale against the state it is supposed to describe, and this
      // one would do so silently, in the direction that destroys a save.
      if (r.daily) {
        writeDaily(r.daily, r);
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

/*
 * Both of these read the previous state from `liveRef` and call `setRun` with a
 * VALUE, rather than passing an updater to `setRun` and working inside it. That is
 * deliberate, and it is the shape `start` above already uses.
 *
 * React may invoke an updater function twice — StrictMode does it in development,
 * and a discarded-and-replayed render can do it under concurrent rendering — so an
 * updater must be pure. `commit`'s used not to be: it called `setPhase`, and it
 * called `persist`. `setPhase` was harmless (React bails on an identical value),
 * but `persist` is I/O. A double invocation fired two concurrent `saveRun` upserts
 * of the same row and two overlapping `setSaving(true)/(false)` pairs — and since
 * `saving` is a boolean rather than a counter, the first call's `finally` cleared
 * the flag while the second write was still in flight, so the autosave indicator
 * read "saved" over an outstanding write. The `next === prev` guard did not help:
 * `fn(prev)` re-runs and returns a fresh object each time.
 *
 * Reading `liveRef` instead of `prev` is not a downgrade. The ref is written
 * synchronously by every path that can change the run — `start`, `resume`, `reset`,
 * `toTitle`, and these two — which is exactly the property `stillPlaying` already
 * relies on, so two calls in one tick each see the first one's result.
 */

// local mutation (no save) — used for trades within a year
  const mutate = useCallback((fn: (s: RunState) => RunState) => {
    const prev = liveRef.current;
    if (!prev) return;
    const next = fn(prev);
    liveRef.current = next;
    setRun(next);
  }, []);

  // mutation that also persists + may end the run
  const commit = useCallback(
    (fn: (s: RunState) => RunState) => {
      const prev = liveRef.current;
      if (!prev) return;
      const next = fn(prev);
      // The engine refuses some mutations outright — aging a life that has already
      // ended is the one that matters here — and hands the state back untouched.
      // Nothing was decided, so nothing is announced and nothing is written.
      if (next === prev) return;
      liveRef.current = next;
      setRun(next);
      // A match run goes to the room's podium first — the standings are the point,
      // and the player's own cinematic recap is one tap away from there.
      if (next.status === "ended") setPhase(matchCodeRef.current ? "podium" : "recap");
      void persist(next);
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
        // The concepts this player keeps getting wrong, SNAPSHOT at the start of the
        // run. Read here rather than at each call site so no future entry point can
        // forget it, and snapshot rather than read live so `drawEvents` stays a pure
        // function of the run — a live read would make the same seed deal different
        // cards tomorrow, and every replay and verification would stop holding.
        //
        // Never on a match (a per-player bias desynchronises the table — the failure
        // `drawEvents` measures at 21% of years and $71k of net worth) and never on
        // the daily (everyone's world has to be identical).
        const solo = opts?.matchCode == null && !opts?.daily;
        const r = initRun(m, backgroundId, name, opts?.seed, opts?.matchCode != null, {
          daily: opts?.daily,
          weakSpots: solo ? weakSpotIds(resolveProgressId(userId)) : undefined,
        });
        setMode(m);
        liveRef.current = r;
        setRun(r);
        setPhase("run");
        void persist(r);
        return r;
      },
      [persist, userId],
    ),

    resume: useCallback((r: RunState, opts?: RunOpts) => {
      matchCodeRef.current = opts?.matchCode ?? null;
      setMode(r.mode);
      // Second line of defence: AuthGate already filters incompatible saves out
      // before offering "Continue", but a version mismatch must never reach the
      // year loop — a save from an older engine has no `homeValue`/`mortgage`
      // and would run as a corrupt half-state.
      if (!isCompatibleSave(r)) {
        setPhase("setup"); // stale save — start fresh for this mode
        return;
      }
      liveRef.current = r;
      setRun(r);
      // A finished match run belongs on the room's podium, not straight in the report.
      setPhase(r.status === "ended" ? (opts?.matchCode ? "podium" : "report") : "run");
    }, []),

    // year actions
    trade: useCallback((asset: AssetId, dollars: number) => mutate((s) => trade(s, asset, dollars)), [mutate]),
    payDebt: useCallback((dollars: number) => mutate((s) => payDebt(s, dollars)), [mutate]),
    /**
     * `commit`, not `mutate`, unlike its neighbours.
     *
     * A trade or a debt payment moves money between things the player already owns
     * and is saved when the year turns. Selling the house ends a thirty-year
     * obligation, changes every future year's expenses from upkeep to rent, and is
     * the one action on this screen that cannot be undone — so it is written down
     * when it happens, not when the year does.
     *
     * `commit`'s `next === prev` short-circuit already matches `sellHome`'s two
     * refusal guards (an ended run, a run that owns nothing), so a sale the engine
     * declines writes nothing and re-renders nothing.
     */
    sellHome: useCallback(() => commit((s) => sellHome(s)), [commit]),
    choose: useCallback(
      (eventId: string, choice: LifeChoice) => mutate((s) => applyLifeChoice(s, eventId, choice)),
      [mutate],
    ),
    advance: useCallback(() => commit((s) => advanceYear(s)), [commit]),

    /** Is the LIVE life still open? A stale copy of this hook still answers honestly:
     *  the ref behind it is shared by every render (see `liveRef`). */
    stillPlaying: useCallback(() => liveRef.current?.status === "playing", []),
    retire: useCallback(() => commit((s) => retire(s)), [commit]),
    quit: useCallback(() => commit((s) => quitRun(s)), [commit]),

    toReport: useCallback(() => setPhase("report"), []),

    reset: useCallback(() => {
      matchCodeRef.current = null;
      liveRef.current = null;
      setRun(null);
      setMode(null);
      setPhase("mode");
    }, []),
    toTitle: useCallback(() => {
      matchCodeRef.current = null;
      liveRef.current = null;
      setRun(null);
      setMode(null);
      setPhase("intro");
    }, []),
  };
}
