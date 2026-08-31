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
 * defect. Strings are left alone; none of the patterns below appear in one.
 */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Files that read a result row's `metrics` and must go through `lib/metrics.ts`. */
const READERS = ["app/r/[id]/page.tsx", "lib/challenge.ts", "components/AppShell.tsx"];

console.log("METRICS READERS — jsonb written by somebody else's browser\n");

for (const file of READERS) {
  const src = code(file);

  check(`${file} does not coerce metrics with Number()`, () => {
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

  check(`${file} does not rebuild a series with map/filter`, () => {
    ok(
      !/\.map\(Number\)/.test(src),
      "`.map(Number)` on a stored series keeps null as a $0 year and — with the " +
        "`.filter(Number.isFinite)` that always follows it — DROPS a bad element, " +
        "compacting the array so every later year is drawn one place early. " +
        "Use finiteSeries from lib/metrics.ts",
    );
  });
}

// The module itself is allowed to say `typeof v === "number"` — it is the one
// place that defines the rule. Stated from this side so a tidy-up cannot hollow
// it out into a re-export of the coercion it replaces.
check("lib/metrics.ts guards on typeof, not on Number()", () => {
  const src = read("lib/metrics.ts");
  ok(
    /typeof v === "number" && Number\.isFinite\(v\)/.test(src),
    "finiteNumber no longer checks `typeof v === \"number\"` — without it every " +
      "caller silently goes back to accepting null, \"\" and []",
  );
  ok(
    /if \(!v\.every\(finiteNumber\)\) return null;/.test(src),
    "finiteSeries must validate the WHOLE array before capping — capping first " +
      "lets a malformed element past the cap be sliced away instead of rejecting the row",
  );
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
