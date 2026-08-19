"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, type ReactNode } from "react";
import { useDialog } from "@/components/ui/LedgerDialog";
import { currency } from "@/lib/format";

import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * A share price. `currency` rounds to whole dollars, which is right for every
 * other figure in the game but hides the movement on a $5 ticker — the quote
 * board would read "$5" before and after a rally. Cents appear under $100.
 */
export function quoteText(n: number): string {
  return n < 100 ? `$${n.toFixed(2)}` : currency(n);
}

/** Money in tabular display numerals, optionally signed/colored. */
export function Money({
  n,
  className = "",
  signed = false,
}: {
  n: number;
  className?: string;
  signed?: boolean;
}) {
  const s = signed && n > 0 ? `+${currency(n)}` : currency(n);
  return <span className={`num ${className}`}>{s}</span>;
}

/**
 * A modal scaffold: a flat darkening scrim + a card that rises and settles.
 * LEDGER: no aura, no backdrop-blur, no glow — depth comes from the scrim, the card's own
 * hairline frame, and (amendment B) the one sanctioned neutral float shadow.
 *
 * The scrim used to be a full-screen `<button aria-label="Close">`, which put an unlabeled
 * page-sized control in the tab order ahead of the card's real contents. It is a plain div
 * now; `useDialog` owns Escape, the focus trap, focus restore, and the scroll lock.
 *
 * (There used to be a `tone` prop — "accent" / "brick" / "neutral" — computed per pending
 * modal in CashflowGame, threaded through here, and then thrown away with `void tone`: it
 * drove the pre-LEDGER coloured aura, which the flat scrim replaced. Prop and producer
 * are both gone.)
 */
export function Modal({
  children,
  onClose,
  maxWidth = "max-w-lg",
  label = "Dialog",
}: {
  children: ReactNode;
  onClose?: () => void;
  maxWidth?: string;
  label?: string;
}) {
  const { reduced: reduce } = useMotionCtx();
  const noop = useCallback(() => {}, []);
  const ref = useDialog<HTMLDivElement>({ open: true, onClose: onClose ?? noop });
  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      {/* flat scrim — darkens the board so the card reads as lifted */}
      <motion.div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-elevated=""
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        // Leaving is faster than arriving: nobody waits for a dialog to go away,
        // and a spring on the way out just holds the screen hostage (DUR.exitFast).
        exit={
          reduce
            ? { opacity: 0 }
            : { opacity: 0, y: 18, scale: 0.98, transition: { duration: DUR.exitFast, ease: EASE } }
        }
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 24, mass: 0.9 }}
        className={`relative w-full ${maxWidth} thin-scroll max-h-[88svh] overflow-y-auto`}
        data-lenis-prevent
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * The recurring teaching callout. LEDGER §3.3: no "Why this matters" header,
 * no badge — it renders as one quiet serif voice line under a hairline.
 */
export function LessonBox({ children }: { children: ReactNode }) {
  const { reduced: reduce } = useMotionCtx();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE, delay: 0.12 }}
      className="mt-4 border-t border-hairline pt-3"
    >
      <p className="voice text-[1rem] leading-snug text-ink/90">{children}</p>
    </motion.div>
  );
}

/**
 * A short-lived floating toast (payday collected, etc.). `role="status"` — it is
 * `pointer-events-none`, so being announced is the only way a screen-reader user
 * ever learns a payday landed.
 */
export function Toast({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95, transition: { duration: DUR.exitFast, ease: EASE } }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          /* Bottom-RIGHT, above whatever sticky chrome the screen owns.
           *
           * Bottom-centre put it squarely on the primary CTA: measured across four
           * scroll positions it covered 20,262px² of controls on the mobile year
           * screen (51-68% of ADVANCE THE YEAR) and 79% of the hint that explains
           * why that button is dead, plus 3,941px² of the Rat Race statement's
           * controls. Anchoring right of the content column and above the sticky bar
           * measures 0px² on controls on three of those four screens and 268px² on
           * the fourth — see the sweep in the Stage 4c report.
           *
           * `--toast-inset` is published by whichever screen owns sticky bottom
           * chrome (AdvanceBar); it is 0 everywhere else, so the toast keeps its
           * ordinary 8px gap. The safe-area term keeps it clear of a phone's home
           * indicator. */
          style={{ bottom: "calc(var(--toast-inset, 0px) + 8px + env(safe-area-inset-bottom, 0px))" }}
          className="pointer-events-none fixed right-4 z-[90] max-w-[calc(100vw-2rem)]"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
