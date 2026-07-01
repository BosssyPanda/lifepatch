import type { SVGProps } from "react";

/**
 * Engraved glyph for a Rat Race / Fast Track board tile, keyed by square type.
 * Line-art (currentColor) so it inherits the tile's type tint. Sized by the
 * caller via className (e.g. h-[46%]). Replaces the bare 3-letter labels.
 */

const GLYPHS: Record<string, React.ReactNode> = {
  // opportunity / asset deed
  deal: <><path d="M7 3h7l3 3v15H7z" /><path d="M10 8h5M10 11.5h5M10 15h3" /></>,
  ftdeal: <><path d="M4 20V10l4 2V9l5 3V7l7 4v9z" /><path d="M4 20h16" /></>,
  // lifestyle expense — shopping bag
  doodad: <><path d="M6 8h12l-1.2 12H7.2z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  // charity / give — open hand + heart
  charity: <><path d="M12 8.5s-1.6-2-3.2-1.1c-1.4.8-1 2.6.3 3.6L12 13l2.9-2c1.3-1 1.7-2.8.3-3.6C13.6 6.5 12 8.5 12 8.5Z" /><path d="M5 15l3.5 2.5a4 4 0 0 0 4.3.2L19 14" /></>,
  // salary — coin with $
  payday: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5v9M14.3 9.6c0-1.2-1-1.8-2.3-1.8s-2.3.6-2.3 1.7 1 1.5 2.3 1.5 2.3.5 2.3 1.7-1 1.8-2.3 1.8-2.3-.6-2.3-1.8" /></>,
  cashflowday: <><circle cx="12" cy="12" r="8" /><path d="M8.5 13.5l2.5-3 2 2 2.5-3.5" /><path d="M14 9h1.5v1.5" /></>,
  // market — candlesticks
  market: <><path d="M4 20h16" /><rect x="6" y="9" width="2.6" height="7" /><path d="M7.3 6v3M7.3 16v2" /><rect x="14.4" y="6.5" width="2.6" height="8" /><path d="M15.7 4v2.5M15.7 14.5v2.5" /></>,
  // new child — stroller / pram
  baby: <><path d="M4.5 12.5a7.5 7.5 0 0 1 15 0z" /><path d="M12 5v7.5" /><path d="M19.5 12.5v-2.5a2 2 0 0 0-2-2" /><circle cx="8.5" cy="18" r="1.8" /><circle cx="16" cy="18" r="1.8" /></>,
  // job loss — briefcase with a downturn
  downsized: <><rect x="4" y="8" width="16" height="11" rx="1.5" /><path d="M9 8V6.5A2 2 0 0 1 11 4.5h2a2 2 0 0 1 2 2V8" /><path d="M8 12.5l2.5 2.5 5-4" /></>,
  // fast-track dream — star
  dream: <><path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.3L12 20.5l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" /></>,
  // fast-track loss — down arrow
  ftloss: <><path d="M12 5v11M7 12l5 5 5-5" /><path d="M6 20h12" /></>,
};

// share glyphs between synonymous types
GLYPHS.pay = GLYPHS.payday;
GLYPHS.mkt = GLYPHS.market;
GLYPHS.give = GLYPHS.charity;
GLYPHS.fired = GLYPHS.downsized;

export function TileIcon({ type, ...props }: { type: string } & SVGProps<SVGSVGElement>) {
  const glyph = GLYPHS[type] ?? <circle cx="12" cy="12" r="6" />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {glyph}
    </svg>
  );
}
