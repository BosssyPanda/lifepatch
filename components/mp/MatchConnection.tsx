"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMatchCtx } from "@/hooks/useMatch";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * What the room's wire is doing, said out loud.
 *
 * A dropped socket used to be completely silent. The year timer kept counting,
 * the standings kept showing figures, and the player kept making choices — while
 * nothing they did reached anybody and the room, hearing nothing, wrote them off
 * as away and auto-played their life. The first they knew of it was the moment
 * the board snapped to a run they had not played.
 *
 * So the line says the true thing and only the true thing: the ROOM is out of
 * reach. It does not say the game is broken, because it isn't — the world is
 * seeded and deterministic, so the year on screen is still the right year and
 * still worth playing, which is exactly why nothing here blocks or freezes. It
 * clears itself the moment the transport reconnects and `useMatch` has
 * re-announced this player into the room.
 *
 * The version line below it is the one thing reconnecting cannot fix: two engine
 * builds in one room cannot read each other's runs at all, so it names the only
 * cure and stays until the player takes it.
 */
export function MatchConnection() {
  const match = useMatchCtx();
  const offline = match?.connection === "offline";
  const clash = match?.versionClash === true;
  if (!match) return null;

  return (
    <AnimatePresence initial={false}>
      {(offline || clash) && (
        <motion.div
          key="conn"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: DUR.base, ease: EASE }}
          className="flex flex-col gap-1"
        >
          {offline && (
            <p className="voice flex items-center gap-2 text-xs leading-snug text-loss">
              <Pulse />
              Can&rsquo;t reach the room &mdash; reconnecting. Keep playing; your year is safe.
            </p>
          )}
          {clash && (
            <p className="voice text-xs leading-snug text-loss">
              Someone here is on a newer version of the game, so the standings can&rsquo;t stay in
              step. Reload the page to catch up.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A slow blink, not a spinner. A spinner reads as "the app is busy and you should
 * wait", which is the opposite of what this banner asks for.
 */
function Pulse() {
  return (
    <motion.span
      aria-hidden
      data-radius=""
      className="inline-block size-1.5 shrink-0 bg-loss"
      animate={{ opacity: [1, 0.25, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
