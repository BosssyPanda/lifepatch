"use client";

import { useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { hasWebGL } from "@/components/cashflow/board/lazy";
import {
  FAST_SQUARE_META,
  RAT_SQUARE_META,
} from "@/lib/cashflow/board";
import { FAST_TRACK_DEALS } from "@/lib/cashflow/decks";
import {
  applyMove,
  beginTurn,
  buyBusiness,
  buyRealEstate,
  buyStock,
  checkFastWin,
  consumeCharityRoll,
  drawBigDeal,
  drawDoodad,
  drawMarket,
  drawSmallDeal,
  markEscaped,
  markLessonSeen,
  pushLog,
  roll,
  tickStockPrices,
} from "@/lib/cashflow/engine";
import { MILESTONE_LESSONS, QUIZ_BANK, SQUARE_COACH } from "@/lib/cashflow/lessons";
import type { QuizQuestion as QuizT } from "@/lib/cashflow/lessons";
import { pickIndex } from "@/lib/cashflow/rng";
import { bankLoanStress, freedomRatio } from "@/lib/cashflow/selectors";
import { clamp } from "@/lib/format";
import type { CashflowState, Deal, DoodadCard as DoodadT, FastTrackDeal, MarketCard } from "@/lib/cashflow/types";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/**
 * A turn of the board: roll, move, land, resolve, maybe teach, end. The screen that
 * renders the board decides nothing about any of it — it reads `busy`, mounts whatever
 * `pending` names, and calls back in.
 *
 * The dice are not decoration. `roll()` is the engine's, and the physics overlay is
 * handed the numbers it already produced to display — it never generates its own.
 */

export type Pending =
  | { kind: "coach"; title: string; body: string; then: () => void; concept?: string }
  | { kind: "deal-choose" }
  | { kind: "deal"; deal: Deal }
  | { kind: "doodad"; card: DoodadT }
  | { kind: "charity" }
  | { kind: "market"; card: MarketCard }
  | { kind: "baby" }
  | { kind: "downsized" }
  | { kind: "ftdeal"; deal: FastTrackDeal }
  | { kind: "cashflowday" }
  | { kind: "dream" }
  | { kind: "ftloss" }
  | { kind: "quiz"; q: QuizT };

export function useCashflowTurn({
  s,
  apply,
  commit,
  blocked,
}: {
  s: CashflowState;
  apply: (fn: (s: CashflowState) => CashflowState) => void;
  commit: (fn: (s: CashflowState) => CashflowState) => void;
  /** Screen-owned modals (the tutorial) that must also freeze the turn controls. */
  blocked: boolean;
}) {
  const audio = useAudio();
  const { reduced: reduce } = useMotionCtx();
  const isFast = s.track === "fast";

  const [turnPhase, setTurnPhase] = useState<"idle" | "rolling" | "moving" | "resolve">("idle");
  const [dice, setDice] = useState<number[]>(isFast ? [3, 4] : [6]);
  const [rollFx, setRollFx] = useState<number[] | null>(null);
  const landRef = useRef<(() => void) | null>(null);

  /**
   * Every timer a roll schedules, so leaving the board cancels them.
   *
   * One roll queues up to three: the payday toast's dismissal, the token's travel,
   * and — without the physics overlay — the landing itself. None were tracked, and
   * Exit is reachable mid-roll on purpose: a roll takes up to three seconds, and a
   * control the player cannot press for three seconds is a worse bug than this one.
   * So a player who rolled and then left took the timers with them, and they fired
   * against a screen that was gone.
   *
   * The state setters in those callbacks are harmless after unmount — React 19 drops
   * them silently. The audio is not. `audio` is a singleton that outlives this hook,
   * so `accent("stab")` played over the mode select, and a losing landing went on to
   * `endTurn` → `pushIntensity`, which re-aimed the adaptive score's intensity and
   * could fire a freedom-milestone sting on a screen with no board on it.
   */
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Warm the physics chunk + wasm while the player reads the board, so the
  // first roll's overlay appears instantly instead of after a module load.
  useEffect(() => {
    if (hasWebGL()) void import("@/components/cashflow/board/DiceRollOverlay");
  }, []);
  const [twoDice, setTwoDice] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [paydayToast, setPaydayToast] = useState<number | null>(null);

  const lastRoll = useRef(0);
  const lastLanded = useRef("");
  const quizState = useRef<CashflowState | null>(null);
  // highest freedom milestone already celebrated (0=none, 1=half, 2=free) so each
  // threshold stings exactly once on the way up — never on every recompute.
  const freedomTier = useRef(0);

  // ── per-tile landing accent (fires the instant the 3D token settles) ──
  function landingSfx(type: string) {
    switch (type) {
      case "payday":
      case "cashflowday":
        audio.sfx("cash");
        audio.sting("good");
        break;
      case "deal":
      case "ftdeal":
        audio.sfx("uitick");
        break;
      case "charity":
        audio.sfx("coins");
        break;
      case "market":
        audio.sfx("page");
        break;
      case "dream":
        audio.sting("good");
        break;
      case "doodad":
      case "downsized":
      case "ftloss":
        audio.sting("bad");
        break;
      default:
        audio.sfx("uitick");
    }
  }

  // ── Phase M1: compositor zoom-pulse toward the landed square + payday blink ──
  const boardPulse = useAnimationControls();
  const [paydayFlash, setPaydayFlash] = useState(0);
  function handleLand(type: string, at: { xPct: number; yPct: number }) {
    landingSfx(type);
    if (reduce) return;
    void boardPulse.start({
      scale: [1, 1.035, 1],
      transformOrigin: `${at.xPct}% ${at.yPct}%`,
      transition: { duration: 0.38, ease: EASE, times: [0, 0.35, 1] },
    });
  }

  const busy = turnPhase !== "idle" || pending !== null || blocked;

  // ── intensity feeds the adaptive score + freedom-milestone stings ──
  function pushIntensity(state: CashflowState) {
    const fr = clamp(freedomRatio(state), 0, 1);
    const loan = state.liabilities.bankLoan > 0 ? 0.2 : 0;
    audio.setIntensity(clamp(0.32 + (1 - fr) * 0.32 + loan, 0, 1));

    // celebrate the first time the player crosses each freedom milestone (rat track
    // only — the fast track has its own win flow). Fires once per threshold.
    if (state.track === "rat") {
      const tier = fr >= 1 ? 2 : fr >= 0.5 ? 1 : 0;
      if (tier > freedomTier.current) {
        audio.sting("good");
        if (tier === 2) audio.swellWarmth();
        freedomTier.current = tier;
      } else if (tier < freedomTier.current) {
        // slipped back below a milestone — let it be re-earned later
        freedomTier.current = tier;
      }
    }
  }

  // ── end of turn: log + escape/win check ──
  function endTurn(state: CashflowState) {
    let next = pushLog(state, { roll: lastRoll.current, landedOn: lastLanded.current, note: "" });
    next = state.track === "rat" ? markEscaped(next) : checkFastWin(next);
    commit(() => next);
    setPending(null);
    setTurnPhase("idle");
    pushIntensity(next);
  }

  // ── teaching: one beat per resolution, at the moment the decision needs it ──
  /**
   * What the player just did, so an explainer can land on the decision that
   * earned it rather than on a timer.
   */
  type ResolveCtx = "deal" | "doodad" | "sale" | "none";

  type TeachBeat =
    | { key: string; kind: "coach"; title: string; body: string; concept?: string; when: boolean }
    | { key: string; kind: "quiz"; q: QuizT; when: boolean };

  /**
   * The old `pickQuiz` served exactly three of the six bank questions and none of
   * the three MILESTONE_LESSONS (which nothing imported at all). Everything is
   * wired now, ordered by pedagogical dependency, and the concept-first beats are
   * *explainers* — a single "Got it" — never quiz walls. At most one fires per
   * resolution, so they spread themselves across the run instead of stacking.
   */
  function pickTeaching(state: CashflowState, ctx: ResolveCtx): TeachBeat | null {
    const find = (id: string) => QUIZ_BANK.find((q) => q.id === id)!;
    const fr = freedomRatio(state);
    const owns = state.realEstate.length + state.businesses.length;
    const beats: TeachBeat[] = [
      // first purchase: name what just happened before asking anything about it
      { key: "t-first-deal", kind: "coach", ...MILESTONE_LESSONS.firstDeal, concept: "assets", when: ctx === "deal" && state.dealsBought >= 1 },
      // the expense you just paid for, explained while the sting is fresh. The beat key
      // and the square type stay `doodad` (they are engine identifiers and are persisted
      // in `seenLessons`); only the words a player reads are the board's plain ones.
      { key: "t-doodad", kind: "coach", title: "Expenses", body: find("q-doodad").explain, concept: find("q-doodad").concept, when: ctx === "doodad" },
      { key: "t-q-asset", kind: "quiz", q: find("q-asset"), when: state.dealsBought >= 2 },
      // the number on every deal card — explained once they own something to apply it to
      { key: "t-coc", kind: "coach", title: "Cash-on-cash return", body: find("q-coc").explain, concept: find("q-coc").concept, when: owns >= 1 && state.dealsBought >= 2 },
      // the bank, the moment it has teeth
      { key: "t-bankloan", kind: "quiz", q: find("q-bankloan"), when: state.liabilities.bankLoan > 0 },
      { key: "t-debt-spiral", kind: "coach", title: "The spiral", body: "Your bank loan is past 60% of what the bank will lend. At 10% a month the payment grows faster than a payday can cover it — repay it, or sell an asset, before a bill lands that the bank won't cover.", concept: "Bad debt", when: bankLoanStress(state) >= 0.6 },
      { key: "t-half", kind: "coach", ...MILESTONE_LESSONS.halfway, concept: "Passive income", when: fr >= 0.5 },
      { key: "t-q-passive", kind: "quiz", q: find("q-passive"), when: fr >= 0.5 },
      { key: "t-almost", kind: "coach", ...MILESTONE_LESSONS.almost, when: fr >= 0.75 },
      { key: "t-escape", kind: "coach", title: "Financial freedom", body: find("q-escape").explain, concept: find("q-escape").concept, when: fr >= 0.85 },
    ];
    return beats.find((b) => b.when && !state.seenLessons.includes(b.key)) ?? null;
  }

  function finishResolve(stateAfter: CashflowState, ctx: ResolveCtx = "none") {
    // A run that just ended goes straight to its recap — no quiz on the way out.
    if (stateAfter.status === "lost") {
      endTurn(stateAfter);
      return;
    }
    const beat = pickTeaching(stateAfter, ctx);
    if (!beat) {
      endTurn(stateAfter);
      return;
    }
    const marked = markLessonSeen(stateAfter, beat.key);
    commit(() => marked); // reflect the purchase immediately behind the card
    if (beat.kind === "quiz") {
      quizState.current = marked;
      setPending({ kind: "quiz", q: beat.q });
      return;
    }
    setPending({ kind: "coach", title: beat.title, body: beat.body, concept: beat.concept, then: () => endTurn(marked) });
  }

  // ── opening the right modal for the landed square ──
  function openResolution(state: CashflowState, type: string) {
    setTurnPhase("resolve");
    if (state.track === "rat") {
      switch (type) {
        case "deal":
          setPending({ kind: "deal-choose" });
          return;
        case "doodad": {
          const { card, next } = drawDoodad(state);
          commit(() => next);
          setPending({ kind: "doodad", card });
          return;
        }
        case "charity":
          setPending({ kind: "charity" });
          return;
        case "market": {
          const { card, next } = drawMarket(state);
          // A market report moves every quote BEFORE the card renders, so the
          // prices the player is offered are the prices the engine will honour.
          const moved = card.kind === "stockMarket" ? tickStockPrices(next, card.drift) : next;
          commit(() => moved);
          setPending({ kind: "market", card });
          return;
        }
        case "baby":
          setPending({ kind: "baby" });
          return;
        case "downsized":
          setPending({ kind: "downsized" });
          return;
        case "payday":
        default:
          endTurn(state);
          return;
      }
    }
    // fast track
    switch (type) {
      case "ftdeal": {
        // `(cursor * 7) % 6` reduces to `cursor % 6` — the six Fast Track deals
        // came out in fixed rotation, every run. Use the run's actual RNG.
        const idx = pickIndex(state.seed, state.rngCursor + 47, FAST_TRACK_DEALS.length);
        commit(() => ({ ...state, rngCursor: state.rngCursor + 1 }));
        setPending({ kind: "ftdeal", deal: FAST_TRACK_DEALS[idx] });
        return;
      }
      case "cashflowday":
        setPending({ kind: "cashflowday" });
        return;
      case "dream":
        setPending({ kind: "dream" });
        return;
      case "ftloss":
        setPending({ kind: "ftloss" });
        return;
      default:
        endTurn(state);
    }
  }

  function resolveLanding(state: CashflowState, type: string) {
    const meta = (state.track === "rat" ? RAT_SQUARE_META : FAST_SQUARE_META) as Record<string, { label: string }>;
    lastLanded.current = meta[type]?.label ?? type;
    const coach = SQUARE_COACH[type];
    const key = `sq-${type}`;
    if (state.track === "rat" && coach && !state.seenLessons.includes(key)) {
      // `state` is the post-move snapshot every later handler builds on, so the
      // "seen" mark has to travel forward with it — committing a functional update
      // against the store would be overwritten by the next snapshot commit.
      const marked = markLessonSeen(state, key);
      commit(() => marked);
      setPending({ kind: "coach", title: coach.title, body: coach.body, then: () => openResolution(marked, type) });
      return;
    }
    openResolution(state, type);
  }

  // ── roll + move ──
  function handleRoll() {
    if (busy) return;
    audio.unlock("gameplay");

    if (s.skipTurns > 0) {
      audio.sfx("uitick");
      commit((st) => ({ ...st, skipTurns: st.skipTurns - 1, turn: st.turn + 1 }));
      return;
    }

    const count = isFast ? 2 : s.charityRolls > 0 && twoDice ? 2 : 1;
    const rolled = roll(s, count);
    lastRoll.current = rolled.total;
    setDice(rolled.rolls);
    setTurnPhase("rolling");
    audio.sfx("dice");

    const land = () => {
      audio.sfx("diceLand");
      let moved = beginTurn(rolled.next);
      // Only a roll that actually USED the two-dice choice spends a charity roll.
      // It used to burn on every rat-track roll while any were banked, so a player
      // who rolled a single die lost the benefit they had just paid 10% of their
      // income for.
      if (s.track === "rat" && s.charityRolls > 0 && count === 2) moved = consumeCharityRoll(moved);
      const mv = applyMove(moved, rolled.total);
      setTurnPhase("moving");
      apply(() => mv.state);

      if (mv.paydaysPassed > 0 && mv.paydayAmount !== 0) {
        setPaydayToast(mv.paydayAmount * mv.paydaysPassed);
        setPaydayFlash((n) => n + 1);
        if (mv.paydayAmount >= 0) audio.sfx("cash");
        else audio.sting("bad");
        later(() => setPaydayToast(null), 1800);
      }

      const travel = reduce ? 0 : rolled.total * 165 + 380;
      later(() => {
        audio.accent("stab");
        // Passing Payday can itself end the run (a payday that the bank will no
        // longer cover). Don't open a card on top of a finished game.
        if (mv.state.status === "lost") {
          endTurn(mv.state);
          return;
        }
        resolveLanding(mv.state, mv.landedType);
      }, travel);
    };

    // Physics overlay performs the engine's roll; classic timing otherwise.
    if (!reduce && hasWebGL()) {
      landRef.current = land;
      setRollFx(rolled.rolls);
    } else {
      later(land, reduce ? 120 : 820);
    }
  }

  /** The physics overlay has finished showing the engine's numbers — now actually move. */
  function finishRollFx() {
    setRollFx(null);
    const land = landRef.current;
    landRef.current = null;
    land?.();
  }

  // ── per-modal action handlers ──
  function pickDeal(size: "small" | "big") {
    const drawn = size === "small" ? drawSmallDeal(s) : drawBigDeal(s);
    audio.sfx("page");
    commit(() => drawn.next);
    setPending({ kind: "deal", deal: drawn.card });
  }
  function buyDeal(deal: Deal, shares?: number) {
    let next: CashflowState;
    if (deal.kind === "stock") next = buyStock(s, deal, shares ?? 0);
    else if (deal.kind === "realestate") next = buyRealEstate(s, deal);
    else next = buyBusiness(s, deal);
    audio.sfx("stamp");
    audio.sting("good");
    finishResolve(next, "deal");
  }

  // ── soft "card slides up" cue whenever a resolution modal opens ──
  const pendingKind = pending?.kind ?? null;
  useEffect(() => {
    if (pendingKind) audio.sfx("modal");
    // audio.sfx is a stable useCallback; depend only on the kind transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKind]);

  return {
    turnPhase,
    dice,
    rollFx,
    twoDice,
    setTwoDice,
    pending,
    setPending,
    quizState,
    paydayToast,
    paydayFlash,
    boardPulse,
    busy,
    handleLand,
    handleRoll,
    finishRollFx,
    endTurn,
    finishResolve,
    pickDeal,
    buyDeal,
  };
}
