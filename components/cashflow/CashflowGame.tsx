"use client";

import { AnimatePresence, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { BankIcon, FreedomIcon, InfoIcon, SoundOffIcon, SoundOnIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { conceptsForText } from "@/lib/concepts";
import { Dice } from "@/components/cashflow/board/Dice";

// WebGL board is loaded only inside the cashflow shell (never the landing bundle).
// It self-falls-back to the flat 2D <Board> when WebGL is unavailable.
const Board3D = dynamic(() => import("@/components/cashflow/board/Board3D").then((m) => m.Board3D), {
  ssr: false,
  loading: () => <div className="mx-auto aspect-square w-full max-w-[560px]" />,
});
import { DealCard, DealChooser } from "@/components/cashflow/cards/DealCard";
import { BabyCard, CharityCard, DoodadCard, DownsizedCard, MarketCardView } from "@/components/cashflow/cards/EventCards";
import { CoachCard, GlossaryModal, QuizCard, Tutorial } from "@/components/cashflow/learn/Learn";
import { FinancialStatement } from "@/components/cashflow/statement/FinancialStatement";
import { FreedomMeter } from "@/components/cashflow/statement/FreedomMeter";
import { Modal, Money, Toast } from "@/components/cashflow/shared";
import {
  FAST_BOARD,
  FAST_SQUARE_META,
  RAT_BOARD,
  RAT_SQUARE_META,
} from "@/lib/cashflow/board";
import { FAST_TRACK_DEALS } from "@/lib/cashflow/decks";
import { FAST_TRACK_CASHFLOW_GOAL, getDream } from "@/lib/cashflow/dreams";
import {
  addBaby,
  applyDownsized,
  applyFtLoss,
  applyMove,
  applyWindfall,
  beginTurn,
  buyBusiness,
  buyDream,
  buyFastTrackDeal,
  buyRealEstate,
  buyStock,
  checkFastWin,
  collectCashflowDay,
  consumeCharityRoll,
  donateCharity,
  drawBigDeal,
  drawDoodad,
  drawMarket,
  drawSmallDeal,
  fastTrackMonthly,
  markEscaped,
  markLessonSeen,
  payDoodad,
  pushLog,
  roll,
  sellBusiness,
  sellProperty,
} from "@/lib/cashflow/engine";
import { QUIZ_BANK, SQUARE_COACH, TUTORIAL_STEPS } from "@/lib/cashflow/lessons";
import type { QuizQuestion as QuizT } from "@/lib/cashflow/lessons";
import { getProfession } from "@/lib/cashflow/professions";
import { freedomRatio } from "@/lib/cashflow/selectors";
import { clamp, currency } from "@/lib/format";
import type { CashflowState, Deal, DoodadCard as DoodadT, FastTrackDeal, MarketCard } from "@/lib/cashflow/types";

type Pending =
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

const ratColor = (t: string) =>
  ({
    deal: "border-ochre/50 bg-ochre/20 text-ochre",
    doodad: "border-brick/50 bg-brick/20 text-brick",
    charity: "border-steel/50 bg-steel/25 text-steel",
    payday: "border-olive/50 bg-olive/20 text-olive",
    market: "border-accent/50 bg-accent/20 text-accent",
    baby: "border-brass/50 bg-brass/20 text-brass",
    downsized: "border-brick/70 bg-brick/40 text-paper",
  })[t] ?? "border-ink/20 bg-bg3 text-ink";

const fastColor = (t: string) =>
  ({
    ftdeal: "border-brass/50 bg-brass/20 text-brass",
    cashflowday: "border-olive/50 bg-olive/20 text-olive",
    dream: "border-accent/70 bg-accent/40 text-paper",
    ftloss: "border-brick/50 bg-brick/20 text-brick",
  })[t] ?? "border-ink/20 bg-bg3 text-ink";

/** Map a pending modal to its emotional tone, driving the Modal's aura color. */
function modalTone(kind: Pending["kind"]): "accent" | "brick" | "neutral" {
  switch (kind) {
    case "deal-choose":
    case "deal":
    case "ftdeal":
    case "cashflowday":
    case "charity":
    case "dream":
      return "accent"; // opportunity
    case "doodad":
    case "downsized":
    case "ftloss":
      return "brick"; // loss / penalty
    default:
      return "neutral"; // coach, market, baby, quiz
  }
}

export function CashflowGame({
  s,
  apply,
  commit,
  onExit,
}: {
  s: CashflowState;
  apply: (fn: (s: CashflowState) => CashflowState) => void;
  commit: (fn: (s: CashflowState) => CashflowState) => void;
  onExit: () => void;
}) {
  const audio = useAudio();
  const { learn } = useConceptLearn();
  const reduce = useReducedMotion();
  const isFast = s.track === "fast";

  const [turnPhase, setTurnPhase] = useState<"idle" | "rolling" | "moving" | "resolve">("idle");
  const [dice, setDice] = useState<number[]>(isFast ? [3, 4] : [6]);
  const [twoDice, setTwoDice] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(!s.tutorialDone);
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

  const dream = getDream(s.dreamId);
  const prof = getProfession(s.professionId);
  const busy = turnPhase !== "idle" || pending !== null || tutorialOpen;

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
      commit((st) => markLessonSeen(st, key));
      setPending({ kind: "coach", title: coach.title, body: coach.body, then: () => openResolution(state, type) });
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

    window.setTimeout(() => {
      audio.sfx("diceLand");
      let moved = beginTurn(rolled.next);
      if (s.track === "rat" && s.charityRolls > 0) moved = consumeCharityRoll(moved);
      const mv = applyMove(moved, rolled.total);
      setTurnPhase("moving");
      apply(() => mv.state);

      if (mv.paydaysPassed > 0 && mv.paydayAmount !== 0) {
        setPaydayToast(mv.paydayAmount * mv.paydaysPassed);
        if (mv.paydayAmount >= 0) audio.sfx("cash");
        else audio.sting("bad");
        window.setTimeout(() => setPaydayToast(null), 1800);
      }

      const travel = reduce ? 0 : rolled.total * 165 + 380;
      window.setTimeout(() => {
        audio.accent("stab");
        resolveLanding(mv.state, mv.landedType);
      }, travel);
    }, reduce ? 120 : 820);
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

  const rollLabel = s.skipTurns > 0 ? `Skip turn · downsized ×${s.skipTurns}` : turnPhase === "idle" ? "Roll" : "…";

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-6xl px-3 py-4 sm:px-5">
      {/* HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow text-accent" style={{ fontSize: "0.58rem" }}>
            {isFast ? "Fast Track" : "The Rat Race"} · Turn {s.turn}
          </p>
          <h1 className="display-caps truncate text-xl text-ink sm:text-2xl">{prof.title}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden rounded-full border border-ink/15 bg-bg2 px-3 py-1.5 num text-sm text-ink sm:inline">
            Cash <Money n={s.cash} className="text-olive" />
          </span>
          <button onClick={() => { audio.sfx("modal"); setGlossaryOpen(true); }} aria-label="Glossary" className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 bg-bg2 text-ink-dim hover:text-ink">
            <InfoIcon size={18} />
          </button>
          <button onClick={() => audio.setMuted(!audio.muted)} aria-label="Toggle sound" className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 bg-bg2 text-ink-dim hover:text-ink">
            {audio.muted ? <SoundOffIcon size={17} /> : <SoundOnIcon size={17} />}
          </button>
          <NeonButton variant="ghost" size="sm" onClick={onExit}>
            Exit
          </NeonButton>
        </div>
      </div>

      {/* main layout */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* board column */}
        <div className="order-2 lg:order-1">
          <Board3D
            squares={isFast ? FAST_BOARD : RAT_BOARD}
            position={s.position}
            colorFor={isFast ? fastColor : ratColor}
            labelFor={(t) => (isFast ? FAST_SQUARE_META[t as keyof typeof FAST_SQUARE_META] : RAT_SQUARE_META[t as keyof typeof RAT_SQUARE_META])?.short ?? "?"}
            tokenLabel={s.playerName.charAt(0).toUpperCase()}
            title={isFast ? `Dream: ${dream.title}` : "Escape the Rat Race"}
            onLand={landingSfx}
            onTileHover={() => audio.sfx("hover")}
          >
            <div className="mt-2 flex flex-col items-center gap-2">
              <Dice values={dice} rolling={turnPhase === "rolling"} />
              {!isFast && s.charityRolls > 0 && (
                <button
                  onClick={() => setTwoDice((v) => !v)}
                  className="rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 num text-[0.66rem] text-accent"
                >
                  Charity: roll {twoDice ? "2 dice" : "1 die"} ({s.charityRolls} left)
                </button>
              )}
              <NeonButton variant="brass" size="md" disabled={busy} onClick={handleRoll}>
                {rollLabel}
              </NeonButton>
              {isFast && (
                <p className="num text-[0.66rem] text-ink-dim">
                  +{currency(s.fastTrackCashflow)} / {currency(FAST_TRACK_CASHFLOW_GOAL)} cash flow
                </p>
              )}
            </div>
          </Board3D>

          {/* freedom + goal hint under board */}
          <div className="mt-4">
            {isFast ? (
              <div className="rounded-[5px] border border-ink/15 bg-bg2 p-3.5">
                <div className="flex items-center gap-2 text-accent">
                  <FreedomIcon size={18} />
                  <span className="eyebrow" style={{ fontSize: "0.6rem" }}>
                    Win the game
                  </span>
                </div>
                <p className="mt-1.5 font-serif text-[0.82rem] text-ink-dim">
                  Reach <strong className="text-ink">{dream.title}</strong> ({currency(dream.cost)}) or build{" "}
                  <strong className="text-ink">+{currency(FAST_TRACK_CASHFLOW_GOAL)}/mo</strong> in cash flow. Monthly cash flow now:{" "}
                  <span className="num text-olive">{currency(fastTrackMonthly(s))}</span>.
                </p>
              </div>
            ) : (
              <FreedomMeter s={s} />
            )}
          </div>
        </div>

        {/* statement column */}
        <div className="order-1 lg:order-2">
          <FinancialStatement s={s} />
        </div>
      </div>

      {/* payday toast */}
      <Toast show={paydayToast !== null}>
        <div className={`rounded-full px-5 py-2 display-caps text-lg shadow-xl ${(paydayToast ?? 0) >= 0 ? "bg-olive text-bg" : "bg-brick text-paper"}`}>
          {(paydayToast ?? 0) >= 0 ? "Payday +" : "Payday "}
          {currency(paydayToast ?? 0)}
        </div>
      </Toast>

      {/* modals */}
      <AnimatePresence>
        {tutorialOpen && (
          <Modal key="tut">
            <Tutorial
              steps={TUTORIAL_STEPS}
              onDone={() => {
                setTutorialOpen(false);
                commit((st) => ({ ...st, tutorialDone: true }));
                audio.sfx("confirm");
              }}
            />
          </Modal>
        )}

        {glossaryOpen && (
          <Modal key="glo" onClose={() => setGlossaryOpen(false)} maxWidth="max-w-xl">
            <GlossaryModal onClose={() => setGlossaryOpen(false)} />
          </Modal>
        )}

        {pending && (
          <Modal key={`p-${pending.kind}`} tone={modalTone(pending.kind)}>
            {pending.kind === "coach" && (
              <CoachCard title={pending.title} body={pending.body} onOk={() => { audio.sfx("confirm"); const then = pending.then; setPending(null); then(); }} />
            )}
            {pending.kind === "deal-choose" && (
              <DealChooser onPick={pickDeal} onPass={() => { audio.sfx("page"); endTurn(s); }} />
            )}
            {pending.kind === "deal" && (
              <DealCard deal={pending.deal} cash={s.cash} onBuy={(shares) => { learn(conceptsForText(pending.deal.lesson), { applied: true }); buyDeal(pending.deal, shares); }} onPass={() => { audio.sfx("page"); endTurn(s); }} />
            )}
            {pending.kind === "doodad" && (
              <DoodadCard card={pending.card} cash={s.cash} onPay={() => { audio.sting("bad"); learn(conceptsForText(pending.card.lesson), { applied: false }); finishResolve(payDoodad(s, pending.card.cost)); }} />
            )}
            {pending.kind === "charity" && (
              <CharityCard s={s} onDonate={() => { audio.sfx("coins"); finishResolve(donateCharity(s)); }} onSkip={() => endTurn(s)} />
            )}
            {pending.kind === "market" && (
              <MarketCardView
                card={pending.card}
                s={s}
                onSellProperty={(uid, price) => { audio.sfx("cash"); commit((st) => sellProperty(st, uid, price)); }}
                onSellBusiness={(uid) => { audio.sfx("cash"); commit((st) => sellBusiness(st, uid)); }}
                onWindfall={(c) => { if (c.cash >= 0) audio.sfx("cash"); else audio.sting("bad"); finishResolve(applyWindfall(s, c)); }}
                onDone={() => endTurn(s)}
              />
            )}
            {pending.kind === "baby" && <BabyCard s={s} onOk={() => { audio.sfx("confirm"); finishResolve(addBaby(s)); }} />}
            {pending.kind === "downsized" && <DownsizedCard s={s} onOk={() => { audio.sting("bad"); finishResolve(applyDownsized(s)); }} />}

            {pending.kind === "ftdeal" && <FtDealCard deal={pending.deal} cash={s.cash} onBuy={() => { audio.sfx("stamp"); audio.sting("good"); finishResolve(buyFastTrackDeal(s, pending.deal)); }} onPass={() => endTurn(s)} />}
            {pending.kind === "cashflowday" && <FtSimpleCard title="Cash Flow Day" body={`Collect your monthly cash flow of ${currency(fastTrackMonthly(s))}.`} action="Collect" onOk={() => { audio.sfx("cash"); finishResolve(collectCashflowDay(s)); }} />}
            {pending.kind === "dream" && <FtDreamCard s={s} onBuy={() => { audio.sting("good"); audio.swellWarmth(); finishResolve(buyDream(s)); }} onPass={() => endTurn(s)} />}
            {pending.kind === "ftloss" && <FtSimpleCard title="Setback" body="A risky venture went sideways. You lose up to $20,000 — even the wealthy manage risk." action="Take the hit" tone="bad" onOk={() => { audio.sting("bad"); finishResolve(applyFtLoss(s)); }} />}

            {pending.kind === "quiz" && (
              <QuizCard
                q={pending.q}
                onDone={(correct) => {
                  audio.sfx(correct ? "chime" : "uitick");
                  learn(conceptsForText(pending.q.concept, pending.q.explain), { applied: correct });
                  const base = quizState.current ?? s;
                  quizState.current = null;
                  endTurn({ ...base, quizzesPassed: base.quizzesPassed + (correct ? 1 : 0) });
                }}
              />
            )}
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── small fast-track modal cards (local) ──
function FtSimpleCard({ title, body, action, tone, onOk }: { title: string; body: string; action: string; tone?: "bad"; onOk: () => void }) {
  return (
    <div className="paper rounded-[6px] p-5">
      <h3 className={`display-caps text-xl ${tone === "bad" ? "text-brick" : "text-paper-ink"}`}>{title}</h3>
      <p className="mt-2 font-serif text-[0.9rem] text-paper-ink/80">{body}</p>
      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" onClick={onOk}>
          {action}
        </NeonButton>
      </div>
    </div>
  );
}

function FtDealCard({ deal, cash, onBuy, onPass }: { deal: FastTrackDeal; cash: number; onBuy: () => void; onPass: () => void }) {
  const afford = cash >= deal.price;
  return (
    <div className="paper rounded-[6px] p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-brass text-bg">
          <BankIcon size={22} />
        </span>
        <div>
          <p className="eyebrow text-paper-dim" style={{ fontSize: "0.58rem" }}>
            Fast Track investment
          </p>
          <h3 className="display-caps text-xl text-paper-ink">{deal.label}</h3>
        </div>
      </div>
      <p className="mt-2 font-serif text-[0.86rem] italic text-paper-ink/65">{deal.flavor}</p>
      <div className="mt-3 flex items-center justify-between rounded-[5px] bg-paper-2 px-3 py-2">
        <span className="font-serif text-[0.84rem] text-paper-ink/70">Price (cash)</span>
        <span className="num font-semibold text-paper-ink">{currency(deal.price)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between rounded-[5px] bg-olive/15 px-3 py-2">
        <span className="font-serif text-[0.84rem] text-paper-ink/70">Adds monthly cash flow</span>
        <span className="num font-bold text-olive">+{currency(deal.cashFlow)}</span>
      </div>
      {!afford && <p className="mt-3 font-serif text-[0.82rem] text-brick">Not enough cash. Land on Cash Flow Days to build up, then return.</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Pass
        </NeonButton>
        <NeonButton variant="paper" size="md" disabled={!afford} onClick={onBuy}>
          Buy · {currency(deal.price)}
        </NeonButton>
      </div>
    </div>
  );
}

function FtDreamCard({ s, onBuy, onPass }: { s: CashflowState; onBuy: () => void; onPass: () => void }) {
  const dream = getDream(s.dreamId);
  const afford = s.cash >= dream.cost;
  return (
    <div className="paper rounded-[6px] p-5">
      <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
        Your Dream
      </p>
      <h3 className="display-caps mt-1 text-2xl text-paper-ink">{dream.title}</h3>
      <p className="mt-1 font-serif text-[0.9rem] text-paper-ink/80">{dream.blurb}</p>
      <div className="mt-3 flex items-center justify-between rounded-[5px] bg-paper-2 px-3 py-2">
        <span className="font-serif text-[0.84rem] text-paper-ink/70">Cost</span>
        <span className="num text-lg font-bold text-paper-ink">{currency(dream.cost)}</span>
      </div>
      {!afford && <p className="mt-3 font-serif text-[0.82rem] text-brick">You have {currency(s.cash)}. Keep building cash flow and come back to claim it.</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Not yet
        </NeonButton>
        <NeonButton variant="paper" size="md" disabled={!afford} onClick={onBuy}>
          Claim my dream
        </NeonButton>
      </div>
    </div>
  );
}
