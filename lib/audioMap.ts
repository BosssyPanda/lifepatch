/**
 * Single source of truth tying game data to audio. Keeps components dumb:
 * they pass an event `tag` / outcome `tone` and get the right sound id.
 */
import type { AmbienceId, StingTone } from "@/src/audio/sfxBank";
import type { Tone } from "@/lib/markets";

/** Life-event tag → looping scenario ambience. */
export function ambienceForTag(tag: string): AmbienceId | null {
  switch (tag) {
    case "Career": return "amb_office";
    case "Family": return "amb_room";
    case "Life": return "amb_room";
    case "The Feed": return "amb_feed";
    case "Housing": return "amb_keys";
    case "Health": return "amb_hospital";
    case "Debt": return "amb_coins";
    case "Curveball": return "amb_unease";
    case "Windfall": return "amb_shimmer";
    case "Leaks": return "amb_hiss";
    default: return null;
  }
}

/** Outcome / macro tone → reveal sting (the union already matches). */
export function stingForTone(tone: Tone): StingTone {
  return tone;
}
