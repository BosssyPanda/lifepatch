/**
 * Room codes. Six characters, read aloud over a call and typed on a phone, so the
 * alphabet drops every glyph pair people mishear or mistype: no 0/O, no 1/I/L.
 */

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;

/**
 * A uniform index below `bound`, from the platform CSPRNG where there is one.
 *
 * Exported because it guards more than room codes now: `lib/cloud/generate.ts`
 * mints friend codes, which the schema calls "the sole capability guarding
 * addByCode", and was drawing them from `Math.random()` — V8's xorshift128+,
 * whose internal state is recoverable from a handful of consecutive outputs. Two
 * of those neighbouring outputs (the username and the avatar seed) are published
 * on `profiles_public` for every player on the leaderboard. The weaker generator
 * was sitting on the more sensitive value while this one guarded a throwaway
 * lobby; there is no reason for two.
 */
export function randomIndex(bound: number): number {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    // Reject the tail of the range so the modulo stays uniform.
    const limit = Math.floor(0xffffffff / bound) * bound;
    for (let i = 0; i < 16; i++) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % bound;
    }
    return buf[0] % bound;
  }
  return Math.floor(Math.random() * bound);
}

export function makeRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomIndex(ROOM_CODE_ALPHABET.length)];
  return code;
}

/**
 * What the join field should show as the player types: uppercased, anything
 * outside the alphabet dropped (spaces, dashes, and the excluded glyphs alike),
 * capped at six. Deliberately no confusable "correction" — 0/O and 1/I/L are BOTH
 * absent from the alphabet, so there is nothing honest to fold them onto, and
 * guessing would silently hand the player a different room. Never throws: this is
 * an input formatter. Ask `isRoomCode` whether the result is joinable.
 */
export function normalizeRoomCode(raw: string): string {
  let out = "";
  for (const ch of String(raw ?? "").toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}

export function isRoomCode(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of v) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
