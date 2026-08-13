/**
 * Canvas can't read Tailwind. next/font hashes every family name, so a 2D context
 * that spells `"Anton"` (or worse, `Arial`) silently paints something else — which
 * is how the ban in DESIGN.md § Typography gets broken without anyone editing a
 * class. Read the concrete family off a probe element carrying the same class the
 * DOM uses, and cache it.
 *
 * Lives here, once, because three separate canvas surfaces in the film need it
 * (BoardScene's tile plates, TitleAscii's glyph grid, BillVortex's ghost numerals)
 * and three private copies is how the fonts drifted apart in the first place.
 *
 * Callers still owe `document.fonts.ready` before painting anything they keep: the
 * family name resolves immediately, but the file may not have arrived, and a
 * CanvasTexture painted once never repaints.
 */
const familyCache = new Map<string, string>();

export function familyOf(className: string, fallback: string): string {
  const hit = familyCache.get(className);
  if (hit) return hit;
  try {
    const el = document.createElement("span");
    el.className = className;
    el.style.position = "absolute";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const fam = getComputedStyle(el).fontFamily || fallback;
    el.remove();
    familyCache.set(className, fam);
    return fam;
  } catch {
    // never cached — a probe that failed before <body> existed can succeed later
    return fallback;
  }
}
