// Nobody reads `results.metrics` with a coercion that lies.
//
//   node scripts/qa/metrics-readers.mjs
//
// WHAT WENT WRONG, twice, in the same week.
//
// `metrics` is jsonb written by other players' browsers, and the idiomatic-looking
// way to read a number out of it is wrong in both directions at once:
//
//   Number.isFinite(Number(v))   accepts null, "", " ", [] and true — all finite
//   arr.map(Number).filter(...)  DROPS a bad element, compacting the series so
//                                every later year is drawn one place early
//
// The first turned a `"seed": null` into seed 0 — a real, playable world with
// nothing to do with the statement that was clicked. The second re-dated a public,
// hour-cached chart. `lib/metrics.ts` exists to be the one place that knows this,
// and the first commit to add it left four sibling readers on the old coercion.
//
// A source check rather than a behavioural one, for the same reason
// `cloud-guards.mjs` is: the rule being protected is a rule ABOUT THE SOURCE —
// "a reader of untrusted metrics does not use the generous coercion" — and it is
// exactly the check that would have caught both rounds of this.
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

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
 * Source with comments removed.
 *
 * The prose in these files QUOTES the coercions it warns against — that is the
 * point of the comments — so scanning raw text flags the documentation as the
 * defect. Only WHOLE comment lines are stripped, never a `//` found mid-line: a
 * blanket end-of-line strip eats `"https://…"` and everything after it, which
 * would silently remove real code from the scan.
 */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");

/** Files that read a result row's `metrics` and must go through `lib/metrics.ts`. */
const READERS = [
  "app/r/[id]/page.tsx",
  "app/api/og/[id]/route.tsx",
  "lib/challenge.ts",
  "components/AppShell.tsx",
];

console.log("METRICS READERS — jsonb written by somebody else's browser\n");

for (const file of READERS) {
  // One read per file: the four checks below are pure reads of the same string.
  const src = code(file);

  check(`${file} does not coerce a metrics field with Number()`, () => {
    // `Number(` applied to anything reached through a metrics blob. The lookbehind
    // keeps `finiteNumber(` — the approved reader, whose name ends in `Number(` —
    // from matching as the thing it replaces.
    const bad = [...src.matchAll(/(?<![A-Za-z_$])Number\(\s*(?:[A-Za-z_$][\w$]*\s*[?.]*\.)?(?:metrics|m)\s*[?.]/g)];
    ok(
      bad.length === 0,
      `${bad.length} coercion(s) of a metrics field via Number(): ${bad.map((b) => b[0]).join(", ")} — ` +
        "Number(null) is a finite 0, so this accepts exactly the malformed values it looks like it rejects. " +
        "Use finiteNumber from lib/metrics.ts",
    );
  });

  check(`${file} does not launder a metrics field through Number.isFinite(Number(…))`, () => {
    // The ALIASED form the member-expression check above cannot see: pull the field
    // into a local first (`const seed = m?.seed`) and the coercion no longer mentions
    // `metrics` at all. This shape is the bug itself regardless of what it is applied
    // to, so it is banned outright rather than matched against a receiver.
    ok(
      !/Number\.isFinite\(\s*Number\(/.test(src),
      "`Number.isFinite(Number(v))` is true for null, \"\", \" \", [] and true — it is the " +
        "generous coercion wearing a guard's clothes. Use finiteNumber from lib/metrics.ts",
    );
  });

  check(`${file} does not rebuild a series with map/filter`, () => {
    ok(
      !/\.map\(Number\)/.test(src),
      "`.map(Number)` on a stored series keeps null as a $0 year and — with the " +
        "`.filter(Number.isFinite)` that always follows it — DROPS a bad element, " +
        "compacting the array so every later year is drawn one place early. " +
        "Use finiteSeries from lib/metrics.ts",
    );
  });

  check(`${file} does not render a metrics field with String(… ?? …)`, () => {
    // The other half of the same failure, and the half that reaches the reader:
    // `String(v ?? "—")` renders an object-valued field as "[object Object]", and
    // a template literal does the same silently.
    const bad = [
      ...src.matchAll(/String\(\s*(?:[A-Za-z_$][\w$]*\s*[?.]*\.)?(?:metrics|m)\s*[?.][\w$]+\s*\?\?/g),
      ...src.matchAll(/\$\{\s*(?:[A-Za-z_$][\w$]*\s*[?.]*\.)?(?:metrics|m)\s*[?.][\w$]+\s*\?\?/g),
    ];
    ok(
      bad.length === 0,
      `${bad.length} metrics field(s) rendered with a \`?? "—"\` fallback: ${bad.map((b) => b[0]).join(", ")} — ` +
        "that fallback only catches null/undefined, so an object or array prints as " +
        "\"[object Object]\" on a public page. Gate on finiteNumber instead",
    );
  });
}

/**
 * Files that touch `metrics` and are allowed to coerce, each for a stated reason.
 * Listed rather than pattern-matched so an exemption is a decision someone made
 * on purpose and can be argued with, instead of a hole the gate cannot see.
 */
const EXEMPT = [
  // `fromProjectedRow` converts a PostgREST `metrics->>key` projection, which
  // genuinely arrives as a top-level STRING column — `Number("1")` is the correct
  // read there, and `finiteNumber` would reject every projected row. The nested
  // `metrics` object it hands on is validated by its consumers.
  "lib/cloud/results.ts",
  // Reads `metrics.verified === 1` and nothing else: a strict equality against a
  // literal, which is the approved shape. Listed so the coverage check below does
  // not have to guess, and so adding a RENDER here is a deliberate act.
  "components/social/Leaderboard.tsx",
];

/**
 * The list above is hand-maintained, and the OG route was missed for exactly that
 * reason — it fetches `metrics` over REST rather than importing a helper, so no
 * import graph would have caught it either. This asks the repo instead: anything
 * that touches `.metrics` and coerces is either listed or a new hole.
 */
check("READERS covers every file that reads .metrics", () => {
  const found = execSync(
    "grep -rlE '(row|c|r)\\??\\.metrics|metrics\\??\\.' app components lib --include=*.ts --include=*.tsx || true",
    // `fileURLToPath`, not `.pathname`: a repo checked out under a path with a
    // space yields `My%20Projects` from the latter, and execSync then throws
    // ENOENT on a cwd that does not exist — a red gate saying nothing about metrics.
    { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => !READERS.includes(f) && !EXEMPT.includes(f));

  // Judged on CODE, not on prose. Every file in this feature quotes the banned
  // coercions in its comments — that is what the comments are for — so scanning
  // raw text reports the documentation as the defect. The lookbehind is applied to
  // BOTH alternatives: without its own group it binds only to `Number(`, and
  // `String(` then matches inside `toString(`, which `Date.now().toString(36)`
  // puts in half the files in the repo.
  const missing = found.filter((f) => /(?<![A-Za-z_$])(?:Number|String)\(/.test(code(f)));
  ok(
    missing.length === 0,
    `these read .metrics and coerce, but are in neither READERS nor EXEMPT: ${missing.join(", ")} — ` +
      "add them to the list, or exempt them with a reason",
  );
});

/**
 * The module itself is allowed to say `typeof v === "number"` — it is the one place
 * that defines the rule. Stated from this side so a tidy-up cannot hollow it out
 * into a re-export of the coercion it replaces.
 */
check("lib/metrics.ts guards on typeof, not on Number()", () => {
  const src = code("lib/metrics.ts");
  ok(
    /typeof v === "number" && Number\.isFinite\(v\)/.test(src),
    'finiteNumber no longer checks `typeof v === "number"` — without it every ' +
      'caller silently goes back to accepting null, "" and []',
  );
});

check("lib/metrics.ts validates a series BEFORE it caps it", () => {
  const src = code("lib/metrics.ts");
  const body = src.slice(src.indexOf("export function finiteSeries"));
  const validate = body.search(/\.every\(\s*finiteNumber\s*\)/);
  const cap = body.search(/\.slice\(/);
  ok(validate !== -1, "finiteSeries no longer validates its elements with every(finiteNumber)");
  ok(cap !== -1, "finiteSeries no longer caps its length");
  // The ORDER — capping first lets a malformed element past the cap be sliced away
  // instead of rejecting the row.
  ok(
    validate < cap,
    "finiteSeries caps before it validates — an element past the cap is then sliced " +
      "away rather than rejecting the row, which is not the all-or-nothing rule stated",
  );
  // AND what it does on failure. Order alone permits
  // `v.every(finiteNumber) ? v : v.filter(finiteNumber)`, which passes every check
  // above while COMPACTING a series with a hole in it — the one outcome the module
  // exists to prevent.
  ok(
    /!v\.every\(\s*finiteNumber\s*\)/.test(body) && /return null/.test(body),
    "finiteSeries no longer REJECTS a series that fails validation — filtering or " +
      "repairing it compacts the array and re-dates every year after the hole",
  );
  ok(
    !/\.filter\(\s*finiteNumber\s*\)/.test(body),
    "finiteSeries filters its elements — that is the compaction the module forbids",
  );
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
