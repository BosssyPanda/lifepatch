"use client";

import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { BlockSpark } from "@/components/ui/BlockSpark";
import { ChevronDown, InfoIcon } from "@/components/icons";
import { currency } from "@/lib/format";
import { homeEquity, netWorth, type RunState, yearIndex } from "@/lib/runEngine";
import { juiceTier } from "@/src/motion/juice";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE, SPRING } from "@/src/motion/tokens";

// LEDGER: meters read gain (green) high, secondary (grey) mid, loss (red) low.
function barVar(v: number) {
  return v >= 60 ? "var(--color-gain)" : v >= 35 ? "var(--color-secondary)" : "var(--color-loss)";
}

/**
 * HUD micro-interaction (Addendum A §8.2): when a tracked value changes, its
 * numeral gets a one-shot background tint flash in gain/loss color — the same
 * pulse the consequence beat's net-worth rail uses.
 *
 * The tint used to be animated as `backgroundColor` on the numeral itself, which
 * is a paint-property tween on the most frequently-changing figures in the game.
 * It is now the OPACITY of a pre-tinted, absolutely-positioned overlay: the fill
 * colour is static, only opacity moves, so the whole flash stays on the
 * compositor (DESIGN.md § Motion). Same colours, same ≤600ms window.
 *
 * A tint alone is easy to miss on a HUD you aren't looking at, so the figure also
 * POPS: scale 1 → `juiceTier().popScale` → 1, sized by how big the change was
 * relative to where the number stood. Transform + opacity only — the pop rides
 * the same compositor path as the tint and never touches the overlay's contract.
 * Reduced motion keeps the tint (feedback is never deleted) and drops the pop.
 */
/* Mixed from the tokens, not transcribed from them. These were literal rgba() —
   43,213,118 and 255,59,48 — which is the palette from BEFORE the Risograph pass,
   so the HUD had been flashing the old green and the old red ever since. An rgba()
   triplet is invisible to a search for hex, which is exactly how it survived. */
const FLASH_TINT = {
  gain: "color-mix(in srgb, var(--color-gain) 16%, transparent)",
  loss: "color-mix(in srgb, var(--color-loss) 16%, transparent)",
} as const;

/**
 * 44px of hit box without changing how big either control looks. Both expanders stay
 * inside the header's own `py-2.5`, so neither bleeds into the sticky rail above or the
 * page below; the chevron's horizontal 7px lands on the net-worth column, which is text.
 */
const ICON_HIT = "relative before:absolute before:-inset-[7px] before:content-['']";
const TEXT_HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[8px] before:content-['']";

function FlashValue({ value, children, delta = false }: { value: number; children: ReactNode; delta?: boolean }) {
  const { reduced } = useMotionCtx();
  const prev = useRef(value);
  const [flash, setFlash] = useState<"gain" | "loss" | null>(null);
  /** The signed figure to float off this number, keyed so a repeat amount re-fires. */
  const [bubble, setBubble] = useState<{ id: number; amount: number; tier: 0 | 1 | 2 } | null>(null);
  const pop = useAnimationControls();
  useEffect(() => {
    if (value === prev.current) return;
    const change = value - prev.current;
    const magnitudePct = (Math.abs(change) / Math.max(Math.abs(prev.current), 1)) * 100;
    setFlash(value > prev.current ? "gain" : "loss");
    prev.current = value;
    const { popScale, tier } = juiceTier(magnitudePct);
    if (!reduced) {
      void pop
        .start({ scale: popScale }, SPRING.press)
        .then(() => pop.start({ scale: 1 }, SPRING.lift))
        .catch(() => {});
    }
    // The board throws a signed figure off the square that produced it; the HUD only
    // ever popped in place, so a player watching the board learned what moved and a
    // player watching the HUD did not. Same idea, same tiering — deliberately NOT the
    // board's absolute log10 scale: out here a $5,000 swing means something different
    // at $10k net worth than at $2M, and `juiceTier` is already relative to the figure.
    if (delta) setBubble({ id: Date.now(), amount: change, tier });
  }, [value, reduced, pop, delta]);
  return (
    <motion.span className="relative -mx-1 inline-block px-1" animate={pop} style={{ originX: 0.5, originY: 0.5 }}>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: FLASH_TINT[flash ?? "gain"] }}
        initial={false}
        animate={flash ? { opacity: [0, 1, 0] } : { opacity: 0 }}
        transition={{ duration: DUR.scene }}
      />
      <span className="relative">{children}</span>
      {bubble && (
        <motion.span
          key={bubble.id}
          aria-hidden
          className="num pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 whitespace-nowrap leading-none"
          style={{
            color: bubble.amount > 0 ? "var(--color-gain)" : "var(--color-loss)",
            fontSize: `${0.62 + 0.06 * bubble.tier}rem`,
          }}
          initial={reduced ? { opacity: 1, y: -12 } : { opacity: 0, y: 0, scale: 0.8 }}
          animate={reduced ? { opacity: 1, y: -12 } : { opacity: [0, 1, 1, 0], y: -(16 + 8 * bubble.tier), scale: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.8 + 0.2 * bubble.tier, times: [0, 0.14, 0.68, 1], ease: "easeOut" }}
          onAnimationComplete={() => setBubble(null)}
        >
          {/* the sign is always printed, so colour is the second channel and never the only one */}
          {bubble.amount > 0 ? "+" : "−"}
          {currency(Math.abs(bubble.amount))}
        </motion.span>
      )}
    </motion.span>
  );
}

export function YearHud({
  run,
  saving,
  onOpenAlmanac,
}: {
  run: RunState;
  saving: boolean;
  onOpenAlmanac: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nw = netWorth(run);
  const nwVar = nw >= 0 ? "var(--color-gain)" : "var(--color-loss)";

  return (
    <header className="sticky top-8 z-40 border-b border-hairline bg-bg">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2.5 sm:gap-6 sm:px-5">
        <div className="shrink-0">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>Year</p>
          {/* The year you are IN — the accent's "what is live" job. Every other figure in
              this rail is money and stays on the gain/loss/ink scale, so the one orange
              number in the HUD can never be mistaken for an amount. */}
          <p className="num text-2xl leading-none text-accent">{yearIndex(run)}</p>
        </div>
        <div className="hidden h-7 w-px shrink-0 bg-hairline sm:block" />

        <Stat label="Age" value={`${run.age}`} />
        <Stat label="Cash" animated={run.cash} fmt={currency} delta />
        <div className="flex flex-1 flex-col">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>Net worth</p>
          {/* The live region carries the settled figure only — the count-up itself is
              hidden, or every rAF frame would be announced. */}
          <p className="num text-lg sm:text-xl" style={{ color: nwVar }} aria-live="polite" aria-atomic="true">
            <span aria-hidden>
              <FlashValue value={nw} delta>
                <AnimatedNumber value={nw} format={currency} />
              </FlashValue>
            </span>
            <span className="sr-only">Net worth {currency(nw)}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAlmanac}
          data-radius=""
          className={`${TEXT_HIT} hidden shrink-0 items-center gap-1 border border-hairline-strong px-2.5 py-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink sm:flex`}
        >
          <InfoIcon size={14} /><span className="eyebrow" style={{ fontSize: "0.58rem" }}>Learn</span>
        </button>
        {/* This used to rest at opacity 0.5 over `text-secondary` (≈2.6:1, unreadable) and
            pulse on an unguarded `repeat: Infinity`. The word already says which state it is
            in, so the animation was carrying nothing the text wasn't — it is gone, and the
            colour is the token meant for faint-but-legible. */}
        <span
          className="hidden shrink-0 eyebrow text-tertiary md:inline"
          style={{ fontSize: "0.56rem" }}
        >
          {saving ? "Saving…" : "Saved"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Toggle full stats"
          data-radius=""
          className={`${ICON_HIT} shrink-0 border border-hairline-strong p-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink`}
        >
          <motion.span animate={{ rotate: open ? 180 : 0 }} className="block"><ChevronDown size={16} /></motion.span>
        </button>
      </div>

      {/* The drawer used to animate `height: 0 ↔ "auto"`, which made framer measure the
          content every open AND reflow the whole page under a *sticky* header for the
          full tween. It now takes its natural height in one discrete step and reveals
          with a clip-path wipe (the house paper-feed grammar) — one layout per toggle
          instead of one per frame, and the reveal itself is compositor-only. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ clipPath: "inset(0 0 100% 0)", opacity: 0 }}
            animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1 }}
            exit={{ clipPath: "inset(0 0 100% 0)", opacity: 0, transition: { duration: DUR.exitFast, ease: EASE } }}
            transition={{ duration: DUR.fast, ease: EASE }}
            className="overflow-hidden border-t border-hairline bg-bg2"
          >
            <div className="mx-auto grid max-w-5xl gap-3 px-3 py-3 sm:grid-cols-3 sm:px-5">
              <div className="space-y-2">
                <KV label="Salary" value={run.salary > 0 ? `${currency(run.salary)}/yr` : "Unemployed"} colorVar={run.salary > 0 ? "var(--color-ink)" : "var(--color-loss)"} />
                <KV label="Debt" value={currency(run.debt)} colorVar={run.debt > 0 ? "var(--color-loss)" : "var(--color-gain)"} />
                <KV label="Job" value={run.salary > 0 ? run.job : "Looking for work"} colorVar="var(--color-secondary)" />
                {run.history.length > 1 && (
                  <div className="flex items-baseline justify-between">
                    <span className="eyebrow text-secondary">Trend</span>
                    <BlockSpark values={run.history.map((h) => h.netWorth)} />
                  </div>
                )}
              </div>
              <div className="space-y-2.5">
                <Bar label="Health" v={run.life.health} />
                <Bar label="Mood" v={run.life.happiness} />
              </div>
              <div className="space-y-2">
                <KV label="Status" value={run.life.partner ? "Married" : "Single"} colorVar="var(--color-secondary)" />
                <KV label="Kids" value={`${run.life.kids}`} colorVar="var(--color-secondary)" />
                {/* "Homeowner" alone, next to a net-worth figure that silently includes the
                    house's equity, is the one holding the run could not read. Commit 4 gave
                    the Portfolio a Home tile; this is the HUD's half of the same fact. */}
                <KV
                  label="Home"
                  value={run.life.housing === "owned" ? `Homeowner · ${currency(homeEquity(run))} equity` : "Renting"}
                  colorVar="var(--color-secondary)"
                />
              </div>
              <button type="button" onClick={onOpenAlmanac} className="eyebrow text-ink sm:hidden">Open the Almanac →</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Stat({ label, value, animated, fmt, delta = false }: { label: string; value?: string; animated?: number; fmt?: (n: number) => string; delta?: boolean }) {
  const live = animated !== undefined && !!fmt;
  return (
    <div className="flex flex-col">
      <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>{label}</p>
      <p
        className="num text-base sm:text-lg text-ink"
        aria-live={live ? "polite" : undefined}
        aria-atomic={live ? true : undefined}
      >
        {live ? (
          <>
            <span aria-hidden>
              <FlashValue value={animated!} delta={delta}>
                <AnimatedNumber value={animated!} format={fmt!} />
              </FlashValue>
            </span>
            <span className="sr-only">{label} {fmt!(animated!)}</span>
          </>
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function KV({ label, value, colorVar }: { label: string; value: string; colorVar: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="eyebrow text-secondary">{label}</span>
      <span className="num text-sm" style={{ color: colorVar }}>{value}</span>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const colorVar = barVar(v);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-secondary">{label}</span>
        <span className="num text-xs" style={{ color: colorVar }}>
          <FlashValue value={v}>{Math.round(v)}</FlashValue>
        </span>
      </div>
      {/* fixed-size track, scaling fill: `width` was a layout tween on a meter that
          moves every year — `scaleX` from the left edge is the same picture on the
          compositor. Same spring, so the settle still overshoots identically. */}
      <div className="mt-1 h-2 overflow-hidden bg-hairline">
        <motion.div
          className="h-full w-full origin-left"
          style={{ background: colorVar }}
          animate={{ scaleX: Math.max(0, Math.min(100, v)) / 100 }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}
