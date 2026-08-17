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
} from "@/lib/cashflow/engine";
import { QUIZ_BANK, SQUARE_COACH } from "@/lib/cashflow/lessons";
import type { QuizQuestion as QuizT } from "@/lib/cashflow/lessons";
import { freedomRatio } from "@/lib/cashflow/selectors";
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
  | { kind: "coach"; title: string; body: string; then: () => void }
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

  // ── after an action: maybe inject a contextual quiz, else end ──
  function pickQuiz(state: CashflowState): { key: string; q: QuizT } | null {
    const find = (id: string) => QUIZ_BANK.find((q) => q.id === id)!;
    if (state.dealsBought >= 1 && !state.seenLessons.includes("quiz-first")) return { key: "quiz-first", q: find("q-asset") };
    if (freedomRatio(state) >= 0.5 && !state.seenLessons.includes("quiz-half")) return { key: "quiz-half", q: find("q-passive") };
    if (state.liabilities.bankLoan > 0 && !state.seenLessons.includes("quiz-loan")) return { key: "quiz-loan", q: find("q-bankloan") };
    return null;
  }

  function finishResolve(stateAfter: CashflowState) {
    const quiz = pickQuiz(stateAfter);
    if (quiz) {
      const marked = markLessonSeen(stateAfter, quiz.key);
      commit(() => marked); // reflect the purchase immediately behind the quiz
      quizState.current = marked;
      setPending({ kind: "quiz", q: quiz.q });
      return;
    }
    endTurn(stateAfter);
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
          commit(() => next);
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
        const idx = (state.rngCursor * 7) % FAST_TRACK_DEALS.length;
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
      if (s.track === "rat" && s.charityRolls > 0) moved = consumeCharityRoll(moved);
      const mv = applyMove(moved, rolled.total);
      setTurnPhase("moving");
      apply(() => mv.state);

      if (mv.paydaysPassed > 0 && mv.paydayAmount !== 0) {
        setPaydayToast(mv.paydayAmount * mv.paydaysPassed);
        setPaydayFlash((n) => n + 1);
        if (mv.paydayAmount >= 0) audio.sfx("cash");
        else audio.sting("bad");
        window.setTimeout(() => setPaydayToast(null), 1800);
      }

      const travel = reduce ? 0 : rolled.total * 165 + 380;
      window.setTimeout(() => {
        audio.accent("stab");
        resolveLanding(mv.state, mv.landedType);
      }, travel);
    };

    // Physics overlay performs the engine's roll; classic timing otherwise.
    if (!reduce && hasWebGL()) {
      landRef.current = land;
      setRollFx(rolled.rolls);
    } else {
      window.setTimeout(land, reduce ? 120 : 820);
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
    finishResolve(next);
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
