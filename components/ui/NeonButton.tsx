"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "paper";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-bg border-accent hover:bg-accent-2",
  secondary: "bg-transparent text-ink border-ink/45 hover:bg-ink hover:text-bg",
  danger: "bg-brick text-ink border-brick hover:brightness-110",
  outline: "bg-transparent text-paper-ink border-paper-ink/40 hover:bg-paper-ink hover:text-paper",
  ghost: "bg-transparent text-ink-dim border-transparent hover:text-ink",
  paper: "bg-paper-ink text-paper border-paper-ink hover:bg-transparent hover:text-paper-ink",
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
      className={`inline-flex items-center justify-center gap-2 rounded-[3px] border display-caps tracking-[0.14em] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </motion.button>
  );
}
