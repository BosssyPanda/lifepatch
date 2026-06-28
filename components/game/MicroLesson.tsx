"use client";

import { motion } from "framer-motion";
import { InfoIcon } from "@/components/icons";

export function MicroLesson({ lesson }: { lesson: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="flex items-start gap-3 border-t border-ink/15 pt-4"
    >
      <InfoIcon size={20} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="eyebrow text-ink-dim">The lesson</p>
        <p className="mt-1 font-serif text-[1.02rem] italic leading-snug text-ink/90">
          {lesson}
        </p>
      </div>
    </motion.div>
  );
}
