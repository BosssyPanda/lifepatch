/**
 * Tile palette + glyph mapping for the 3D board.
 *
 * Colors are pulled from the live `@theme` CSS custom properties in
 * `app/globals.css` at runtime (no hardcoded hex), so the board stays locked to
 * the dark + amber design system. Each tile type maps to a face color and a
 * simple vector glyph drawn onto the canvas tile texture.
 */

/** Glyph ids understood by the canvas texture painter. */
export type Glyph =
  | "deal"
  | "doodad"
  | "charity"
  | "payday"
  | "market"
  | "baby"
  | "downsized"
  | "invest"
  | "dream"
  | "loss"
  | "blank";

export type TileStyle = {
  /** hex (or any CSS color string) resolved from the theme token */
  color: string;
  glyph: Glyph;
};

/** Map a board tile `type` to the theme token name driving its color. */
const TYPE_TOKEN: Record<string, { token: string; glyph: Glyph }> = {
  // Rat ring
  deal: { token: "--color-ochre", glyph: "deal" },
  doodad: { token: "--color-brick", glyph: "doodad" },
  charity: { token: "--color-steel", glyph: "charity" },
  payday: { token: "--color-olive", glyph: "payday" },
  market: { token: "--color-accent", glyph: "market" },
  baby: { token: "--color-brass", glyph: "baby" },
  downsized: { token: "--color-brick", glyph: "downsized" },
  // Fast track
  ftdeal: { token: "--color-brass", glyph: "invest" },
  cashflowday: { token: "--color-olive", glyph: "payday" },
  dream: { token: "--color-accent", glyph: "dream" },
  ftloss: { token: "--color-brick", glyph: "loss" },
};

/** Fallback hex values used in SSR/test or if a token is unreadable. */
const FALLBACK: Record<string, string> = {
  "--color-bg": "#14110e",
  "--color-bg2": "#1e1a15",
  "--color-bg3": "#2a241d",
  "--color-ink": "#e9e1cf",
  "--color-ink-dim": "#a89f8c",
  "--color-accent": "#d4541e",
  "--color-accent-2": "#e9692f",
  "--color-paper": "#e7dfc9",
  "--color-olive": "#7f8b52",
  "--color-brick": "#a33218",
  "--color-ochre": "#c8861e",
  "--color-brass": "#c9a24a",
  "--color-steel": "#5f7480",
};

/** Read a single theme token, falling back to a baked value off-DOM. */
export function token(name: string): string {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  }
  return FALLBACK[name] ?? "#888888";
}

/** Resolve the full style (color + glyph) for a board tile type. */
export function tileStyle(type: string): TileStyle {
  const entry = TYPE_TOKEN[type] ?? { token: "--color-bg3", glyph: "blank" as Glyph };
  return { color: token(entry.token), glyph: entry.glyph };
}

/** Shared surface colors for the board base, hub, and token. */
export function surfacePalette() {
  return {
    bg: token("--color-bg"),
    bg2: token("--color-bg2"),
    bg3: token("--color-bg3"),
    ink: token("--color-ink"),
    inkDim: token("--color-ink-dim"),
    accent: token("--color-accent"),
    accent2: token("--color-accent-2"),
    paper: token("--color-paper"),
  };
}
