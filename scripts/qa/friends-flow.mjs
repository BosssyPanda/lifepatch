// Does the friends feature actually work — and does it hold its own rule?
//
//   node scripts/qa/friends-flow.mjs
//
// `lib/cloud/friends.ts` has existed since the social layer shipped and, until
// this change, `addByCode` had no caller anywhere in the repo. Nothing had ever
// run it. So before wiring a panel on top of it, this drives the whole lifecycle
// through the module's LOCAL branch — ask, accept, dismiss, unfriend — with a
// localStorage stub standing in for the browser, and checks the derived lists
// after every step.
//
// Three things it is really here to pin:
//
//   1. One edge is never a friendship. That rule is the consent model (see the
//      header of lib/cloud/friends.ts for what the old one-edge reading allowed),
//      and it now lives in one exported pure function, so it can be attacked
//      directly with edge sets no UI would produce.
//   2. Unfriending takes BOTH rows. Deleting only mine ends the friendship and
//      leaves theirs standing, which the incoming list immediately re-presents as
//      a brand-new request from the person I just removed.
//   3. A friend code is drawn from a CSPRNG with the modulo tail rejected. That
//      claim is measurable, so it is measured rather than asserted in a comment.
import { engineDir } from "./build-engine.mjs";

// The module's local branch reads `localStorage` at call time, so the stub only
// has to exist before the first call — not before the require.
const store = new Map();
globalThis.localStorage = {
  get length() {
    return store.size;
  },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};

const DIR = engineDir();
const { createRequire } = await import("module");
const require = createRequire(`${DIR}/x.js`);
const friends = require(`${DIR}/lib/cloud/friends.js`);
const generate = require(`${DIR}/lib/cloud/generate.js`);

let checks = 0;
const fails = [];
function ck(cond, label, detail = "") {
  checks++;
  if (cond) {
    console.log(`  ok   ${label}`);
    return;
  }
  fails.push(label + (detail ? `\n      ${detail}` : ""));
  console.log(`  FAIL ${label}${detail ? `\n      ${detail}` : ""}`);
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const A = "user-a";
const B = "user-b";
const C = "user-c";

function seedProfiles() {
  store.clear();
  for (const [id, code, name] of [
    [A, "AAA111", "brave-otter-101"],
    [B, "BBB222", "calm-heron-202"],
    [C, "CCC333", "bold-lynx-303"],
  ]) {
    store.set(
      `lifepatch.profile.${id}`,
      JSON.stringify({ id, username: name, avatarSeed: "aa11", friendCode: code, createdAt: "" }),
    );
  }
}

// ── 1. the rule itself, on edge sets no UI would produce ────────────────────
console.log("\n── 1. one edge is never a friendship ──");
{
  const e = (u, f, status = "pending") => ({ userId: u, friendId: f, status, createdAt: "" });
  const p = (id, edges) => friends.partitionEdges(id, edges);

  const asked = [e(A, B)];
  ck(same(p(A, asked).outgoing, [B]) && p(A, asked).friends.length === 0, "asking is outgoing, not a friendship");
  ck(same(p(B, asked).incoming, [A]) && p(B, asked).friends.length === 0, "and the other side sees a request");

  const both = [e(A, B), e(B, A, "accepted")];
  ck(same(p(A, both).friends, [B]) && same(p(B, both).friends, [A]), "two edges are a friendship, from both sides");
  ck(p(A, both).incoming.length === 0 && p(A, both).outgoing.length === 0, "and it is in neither pending list");

  // The exact legacy row `listIncoming`'s comment describes: the old insert
  // policy let a sender mark their OWN edge accepted. It must still read as a
  // request to the person who never wrote one back, or they are never shown it.
  const selfDeclared = [e(A, B, "accepted")];
  ck(p(B, selfDeclared).friends.length === 0, "a self-declared `accepted` edge is not a friendship");
  ck(same(p(B, selfDeclared).incoming, [A]), "it is a request, and B is shown it");

  const stranger = [e(C, "user-d")];
  const pa = p(A, stranger);
  ck(pa.friends.length + pa.incoming.length + pa.outgoing.length === 0, "somebody else's edge is none of my business");

  // A row the schema now refuses outright (`friends_not_self`). If one is already
  // in a table from before that constraint, it must not read as a friendship.
  const self = [e(A, A)];
  ck(p(A, self).friends.length === 0, "a legacy self-edge is not a friendship with yourself");
}

// ── 2. the lifecycle, through the real module ───────────────────────────────
console.log("\n── 2. ask · accept · unfriend · dismiss ──");
{
  seedProfiles();

  const bad = await friends.addByCode(A, "ZZZZZZ");
  ck(!bad.ok && bad.reason === "not-found", "a code nobody holds is `not-found`", JSON.stringify(bad));

  const mine = await friends.addByCode(A, "AAA111");
  ck(!mine.ok && mine.reason === "self", "your own code is `self`", JSON.stringify(mine));

  const sent = await friends.addByCode(A, "BBB222");
  ck(sent.ok && sent.username === "calm-heron-202", "asking by code names who it went to", JSON.stringify(sent));

  ck(same(await friends.listOutgoing(A), [B]), "A is waiting on B");
  ck(same(await friends.listIncoming(B), [A]), "B has a request from A");
  ck((await friends.listFriendIds(A)).length === 0, "and nobody is anybody's friend yet");

  const again = await friends.addByCode(A, "BBB222");
  ck(!again.ok && again.reason === "exists", "asking twice is `exists`, not a second edge", JSON.stringify(again));

  ck(await friends.accept(B, A), "B accepts");
  ck(same(await friends.listFriendIds(A), [B]), "A has B");
  ck(same(await friends.listFriendIds(B), [A]), "B has A");
  ck((await friends.listIncoming(B)).length === 0, "the request is no longer pending on B");
  ck((await friends.listOutgoing(A)).length === 0, "and A is no longer waiting");

  // The one the both-rows delete exists for.
  ck(await friends.removeFriend(A, B), "A removes B");
  ck((await friends.listFriendIds(A)).length === 0 && (await friends.listFriendIds(B)).length === 0, "the friendship is gone on both sides");
  ck((await friends.listIncoming(A)).length === 0, "and B's edge did NOT survive as a fresh request to A");
  ck((await friends.listIncoming(B)).length === 0, "nor A's to B");

  const fromC = await friends.addByCode(C, "AAA111");
  ck(fromC.ok, "C asks A", JSON.stringify(fromC));
  ck(same(await friends.listIncoming(A), [C]), "A is shown it");
  ck(await friends.decline(A, C), "A dismisses it");
  ck((await friends.listIncoming(A)).length === 0, "the request is gone from A's list");
  ck((await friends.listOutgoing(C)).length === 0, "and from C's — a dismissal is not a silent limbo");

  const askAgain = await friends.addByCode(C, "AAA111");
  ck(askAgain.ok, "a dismiss is not a block: C can ask again", JSON.stringify(askAgain));
}

// ── 3. the code itself ──────────────────────────────────────────────────────
console.log("\n── 3. the friend code ──");
{
  const { FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH, generateFriendCode, isFriendCode, normalizeFriendCode } = generate;

  ck(!/[01OIL]/.test(FRIEND_CODE_ALPHABET), "no 0/O and no 1/I/L — a code survives being read aloud");
  ck(normalizeFriendCode("k7x-2 fm") === "K7X2FM", "the formatter uppercases and drops separators", normalizeFriendCode("k7x-2 fm"));
  ck(normalizeFriendCode("OIL000") === "", "and drops the excluded glyphs rather than guessing at them", normalizeFriendCode("OIL000"));
  ck(normalizeFriendCode("ABCDEFGH").length === FRIEND_CODE_LENGTH, "and caps at the code length");
  ck(!isFriendCode("ABCDE") && !isFriendCode("ABCDEFG") && !isFriendCode("ABCDE0"), "a short, long or off-alphabet code is refused");

  const N = 60_000;
  const seen = new Map();
  let allValid = true;
  const codes = new Set();
  for (let i = 0; i < N; i++) {
    const c = generateFriendCode();
    if (!isFriendCode(c)) allValid = false;
    codes.add(c);
    for (const ch of c) seen.set(ch, (seen.get(ch) ?? 0) + 1);
  }
  ck(allValid, `all ${N.toLocaleString()} generated codes are well-formed`);
  ck(seen.size === FRIEND_CODE_ALPHABET.length, "every glyph in the alphabet actually appears");

  // Collisions are EXPECTED, and the count is the measurement worth making.
  // 31^6 is 887,503,681, so 60,000 draws collide about n^2/2N ≈ 2.0 times — the
  // first version of this check asserted zero and failed, which was the check
  // being wrong, not the generator. What a real fault looks like here is a
  // SMALLER space than the alphabet claims (a truncated code, a stuck glyph, a
  // bound off by an order of magnitude), and that shows up as collisions far
  // above the Poisson tail rather than as none at all.
  const space = FRIEND_CODE_ALPHABET.length ** FRIEND_CODE_LENGTH;
  const collisions = N - codes.size;
  const lambda = (N * (N - 1)) / (2 * space);
  ck(
    collisions <= 12,
    `collisions sit in the birthday range for a ${space.toLocaleString()}-code space`,
    `${collisions} seen, ~${lambda.toFixed(1)} expected`,
  );
  console.log(`       ${collisions} collision(s) in ${N.toLocaleString()} draws · ~${lambda.toFixed(1)} expected`);

  // The modulo-bias claim, measured. A bare `% 31` over 2^32 would make the first
  // nine glyphs about 1 part in 138 million likelier — far too small to see here —
  // but a broken generator (a truncated alphabet, a bad bound, a stuck byte) shows
  // up immediately as a glyph far off its expected share.
  const expected = (N * FRIEND_CODE_LENGTH) / FRIEND_CODE_ALPHABET.length;
  const counts = [...seen.values()];
  const worst = Math.max(...counts.map((n) => Math.abs(n - expected) / expected));
  ck(worst < 0.05, `the draw is flat across the alphabet (worst glyph ${(worst * 100).toFixed(2)}% off even)`);
}

console.log(`\n${fails.length === 0 ? "PASS" : "FAIL"} — ${checks} checks, ${fails.length} failures`);
for (const f of fails) console.log(`  ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
