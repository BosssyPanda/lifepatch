"use client";

import { motion } from "framer-motion";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * Bracketed terminal-prompt CTA (Addendum A §6 / §13 #6). `[ LABEL ····· → ]` in
 * mono; on hover/press an ink fill sweeps left-to-right along the dot leader and
 * the text inverts to the paper color — a terminal command completing. A block
 * caret blinks before the label. Compositor-only (transform/opacity); LEDGER tokens.
 */
export function BracketCTA({
  label,
  onClick,
  className = "",
  caret = true,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  caret?: boolean;
}) {
  const { reduced: reduce } = useMotionCtx();

  return (
    <button
      type="button"
      onClick={onClick}
      // The site's loudest CTA, so it carries the signature: an orange keyline that
      // fills orange on hover with the label knocked out in paper (6.04:1 — ink on
      // orange fails at 2.74:1). `data-accent-fill` swaps the focus ring to ink, or
      // an orange ring 2px off an orange edge would read as one thick band.
      data-accent-fill=""
      className={`group relative inline-flex min-w-[15rem] items-center overflow-hidden border border-accent px-4 py-3.5 text-left sm:min-w-[19rem] ${className}`}
    >
      {/* fill sweeps across on hover/press */}
      <span
        aria-hidden
        className="absolute inset-0 origin-left scale-x-0 bg-accent transition-transform duration-300 ease-out group-hover:scale-x-100 group-active:scale-x-100 motion-reduce:transition-none"
      />
      <span className="relative z-10 flex w-full items-center gap-2.5 display-caps text-accent transition-colors duration-200 group-hover:text-bg">
        <span className="text-secondary transition-colors duration-200 group-hover:text-bg">[</span>
        {caret && (
          <motion.span
            aria-hidden
            className="inline-block h-[0.9em] w-[0.5ch] bg-accent group-hover:bg-bg"
            animate={reduce ? undefined : { opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1.05, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
          />
        )}
        <span className="tracking-[0.16em]">{label}</span>
        <span className="mb-1 hidden flex-1 rule-dotted sm:block" aria-hidden />
        <span aria-hidden className="ml-auto sm:ml-0">→</span>
        <span className="text-secondary transition-colors duration-200 group-hover:text-bg">]</span>
      </span>
    </button>
  );
}
