"use client";

import { motion } from "framer-motion";
import { Mascot, type MascotMood } from "@/components/brand/Mascot";

export function MascotLine({
  line,
  mood = "smug",
}: {
  line: string;
  mood?: MascotMood;
}) {
  return (
    <motion.figure
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="mt-7 flex items-center gap-3"
    >
      <div className="w-14 shrink-0 sm:w-16" aria-hidden>
        <Mascot mood={mood} />
      </div>
      <figcaption className="relative rounded-[4px] border-l-2 border-accent bg-bg2/70 px-4 py-2.5">
        <span className="eyebrow text-accent">The System</span>
        <p className="font-serif text-[0.98rem] italic leading-snug text-ink/90">
          &ldquo;{line}&rdquo;
        </p>
      </figcaption>
    </motion.figure>
  );
}
