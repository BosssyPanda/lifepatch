// Every per-player cloud call asks whether THIS PLAYER has a row, not whether a
// cloud exists.
//
//   node scripts/qa/cloud-guards.mjs
//
// WHAT WENT WRONG, and why a source check is the right shape for it.
//
// `lib/cloud/*` modules all branch the same way: reach the cloud, or fall back to
// `localStorage`. Two of the four asked `isCloud && supabase` — "is this build
// configured for a cloud" — and two asked `isCloud && supabase && !isGuestId(userId)`
// — "and does this player have a row in it". Those are different questions, and a
// guest is exactly where they diverge: a guest id is `device-<random>` (see
// `identity.ts`), not a uuid, so PostgREST refuses every request made with one.
//
// The wasted request was not the damage. The local branch underneath is the one a
// guest is SUPPOSED to take, and taking the cloud branch and failing meant never
// reaching it — so on any build with Supabase configured, which is production, a
// guest's finished run, their daily streak and their personal best were written
// nowhere at all. Not degraded: absent. `streaks.ts` and `results.ts` had it;
// `mastery.ts` and `profiles.ts` did not, which is what made it visible.
//
// It surfaced from `qa:mp`, of all places — four refused
// `/rest/v1/streaks?user_id=eq.device-...` per client, on a run where nobody had
// signed in. Nothing was asserting it, so nothing said so.
//
// A source check rather than a behavioural one, deliberately: these modules read
// `isCloud`/`supabase` as module imports, so there is no seam to inject a fake
// through, and the rule being protected is a rule ABOUT THE SOURCE — "a function
// that takes a userId must not decide with a guard that ignores it". Crude, and it
// is exactly the check that would have caught this.
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

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

/**
 * The four modules that write or read per-player rows, and — for each — the
 * functions that take a `userId` and therefore must consult the guest guard.
 *
 * `topResults` and `getResult` are deliberately absent from `results.ts`: they read
 * the public board and a shared statement by id, take no player, and are supposed to
 * reach the cloud for everyone. Guarding those would blank the leaderboard for
 * guests, which is the opposite mistake.
 */
const MODULES = [
  { file: "lib/cloud/streaks.ts", guard: "cloudStreakFor", fns: ["readStreak", "bumpStreak"] },
  { file: "lib/cloud/results.ts", guard: "cloudResultsFor", fns: ["submitResult", "myBest"] },
  { file: "lib/cloud/mastery.ts", guard: "cloudMasteryFor", fns: ["readMastery", "recordConcepts"] },
  { file: "lib/cloud/profiles.ts", guard: "cloudProfileFor", fns: ["getProfile", "ensureProfile"] },
];

console.log("CLOUD GUARDS — a guest is not a user id the cloud has ever heard of\n");

for (const m of MODULES) {
  const src = read(m.file);

  check(`${m.file} defines ${m.guard} and it consults isGuestId`, () => {
    const decl = src.match(new RegExp(`function ${m.guard}\\([^)]*\\)[^{]*\\{([^}]*)\\}`));
    ok(decl, `no ${m.guard} declaration found`);
    ok(/isGuestId/.test(decl[1]), `${m.guard} does not consult isGuestId`);
  });

  for (const fn of m.fns) {
    check(`${m.file} · ${fn} decides with ${m.guard}`, () => {
      const start = src.search(new RegExp(`(export )?(async )?function ${fn}\\b`));
      ok(start !== -1, `function ${fn} not found — has it been renamed?`);
      // To the next top-level function, which is where this one's body ends.
      const rest = src.slice(start + 1);
      const nextIdx = rest.search(/\n(export )?(async )?function \w/);
      const body = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
      ok(
        !/if \(isCloud && supabase\)/.test(body),
        `${fn} branches on \`isCloud && supabase\`, which ignores who the player is — ` +
          `a guest takes the cloud path, is refused, and never reaches the local write`,
      );
      ok(body.includes(m.guard), `${fn} never calls ${m.guard}`);
    });
  }
}

// The other half of the rule, stated from the opposite side so a well-meaning
// "consistency" pass cannot quietly break the leaderboard for signed-out players.
check("results.ts leaves the PUBLIC reads unguarded", () => {
  const src = read("lib/cloud/results.ts");
  for (const fn of ["topResults", "getResult"]) {
    const start = src.search(new RegExp(`export async function ${fn}\\b`));
    ok(start !== -1, `${fn} not found`);
    const rest = src.slice(start + 1);
    const nextIdx = rest.search(/\n(export )?(async )?function \w/);
    const body = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
    ok(
      !/cloudResultsFor/.test(body),
      `${fn} reads public data for everyone — guarding it on a guest id blanks the board`,
    );
  }
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
