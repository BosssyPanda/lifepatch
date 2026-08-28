// Compile the pure game engine to plain JS so a Node script can drive it.
//
//   node scripts/qa/build-engine.mjs   →  /tmp/lifepatch-engine/lib/*.js
//
// The engine modules under `lib/` are pure TypeScript with no React and no DOM, so
// they run headless — which is how the balance work in docs/QA-REPORT.md measured
// 9,000 runs, and how the replay/determinism properties below are proven. Output is
// CommonJS into a directory with no package.json, so Node resolves extensionless
// relative requires the way tsc emits them; `@/…` specifiers are rewritten to real
// relative paths on the way out, because tsc resolves that alias for TYPES only and
// emits the specifier untouched.
import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import path from "path";

export const OUT = process.env.QA_ENGINE_OUT ?? "/tmp/lifepatch-engine";
const ROOT = process.cwd();

/** Engine modules only — anything importing React, next/* or the browser stays out.
 *  (`lib/assets.ts` is excluded for exactly that reason: it carries icon components.) */
const ENTRIES = [
  "lib/rng.ts",
  "lib/format.ts",
  "lib/economy.ts",
  "lib/backgrounds.ts",
  "lib/markets.ts",
  "lib/modes.ts",
  "lib/concepts.ts",
  "lib/lifeEvents.ts",
  "lib/runEngine.ts",
  "lib/verdict.ts",
  "lib/palette.ts",
  "lib/replay.ts",
  "lib/daily.ts",
  "lib/dailyShare.ts",
  "lib/cashflow/engine.ts",
  "lib/cloud/buildResult.ts",
  "lib/mp/autoResolve.ts",
  "lib/mp/protocol.ts",
];

/** `walk`, but an absent directory is not an error — nothing may have compiled into it. */
function walkIfPresent(dir) {
  try {
    return walk(dir);
  } catch {
    return [];
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

export function buildEngine({ extra = [] } = {}) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const cfg = path.join(OUT, "tsconfig.build.json");
  writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "commonjs",
        moduleResolution: "node",
        rootDir: ROOT,
        outDir: OUT,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        // `lib/mp/protocol.ts` reaches one component deep (NameField, for the single
        // name-normalising rule both the wire and the setup screen have to agree on),
        // so the compiler needs JSX even though nothing here renders anything.
        jsx: "react-jsx",
        // `lib/supabase.ts` (reached through lib/cloud/buildResult.ts) reads
        // `process.env` — the app's own tsconfig has node types, this one needs
        // them said out loud because it declares its own compilerOptions wholesale.
        // The config file lives in OUT, so tsc would look for @types beside it.
        types: ["node"],
        typeRoots: [path.join(ROOT, "node_modules/@types")],
        // Types only — the emitted specifier keeps the alias, and the rewrite below
        // turns it into a path Node can actually resolve.
        baseUrl: ROOT,
        paths: { "@/*": ["./*"] },
      },
      files: [...ENTRIES, ...extra].map((f) => path.join(ROOT, f)),
    }),
    "utf8",
  );

  execFileSync("npx", ["tsc", "-p", cfg], { stdio: "inherit", cwd: ROOT });

  // The compiled tree lives outside the repo, so Node cannot walk up to the real
  // node_modules. One symlink is cheaper than vendoring or bundling.
  try {
    symlinkSync(path.join(ROOT, "node_modules"), path.join(OUT, "node_modules"), "junction");
  } catch {}

  // `require("@/lib/x")` → the real relative path from this file's directory.
  //
  // Both trees, not just `lib`: `lib/cloud/profiles.ts` and `lib/mp/roomCodes.ts`
  // import the username filter and the identity generator, which live under
  // `supabase/functions/_shared` so the `profile` Edge Function can import the same
  // copy. Not `walk(OUT)` — the node_modules symlink above is under there.
  for (const file of [...walk(path.join(OUT, "lib")), ...walkIfPresent(path.join(OUT, "supabase"))]) {
    const src = readFileSync(file, "utf8");
    const fixed = src.replace(/require\("@\/([^"]+)"\)/g, (_m, spec) => {
      let rel = path.relative(path.dirname(file), path.join(OUT, spec)).split(path.sep).join("/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `require("${rel}")`;
    });
    if (fixed !== src) writeFileSync(file, fixed, "utf8");
  }
  return OUT;
}

/**
 * The compiled engine, rebuilt when the tree has moved past it.
 *
 * Every consumer of this module used to `import { OUT }` and require straight out of
 * it, which builds nothing — so a script run on its own drove whatever happened to be
 * left in /tmp from an earlier build. That was found by sabotaging `lib/replay.ts` and
 * watching the property suite pass anyway: the engine under test was three hours old.
 *
 * A stale gate is the same failure as a gate that cannot fail. It reports on code that
 * is not the code in front of you, and it reports PASS.
 *
 * Staleness is decided by mtime rather than by rebuilding unconditionally, because the
 * browser journeys import this too and none of them should pay a tsc run to open a
 * page. Newest source newer than newest output ⇒ rebuild. Missing output ⇒ rebuild.
 */
let resolved = null;

function newest(dir, ext) {
  let t = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return Infinity; // unreadable or absent — treat as infinitely new, i.e. rebuild
    }
    for (const name of names) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (p.endsWith(ext)) t = Math.max(t, st.mtimeMs);
    }
  }
  return t;
}

export function engineDir() {
  if (resolved) return resolved;
  // `_shared` is engine source too now — `lib/cloud/buildResult.ts` reaches it
  // through `profiles.ts`. Leaving it out of the staleness check would be exactly
  // the failure the note above describes: a gate reporting on code that moved.
  const src = Math.max(
    newest(path.join(ROOT, "lib"), ".ts"),
    newest(path.join(ROOT, "supabase/functions/_shared"), ".ts"),
  );
  const out = newest(path.join(OUT, "lib"), ".js");
  if (src === Infinity || out === Infinity || out === 0 || src > out) buildEngine();
  resolved = OUT;
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildEngine();
  console.log(`engine → ${OUT}/lib`);
}
