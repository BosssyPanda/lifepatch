"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReveal } from "@/hooks/useReveal";
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
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: DUR.scene, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
