/**
 * Deterministic, generated avatar — no uploads (teen-safe). A squared LEDGER
 * chit: mono monogram on a faint framed panel, the seed only tinting the
 * monogram to one of the ledger's own tones (ink / secondary / tertiary /
 * gain / loss). No decorative palette, no shadow (§3.1/§3.2).
 */

const ACCENTS = [
  "var(--color-ink)",
  "var(--color-secondary)",
  "var(--color-tertiary)",
  "var(--color-gain)",
  "var(--color-loss)",
];

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
  const accent = ACCENTS[hashSeed(seed) % ACCENTS.length];
  return (
    <span
      aria-hidden
      className="num grid shrink-0 place-items-center border border-hairline bg-bg2"
      style={{ width: size, height: size, fontSize: size * 0.36, color: accent }}
    >
      {monogram(username)}
    </span>
  );
}
