"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "paper" | "brass";
type Size = "sm" | "md" | "lg";

// LEDGER buttons: square, mono, flat. Emphasis from inversion, never glow.
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg border-ink hover:bg-ink-bright",
  secondary: "bg-transparent text-ink border-ink/50 hover:bg-ink hover:text-bg",
  outline: "bg-transparent text-ink border-ink/35 hover:bg-ink hover:text-bg",
  ghost: "bg-transparent text-ink-dim border-transparent hover:text-ink",
  paper: "bg-ink text-bg border-ink hover:bg-transparent hover:text-ink",
  danger: "bg-transparent text-loss border-loss hover:bg-loss hover:text-bg",
  brass: "bg-transparent text-ink border-ink/50 hover:bg-ink hover:text-bg",
};

const SIZES: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-[0.7rem]",
  md: "px-5 py-2.5 text-[0.8rem]",
  lg: "px-7 py-3.5 text-sm",
};

export function NeonButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  disabled = false,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { y: 1, scale: 0.99 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
      className={`group relative inline-flex items-center justify-center gap-2 border display-caps tracking-[0.12em] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {/* §8.3 bracket highlight — corner marks that register on hover/focus */}
      <span aria-hidden className="pointer-events-none absolute left-0.5 top-0.5 h-1.5 w-1.5 border-l border-t border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 border-r border-t border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      <span aria-hidden className="pointer-events-none absolute bottom-0.5 left-0.5 h-1.5 w-1.5 border-b border-l border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      <span aria-hidden className="pointer-events-none absolute bottom-0.5 right-0.5 h-1.5 w-1.5 border-b border-r border-current opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70" />
      {children}
    </motion.button>
  );
}
