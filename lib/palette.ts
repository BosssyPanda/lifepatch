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
 *
 * The board's `--color-tile-*` category tokens are deliberately NOT mirrored
 * here: they are aliases of the values below (plus one muted chartreuse) and are
 * only ever read by the DOM, which can read a custom property.
 */

export const PALETTE = {
  /** Background ramp — warm near-black paper, framed panel, raised panel. */
  bg: "#131110",
  bg2: "#1a1714",
  bg3: "#211d19",

  /** Ink ramp — primary through faint. */
  ink: "#f4f0e6",
  inkBright: "#ffffff",
  inkDim: "#9a968c",
  secondary: "#9a968c",
  tertiary: "#8f8b81",

  /** Structure. */
  hairline: "#4c4b47",
  hairlineStrong: "#6b6964",
  dotted: "#55544f",

  /**
   * Identity + reward — never an outcome.
   *
   * `accent` is the signature safety orange: CTAs, the active square, the player
   * stamp, section numerals. `highlight` is the acid chartreuse, spent sparingly
   * on a reward. Anything knocked out of either fill is painted in `bg` (paper),
   * never in `ink` — ink on accent measures 2.74:1 and fails.
   */
  accent: "#ff5a1f",
  highlight: "#d8e04b",

  /** Money, and only money. */
  gain: "#2fcc71",
  loss: "#fe4030",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * Darker structural tones used only inside canvas/WebGL surfaces, where a
 * hairline at document contrast reads far too bright against an unlit
 * material. Deliberately dimmer than `PALETTE.hairline` — not drift.
 */
export const CANVAS = {
  hairline: "#2c2a26",
} as const;

/**
 * The three ink tiers a verdict can be stamped in, plus the money pair.
 * Verdicts carry meaning, never mood: a ranking reads as ink, an outcome
 * reads as gain or loss.
 */
export const INK_TIER = {
  high: PALETTE.ink,
  mid: "#cbc6ba", /* 11.05:1 on bg — the warm mid rung between ink and secondary */
  low: PALETTE.secondary,
} as const;
