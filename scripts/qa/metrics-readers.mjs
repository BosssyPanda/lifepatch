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
  check(`${file} does not coerce a metrics field with Number()`, () => {
    const src = code(file);
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
    const src = code(file);
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
    const src = code(file);
    ok(
      !/\.map\(Number\)/.test(src),
      "`.map(Number)` on a stored series keeps null as a $0 year and — with the " +
        "`.filter(Number.isFinite)` that always follows it — DROPS a bad element, " +
        "compacting the array so every later year is drawn one place early. " +
        "Use finiteSeries from lib/metrics.ts",
    );
  });

  check(`${file} does not render a metrics field with String(… ?? …)`, () => {
    const src = code(file);
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
  // Writes metrics, reads none.
  "lib/cloud/buildResult.ts",
  // Types it.
  "lib/cloud/types.ts",
  // Defines the rule.
  "lib/metrics.ts",
  // `fromProjectedRow` converts a PostgREST `metrics->>key` projection, which
  // genuinely arrives as a top-level STRING column — `Number("1")` is the correct
  // read there, and `finiteNumber` would reject every projected row. The nested
  // `metrics` object it hands on is validated by its consumers above.
  "lib/cloud/results.ts",
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
    { cwd: new URL("../../", import.meta.url).pathname, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => !EXEMPT.includes(f));
  const missing = found.filter((f) => !READERS.includes(f) && /(?<![A-Za-z_$])Number\(|String\(/.test(read(f)));
  ok(
    missing.length === 0,
    `these read .metrics and coerce, but are not in READERS: ${missing.join(", ")} — ` +
      "add them to the list (and to lib/metrics.ts's rule) or the gate is blind to them",
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
  // The ORDER, not the presence of one exact line: capping first lets a malformed
  // element past the cap be sliced away instead of rejecting the row, which is a
  // quieter rule than the one the module states.
  ok(
    validate < cap,
    "finiteSeries caps before it validates — an element past the cap is then sliced " +
      "away rather than rejecting the row, which is not the all-or-nothing rule stated",
  );
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
