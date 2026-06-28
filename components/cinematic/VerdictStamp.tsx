"use client";

import { motion } from "framer-motion";

export function VerdictStamp({ title, hex }: { title: string; hex: string }) {
  return (
    <motion.div
      initial={{ scale: 2.4, rotate: -16, opacity: 0 }}
      animate={{ scale: 1, rotate: -3, opacity: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 9 }}
      className="inline-block rounded-[5px] border-[3px] px-8 py-4 text-center"
      style={{ borderColor: hex, color: hex, boxShadow: `0 0 0 6px ${hex}1a` }}
    >
      <p className="eyebrow" style={{ opacity: 0.7 }}>Final verdict</p>
      <p className="display-caps text-5xl sm:text-7xl">{title}</p>
    </motion.div>
  );
}
