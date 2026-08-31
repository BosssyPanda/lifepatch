"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Opening } from "@/components/cinematic/Opening";
import { ModeSelect } from "@/components/screens/ModeSelect";
import { playerName } from "@/components/ui/NameField";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AudioProvider, useAudio } from "@/hooks/useAudio";
import { MatchProvider, useMatchCtx } from "@/hooks/useMatch";
import { useRun } from "@/hooks/useRun";
import { ConceptLearnProvider, useConceptLearn } from "@/hooks/useConceptLearn";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { wipeFor } from "@/src/motion/transitions";
import type { DailyPuzzle } from "@/lib/daily";
import { challengeableWorld, challengeFor, writeChallenge } from "@/lib/challenge";
import { consumeInvite } from "@/lib/deepLink";
import { lastPlayerName } from "@/lib/mp/matchStore";
import { resolveProgressId } from "@/lib/cloud/identity";
import { getProfiles } from "@/lib/cloud/profiles";
import { getResult } from "@/lib/cloud/results";
import { resultFromRun, submitRunOnce } from "@/lib/cloud/buildResult";
import type { GameMode } from "@/lib/cloud/types";
import { yearIndex, type RunState } from "@/lib/runEngine";

// Code-split every screen first paint doesn't need. Only the intro (Opening) and
// ModeSelect stay eager; the run engine, Rat Race board, cinematics, report, and
// overlays load on demand — keeping `/`'s First Load lean. ssr:false because these
// are all client-only screens gated behind a phase or a user action.
const screenFallback = () => (
  <div className="flex min-h-[100svh] items-center justify-center bg-bg">
    <TerminalOp label="Loading" center />
  </div>
);
const CashflowShell = dynamic(() => import("@/components/cashflow/CashflowShell").then((m) => m.CashflowShell), { ssr: false, loading: screenFallback });
const YearLoop = dynamic(() => import("@/components/run/YearLoop").then((m) => m.YearLoop), { ssr: false, loading: screenFallback });
const Outro = dynamic(() => import("@/components/cinematic/Outro").then((m) => m.Outro), { ssr: false, loading: screenFallback });
const LifeReport = dynamic(() => import("@/components/screens/LifeReport").then((m) => m.LifeReport), { ssr: false, loading: screenFallback });
const AuthGate = dynamic(() => import("@/components/screens/AuthGate").then((m) => m.AuthGate), { ssr: false, loading: screenFallback });
const Setup = dynamic(() => import("@/components/screens/Setup").then((m) => m.Setup), { ssr: false, loading: screenFallback });
// "With friends" screens: nobody who plays solo ever pays for these chunks.
const LobbyScreen = dynamic(() => import("@/components/mp/LobbyScreen").then((m) => m.LobbyScreen), { ssr: false, loading: screenFallback });
const MatchPodium = dynamic(() => import("@/components/mp/MatchPodium").then((m) => m.MatchPodium), { ssr: false, loading: screenFallback });
// Overlays: keep their always-mounted open/close API (and exit animation) but defer
// the chunk until the first time each is opened, then leave it mounted.
const Almanac = dynamic(() => import("@/components/screens/Almanac").then((m) => m.Almanac), { ssr: false });
const Leaderboard = dynamic(() => import("@/components/social/Leaderboard").then((m) => m.Leaderboard), { ssr: false });
const MasteryMap = dynamic(() => import("@/components/learn/MasteryMap").then((m) => m.MasteryMap), { ssr: false });
const FriendsSheet = dynamic(() => import("@/components/social/FriendsSheet").then((m) => m.FriendsSheet), { ssr: false });

export function AppShell() {
  return (
    // MotionProvider now lives in the root layout so the standalone routes get it too.
    <AudioProvider>
      {/* Auth sits ABOVE the concept provider on purpose: the provider records
          mastery, and it has to observe the same sign-in the report and the
          mastery map do. When these were two separate hook instances, every
          concept a player earned was filed under the anonymous device id while
          the map read the signed-in one, and progress never appeared. */}
      <AuthProvider>
        {/* The match provider sits under auth because the room needs the same
            player id the rest of the social layer uses, and above everything
            that renders a screen: a match is a property of the whole session,
            not of the run currently on screen. Outside a room it holds no
            channel and `useMatchCtx()` reads null, so every solo path below is
            byte-for-byte what it was before multiplayer existed. */}
        <MatchProvider>
          <ConceptLearnProvider>
            <AppShellInner />
          </ConceptLearnProvider>
        </MatchProvider>
      </AuthProvider>
    </AudioProvider>
  );
}

/** The signature a match run reports on: a new year, or the end of the life. */
function matchSig(r: RunState): string {
  return `${r.seed}:${yearIndex(r)}:${r.status}`;
}

function AppShellInner() {
  const auth = useAuth();
  const run = useRun(auth.user?.id ?? null);
  const audio = useAudio();
  // null unless this device is in a room — every branch below that reads it is
  // additive, so the solo phases render exactly as they always have.
  const match = useMatchCtx();
  const { reduced } = useMotionCtx();
  // Phase-C transition layer: the paper-feed wipe (director's pick; see src/motion/transitions).
  const wipe = wipeFor(reduced);
  const { phase, mode } = run;
  // Each overlay stays mounted once first opened (defers its chunk without losing
  // the open/close animation); `*Open` drives visibility, `*Mounted` gates the load.
  const [almanacOpen, setAlmanacOpen] = useState(false);
  const [almanacMounted, setAlmanacMounted] = useState(false);
  const openAlmanac = () => { audio.sfx("modal"); setAlmanacMounted(true); setAlmanacOpen(true); };
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialMounted, setSocialMounted] = useState(false);
  const [socialMode, setSocialMode] = useState<GameMode>("story");
  const openLeaderboard = (m: GameMode) => { audio.sfx("modal"); setSocialMounted(true); setSocialMode(m); setSocialOpen(true); };
  const [masteryOpen, setMasteryOpen] = useState(false);
  const [masteryMounted, setMasteryMounted] = useState(false);
  const openMasteryMap = () => { audio.sfx("modal"); setMasteryMounted(true); setMasteryOpen(true); };
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [friendsMounted, setFriendsMounted] = useState(false);
  const [friendsPrefill, setFriendsPrefill] = useState<string | null>(null);
  /**
   * The friends sheet, and the board it replaces.
   *
   * `setSocialOpen(false)` is not tidiness. Both are `LedgerDialog`s, and
   * `useDialog` binds its focus trap and its Escape handler to `document` in the
   * capture phase — two open at once trap Tab against each other and both answer
   * one Escape. Closing the board here keeps exactly one modal live; its exit
   * animation still plays, because `useDialog`'s effects key on `open` rather
   * than on being mounted.
   */
  /**
   * Whether the board was the thing the sheet was opened FROM.
   *
   * Closing it below is required (see above) but it is not a dismissal — the
   * player asked for the friends sheet, not for the leaderboard to go away. With
   * nothing restoring it they were dropped back to the title or the report,
   * having just added the friend whose row they wanted to see, with no way back
   * but reopening the board by hand. Reopening it here also re-runs the board's
   * fetch for free: `open` is in its effect deps, which is exactly the
   * invalidation `LeaderboardPage` has to ask for explicitly with `refreshSignal`
   * because its board is page chrome and never toggles.
   */
  const [boardBehindFriends, setBoardBehindFriends] = useState(false);
  const openFriends = (prefill?: string) => {
    audio.sfx("modal");
    setBoardBehindFriends(socialOpen);
    setSocialOpen(false);
    setFriendsPrefill(prefill ?? null);
    setFriendsMounted(true);
    setFriendsOpen(true);
  };
  const closeFriends = () => {
    setFriendsOpen(false);
    if (boardBehindFriends) {
      setBoardBehindFriends(false);
      // The board coming back is an opening like any other, and every other one
      // in this app has a sound. Silence here read as the sheet having failed to
      // close rather than the board having returned.
      audio.sfx("modal");
      setSocialOpen(true);
    }
  };
  /**
   * The link this page was opened with, read exactly once (`lib/deepLink.ts`).
   *
   * A friend code is the one thing in this game that only travels between two
   * people, so it is the one thing allowed to decide what opens first. No sound
   * here on purpose: nothing was tapped, and the audio engine is gesture-gated
   * anyway.
   */
  useEffect(() => {
    const invite = consumeInvite();
    if (!invite) return;
    if (invite.kind === "friend") {
      setFriendsPrefill(invite.code);
      setFriendsMounted(true);
      setFriendsOpen(true);
      return;
    }

    /**
     * `?vs=<resultId>` — play the world that statement was played on.
     *
     * The row carries everything a world needs (`metrics.seed` and
     * `metrics.backgroundId`), so this reads it, records who is being answered,
     * and opens the life. It skips the auth gate and the setup screen for the
     * same reason the daily does: the seed and the background are already fixed,
     * and there is nothing left on either screen to decide. The click on the
     * statement — where the reader had the rival's number and chart in front of
     * them — was the confirmation.
     *
     * Every failure below lands the player on the title screen with a world of
     * their own, which is exactly where the link used to send them. There is
     * nothing to announce: nothing was lost.
     */
    /**
     * Deliberately NOT cancelled on cleanup.
     *
     * StrictMode double-invokes this effect, and `consumeInvite` answers at most
     * once per load — so an `active = false` in the cleanup would kill the only
     * run that has the invite, and the second pass would find nothing left to do.
     * The parameter is already stripped by then, so a refresh could not retry
     * either: the whole feature would be dead in `next dev` and alive in
     * production, which is the worst way for it to be broken. `AppShell` is the
     * root of the tree and does not unmount in practice; the guard that matters
     * is the one below, on what the player is doing NOW.
     */
    void (async () => {
      let row;
      try {
        row = await getResult(invite.resultId);
      } catch {
        // Offline, or a row that is gone. The title screen is a fine place to be.
        return;
      }
      if (!row) return;

      // The rules for what counts as a world live in `lib/challenge.ts`, so this
      // reader and the button that produced the link cannot drift apart.
      const world = challengeableWorld(row);
      if (!world) return;

      // A name for the report to print, and nothing more — a board row is public,
      // so this is the public view of them. Its own try/catch because a missing
      // display name must not cost the player the world they asked for: the two
      // things a world actually needs are already validated and in hand.
      let name = "anonymous";
      try {
        name = (await getProfiles([row.userId]))[row.userId]?.username ?? "anonymous";
      } catch {}

      /**
       * The player did not sit still while those round trips ran.
       *
       * Checked HERE, after both awaits, rather than before them: a guard that
       * runs before the second await only covers the first. On a slow profile
       * lookup the player — sitting on a title screen
       * where nothing appeared to be happening — can get all the way through mode
       * select, the auth gate and setup, and begin a life of their own. `run.start`
       * replaces the live run, its mode and the phase, and a challenge run is
       * fenced out of `lib/saves.ts`, so landing it on them would delete the run
       * they chose with nothing written anywhere.
       *
       * `hasRun`, not `stillPlaying`: a save resumed from a FINISHED run lands on
       * the report with status `"ended"`, which `stillPlaying` reads as false — so
       * the narrower guard would have let the challenge overwrite a statement the
       * player had just asked to see. Both read `liveRef`, so this is the live
       * answer and not a stale closure over this render.
       */
      if (run.hasRun()) return;

      /**
       * The rival is recorded only once the guards above have passed.
       *
       * Ordering matters here in a way that is not obvious. Writing it earlier —
       * to keep the invitation recoverable after a bail — leaves a record that
       * `challengeFor` MATCHES against any run standing on the same seed,
       * background and mode. The run the player resumed while this was loading is
       * exactly such a run when they opened their OWN statement's link: the record
       * would attach to a life that was already finished and already posted, and
       * `submitRunOnce` would re-key it with the attempt nonce, miss the mark from
       * the first submission and post a SECOND leaderboard row for one run. The
       * report would also print them against themselves. Nothing is written unless
       * this effect is about to start the run the record describes.
       *
       * `writeChallenge` can still fail — a private window, a full quota — and the
       * run starts anyway. The link promised this world and it delivers it; what
       * is lost is the comparison at the end, which is the smaller half. Refusing
       * to start would make the link a no-op with nothing on screen to explain it,
       * because `consumeInvite` has already taken the parameter out of the URL.
       */
      writeChallenge({
        resultId: row.id,
        // Per ATTEMPT, not per world. `submitRunOnce` dedupes on a key built from
        // the run's seed, and a challenge borrows someone else's seed by design —
        // so answering your own link, or taking a second run at one, would hash to
        // a key already marked submitted and post nothing at all.
        attempt: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        seed: world.seed,
        backgroundId: world.backgroundId,
        mode: world.mode,
        name,
        score: row.score,
        history: world.history,
        startYear: world.startYear,
        coached: world.coached,
      });

      /**
       * NOT made a guest first, deliberately — this used to call `continueAsGuest`.
       *
       * The effect runs once on mount with `[]` deps, so `auth` here is the
       * MOUNT-TIME value, and on the cloud path `useAuthState` starts at
       * `user === null` and only resolves the session in a later `getSession()`
       * callback. `!auth.user` was therefore true for everyone, signed in or not,
       * and the call demoted a real account to the device guest: the session was
       * replaced, `resolveProgressId` switched to the device id, and the run the
       * link invited them to play was written to localStorage instead of the board
       * the rival is standing on. Nobody ever saw the answer.
       *
       * Nothing needs it any more. `resolveProgressId(null)` already mints the
       * device id at the submit site, so a visitor with no account records their
       * run exactly as a guest does, and the friends sheet's own gate tests for an
       * account rather than for `guest`. A player who has not chosen guest play is
       * not silently signed up for it.
       */
      run.start(world.mode, world.backgroundId, playerName(lastPlayerName()), {
        seed: world.seed,
        challenge: true,
      });
    })();
    // Once, on the first mount: `consumeInvite` answers at most once per load and
    // everything this closes over is either stable or read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { resetRun } = useConceptLearn();

  /**
   * The Daily Ledger's one entry point.
   *
   * It skips the auth gate and the setup screen on purpose: the day fixes the seed
   * AND the background, so there is nothing on either screen left to decide, and
   * asking anyway would just be two taps between the player and a run that is
   * already fully specified. The name comes from whatever this device last played
   * under — the daily is a puzzle, not an identity.
   *
   * A finished day resumes into its own report rather than starting a second
   * attempt; `useRun.resume` routes an ended run there by itself.
   */
  const startDaily = (puzzle: DailyPuzzle, resume: RunState | null) => {
    audio.sfx("confirm");
    if (resume) {
      run.resume(resume);
      return;
    }
    run.start("story", puzzle.backgroundId, playerName(lastPlayerName()), {
      seed: puzzle.seed,
      daily: puzzle.date,
    });
  };

  // The Rat Race mode is a fully self-contained board game with its own internal
  // phase machine — hand off to it as soon as it's chosen (skip LifePatch auth).
  const inCashflow = mode === "cashflow" && phase !== "intro" && phase !== "mode";

  // Phase → music preset. intro & recap are owned by Opening/Outro (so they can
  // sync the escalation/verdict), everything else crossfades to a steady bed.
  // The lobby and the podium are menus with a room in them, so they take the menu
  // bed — multiplayer ships no cues of its own, by contract.
  // `setPhase` is destructured because it is stable while `audio` is not: keeping
  // the whole object here re-ramped all eight stem gains on every step of the
  // volume fader.
  const { setPhase: setScorePhase } = audio;
  useEffect(() => {
    if (phase === "mode" || phase === "auth" || phase === "setup" || phase === "lobby") setScorePhase("menu");
    else if (phase === "run") setScorePhase("gameplay");
    else if (phase === "report" || phase === "podium") setScorePhase("menu");
  }, [phase, setScorePhase]);

  // Post a leaderboard result + bump the daily streak when a life run finishes.
  // submitRunOnce dedupes durably (per run seed), so re-renders, resumes, and
  // reloads all post exactly once.
  //
  // "podium" is in the gate because a match run ends THERE, not in the report: a
  // player who reads the standings and closes the tab still finished a story run
  // and still owns their place on the global board. The dedupe key makes the
  // second pass (once they tap through to their report) a no-op.
  useEffect(() => {
    if ((phase !== "report" && phase !== "podium") || !run.run || run.run.status !== "ended") return;
    const r = run.run;
    // `resolveProgressId`, not `resolvePlayerId` — the WRITE has to name the player
    // the same way the READ does, and the streak chip reads under this one
    // (`useProfile`). `resolvePlayerId` withholds a guest's device id in a cloud
    // build, which is the right answer for a share link that needs a cloud row and
    // the wrong one here: `submitRunOnce` short-circuits on the null, so the three
    // guest guards below it (`cloudResultsFor`, `cloudStreakFor`, `cloudProfileFor`)
    // never got to route a guest to localStorage. A guest finished a run and BOTH
    // branches were skipped. A signed-in player is unaffected: this returns their
    // auth id and the guards send it to the cloud exactly as before.
    const id = resolveProgressId(auth.user?.id ?? null);
    // The seed alone identifies a run only while seeds are random per run. A
    // challenge borrows one on purpose, so answering your own link — or taking a
    // second run at somebody else's — would collide with the key the first run
    // already marked submitted, and the better result would be dropped in silence.
    const answering = challengeFor(r);
    void submitRunOnce(
      answering ? `${r.mode}-${r.seed}-${answering.attempt}` : `${r.mode}-${r.seed}`,
      id,
      resultFromRun(r),
    );
  }, [phase, run.run, auth.user]);

  // ── the room ──────────────────────────────────────────────────────────────
  // A match run reports itself to the room once per YEAR and once at its end.
  // This lives here rather than in YearLoop because the ending unmounts YearLoop
  // in the same commit that produces the ended state — the final standings row
  // would never leave the device. Gated on the signature so the dozen state
  // objects a year of trading produces don't each become a broadcast.
  const reportedRef = useRef("");
  useEffect(() => {
    const r = run.run;
    if (!match || !r) return;
    const sig = matchSig(r);
    if (sig === reportedRef.current) return;
    reportedRef.current = sig;
    if (r.status === "ended") match.reportEnded(r);
    else match.reportAdvance(r);
  }, [match, run.run]);

  // Every client starts (or resumes) its own life the moment the room says the
  // match is running — same background, same seed, same world.
  const startedRoomRef = useRef<string | null>(null);
  const onStartRun = () => {
    const cfg = match?.config;
    if (!match || !cfg || startedRoomRef.current === cfg.roomCode) return;
    startedRoomRef.current = cfg.roomCode;
    if (match.resumeState) {
      // Rejoin: the hook already caught this life up to the room's year.
      run.resume(match.resumeState, { matchCode: cfg.roomCode });
      return;
    }
    const name = playerName(match.peers[match.selfId]?.name ?? "");
    const r = run.start("story", cfg.backgroundId, name, { seed: cfg.seed, matchCode: cfg.roomCode });
    // Seed the standings row now instead of a render later, and mark it reported
    // so the effect above doesn't send the same year twice.
    reportedRef.current = matchSig(r);
    match.reportAdvance(r);
  };

  // The lobby calls `onStartRun` when the room flips to running, and that is the
  // normal path. This is the other one: a REJOIN arrives in a match that is
  // already running, so there is no flip to watch for — the lobby is a doorway it
  // passes straight through. It lives here rather than in LobbyScreen because that
  // screen is a dynamic import and is often not mounted yet at the moment the room
  // settles. Idempotent (the ref above is the gate), so the two paths can't
  // double-start a life.
  const onStartRunRef = useRef(onStartRun);
  onStartRunRef.current = onStartRun;
  useEffect(() => {
    if (phase !== "lobby") return;
    // A rejoin can also land in a room that is ALREADY over — the room's clock has
    // passed the last year, so the match reads "finished" before this screen ever
    // mounts. The life the hook just caught up belongs on the podium (and on the
    // global board), not on a lobby whose Start button can never fire again.
    // `resumeState` is the gate: without a recovered run there is nothing to show,
    // and starting one would drop a fresh year-one life into a dead room.
    if (match?.phase === "running" || (match?.phase === "finished" && match.resumeState)) {
      onStartRunRef.current();
    }
  }, [phase, match]);

  const leaveRoom = () => match?.leaveMatch();
  const exitToTitle = () => {
    leaveRoom();
    run.toTitle();
  };

  // A room screen with no room behind it (the transport dropped, or the player
  // left from somewhere else) has nothing to render — fall back to the solo flow
  // rather than a blank phase.
  const setRunPhase = run.setPhase;
  useEffect(() => {
    if (match) return;
    startedRoomRef.current = null;
    if (phase === "lobby") setRunPhase("setup");
    else if (phase === "podium") setRunPhase("report");
  }, [match, phase, setRunPhase]);

  // Fresh run → clear the "this run sharpened" concept summary.
  const runSeed = run.run?.seed ?? null;
  useEffect(() => {
    if (phase === "run") resetRun();
  }, [phase, runSeed, resetRun]);

  if (inCashflow) {
    return (
      <main id="main" className="relative min-h-[100svh] w-full">
        <CashflowShell onExit={run.toTitle} onOpenAlmanac={openAlmanac} onMasteryMap={openMasteryMap} />
        {almanacMounted && <Almanac open={almanacOpen} onClose={() => setAlmanacOpen(false)} />}
        {masteryMounted && <MasteryMap open={masteryOpen} onClose={() => setMasteryOpen(false)} />}
      </main>
    );
  }

  return (
    <main id="main" className="relative min-h-[100svh] w-full">
      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <motion.div key="intro" {...wipe}>
            <Opening onStart={run.goMode} onAlmanac={openAlmanac} />
          </motion.div>
        )}

        {phase === "mode" && (
          <motion.div key="mode" {...wipe}>
            <ModeSelect
              onChoose={run.chooseMode}
              onBack={run.toTitle}
              onLeaderboard={() => openLeaderboard("story")}
              onMasteryMap={openMasteryMap}
              onDaily={startDaily}
            />
          </motion.div>
        )}

        {phase === "auth" && mode && (
          <motion.div key="auth" {...wipe}>
            <AuthGate auth={auth} mode={mode} onResume={run.resume} onNew={run.toSetup} onBack={run.goMode} />
          </motion.div>
        )}

        {phase === "setup" && mode && (
          <motion.div key="setup" {...wipe}>
            <Setup
              mode={mode}
              onStart={(bg, name) => run.start(mode, bg, name)}
              onBack={() => run.setPhase("auth")}
              onEnterLobby={() => run.setPhase("lobby")}
            />
          </motion.div>
        )}

        {phase === "lobby" && match && (
          <motion.div key="lobby" {...wipe}>
            <LobbyScreen onStartRun={onStartRun} onLeave={() => { leaveRoom(); run.setPhase("setup"); }} />
          </motion.div>
        )}

        {phase === "run" && run.run && (
          <motion.div key="run" {...wipe}>
            <YearLoop run={run} onOpenAlmanac={openAlmanac} />
          </motion.div>
        )}

        {phase === "podium" && match && run.run && (
          <motion.div key="podium" {...wipe}>
            <MatchPodium run={run.run} onSeeReport={() => run.setPhase("recap")} onExit={exitToTitle} />
          </motion.div>
        )}

        {phase === "recap" && run.run && (
          <motion.div key="recap" {...wipe}>
            <Outro run={run.run} onDone={run.toReport} />
          </motion.div>
        )}

        {phase === "report" && run.run && (
          <motion.div key="report" {...wipe}>
            <LifeReport
              run={run.run}
              // Both exits close the room first: a replay is a solo run, and a
              // player still holding a channel would keep broadcasting rows from
              // a life the room never started.
              onReplay={() => { leaveRoom(); run.start(run.run!.mode, run.run!.backgroundId, run.run!.name); }}
              onTitle={exitToTitle}
              // Only while the room is still held — and it is, because reading the
              // report doesn't leave it. If the room dies while they read, the prop
              // goes away and the effect above keeps podium → report one-way.
              onBackToStandings={match ? () => run.setPhase("podium") : undefined}
              onAlmanac={openAlmanac}
              onMasteryMap={openMasteryMap}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {almanacMounted && <Almanac open={almanacOpen} onClose={() => setAlmanacOpen(false)} />}
      {socialMounted && (
        <Leaderboard
          open={socialOpen}
          onClose={() => setSocialOpen(false)}
          initialMode={socialMode}
          onOpenFriends={() => openFriends()}
        />
      )}
      {masteryMounted && <MasteryMap open={masteryOpen} onClose={() => setMasteryOpen(false)} />}
      {friendsMounted && (
        <FriendsSheet
          open={friendsOpen}
          onClose={closeFriends}
          prefillCode={friendsPrefill}
        />
      )}
    </main>
  );
}
