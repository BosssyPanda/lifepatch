/**
 * Username screening.
 *
 * Usernames render publicly on the leaderboard, and `updateUsername` enforced a
 * length and nothing else — the file's own comment said "profanity screening lands
 * in Phase 2", and the board it feeds is public now.
 *
 * TWO DEFENCES, DELIBERATELY DIFFERENT IN KIND.
 *
 * 1. CHARSET, and it is the load-bearing one. `USERNAME_RE` below is the same
 *    expression as the `profiles_username_charset` CHECK in supabase/schema.sql, so
 *    the database refuses what this refuses even if a caller skips it. It exists to
 *    stop impersonation rather than rudeness: zero-width joiners, RTL overrides,
 *    combining marks and Cyrillic/Greek homoglyphs are how one player wears another
 *    player's name, or smuggles a second line of text into a table row. Those are
 *    unfixable by a word list and trivially fixed by an alphabet.
 *
 * 2. A WORD LIST, which is a floor and not a ceiling. Anyone determined to be
 *    offensive in twenty-four characters will manage it; the value here is refusing
 *    the low-effort case so a public board is not trivially defaced. It is
 *    deliberately SHORT and deliberately conservative — a big list is a big pile of
 *    false positives, and a name wrongly refused is a player told "no" for no reason
 *    they can see. If this ever needs to be comprehensive, that is a job for a
 *    maintained wordlist package, not for this file growing.
 *
 * KEEPING SCUNTHORPE OUT OF IT. Substring matching is what makes filters infamous,
 * so there are three lists rather than one. `TOKEN_BLOCKED` matches whole tokens
 * only (usernames are `adjective-noun-123`, so tokens are what they are made of),
 * which is what lets "bass", "sextet", "cocktail" and "analysis" through.
 * `SUBSTRING_BLOCKED` matches anywhere, because splitting a word on separators
 * would otherwise be a one-character escape. And `ALLOW` drops the innocent tokens
 * that happen to contain one of those terms before the match runs.
 *
 * The third list is not optional and the first draft of this file did not have it:
 * "Scunthorpe" contains one of the terms above and "titan-grape" contains another,
 * and both were rejected until `scripts/qa/username-filter.mjs` said so. That gate
 * runs every name the generator can produce plus a fixture of names that must pass
 * and must fail; extend the lists there and here together.
 */

/** The charset. MUST stay identical to `profiles_username_charset` in schema.sql. */
export const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$/;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/**
 * Fold the cheap evasions before matching: case, leetspeak, separators, and runs of
 * a repeated letter. Applied only for the CHECK — the stored name is the player's.
 */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[4@]/g, "a")
    .replace(/[3€]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "")
    // fuuuuck -> fuck. Collapses any run of 3+ to a single letter.
    .replace(/(.)\1{2,}/g, "$1");
}

/**
 * Ordinary words that CONTAIN a `SUBSTRING_BLOCKED` term.
 *
 * This list is the entire reason the filter is not the Scunthorpe joke. A token
 * matched here is dropped before substring matching runs, so the letters it
 * contributes cannot form a blocked word. Exact match plus a trailing "s" only —
 * a `startsWith` test would re-open the hole it closes.
 */
const ALLOW = new Set([
  "scunthorpe", "penistone", "lightwater", "clitheroe",
  "grape", "grapes", "grapefruit", "drape", "drapes", "drapery",
  "scrape", "scrapes", "scraper", "trapeze", "therapist", "therapists",
  "niggle", "niggles", "niggling", "niggard", "niggardly",
  "pedometer", "pedometers", "pedagogy", "pedal", "pedals",
  "assassin", "assassins", "shiitake",
]);

/**
 * Terms with no innocent embedding — matched anywhere, after ALLOW has removed the
 * tokens that would be false positives.
 */
const SUBSTRING_BLOCKED = [
  "fuck", "shit", "bitch", "cunt", "wank", "bollock", "asshole", "arsehole",
  "nigg", "fagg", "retard", "spastic", "tranny", "kike", "chink", "wetback",
  "rape", "rapist", "nazi", "hitler", "pedo", "paedo", "incest", "molest",
  "porn", "hentai", "creampie", "blowjob", "handjob", "dildo",
];

/**
 * Terms that ARE ordinary words inside other words, so they only count as a whole
 * token. "assam", "bass", "class", "hello", "shell", "cocktail", "analysis",
 * "titan", "grape", "sextet" and "Scunthorpe" all survive this; "ass" alone does not.
 */
const TOKEN_BLOCKED = [
  "ass", "arse", "tit", "tits", "cock", "dick", "penis", "vagina", "cum", "jizz",
  "slut", "whore", "hoe", "damn", "crap", "piss", "twat", "prick", "bastard",
  "sex", "anal", "anus", "nude", "nsfw", "milf", "bdsm",
  // Not rude — impersonation. A leaderboard row reading "admin" or "moderator"
  // claims an authority the game does not grant anyone.
  "admin", "administrator", "moderator", "mod", "staff", "official", "lifepatch",
  "support", "system", "root", "owner", "dev", "developer",
];

function tokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => normalize(t))
    .filter(Boolean);
}

/** True when the name trips either list. */
export function isBlockedUsername(raw: string): boolean {
  const toks = tokens(raw);

  // Whole-token terms: "ass" is not "bass", "sex" is not "sextet".
  if (toks.some((t) => TOKEN_BLOCKED.includes(t))) return true;

  // Substring terms are matched against the tokens JOINED, so splitting a word on
  // separators is not an escape — "f-u-c-k" and "F U C K" both flatten to "fuck".
  // Allow-listed tokens are dropped first, which is what keeps "Scunthorpe" and
  // "titan-grape" out of it: their letters never reach the match.
  const suspect = toks.filter((t) => !isAllowed(t)).join("");
  return SUBSTRING_BLOCKED.some((w) => suspect.includes(w));
}

function isAllowed(token: string): boolean {
  if (ALLOW.has(token)) return true;
  return token.endsWith("s") && ALLOW.has(token.slice(0, -1));
}

export type UsernameRejection = "too-short" | "too-long" | "charset" | "blocked";

/** Why a rejected name was rejected, in words a player can act on. */
export const USERNAME_MESSAGE: Record<UsernameRejection, string> = {
  "too-short": `Name must be at least ${USERNAME_MIN} characters.`,
  "too-long": `Name must be at most ${USERNAME_MAX} characters.`,
  charset:
    "Letters, numbers, spaces, hyphens and underscores only — and it has to start and end with a letter or number.",
  blocked: "Pick a different name.",
};

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: UsernameRejection; message: string };

/**
 * The single gate for a username. Trims, then checks length, charset and words —
 * in that order, so the message names the first real problem.
 *
 * Note it does NOT silently truncate. `updateUsername` used to `slice(0, MAX)`,
 * which quietly renamed the player to something they did not type; being told the
 * name is too long is better than being given a different one.
 */
export function checkUsername(raw: string): UsernameCheck {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < USERNAME_MIN) return fail("too-short");
  if (value.length > USERNAME_MAX) return fail("too-long");
  if (!USERNAME_RE.test(value)) return fail("charset");
  if (isBlockedUsername(value)) return fail("blocked");
  return { ok: true, value };
}

function fail(reason: UsernameRejection): UsernameCheck {
  return { ok: false, reason, message: USERNAME_MESSAGE[reason] };
}
