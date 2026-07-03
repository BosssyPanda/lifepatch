"use client";

import { motion, useScroll, useSpring } from "framer-motion";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * A one-pixel ink rule across the very top of the title page that fills with
 * scroll — the ledger's own progress mark (spectacle Phase K5). Compositor
 * scaleX only; absent under reduced motion.
 */
export function ScrollProgress() {
  const { reduced } = useMotionCtx();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 160, damping: 28, restDelta: 0.001 });

  if (reduced) return null;

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-px origin-left bg-ink"
      style={{ scaleX }}
    />
  );
}
