// The username-screening gate.
//
//   node scripts/qa/username-filter.mjs
//
// A content filter has two failure modes and they pull in opposite directions, so
// measuring one without the other is how filters end up either useless or famous.
// This measures both:
//
//   • FALSE POSITIVES — an innocent name refused. The expensive kind: a player is
//     told "pick a different name" about a name that was fine, with no way to tell
//     why. The fixture is the classic set (Scunthorpe, Penistone, bass, classic,
//     cocktail, analysis, sextet, Mississippi, titan-grape) plus every one of the
//     576 adjective-noun pairs `generateUsername` can mint, at three number
//     suffixes. A generator that cannot name a player is worse than no filter.
//
//   • MISSES — an abusive name accepted, including the cheap evasions the filter
//     claims to fold: leetspeak, separator-splitting, repeated letters, and the
//     impersonation names ("admin", "staff", "official").
//
// Both lists started non-empty. `cunt` inside Scunthorpe and `rape` inside grape
// were live false positives, and `a55hole` walked straight through, until this ran.
//
// It now covers the SERVER rule and not just the client one: the module below moved
// to supabase/functions/_shared so the `profile` Edge Function could import the same
// copy, and this gate runs against that copy.
import { checkUsername } from "../../supabase/functions/_shared/username.ts";

// Mirrors supabase/functions/_shared/generate.ts. Duplicated on purpose: if that
// file's lists change, this gate should fail loudly rather than quietly follow them
// somewhere unusable.
const ADJECTIVES = [
  "brave", "calm", "clever", "bright", "swift", "bold", "kind", "lucky",
  "sunny", "steady", "wise", "keen", "quiet", "nimble", "frosty", "amber",
  "thrifty", "prime", "vivid", "cosmic", "mellow", "rapid", "noble", "zesty",
];
const NOUNS = [
  "otter", "falcon", "maple", "comet", "pixel", "harbor", "willow", "ember",
  "lynx", "delta", "pine", "raven", "koi", "cedar", "vector", "quartz",
  "badger", "heron", "marlin", "sable", "tiger", "puffin", "orca", "wren",
];

/** Names that MUST be accepted. Every one of these is a real word or place. */
const MUST_PASS = [
  "Scunthorpe", "Penistone", "Clitheroe", "Lightwater",
  "classic-bass-1", "assam-tea-12", "cocktail-hour", "analysis-99",
  "titan-grape", "grapefruit-42", "shell-hello", "sextet-7", "Mississippi",
  "the-assassin", "therapist-1", "niggling-doubt", "pedometer-9",
  "Jose-Alvarez", "a_b-c 1", "brave-otter-101", "dickens-fan", "Middlesex",
];

/** Names that MUST be refused, and the evasion each one is testing. */
const MUST_FAIL = [
  "fuck-you-1", "F U C K", "f-u-c-k", "fuuuuck",   // separators, spacing, repeats
  "sh1t-head", "a55hole", "c0ck", "b1tch",          // leetspeak
  "admin", "moderator-7", "LifePatch-Staff", "official-mod", "dev", "system",
  "xX_slut_Xx", "nazi-fan",
];

/** Names that MUST be refused on charset/length, not on words. */
const MUST_FAIL_SHAPE = [
  ["ab", "too-short"],
  ["a".repeat(25), "too-long"],
  ["-leading-hyphen", "charset"],
  ["trailing-hyphen-", "charset"],
  ["José", "charset"],                    // accented: not in the alphabet
  ["brave‮otter", "charset"],             // RTL override
  ["brave​otter", "charset"],             // zero-width space
  ["аdmin-brave", "charset"],             // Cyrillic homoglyph
];

/**
 * Names that are ACCEPTED but rewritten. Whitespace is folded rather than refused,
 * which is the right call for a name field and worth pinning: a newline's only real
 * danger is smuggling a second line into a leaderboard row, and a newline that has
 * become a space cannot. `\s` covers the exotic spaces too (NBSP, U+2028), so those
 * fold as well. Zero-width space is NOT whitespace and is refused on charset above,
 * which is why both cases need stating.
 */
const MUST_NORMALIZE = [
  ["two\nlines", "two lines"],
  ["two\tlines", "two lines"],
  ["  padded  ", "padded"],
  ["a\u00a0b-c", "a b-c"],
  ["many     spaces", "many spaces"],
];

const fails = [];
const note = (m) => { console.log(`  ✗ ${m}`); fails.push(m); };

let generated = 0;
for (const a of ADJECTIVES) {
  for (const n of NOUNS) {
    for (const num of [100, 500, 999]) {
      const name = `${a}-${n}-${num}`;
      generated++;
      const r = checkUsername(name);
      if (!r.ok) note(`generator produces a name the filter refuses: "${name}" (${r.reason})`);
    }
  }
}

for (const name of MUST_PASS) {
  const r = checkUsername(name);
  if (!r.ok) note(`false positive: "${name}" refused as ${r.reason}`);
}

for (const name of MUST_FAIL) {
  const r = checkUsername(name);
  if (r.ok) note(`miss: "${name}" was accepted`);
  else if (r.reason !== "blocked") note(`"${name}" refused as ${r.reason}, expected blocked`);
}

for (const [name, reason] of MUST_FAIL_SHAPE) {
  const r = checkUsername(name);
  if (r.ok) note(`miss: ${JSON.stringify(name)} was accepted, expected ${reason}`);
  else if (r.reason !== reason) note(`${JSON.stringify(name)} refused as ${r.reason}, expected ${reason}`);
}

for (const [input, expected] of MUST_NORMALIZE) {
  const r = checkUsername(input);
  if (!r.ok) note(`${JSON.stringify(input)} refused as ${r.reason}, expected it to normalize`);
  else if (r.value !== expected) {
    note(`${JSON.stringify(input)} normalized to ${JSON.stringify(r.value)}, expected ${JSON.stringify(expected)}`);
  }
}

console.log("");
if (fails.length) {
  console.error(`username gate FAILED — ${fails.length} problem(s).`);
  process.exit(1);
}
console.log(
  `username gate passed — ${generated} generated names accepted, ` +
    `${MUST_PASS.length} innocent names accepted, ` +
    `${MUST_FAIL.length + MUST_FAIL_SHAPE.length} abusive/malformed names refused, ` +
    `${MUST_NORMALIZE.length} normalized.`,
);
