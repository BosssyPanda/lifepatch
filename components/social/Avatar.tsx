/**
 * Deterministic, generated avatar — no uploads (teen-safe). A brand-palette tile
 * picked from the avatar seed, stamped with the username's monogram.
 */

const PALETTE = ["#7f8b52", "#a33218", "#c8861e", "#c9a24a", "#5f7480", "#d4541e"];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function monogram(username: string): string {
  const parts = username.split(/[-\s]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}

export function Avatar({
  seed,
  username,
  size = 40,
}: {
  seed: string;
  username: string;
  size?: number;
}) {
  const color = PALETTE[hashSeed(seed) % PALETTE.length];
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[5px] font-semibold text-paper"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: size * 0.38,
        boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.18)",
      }}
    >
      {monogram(username)}
    </span>
  );
}
