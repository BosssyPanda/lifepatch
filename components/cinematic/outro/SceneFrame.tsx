"use client";

import { motion } from "framer-motion";
import { DUR } from "@/src/motion/tokens";

/** Full-bleed centered scene shell with a mono eyebrow up top. */
export function SceneFrame({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR.instant }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center px-5"
    >
      {eyebrow && (
        <span className="eyebrow absolute top-8 left-1/2 -translate-x-1/2 text-ink-dim" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
          {eyebrow.toUpperCase()}
        </span>
      )}
      {children}
    </motion.div>
  );
}
