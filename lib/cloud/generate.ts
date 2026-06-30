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

// No 0/O/1/I/L — codes stay unambiguous when read aloud or typed.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789".split("");

const FRIEND_CODE_LENGTH = 6;
const AVATAR_SEED_LENGTH = 8;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateUsername(): string {
  const n = Math.floor(Math.random() * 900) + 100; // 100–999
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
    seed += Math.floor(Math.random() * 16).toString(16);
  }
  return seed;
}
