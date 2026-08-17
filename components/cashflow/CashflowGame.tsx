"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { BrainIcon, FreedomIcon, InfoIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { useAudio } from "@/hooks/useAudio";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { conceptsForText } from "@/lib/concepts";
import { Dice } from "@/components/cashflow/board/Dice";
import { BoardBackdrop } from "@/components/cashflow/board/BoardBackdrop";
import { HudRail } from "@/components/ui/HudRail";

import { Board3D, DiceRollOverlay } from "@/components/cashflow/board/lazy";
import { useCashflowTurn } from "@/components/cashflow/useCashflowTurn";
import { FtDealCard, FtDreamCard, FtSimpleCard } from "@/components/cashflow/cards/FastTrackCards";
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
import { FAST_TRACK_CASHFLOW_GOAL, getDream } from "@/lib/cashflow/dreams";
import { FT_SETBACK_ACTION, FT_SETBACK_BODY, FT_SETBACK_TITLE } from "@/lib/cashflow/messages";
import {
  addBaby,
  applyDownsized,
  applyFtLoss,
  applyWindfall,
  buyDream,
  buyFastTrackDeal,
  collectCashflowDay,
  donateCharity,
  fastTrackMonthly,
  payDoodad,
  sellBusiness,
  sellProperty,
} from "@/lib/cashflow/engine";
import { TUTORIAL_STEPS } from "@/lib/cashflow/lessons";
import { getProfession } from "@/lib/cashflow/professions";
import { currency } from "@/lib/format";
import type { CashflowState } from "@/lib/cashflow/types";


// `ratColor` / `fastColor` (per-tile chip palettes) and `modalTone` (the modal aura
// tone) were computed here, threaded through props, and then discarded on the other
// side — `Board` did `void colorFor`, `Modal` did `void tone`. The LEDGER tint map in
// `Board` and the flat scrim in `Modal` superseded both. All three are gone.

export function CashflowGame({
  s,
  apply,
  commit,
  onExit,
  onOpenAlmanac,
}: {
  s: CashflowState;
  apply: (fn: (s: CashflowState) => CashflowState) => void;
  commit: (fn: (s: CashflowState) => CashflowState) => void;
  onExit: () => void;
  onOpenAlmanac?: () => void;
}) {
  const audio = useAudio();
  const { learn } = useConceptLearn();
  const isFast = s.track === "fast";

  // Screen-owned overlays. The tutorial also has to freeze the board, so it is what
  // the turn machine is told to treat as blocking.
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(!s.tutorialDone);

  // ── the turn: roll, move, land, resolve (components/cashflow/useCashflowTurn) ──
  const {
    turnPhase, dice, rollFx, twoDice, setTwoDice,
    pending, setPending, quizState,
    paydayToast, paydayFlash, boardPulse, busy,
    handleLand, handleRoll, finishRollFx,
    endTurn, finishResolve, pickDeal, buyDeal,
  } = useCashflowTurn({ s, apply, commit, blocked: tutorialOpen });

  const dream = getDream(s.dreamId);
  const prof = getProfession(s.professionId);

  const rollLabel = s.skipTurns > 0 ? `Skip turn · downsized ×${s.skipTurns}` : turnPhase === "idle" ? "Roll" : "…";

  // Leaving destroys the in-memory session; the save on disk survives, so say so.
  const exit = useArmedAction({
    label: "Exit",
    armedLabel: "Tap again — run is saved",
    onArm: () => audio.sfx("uitick"),
    onConfirm: onExit,
  });

  return (
    <div className="relative isolate mx-auto min-h-[100svh] w-full max-w-6xl px-3 py-4 sm:px-5">
      <BoardBackdrop />
      <HudRail
        mode={isFast ? "Fast Track" : "Rat Race"}
        counter={`Turn ${String(s.turn).padStart(2, "0")}`}
        className="-mx-3 -mt-4 mb-3 sm:-mx-5"
      />
      {rollFx && (
        <DiceRollOverlay values={rollFx} onDone={finishRollFx} />
      )}
      {/* HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow text-ink" style={{ fontSize: "0.58rem" }}>
            {isFast ? "Fast Track" : "The Rat Race"} · Turn {s.turn}
          </p>
          <h1 className="display-caps truncate text-xl text-ink sm:text-2xl">{prof.title}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden border border-hairline bg-bg2 px-3 py-1.5 num text-sm text-ink sm:inline">
            Cash <Money n={s.cash} className="text-gain" />
          </span>
          {onOpenAlmanac && (
            <button
              onClick={() => { audio.sfx("modal"); onOpenAlmanac(); }}
              aria-label="Open the Almanac"
              className="grid h-11 w-11 place-items-center border border-hairline-strong bg-bg2 text-ink-dim transition-colors hover:text-ink"
            >
              <BrainIcon size={18} />
            </button>
          )}
          <button onClick={() => { audio.sfx("modal"); setGlossaryOpen(true); }} aria-label="Glossary" className="grid h-11 w-11 place-items-center border border-hairline-strong bg-bg2 text-ink-dim transition-colors hover:text-ink">
            <InfoIcon size={18} />
          </button>
          <NeonButton
            variant={exit.armed ? "danger" : "ghost"}
            size="sm"
            onClick={exit.onClick}
            onBlur={exit.onBlur}
          >
            <ArmedLabel armed={exit.armed}>{exit.label}</ArmedLabel>
          </NeonButton>
        </div>
      </div>

      {/* main layout — board first everywhere. It used to sit *below* a ~30-row
          statement on mobile, so reaching Roll meant scrolling past it every turn. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* board column */}
        <div>
          <motion.div animate={boardPulse}>
          <Board3D
            squares={isFast ? FAST_BOARD : RAT_BOARD}
            position={s.position}
            labelFor={(t) => (isFast ? FAST_SQUARE_META[t as keyof typeof FAST_SQUARE_META] : RAT_SQUARE_META[t as keyof typeof RAT_SQUARE_META])?.short ?? "?"}
            tokenLabel={s.playerName.charAt(0).toUpperCase()}
            title={isFast ? `Dream: ${dream.title}` : "Escape the Rat Race"}
            onLand={handleLand}
            paydayFlash={paydayFlash}
            onTileHover={() => audio.sfx("hover")}
          >
            {/* gap-3, not gap-2: `sm`'s hit layer reaches 8px past its box and `md`'s
                reaches 3px, so an 8px gap would let the toggle's target overlap Roll's. */}
            <div className="mt-2 flex flex-col items-center gap-3">
              <Dice values={dice} rolling={turnPhase === "rolling"} />
              {!isFast && s.charityRolls > 0 && (
                <NeonButton
                  size="sm"
                  variant="secondary"
                  inverted={twoDice}
                  aria-pressed={twoDice}
                  onClick={() => { audio.sfx("uitick"); setTwoDice((v) => !v); }}
                >
                  Charity: roll {twoDice ? "2 dice" : "1 die"} ({s.charityRolls} left)
                </NeonButton>
              )}
              {/* min-w: the busy "…" label used to collapse the button to ~40px and
                  reflow the whole hub under the board on every roll. */}
              <NeonButton variant="brass" size="md" disabled={busy} onClick={handleRoll} className="min-w-[7rem]">
                {rollLabel}
              </NeonButton>
              {isFast && (
                <p className="num text-[0.66rem] text-ink-dim">
                  +{currency(s.fastTrackCashflow)} / {currency(FAST_TRACK_CASHFLOW_GOAL)} cash flow
                </p>
              )}
            </div>
          </Board3D>
          </motion.div>

          {/* freedom + goal hint under board */}
          <div className="mt-4">
            {isFast ? (
              <div className="border border-hairline bg-bg2 p-3.5">
                <div className="flex items-center gap-2 text-ink">
                  <FreedomIcon size={18} />
                  <span className="eyebrow" style={{ fontSize: "0.6rem" }}>
                    Win the game
                  </span>
                </div>
                <p className="mt-1.5 font-body text-[0.82rem] text-ink-dim">
                  Reach <strong className="text-ink">{dream.title}</strong> ({currency(dream.cost)}) or build{" "}
                  <strong className="text-ink">+{currency(FAST_TRACK_CASHFLOW_GOAL)}/mo</strong> in cash flow. Monthly cash flow now:{" "}
                  <span className="num text-gain">{currency(fastTrackMonthly(s))}</span>.
                </p>
              </div>
            ) : (
              <FreedomMeter s={s} />
            )}
          </div>
        </div>

        {/* statement column */}
        <div>
          <FinancialStatement s={s} />
        </div>
      </div>

      {/* payday toast */}
      <Toast show={paydayToast !== null}>
        {/* A toast is a floating surface, which is exactly what amendment B sanctions — but it
            was asking with `shadow-xl`/`rounded-full`, which the reset eats, so it rendered as
            a flat hard-edged block over the board. */}
        <div
          data-radius=""
          data-elevated=""
          className={`px-5 py-2 display-caps text-lg ${(paydayToast ?? 0) >= 0 ? "bg-gain text-bg" : "bg-loss text-bg"}`}
        >
          {(paydayToast ?? 0) >= 0 ? "Payday +" : "Payday "}
          {currency(paydayToast ?? 0)}
        </div>
      </Toast>

      {/* modals */}
      <AnimatePresence>
        {tutorialOpen && (
          <Modal key="tut" label="How to play">
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
          <Modal key="glo" onClose={() => setGlossaryOpen(false)} maxWidth="max-w-xl" label="Glossary">
            <GlossaryModal onClose={() => setGlossaryOpen(false)} />
          </Modal>
        )}

        {pending && (
          <Modal key={`p-${pending.kind}`} label={pending.kind === "coach" ? pending.title : "Your turn"}>
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
            {pending.kind === "ftloss" && <FtSimpleCard title={FT_SETBACK_TITLE} body={FT_SETBACK_BODY} action={FT_SETBACK_ACTION} tone="bad" onOk={() => { audio.sting("bad"); finishResolve(applyFtLoss(s)); }} />}

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
