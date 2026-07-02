"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { conceptsForText, conceptTitle } from "@/lib/concepts";
import { currency } from "@/lib/format";
import type { LifeChoice, LifeEvent, Outcome } from "@/lib/lifeEvents";
import { buzz, BUZZ } from "@/src/motion/haptics";
import { DUR, EASE, STAGGER } from "@/src/motion/tokens";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";
import { beatFor } from "./consequenceBeats";

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
 */

const FULL_MONEY = 1000;
const FULL_NW_FRACTION = 0.1;

type Phase = "stamp" | "hold" | "count" | "land" | "rows" | "done";
type RowTone = "loss" | "gain" | "muted";
type Row = { label: string; value: string; tone: RowTone; strong?: boolean; rule?: boolean };

const TONE_VAR: Record<RowTone, string> = {
  loss: "var(--color-loss)",
  gain: "var(--color-gain)",
  muted: "var(--color-secondary)",
};

function signedMoney(n: number): string {
  const s = n < 0 ? "−" : n > 0 ? "+" : "";
  return `${s}${currency(Math.abs(n))}`;
}
function signedInt(n: number): string {
  return `${n < 0 ? "−" : "+"}${Math.abs(Math.round(n))}`;
}

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
  const audio = useAudio();
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

  // the "why": name the concept this outcome teaches; a good (applied) outcome is
  // what raises mastery, so mark it. Display-only — learn() records in LifeEventCard.
  const conceptIds = conceptsForText(outcome.lesson, outcome.consequence);
  const learnedConcept = conceptIds.length > 0 ? conceptTitle(conceptIds[0]) : null;
  const applied = outcome.tone === "good";

  // ---- ledger rows (derivation first, then secondary effects) ---------------
  const rows: Row[] = [];
  const d = beat?.derivation;
  const reconciled = !!d && Math.abs(cash) === d.monthly * d.months;
  if (d && reconciled) {
    rows.push({ label: d.unitLabel, value: `${cash < 0 ? "−" : "+"}${currency(d.monthly)} / mo`, tone: cash < 0 ? "loss" : "gain" });
    rows.push({ label: "×", value: `${d.months} ${d.periodLabel}`, tone: "muted" });
    rows.push({ label: d.totalLabel, value: signedMoney(cash), tone: cash < 0 ? "loss" : "gain", strong: true, rule: true });
  }
  if (effect.debt) rows.push({ label: "Debt", value: signedMoney(effect.debt), tone: effect.debt > 0 ? "loss" : "gain" });
  if (effect.salaryTo !== undefined) rows.push({ label: "Salary", value: `→ ${currency(effect.salaryTo)}`, tone: "muted" });
  if (effect.salaryPct) rows.push({ label: "Pay", value: `${effect.salaryPct > 0 ? "+" : "−"}${Math.abs(effect.salaryPct)}%`, tone: effect.salaryPct > 0 ? "gain" : "loss" });
  if (effect.health) rows.push({ label: "Health", value: signedInt(effect.health), tone: effect.health > 0 ? "gain" : "loss" });
  if (effect.happiness) rows.push({ label: "Mood", value: signedInt(effect.happiness), tone: effect.happiness > 0 ? "gain" : "loss" });

  // ---- state machine --------------------------------------------------------
  const [phase, setPhase] = useState<Phase>(reduced ? "done" : "stamp");
  const [count, setCount] = useState(reduced ? Math.abs(primary) : 0);
  const [jolt, setJolt] = useState(false);
  const [flash, setFlash] = useState(false);
  const timers = useRef<number[]>([]);
  const rafRef = useRef(0);
  const done = phase === "done";

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // lock body scroll while the overlay owns the screen
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // opening sequence: stamp → (hold) → count
  useEffect(() => {
    if (reduced) {
      audio.sting(isLoss ? "bad" : isGain ? "good" : "neutral");
      return;
    }
    audio.sfx("stamp");
    if (tier === "full") {
      at(140, () => audio.accent("riser"));
      at(470, () => setPhase("hold"));
      at(1010, () => setPhase("count"));
    } else {
      at(300, () => setPhase("count"));
    }
    return clearTimers;
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // count-up rAF; hands off to "land" when the figure lands
  useEffect(() => {
    if (phase !== "count") return;
    const to = Math.abs(primary);
    const start = performance.now();
    const dur = tier === "full" ? 1100 : 700;
    audio.sfx("uitick");
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(to * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setCount(to);
        setPhase("land");
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // landing: money cue + invert stamp + frame jolt + HUD-rail flash, then rows
  useEffect(() => {
    if (phase !== "land") return;
    if (isGain) {
      audio.sfx("cash");
      audio.sting("good");
      audio.accent("stampGood");
    } else if (isLoss) {
      audio.sting(outcome.tone === "bad" ? "bad" : "warning");
      audio.accent("stampBad");
    } else {
      audio.sting("neutral");
    }
    if (tier === "full") {
      at(60, () => audio.accent("consequence"));
      buzz(BUZZ.land, audio.muted); // §13 #11 — impact haptic with the stamp
      setJolt(true);
      setFlash(true);
      at(360, () => setJolt(false));
      at(900, () => setFlash(false));
    } else {
      setFlash(true);
      at(700, () => setFlash(false));
    }
    at(420, () => setPhase("rows"));
    at(420 + rows.length * 140 + 260, () => setPhase("done"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const skip = useCallback(() => {
    if (done) {
      onDone();
      return;
    }
    clearTimers();
    setCount(Math.abs(primary));
    setJolt(false);
    setFlash(false);
    setPhase("done");
  }, [done, onDone, clearTimers, primary]);

  // Global input-skip: while the ceremony is still animating (!done), any pointer/key
  // anywhere jumps it to the final state. It unregisters at `done`, so ambient input
  // skips the animation but never advances — the Continue control below owns that.
  useSkippable(!done, skip);

  const showFigure = reduced || phase === "count" || phase === "land" || phase === "rows" || done;
  const showRows = reduced || phase === "rows" || done;
  const figureText = `${isLoss ? "−" : isGain ? "+" : ""}${currency(count)}`;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Consequence"
      className="fixed inset-0 z-[95] flex flex-col bg-bg text-ink"
      initial={reduced ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.instant }}
      onClick={skip}
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
          <motion.span
            className="num px-1.5 py-0.5"
            style={{ fontSize: "0.78rem", color: nwDelta < 0 ? TONE_VAR.loss : nwDelta > 0 ? TONE_VAR.gain : "var(--color-ink)" }}
            animate={flash ? { backgroundColor: ["rgba(242,241,234,0)", "rgba(242,241,234,0.16)", "rgba(242,241,234,0)"] } : { backgroundColor: "rgba(242,241,234,0)" }}
            transition={{ duration: DUR.scene }}
          >
            {currency(showFigure ? netWorthAfter : netWorthBefore)}
          </motion.span>
        </div>
      </div>

      {/* main block */}
      <motion.div
        className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-12 lg:px-20"
        animate={jolt ? { x: [0, -6, 5, -3, 2, 0], y: [0, 2, -2, 1, 0, 0] } : { x: 0, y: 0 }}
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
            className="font-anton leading-[0.82] tabular-nums"
            style={{ fontSize: "clamp(3.25rem, 13vw, 8.5rem)", color: showFigure ? moneyColor : "var(--color-tertiary)" }}
          >
            {showFigure ? figureText : "—"}
          </span>
          <AnimatePresence>
            {(phase === "land" || phase === "rows" || done) && (
              <motion.span
                initial={reduced ? undefined : { opacity: 0, scale: 1.3, rotate: -6 }}
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
        <div className="mt-6 max-w-lg">
          {rows.map((r, i) => (
            <motion.div
              key={`${r.label}-${i}`}
              className={`flex items-baseline gap-2 py-1.5 ${r.rule ? "mt-1 border-t border-hairline pt-2.5" : ""}`}
              initial={reduced ? undefined : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={showRows ? { opacity: 1, clipPath: "inset(0 0 0% 0)" } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: DUR.fast, ease: EASE, delay: showRows && !reduced ? i * STAGGER.loose : 0 }}
            >
              <span
                className={r.strong ? "display-caps text-ink" : "eyebrow text-secondary"}
                style={{ fontSize: r.strong ? "0.72rem" : "0.62rem", letterSpacing: r.strong ? "0.08em" : "0.14em" }}
              >
                {r.label}
              </span>
              <span className="mt-1 flex-1 rule-dotted" />
              <span
                className="num"
                style={{ fontSize: r.strong ? "0.92rem" : "0.76rem", color: TONE_VAR[r.tone] }}
              >
                {r.value}
              </span>
            </motion.div>
          ))}
        </div>

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
