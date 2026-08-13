"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { SPRING } from "@/src/motion/tokens";

/**
 * The house button. LEDGER: square-ish, mono, flat — emphasis comes from inversion, never
 * glow. Four variants do all the work; `inverted` flips a variant's fill (what the old
 * `paper` variant hard-coded).
 *
 * The legacy names (`outline`, `paper`, `brass`) are still accepted so the ~40 existing call
 * sites keep compiling through this phase; they normalize onto the four below and go away in
 * the screen-by-screen sweep. `NeonButton` is an alias of this component for the same reason.
 */

type CoreVariant = "primary" | "secondary" | "ghost" | "danger";
/** Transitional — removed once every call site has moved. */
type LegacyVariant = "outline" | "paper" | "brass";
type Variant = CoreVariant | LegacyVariant;
type Size = "sm" | "md" | "lg";

const LEGACY: Record<LegacyVariant, { variant: CoreVariant; inverted?: boolean }> = {
  outline: { variant: "secondary" },
  brass: { variant: "secondary" },
  paper: { variant: "primary", inverted: true },
};

const VARIANTS: Record<CoreVariant, string> = {
  primary: "bg-ink text-bg border-ink hover:bg-ink-bright",
  secondary: "bg-transparent text-ink border-hairline-strong hover:bg-ink hover:text-bg",
  ghost: "bg-transparent text-ink-dim border-transparent hover:text-ink",
  danger: "bg-transparent text-loss border-loss hover:bg-loss hover:text-bg",
};

/** `inverted` = start from the filled state and empty out on hover (the old `paper`). */
const INVERTED: Record<CoreVariant, string> = {
  primary: "bg-ink text-bg border-ink hover:bg-transparent hover:text-ink",
  secondary: "bg-ink text-bg border-ink hover:bg-transparent hover:text-ink",
  ghost: "bg-transparent text-ink border-transparent hover:text-ink-dim",
  danger: "bg-loss text-bg border-loss hover:bg-transparent hover:text-loss",
};

const SIZES: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-[0.7rem]",
  md: "px-5 py-2.5 text-[0.8rem]",
  lg: "px-7 py-3.5 text-sm",
};

/**
 * Touch targets: the visual height stays as designed, but a `::before` layer expands the
 * *hit* area vertically to clear 44px (WCAG 2.5.8 / HIG). It's part of the button, so it
 * needs no pointer-events juggling; it only overlaps the gaps between stacked controls.
 */
const HIT: Record<Size, string> = {
  sm: "before:content-[''] before:absolute before:inset-x-0 before:-inset-y-[8px]",
  md: "before:content-[''] before:absolute before:inset-x-0 before:-inset-y-[3px]",
  lg: "",
};

export function LedgerButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  disabled = false,
  inverted = false,
  loading = false,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: Variant;
  size?: Size;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  /** Flip the fill: filled at rest, empty on hover. */
  inverted?: boolean;
  /** Blinking caret + disabled, for an action that is in flight. */
  loading?: boolean;
  "aria-label"?: string;
}) {
  const { reduced } = useMotionCtx();
  const legacy = variant in LEGACY ? LEGACY[variant as LegacyVariant] : null;
  const core: CoreVariant = legacy ? legacy.variant : (variant as CoreVariant);
  const flip = inverted || !!legacy?.inverted;
  const inert = disabled || loading;

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={inert}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      data-radius=""
      whileHover={inert || reduced ? undefined : { y: -1 }}
      whileTap={inert ? undefined : { scale: 0.97 }}
      transition={SPRING.press}
      className={`group relative inline-flex items-center justify-center gap-2 border display-caps tracking-[0.12em] transition-colors duration-200 disabled:cursor-not-allowed ${
        loading ? "disabled:opacity-70" : "disabled:opacity-40"
      } ${(flip ? INVERTED : VARIANTS)[core]} ${SIZES[size]} ${HIT[size]} ${className}`}
    >
      {/* §8.3 bracket highlight — corner marks that register on hover/focus */}
      <span aria-hidden className="pointer-events-none absolute left-0.5 top-0.5 h-1.5 w-1.5 border-l border-t border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 border-r border-t border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      <span aria-hidden className="pointer-events-none absolute bottom-0.5 left-0.5 h-1.5 w-1.5 border-b border-l border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      <span aria-hidden className="pointer-events-none absolute bottom-0.5 right-0.5 h-1.5 w-1.5 border-b border-r border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      {children}
      {loading && (
        <motion.span
          aria-hidden
          className="inline-block h-[0.85em] w-[0.5ch] bg-current"
          animate={reduced ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
          transition={reduced ? undefined : { duration: 1.05, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
        />
      )}
    </motion.button>
  );
}

/** Transitional alias — the old name, same component. Removed in the cleanup sweep. */
export { LedgerButton as NeonButton };
