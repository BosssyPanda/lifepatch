"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReveal } from "@/hooks/useReveal";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/** Fades + lifts its children in when scrolled into view. */
export function Reveal({
  children,
  delay = 0,
  y = 22,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const { reduced } = useMotionCtx();
  // Reduced motion replaces rather than removes: the content still arrives, it just arrives
  // already in place (no travel, no stagger delay) instead of not arriving at all.
  const offset = reduced ? 0 : y;
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: offset }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: offset }}
      transition={{ duration: reduced ? DUR.instant : DUR.scene, delay: reduced ? 0 : delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
