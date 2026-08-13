"use client";

import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { ACCENT_PREROLL_MS, useBeatClock } from "@/hooks/useBeatClock";
import { AshFall } from "@/components/cinematic/film/AshFall";
import { MoneyFall } from "@/components/cinematic/MoneyFall";
import { conceptsForText, conceptTitle } from "@/lib/concepts";
import { currency } from "@/lib/format";
import type { LifeChoice, LifeEvent, Outcome } from "@/lib/lifeEvents";
import { buzz, BUZZ } from "@/src/motion/haptics";
import { juiceTier } from "@/src/motion/juice";
import { DUR, EASE, HITSTOP, STAGGER } from "@/src/motion/tokens";
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
 *
 * ── beat-lock (see hooks/useBeatClock) ───────────────────────────────────────
 * The ladder below used to be raw milliseconds (140 / 470 / 1010 + an 1100ms
 * count) while the score runs at 76 BPM and quantizes its accents to the
 * transport's 8ths — so the picture and the music agreed by luck. Each boundary
 * now SNAPS to the nearest beat (or 8th) of that same grid: same shape, same
 * feel, but the landing is a downbeat and the `consequence` accent detonates on
 * it. The count-up's duration falls out of the snap as a whole number of beats.
 * A silent or muted player gets the identical ladder on a locally-anchored grid.
 *
 * ── impact (see src/motion/juice) ────────────────────────────────────────────
 * How hard the landing hits is one decision — `juiceTier(|Δ| as % of net worth)`
 * — feeding the shake amplitude, the bill/ash count, the stamp's entry scale and
 * the tick's brightness together, plus a HITSTOP freeze between the impact and
 * its follow-through.
 */

const FULL_MONEY = 1000;
const FULL_NW_FRACTION = 0.1;

/** The pre-quantization ladder, in ms from mount — the shape being preserved. */
const LADDER = {
  full: { riser: 140, hold: 470, count: 1010, land: 2110 },
  minor: { count: 300, land: 1000 },
} as const;

/** Post-landing beats (from the land instant), kept on the existing ms feel. */
const ROWS_MS = 420;
const JOLT_MS = 360;
const FLASH_MS = 900;
const MINOR_FLASH_MS = 700;
const ROW_PRINT_MS = 140;
const ROWS_TAIL_MS = 260;

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
  const clock = useBeatClock();
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
  // `count` is the SETTLED figure only — the tween itself never touches React state
  // (see the count-up effect below), so the ceremony doesn't re-render 60×/s while
  // it is simultaneously running a shake and staggered rows.
  const [count, setCount] = useState(reduced ? Math.abs(primary) : 0);
  const [jolt, setJolt] = useState(false);
  const [flash, setFlash] = useState(false);
  /** The one-shot bill/ash shower, armed by the landing's follow-through. */
  const [fall, setFall] = useState(false);
  const timers = useRef<number[]>([]);
  /** Count-up length in seconds — a whole number of beats, set when the ladder is laid. */
  const countSeconds = useRef((tier === "full" ? 1100 : 700) / 1000);
  const done = phase === "done";

  const figureRef = useRef<HTMLSpanElement>(null);
  const countMV = useMotionValue(reduced ? Math.abs(primary) : 0);
  const countAnim = useRef<{ stop: () => void } | null>(null);
  const signPrefix = isLoss ? "−" : isGain ? "+" : "";
  const fmtFigure = useCallback(
    (n: number) => `${signPrefix}${currency(Math.round(n))}`,
    [signPrefix],
  );
  // the tween writes straight to the DOM node; React never sees the interim values
  useMotionValueEvent(countMV, "change", (v) => {
    const el = figureRef.current;
    if (el) el.textContent = fmtFigure(v);
  });

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    countAnim.current?.stop();
    countAnim.current = null;
  }, []);

  // lock body scroll while the overlay owns the screen
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // opening sequence: stamp → (hold) → count, quantized onto the score's grid.
  useEffect(() => {
    if (reduced) {
      audio.sting(isLoss ? "bad" : isGain ? "good" : "neutral");
      return;
    }
    // The stamp is the ceremony's own downbeat: it fires the instant the overlay
    // mounts and, when nothing is playing, the beat grid anchors right here. It
    // is deliberately NOT delayed onto the transport's next 8th — up to 395ms of
    // dead screen before the first frame reads as lag, not as rhythm.
    audio.sfx("stamp");

    // Accents are quantized by the engine to the next 8th, so a request has to
    // arrive slightly BEFORE the boundary it should sound on.
    const accentAt = (ms: number) => Math.max(0, ms - ACCENT_PREROLL_MS);

    if (tier === "full") {
      const L = LADDER.full;
      const riserAt = clock.snap(L.riser, "8n");
      const holdAt = clock.snap(L.hold, "8n", riserAt + 1);
      const countAt = clock.snap(L.count, "beat", holdAt + 1);
      // the landing is the ceremony's payoff — it gets the downbeat
      const landAt = clock.snap(L.land, "beat", countAt + 1);
      countSeconds.current = (landAt - countAt) / 1000;

      at(accentAt(riserAt), () => audio.accent("riser"));
      at(holdAt, () => setPhase("hold"));
      at(countAt, () => setPhase("count"));
      // pre-rolled so the stamp accents detonate ON the landing beat, not after it
      at(accentAt(landAt), () => {
        if (isGain) audio.accent("stampGood");
        else if (isLoss) audio.accent("stampBad");
        audio.accent("consequence");
      });
    } else {
      // A minor beat is trimmed and quick; locking it to whole beats would
      // stretch it by up to 40%, so it rides the 8th grid instead.
      const L = LADDER.minor;
      const countAt = clock.snap(L.count, "8n");
      const landAt = clock.snap(L.land, "8n", countAt + 1);
      countSeconds.current = (landAt - countAt) / 1000;

      at(countAt, () => setPhase("count"));
      at(accentAt(landAt), () => {
        if (isGain) audio.accent("stampGood");
        else if (isLoss) audio.accent("stampBad");
      });
    }
    return clearTimers;
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // count-up; hands off to "land" when the figure lands. Driven by a MotionValue
  // (one DOM textContent write per frame) instead of setState-per-rAF-frame.
  // Its duration is the gap between two grid boundaries, so the figure settles
  // exactly as the landing beat arrives.
  useEffect(() => {
    if (phase !== "count") return;
    const to = Math.abs(primary);
    audio.sfx("uitick", juice.pitch); // brighter tick the bigger the swing
    countMV.jump(0);
    const controls = animate(countMV, to, {
      duration: Math.max(0.2, countSeconds.current),
      ease: EASE,
      onComplete: () => {
        setCount(to);
        setPhase("land");
      },
    });
    countAnim.current = controls;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Landing. The impact instant is bare: foley + haptic + the DEBIT/CREDIT stamp,
  // and then everything holds still for HITSTOP before the follow-through (shake,
  // rail flash, bill/ash fall) starts. Those few frames of stillness are what make
  // the hit read as a hit rather than as a wobble — the accents already fired,
  // quantized onto this exact beat by the pre-roll above.
  useEffect(() => {
    if (phase !== "land") return;
    if (isGain) {
      audio.sfx("cash");
      audio.sting("good");
    } else if (isLoss) {
      audio.sting(outcome.tone === "bad" ? "bad" : "warning");
    } else {
      audio.sting("neutral");
    }
    const freeze = HITSTOP * 1000;
    if (tier === "full") {
      buzz(BUZZ.land, audio.muted); // §13 #11 — impact haptic with the stamp
      at(freeze, () => {
        setJolt(true);
        setFlash(true);
        setFall(true);
      });
      at(freeze + JOLT_MS, () => setJolt(false));
      at(freeze + FLASH_MS, () => setFlash(false));
    } else {
      at(freeze, () => setFlash(true));
      at(freeze + MINOR_FLASH_MS, () => setFlash(false));
    }
    const rowsAt = clock.snap(freeze + ROWS_MS, "8n", freeze + 1);
    at(rowsAt, () => setPhase("rows"));
    at(rowsAt + rows.length * ROW_PRINT_MS + ROWS_TAIL_MS, () => setPhase("done"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const skip = useCallback(() => {
    if (done) {
      onDone();
      return;
    }
    clearTimers();
    countMV.jump(Math.abs(primary));
    setCount(Math.abs(primary));
    setJolt(false);
    setFlash(false);
    setPhase("done");
  }, [done, onDone, clearTimers, primary, countMV]);

  // Global input-skip: while the ceremony is still animating (!done), any pointer/key
  // anywhere jumps it to the final state. It unregisters at `done`, so ambient input
  // skips the animation but never advances — the Continue control below owns that.
  useSkippable(!done, skip);

  const showFigure = reduced || phase === "count" || phase === "land" || phase === "rows" || done;
  const showRows = reduced || phase === "rows" || done;
  const figureText = fmtFigure(count);

  // The frame jolt, scaled by the tier. `shakePx` 6 reproduces the amplitude
  // this ceremony used to hardcode, so a mid-sized hit is unchanged.
  const a = juice.shakePx;
  const shake = {
    x: [0, -a, a * 0.83, -a * 0.5, a * 0.33, 0],
    y: [0, a / 3, -a / 3, a / 6, 0, 0],
  };

  return (
    <motion.div
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
