// Does anything that must stay on the server end up in the browser bundle?
//
// `SUPABASE_SERVICE_ROLE_KEY` bypasses every row-level-security policy in the
// database. It is kept out of the client by one thing only: the absence of a
// `NEXT_PUBLIC_` prefix, which is a convention enforced by a bundler rather than
// by a type. Add the prefix by mistake — or import `lib/supabaseAdmin` from a
// component, which is a one-character difference in a path — and the key ships to
// every visitor with no error, no warning, and nothing on screen to notice.
//
// So it is checked. Run after `npm run build`.
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const CLIENT_DIRS = [".next/static"];

/** Things that must never appear in a file the browser downloads. */
const FORBIDDEN = [
  ["SUPABASE_SERVICE_ROLE_KEY", "the service-role key's variable name"],
  ["supabaseAdmin", "the server-only admin client"],
  ["userIdFromToken", "the server-only token verifier"],
  // The literal shapes of a Supabase secret key, in case one is ever pasted
  // into a NEXT_PUBLIC_ variable or hard-coded.
  ["sb_secret_", "a Supabase secret key"],
  ["service_role", "a service_role JWT claim"],
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|json)$/.test(p)) out.push(p);
  }
  return out;
}

const files = CLIENT_DIRS.flatMap((d) => walk(d));
if (files.length === 0) {
  console.error("secret-audit: no client bundle found — run `npm run build` first");
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const body = readFileSync(file, "utf8");
  for (const [needle, why] of FORBIDDEN) {
    if (body.includes(needle)) hits.push({ file, needle, why });
  }
}

console.log(`scanned ${files.length} client-bundle files for ${FORBIDDEN.length} server-only markers`);
for (const h of hits) console.log(`  LEAK  ${h.why} — "${h.needle}" in ${h.file}`);

// The publishable key SHOULD be there — it is public by design and every table
// behind it is row-level-secured. Confirming it is present proves the scan is
// actually looking at a real bundle rather than an empty directory.
const anonPresent = files.some((f) => {
  const b = readFileSync(f, "utf8");
  return b.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") || b.includes("sb_publishable_") || b.includes("supabase.co");
});
console.log(`  (the publishable key / project URL is present in the bundle: ${anonPresent ? "yes" : "no — nothing configured at build time"})`);

console.log(`\n${hits.length === 0 ? "PASS" : "FAIL"} — ${hits.length} leaks`);
process.exit(hits.length === 0 ? 0 : 1);
