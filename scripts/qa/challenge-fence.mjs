// The challenge fence and the challenge RECORD have one lifetime, not two.
//
//   node scripts/qa/challenge-fence.mjs
//
// WHAT WENT WRONG, and why it survived a round of fixing.
//
// A `?vs=` run is fenced out of `lib/saves.ts` by `challengeRef`, and the rival it
// is answering lives in localStorage under `lifepatch.challenge`. Those are two
// halves of one fact, and only one of them was being cleared.
//
// `challengeFor` hands the record back to ANY run standing on the same seed,
// background and mode. The player's own saved run is exactly such a run when they
// answered their own statement's link — so a challenge abandoned to the title
// screen re-attached itself to the run resumed after it. The report printed the
// player against themselves, and `submitRunOnce` re-keyed on
// `${mode}-${seed}-${attempt}`, missed the mark the first submission had left, and
// posted a SECOND leaderboard row for one run.
//
// The first attempt at this moved `writeChallenge` behind the guards, which
// narrowed the window and did not close it: the record still outlived the run.
// The rule is not about WHEN it is written, it is that it dies with the fence.
//
// A source check, in the idiom of `cloud-guards.mjs`: the rule is one about the
// source — "every place that drops the fence also drops the record" — and no
// behavioural test reaches all four entry points as cheaply.
import { readFileSync } from "fs";

let checks = 0;
let failures = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

const src = readFileSync(new URL("../../hooks/useRun.ts", import.meta.url), "utf8");

console.log("CHALLENGE FENCE — the rival dies with the run that answered it\n");

/**
 * The four entry points that set the fence, and what each one owes the record.
 *
 * `start` is the odd one: it sets the fence to the run being started, so it clears
 * the record only for a run that is NOT a challenge — clearing unconditionally
 * would delete the rival the challenge it is starting was just handed.
 */
const ENTRIES = ["start", "resume", "reset", "toTitle"];

function bodyOf(name) {
  const at = src.search(new RegExp(`\\b${name}:\\s*useCallback\\(`));
  ok(at !== -1, `${name} is no longer a useCallback on the returned api — has it been renamed?`);
  const rest = src.slice(at);
  const next = rest.slice(1).search(/\n    \w+: useCallback\(/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

for (const name of ENTRIES) {
  check(`${name} sets challengeRef`, () => {
    ok(/challengeRef\.current\s*=/.test(bodyOf(name)), `${name} does not set challengeRef`);
  });

  check(`${name} clears the stored record too`, () => {
    ok(
      /clearChallenge\(\)/.test(bodyOf(name)),
      `${name} drops the fence without clearing lifepatch.challenge — the record outlives ` +
        "the run, `challengeFor` re-attaches it to the next run on the same world, and " +
        "submitRunOnce posts a second leaderboard row for one run",
    );
  });
}

check("start clears the record only for a run that is NOT a challenge", () => {
  const body = bodyOf("start");
  ok(
    /if \(!opts\?\.challenge\) clearChallenge\(\);/.test(body),
    "start must clear conditionally — an unconditional clear here deletes the rival " +
      "the challenge being started was just handed",
  );
});

check("the save fence reads the ref, never the stored record", () => {
  const at = src.indexOf("const persist = useCallback(");
  const body = src.slice(at, src.indexOf("const commit", at));
  ok(
    /if \(challengeRef\.current\) return;/.test(body),
    "the persist fence no longer reads challengeRef",
  );
  ok(
    !/challengeFor\(/.test(body),
    "the persist fence reads the STORED record — `writeChallenge` swallows a storage " +
      "failure, so that fence answers \"not a challenge\" in a private window and lets " +
      "the run evict the player's own save. A fence may fail closed, never open",
  );
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
