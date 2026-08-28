// ESLint flat config.
//
// Replaces `.eslintrc.json`, which ESLint 9 no longer reads by default. ESLint 8
// left support in October 2024 and receives no security fixes; 9 is the maintenance
// line and does.
//
// WHY FlatCompat AND NOT A NATIVE FLAT IMPORT. `eslint-config-next` only began
// shipping real flat-config exports (`eslint-config-next/core-web-vitals`) in the 16
// line. On 15.5.x it is still eslintrc-shaped — `module.exports = { extends: [...] }`
// — so it has to be bridged. This is the same shape `npx @next/codemod
// next-lint-to-eslint-cli` generates, and it drops out naturally whenever the Next 16
// upgrade happens, at which point the body becomes `...nextVitals`.
//
// ESLint 10 is likewise gated behind that upgrade: eslint-config-next@15 peers
// `^7 || ^8 || ^9`, and only the 16 line widens it to `>=9`.
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  {
    // Flat config has no cascade, so ignores are global and stated once. `.next` and
    // `out` are build output; `next-env.d.ts` is generated and rewritten every build.
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Deno, not app code — see the note in tsconfig.json. `_shared/` is linted.
      "supabase/functions/*/index.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
