/**
 * The palette, in TypeScript.
 *
 * `app/globals.css` is the source of truth for anything the browser styles:
 * every DOM element reads `var(--color-*)` and nothing here. This file exists
 * for the surfaces that CANNOT read a CSS custom property —
 *
 *   - `next/og` ImageResponse routes, which render on the edge with no document
 *   - `<canvas>` painting (share cards, WebGL materials, ASCII sampling)
 *   - `viewport.themeColor`, which is serialized into a meta tag at build time
 *
 * — so the two must be edited together. A palette change is: this file, the
 * `@theme` block in `app/globals.css`, and the palette section of `DESIGN.md`.
 * Nothing else should ever carry a literal hex.
 */

export const PALETTE = {
  /** Background ramp — paper, framed panel, raised panel. */
  bg: "#0e0e0c",
  bg2: "#131211",
  bg3: "#191714",

  /** Ink ramp — primary through faint. */
  ink: "#f2f1ea",
  inkBright: "#ffffff",
  inkDim: "#8f8e85",
  secondary: "#8f8e85",
  tertiary: "#818076",

  /** Structure. */
  hairline: "#4a4943",
  hairlineStrong: "#67665e",
  dotted: "#54534a",

  /** Money, and only money. */
  gain: "#2bd576",
  loss: "#ff3b30",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * Darker structural tones used only inside canvas/WebGL surfaces, where a
 * hairline at document contrast reads far too bright against an unlit
 * material. Deliberately dimmer than `PALETTE.hairline` — not drift.
 */
export const CANVAS = {
  hairline: "#2a2a25",
} as const;

/**
 * The three ink tiers a verdict can be stamped in, plus the money pair.
 * Verdicts carry meaning, never mood: a ranking reads as ink, an outcome
 * reads as gain or loss.
 */
export const INK_TIER = {
  high: PALETTE.ink,
  mid: "#c9c8bf",
  low: PALETTE.secondary,
} as const;
