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
  "lib/cloud/buildResult.ts",
  "lib/mp/autoResolve.ts",
  "lib/mp/protocol.ts",
];

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
  for (const file of walk(path.join(OUT, "lib"))) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  buildEngine();
  console.log(`engine → ${OUT}/lib`);
}
