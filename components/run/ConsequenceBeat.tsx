"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { AshFall } from "@/components/cinematic/film/AshFall";
import { MoneyFall } from "@/components/cinematic/MoneyFall";
import { useDialog } from "@/components/ui/LedgerDialog";
import { conceptsForText, conceptTitle } from "@/lib/concepts";
import { currency } from "@/lib/format";
import type { LifeChoice, LifeEvent, Outcome } from "@/lib/lifeEvents";
import { juiceTier } from "@/src/motion/juice";
import { DUR, EASE } from "@/src/motion/tokens";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { beatFor } from "./consequenceBeats";
import { buildRows, LedgerRows, TONE_VAR } from "./consequenceRows";
import { useConsequenceLadder } from "./useConsequenceLadder";

/**
 * The Phase-2 flagship "consequence beat" — a full-screen ceremony that makes a
 * money outcome *legible*: it shows the choice, counts the delta up from zero,
 * stamps it DEBIT/CREDIT, flashes the net-worth rail, then prints the ledger
 * derivation (e.g. "−$300 / mo × 12 = −$3,600") and the lesson as one quiet
 * voice line. See the rebrand brief §4.
 *
 * Tiering (§4): FULL ceremony when |Δmoney| ≥ $1,000 or the swing is ≥10% of
 * net worth; otherwise a MINOR (trimmed) version. Reduced-motion renders the
 * final state with no motion/ceremony. Any input skips to the final state — via
 * the global input-skip (useSkippable), the plumbing later ceremonies share.
 *
 * The ceremony's clock — the beat-locked phase ladder, the count-up and the landing's
 * follow-through — is `useConsequenceLadder`. This file is the frame it drives.
 */

const FULL_MONEY = 1000;
const FULL_NW_FRACTION = 0.1;

export function ConsequenceBeat({
  event,
  choice,
  outcome,
  netWorthAfter,
  onDone,
}: {
  event: LifeEvent;
  choice: LifeChoice;
  outcome: Outcome;
  netWorthAfter: number;
  onDone: () => void;
}) {
  const { reduced } = useMotionCtx();
  const beat = beatFor(event.id);

  const effect = outcome.effect;
  const cash = effect.cash ?? 0;
  const nwDelta = (effect.cash ?? 0) - (effect.debt ?? 0);
  const netWorthBefore = netWorthAfter - nwDelta;
  const primary = cash !== 0 ? cash : nwDelta;
  const isLoss = primary < 0;
  const isGain = primary > 0;
  const moneyColor = isLoss ? TONE_VAR.loss : isGain ? TONE_VAR.gain : "var(--color-ink)";

  const tier: "full" | "minor" =
    Math.abs(primary) >= FULL_MONEY ||
    (netWorthBefore !== 0 && Math.abs(nwDelta) >= FULL_NW_FRACTION * Math.abs(netWorthBefore))
      ? "full"
      : "minor";

  // How hard this lands. |Δ| as a share of what the player had — floored at
  // FULL_MONEY so a run with (near-)zero net worth can't divide its way to an
  // infinite tier on a $40 swing.
  const juice = useMemo(
    () => juiceTier((Math.abs(nwDelta) / Math.max(Math.abs(netWorthBefore), FULL_MONEY)) * 100),
    [nwDelta, netWorthBefore],
  );

  // the "why": name the concept this outcome teaches; a good (applied) outcome is
  // what raises mastery, so mark it. Display-only — learn() records in LifeEventCard.
  const conceptIds = conceptsForText(outcome.lesson, outcome.consequence);
  const learnedConcept = conceptIds.length > 0 ? conceptTitle(conceptIds[0]) : null;
  const applied = outcome.tone === "good";

  // ---- ledger rows (derivation first, then secondary effects) ---------------
  const rows = buildRows(effect, cash, beat);

  // ---- the ceremony's clock (phases, count-up, landing, skip) ----------------
  const { phase, done, jolt, flash, fall, figureRef, figureText, skip } = useConsequenceLadder({
    reduced,
    tier,
    primary,
    isGain,
    isLoss,
    tone: outcome.tone,
    juice,
    rowCount: rows.length,
    onDone,
  });

  // Focus trap + Escape + body scroll lock, from the house dialog hook. `onClose: skip`
  // (not `onDone`) keeps Escape on the same two stages as the tap-anywhere handler below:
  // it fast-forwards while the ceremony runs, and dismisses once it has settled.
  const dialogRef = useDialog<HTMLDivElement>({ open: true, onClose: skip });

  const showFigure = reduced || phase === "count" || phase === "land" || phase === "rows" || done;
  const showRows = reduced || phase === "rows" || done;

  // The frame jolt, scaled by the tier. `shakePx` 6 reproduces the amplitude
  // this ceremony used to hardcode, so a mid-sized hit is unchanged.
  const a = juice.shakePx;
  const shake = {
    x: [0, -a, a * 0.83, -a * 0.5, a * 0.33, 0],
    y: [0, a / 3, -a / 3, a / 6, 0, 0],
  };

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Consequence"
      className="fixed inset-0 z-[95] flex flex-col bg-bg text-ink"
      initial={reduced ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.instant }}
      // Tap-anywhere fast-forwards the ceremony, but only while it is still running. Once it
      // has settled, the surface goes inert and the Continue button is the only way out —
      // otherwise a stray tap dismisses the lesson the beat exists to teach.
      onClick={done ? undefined : skip}
    >
      {/* top rail — event tag + net-worth before → after (after flashes on land) */}
      <div className="flex items-stretch border-b border-hairline">
        <div className="flex items-center gap-2.5 border-r border-hairline px-4 py-3 sm:px-6">
          <span className="eyebrow text-ink" style={{ fontSize: "0.6rem", letterSpacing: "0.2em" }}>
            {event.tag}
          </span>
          <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.22em" }}>
            / Consequence
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 px-4 py-3 sm:px-6">
          <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.22em" }}>
            Net worth
          </span>
          <span className="num text-secondary" style={{ fontSize: "0.72rem" }}>
            {currency(netWorthBefore)}
          </span>
          <span className="text-secondary">→</span>
          {/* The rail flash used to tween `backgroundColor` — a paint property, on the
              figure that changes most often in the ceremony. The ink tint is a static
              pre-coloured overlay now and only its OPACITY moves, so the flash is
              compositor-only. Identical colour and DUR.scene window. */}
          <span className="relative num px-1.5 py-0.5" style={{ fontSize: "0.78rem", color: nwDelta < 0 ? TONE_VAR.loss : nwDelta > 0 ? TONE_VAR.gain : "var(--color-ink)" }}>
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: "rgba(242,241,234,0.16)" }}
              initial={false}
              animate={flash ? { opacity: [0, 1, 0] } : { opacity: 0 }}
              transition={{ duration: DUR.scene }}
            />
            <span className="relative">{currency(showFigure ? netWorthAfter : netWorthBefore)}</span>
          </span>
        </div>
      </div>

      {/* main block */}
      <motion.div
        className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-12 lg:px-20"
        animate={jolt ? shake : { x: 0, y: 0 }}
        transition={{ duration: DUR.fast, ease: "easeOut" }}
      >
        {/* choice stamp */}
        <motion.div
          className="flex items-center gap-3"
          initial={reduced ? undefined : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.base, ease: EASE }}
        >
          <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.24em" }}>
            You chose
          </span>
          <motion.span
            className="border border-ink px-3 py-1.5 display-caps text-ink"
            style={{ fontSize: "0.82rem" }}
            initial={reduced ? undefined : { rotate: -2.5, scale: 1.12, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            // bespoke stamp pop — a punchier spring than the house SPRING.pop; kept inline.
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
          >
            {choice.label}
          </motion.span>
        </motion.div>

        {/* headline (lump-sum framing) */}
        {beat?.headline && (
          <p className="eyebrow mt-8 text-secondary" style={{ letterSpacing: "0.22em" }}>
            {beat.headline}
          </p>
        )}

        {/* the money figure + DEBIT/CREDIT stamp */}
        <div className={`flex flex-wrap items-end gap-x-5 gap-y-2 ${beat?.headline ? "mt-2" : "mt-8"}`}>
          <span
            ref={figureRef}
            className="font-anton leading-[0.82] tabular-nums"
            style={{ fontSize: "clamp(3.25rem, 13vw, 8.5rem)", color: showFigure ? moneyColor : "var(--color-tertiary)" }}
          >
            {showFigure ? figureText : "—"}
          </span>
          <AnimatePresence>
            {(phase === "land" || phase === "rows" || done) && (
              <motion.span
                initial={reduced ? undefined : { opacity: 0, scale: juice.stampScale, rotate: -6 }}
                animate={{ opacity: 1, scale: 1, rotate: -3 }}
                className="mb-3 border px-2.5 py-1 display-caps"
                style={{
                  fontSize: "0.72rem",
                  color: "var(--color-bg)",
                  backgroundColor: isGain ? TONE_VAR.gain : TONE_VAR.loss,
                  borderColor: isGain ? TONE_VAR.gain : TONE_VAR.loss,
                }}
              >
                {isGain ? "Credit" : "Debit"}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* consequence line (existing copy) */}
        <motion.p
          className="mt-5 max-w-xl font-body text-[0.97rem] leading-relaxed text-ink-dim"
          initial={reduced ? undefined : { opacity: 0 }}
          animate={{ opacity: showRows ? 1 : 0.35 }}
          transition={{ duration: DUR.base }}
        >
          {outcome.consequence}
        </motion.p>

        {/* ledger rows print in */}
        <LedgerRows rows={rows} show={showRows} reduced={reduced} />

        {/* the concept this outcome teaches — the "why", named and (if applied) banked */}
        {learnedConcept && (
          <motion.div
            className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1.5"
            initial={reduced ? undefined : { opacity: 0, y: 8 }}
            animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: DUR.slow, ease: EASE, delay: reduced ? 0 : 0.08 }}
          >
            <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.24em" }}>
              Lesson learned
            </span>
            <span className="border border-ink px-2.5 py-1 display-caps text-ink" style={{ fontSize: "0.72rem" }}>
              {learnedConcept}
            </span>
            {applied && (
              <span className="num" style={{ fontSize: "0.64rem", color: "var(--color-gain)", letterSpacing: "0.06em" }}>
                mastery ↑
              </span>
            )}
          </motion.div>
        )}

        {/* the lesson as one quiet voice line — no header (§3.3) */}
        {outcome.lesson && (
          <motion.p
            className={`voice ${learnedConcept ? "mt-3" : "mt-7"} max-w-xl text-[1.12rem] leading-snug text-ink`}
            initial={reduced ? undefined : { opacity: 0, y: 8 }}
            animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: DUR.slow, ease: EASE }}
          >
            {outcome.lesson}
          </motion.p>
        )}
      </motion.div>

      {/* The landing's one-shot shower — bills when you gained, ash when you lost,
          count straight from the tier. ONE SHOT by contract (see MoneyFall): it
          never loops and never re-arms, and it only exists on the natural
          full-tier landing, so a skipped or reduced-motion ceremony never sees it. */}
      {fall && tier === "full" && !reduced && (
        isGain ? <MoneyFall count={juice.bills} /> : <AshFall count={juice.bills} />
      )}

      {/* bottom rail — continue affordance */}
      <div className="flex items-stretch border-t border-hairline">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
          className="ml-auto flex items-center gap-2 px-4 py-3.5 text-ink-dim transition-colors hover:text-ink sm:px-6"
        >
          <span className="eyebrow" style={{ fontSize: "0.58rem", letterSpacing: "0.22em" }}>
            {done ? "Continue" : "Skip"}
          </span>
          <span aria-hidden>→</span>
        </button>
      </div>
    </motion.div>
  );
}
