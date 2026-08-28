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
import { resolveProgressId } from "@/lib/cloud/identity";
import { writeDaily } from "@/lib/dailySave";
import { weakSpotIds } from "@/lib/weakSpots";
import { saveRun } from "@/lib/saves";
import type { AssetId } from "@/lib/markets";
import type { LifeChoice } from "@/lib/lifeEvents";
import { resolveAllPending } from "@/lib/mp/autoResolve";

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
  /**
   * The last cloud write did not land.
   *
   * `saveRun` throws now instead of resolving over a Supabase `{ error }`, so this
   * is the first time the app has been ABLE to know. It is a sticky warning rather
   * than a modal: the run is still perfectly playable and still in memory, and
   * every subsequent year retries the write — what the player needs is to know
   * that closing the tab right now would cost them the run.
   */
  const [saveFailed, setSaveFailed] = useState(false);
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
        setSaveFailed(false);
      } catch {
        // Never rethrown: `commit` calls this as `void persist(next)`, so a
        // rejection escaping here is an unhandled promise rejection rather than
        // anything the player is told. The flag is how it gets told.
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }
    },
    [userId],
  );

  /**
   * Local mutation (no save) — trades within a year, and answering a card.
   *
   * Reads and writes `liveRef` rather than threading a `setRun` updater, and that
   * is load-bearing rather than a style choice: several callers apply more than
   * one mutation in a single tick (the match year-timeout answers every open card
   * and then turns the year), and a chain of queued updaters is only correct if
   * every link reads the previous link's output. `liveRef` is written
   * synchronously here, so it does.
   */
  const mutate = useCallback((fn: (s: RunState) => RunState) => {
    const prev = liveRef.current;
    if (!prev) return;
    const next = fn(prev);
    liveRef.current = next;
    setRun(next);
  }, []);

  /**
   * Mutation that also persists and may end the run.
   *
   * The state change and the effects of it are deliberately NOT inside a `setRun`
   * updater. React is free to call an updater more than once for a single update —
   * StrictMode does it on purpose, and a render-phase restart does it in
   * production — so a save and a phase change sitting in there ran twice for one
   * decision: `persist` fired a duplicate write, and `setPhase` was a state update
   * queued from inside another component's render. Computing the next state first
   * and acting on it afterwards makes each decision happen exactly once, which is
   * what "commit" was always supposed to mean.
   */
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
    saveFailed,
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
    choose: useCallback(
      (eventId: string, choice: LifeChoice) => mutate((s) => applyLifeChoice(s, eventId, choice)),
      [mutate],
    ),
    advance: useCallback(() => commit((s) => advanceYear(s)), [commit]),

    /**
     * The room's year ran out on a player who is still sitting here.
     *
     * Byte-for-byte the same answer the room itself would give: `resolveAllPending`
     * scores each open card against the state left by the previous one, and until
     * now the run screen scored every card of the year against the state as it was
     * BEFORE any of them were answered. With two cards open those are different
     * decisions — and worse than different, since `availableChoices` is a function
     * of the run, a choice that was on the table at the start of the year can be
     * closed by the first answer, and `applyLifeChoice` then refuses it and leaves
     * the card unanswered.
     *
     * `autoAllocate` is deliberately not part of this. That one moves money, and
     * this player is present — they simply ran out of clock. Nobody's money moves
     * without them unless they are genuinely gone (see lib/mp/autoResolve).
     */
    autoAdvance: useCallback(() => commit((s) => advanceYear(resolveAllPending(s))), [commit]),

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
