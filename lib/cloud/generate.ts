/**
 * Pseudonymous identity generators. No real names, no PII — teen-safe by design.
 * Usernames are curated clean word pairs; friend codes avoid look-alike glyphs;
 * avatar seeds drive a deterministic generated avatar (never an uploaded image).
 */

const ADJECTIVES = [
  "brave", "calm", "clever", "bright", "swift", "bold", "kind", "lucky",
  "sunny", "steady", "wise", "keen", "quiet", "nimble", "frosty", "amber",
  "thrifty", "prime", "vivid", "cosmic", "mellow", "rapid", "noble", "zesty",
] as const;

const NOUNS = [
  "otter", "falcon", "maple", "comet", "pixel", "harbor", "willow", "ember",
  "lynx", "delta", "pine", "raven", "koi", "cedar", "vector", "quartz",
  "badger", "heron", "marlin", "sable", "tiger", "puffin", "orca", "wren",
] as const;

/**
 * The friend-code alphabet. No 0/O and no 1/I/L, so a code survives being read
 * aloud and typed back — the same reasoning, and the same 31 glyphs, as
 * `ROOM_CODE_ALPHABET` in lib/mp/roomCodes.ts.
 *
 * Deliberately declared here rather than imported from there. A friend code and a
 * room code answer to different rules — one is a durable capability on an account,
 * the other is a five-minute session key — and a social feature reaching into the
 * multiplayer transport for a constant would couple two things that only happen to
 * agree today.
 */
export const FRIEND_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const FRIEND_CODE_LENGTH = 6;

const AVATAR_SEED_LENGTH = 8;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * A uniform index below `bound`, from the CSPRNG where there is one.
 *
 * `Math.random()` is not a secret generator: V8 seeds one xorshift128+ stream per
 * context and its state is recoverable from a handful of outputs, so codes drawn
 * from it are correlated with every other `Math.random()` the page has made. That
 * is fine for picking an adjective and wrong for a friend code, which is the ONLY
 * thing standing between an account and an unsolicited request — the whole reason
 * the column stopped being world-readable in the same change that shipped this UI.
 *
 * The modulo tail is rejected rather than folded: 2^32 is not a multiple of 31, so
 * a bare `% 31` would make the first nine letters of the alphabet very slightly
 * likelier than the rest. Same discipline as `makeRoomCode`.
 */
function secureIndex(bound: number): number {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / bound) * bound;
    for (let i = 0; i < 16; i++) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % bound;
    }
    return buf[0] % bound;
  }
  return Math.floor(Math.random() * bound);
}

export function generateUsername(): string {
  const n = Math.floor(Math.random() * 900) + 100; // 100–999
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}

export function generateFriendCode(): string {
  let code = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) code += FRIEND_CODE_ALPHABET[secureIndex(FRIEND_CODE_ALPHABET.length)];
  return code;
}

/**
 * What the "add a friend" field should show as somebody types.
 *
 * Uppercased, anything outside the alphabet dropped — spaces, dashes and the
 * excluded glyphs alike — and capped at six. No confusable "correction": 0/O and
 * 1/I/L are BOTH absent from the alphabet, so there is nothing honest to fold them
 * onto, and guessing would silently address the request to a different person.
 * Never throws; this is an input formatter. Ask `isFriendCode` whether the result
 * is worth sending.
 */
export function normalizeFriendCode(raw: string): string {
  let out = "";
  for (const ch of String(raw ?? "").toUpperCase()) {
    if (FRIEND_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === FRIEND_CODE_LENGTH) break;
  }
  return out;
}

export function isFriendCode(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== FRIEND_CODE_LENGTH) return false;
  for (const ch of v) if (!FRIEND_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function generateAvatarSeed(): string {
  let seed = "";
  for (let i = 0; i < AVATAR_SEED_LENGTH; i++) {
    seed += Math.floor(Math.random() * 16).toString(16);
  }
  return seed;
}
