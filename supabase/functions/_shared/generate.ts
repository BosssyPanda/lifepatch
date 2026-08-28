/**
 * Pseudonymous identity generators. No real names, no PII — teen-safe by design.
 * Usernames are curated clean word pairs; friend codes avoid look-alike glyphs;
 * avatar seeds drive a deterministic generated avatar (never an uploaded image).
 *
 * Every draw here goes through `randomIndex`, i.e. the platform CSPRNG. That is
 * not decoration on the username and the avatar seed: they are drawn from the
 * same stream as the friend code, immediately either side of it, and both are
 * published on `profiles_public`. Under `Math.random()` those two public values
 * were neighbours of a secret in a recoverable stream — the friend code is the
 * whole capability protecting the friends graph, and migration 02 exists because
 * these codes were once enumerable.
 *
 * WHY IT LIVES HERE, and why it has no imports. This was `lib/cloud/generate.ts`.
 * The `profile` Edge Function is the only thing allowed to INSERT a profile now,
 * so it mints the friend code — a client that picks its own capability token
 * defeats the CSPRNG, which is the whole of migration 04 §2. `_shared` is the
 * documented directory an Edge Function may import from (importing across
 * `supabase/` has never reliably deployed — supabase/cli#1028), so this is where
 * the one copy has to be.
 *
 * The no-imports rule is load-bearing rather than tidiness. Deno requires the
 * `.ts` extension on a relative import; an emitting `tsc` refuses one. A file both
 * of them read therefore cannot have relative imports at all, which is why
 * `randomIndex` is defined below instead of imported. `lib/mp/roomCodes.ts` reads
 * it back out of here — the arrow points this way round because Deno can follow it
 * and cannot follow the other.
 */

/**
 * A uniform index below `bound`, from the platform CSPRNG where there is one.
 *
 * Shared with room codes rather than written twice. The weaker generator was
 * sitting on the more sensitive value — `Math.random()` is V8's xorshift128+,
 * whose internal state is recoverable from a handful of consecutive outputs, and
 * two of those outputs (username, avatar seed) are published for every player on
 * the leaderboard — while this one guarded a throwaway lobby.
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

// No 0/O/1/I/L — codes stay unambiguous when read aloud or typed.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789".split("");

const FRIEND_CODE_LENGTH = 6;
const AVATAR_SEED_LENGTH = 8;

function pick<T>(arr: readonly T[]): T {
  return arr[randomIndex(arr.length)];
}

export function generateUsername(): string {
  const n = randomIndex(900) + 100; // 100–999
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}

export function generateFriendCode(): string {
  let code = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) code += pick(CODE_CHARS);
  return code;
}

export function generateAvatarSeed(): string {
  let seed = "";
  for (let i = 0; i < AVATAR_SEED_LENGTH; i++) {
    seed += randomIndex(16).toString(16);
  }
  return seed;
}
