// The row-level-security gate.
//
//   node scripts/qa/rls-migration.mjs
//
// A policy you have only read is a policy you are guessing about. Two of the three
// RLS findings this migration answers were policies whose COMMENTS described
// behaviour the SQL did not implement — "leaderboards show username + avatar only"
// over a `using (true)` that published whole rows, and "friendship is mutual-accepted"
// over a policy that never looked at `status`. Reading harder was not going to catch
// those. Running them does.
//
// So this stands the real thing up: a throwaway Postgres cluster, a minimal
// Supabase-shaped harness (the anon/authenticated roles, an auth schema, and an
// auth.uid() reading the same request.jwt.claim.sub GUC PostgREST sets), the OLD
// schema, seed rows, and then three passes:
//
//   BEFORE   supabase/tests/10_attack_probes.sql   — every probe must report VULNERABLE
//   MIGRATE  supabase/migrations/  (every structural one, in order)
//   AFTER    supabase/tests/10_attack_probes.sql   — every probe must report CLOSED
//   WORKS    supabase/tests/20_still_works.sql     — every check must report PASS
//
// The BEFORE pass is the part that makes this a test rather than a demo: a probe that
// cannot show the hole open cannot prove the fix closed it.
//
// Requires a local PostgreSQL (any modern version; developed against 16) on PATH.
// Skips with exit 0 when there is none, so this never becomes the reason CI is red on
// a machine that was never going to run it.
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = process.env.LP_PGPORT ?? "55433";
const SOCK = "/tmp";
const DB = "lp_rls_test";

// A committed fossil, not git archaeology: `HEAD:supabase/schema.sql` stops being
// the "before" the moment the fix lands, which would silently turn the BEFORE pass
// into a second AFTER pass and make the gate self-congratulating.
const OLD_SCHEMA = "supabase/tests/01_schema_before_2026-08-27.sql";
const MIGRATIONS = [
  "supabase/migrations/2026-08-27_01_security_additive.sql",
  "supabase/migrations/2026-08-27_01b_score_bounds.sql",
  "supabase/migrations/2026-08-27_02_profiles_lockdown.sql",
  // 03 is deliberately absent: it rotates live friend codes, which is a data
  // decision an operator makes once, not a structural change the gate can assert.
  "supabase/migrations/2026-08-28_04_write_surface.sql",
  "supabase/migrations/2026-08-28_05_username_gate.sql",
];

const SEED = `
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','victim@example.com'),
  ('22222222-2222-2222-2222-222222222222','attacker@example.com'),
  ('33333333-3333-3333-3333-333333333333','bystander@example.com'),
  -- An account with NO profile row: a fresh signup, which is the state the
  -- username bypass was easiest from. Deliberately absent from public.profiles,
  -- so the three-row counts elsewhere still read three. (No backticks in here:
  -- SEED is a template literal.)
  ('44444444-4444-4444-4444-444444444444','newcomer@example.com');
insert into public.profiles (id, username, avatar_seed, friend_code) values
  ('11111111-1111-1111-1111-111111111111','brave-otter-101','aaaaaaaa','ABC234'),
  ('22222222-2222-2222-2222-222222222222','sly-raven-202','bbbbbbbb','XYZ789'),
  ('33333333-3333-3333-3333-333333333333','calm-maple-303','cccccccc','QWE456');
`;

function have(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status === 0;
}

/**
 * Absolute path to a server binary, or null.
 *
 * `initdb` and `pg_ctl` are frequently NOT on PATH even where `psql` is — Debian and
 * Ubuntu keep them in /usr/lib/postgresql/<major>/bin and only link the client tools.
 * And this runs them through `su postgres -c`, which starts a fresh login shell that
 * would drop an exported PATH anyway. So resolve them here and pass absolute paths.
 */
function serverBin(name) {
  const onPath = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  if (onPath.status === 0) return onPath.stdout.trim();
  const found = spawnSync(
    "sh",
    ["-c", `ls -d /usr/lib/postgresql/*/bin/${name} /usr/pgsql-*/bin/${name} 2>/dev/null | sort -V | tail -1`],
    { encoding: "utf8" },
  );
  const p = found.stdout.trim();
  return p && existsSync(p) ? p : null;
}

/** psql against the throwaway cluster. Returns combined stdout+stderr. */
function psql(args, { db = DB, input } = {}) {
  const r = spawnSync(
    "psql",
    ["-h", SOCK, "-p", PORT, "-U", "postgres", "-d", db, "-q", ...args],
    { encoding: "utf8", input },
  );
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

/** Every "TAG: message" line a probe/positive file raised, in order. */
function verdicts(out, tags) {
  const re = new RegExp(`\\b(${tags.join("|")}): (.*)$`, "gm");
  return [...out.matchAll(re)].map((m) => ({ tag: m[1], msg: m[2].trim() }));
}

let dataDir = null;
let started = false;
let stopCmd = null;

function cleanup() {
  if (started && stopCmd) {
    spawnSync("sh", ["-c", stopCmd], { encoding: "utf8" });
    started = false;
  }
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = null;
  }
}

function main() {
  const INITDB = serverBin("initdb");
  const PG_CTL = serverBin("pg_ctl");
  if (!have("psql") || !INITDB || !PG_CTL) {
    // Not a failure. This gate needs a server; a machine without one is not broken.
    console.log("• no local PostgreSQL (psql + initdb + pg_ctl) — skipping the RLS gate");
    return 0;
  }

  // initdb refuses to run as root, and the postgres user needs to traverse to the
  // data directory, so it lives somewhere that user can actually reach.
  const isRoot = process.getuid?.() === 0;
  const base = isRoot ? "/var/lib/postgresql" : tmpdir();
  if (isRoot && !existsSync(base)) {
    console.log("• no /var/lib/postgresql to host a test cluster — skipping the RLS gate");
    return 0;
  }
  dataDir = mkdtempSync(join(base, "lp-rls-"));
  const asPg = (cmd) =>
    isRoot
      ? spawnSync("su", ["postgres", "-c", cmd], { encoding: "utf8" })
      : spawnSync("sh", ["-c", cmd], { encoding: "utf8" });

  if (isRoot) spawnSync("chown", ["-R", "postgres:postgres", dataDir]);

  const init = asPg(`${INITDB} -D ${dataDir} -A trust -U postgres`);
  if (init.status !== 0) {
    console.log(`• could not initdb a test cluster — skipping the RLS gate\n${init.stderr ?? ""}`);
    return 0;
  }
  const up = asPg(`${PG_CTL} -D ${dataDir} -l ${dataDir}/pg.log -o '-p ${PORT} -k ${SOCK}' -w start`);
  if (up.status !== 0) {
    console.log(`• could not start the test cluster — skipping the RLS gate\n${up.stderr ?? ""}`);
    return 0;
  }
  started = true;
  // Recorded now, while the absolute path and the privilege wrapper are both known —
  // cleanup() runs from a finally block that has neither in scope.
  stopCmd = isRoot
    ? `su postgres -c '${PG_CTL} -D ${dataDir} -m immediate stop'`
    : `${PG_CTL} -D ${dataDir} -m immediate stop`;

  const fail = [];
  const say = (ok, line) => {
    console.log(`${ok ? "  ✓" : "  ✗"} ${line}`);
    if (!ok) fail.push(line);
  };

  psql(["-c", `drop database if exists ${DB}`], { db: "postgres" });
  psql(["-c", `create database ${DB}`], { db: "postgres" });
  psql(["-v", "ON_ERROR_STOP=1", "-f", join(ROOT, "supabase/tests/00_supabase_harness.sql")]);

  // The schema a live database is actually running, as of before the fix.
  psql(["-v", "ON_ERROR_STOP=1", "-f", join(ROOT, OLD_SCHEMA)]);
  psql([], { input: SEED });

  console.log("\nBEFORE — the holes must be open, or this proves nothing");
  const before = verdicts(psql(["-f", join(ROOT, "supabase/tests/10_attack_probes.sql")]), [
    "VULNERABLE",
    "CLOSED",
    "SKIP",
  ]);
  if (before.length === 0) fail.push("no probes ran in the BEFORE pass");
  for (const v of before) say(v.tag === "VULNERABLE", `${v.tag}: ${v.msg}`);

  psql([
    "-c",
    // The newcomer's row only exists if a probe just created one, which is the
    // BEFORE pass reporting the hole open. It must not survive into the next.
    "delete from public.friends; delete from public.results; delete from public.saves;" +
      " delete from public.profiles where id = '44444444-4444-4444-4444-444444444444';",
  ]);
  console.log("\nMIGRATE");
  for (const m of MIGRATIONS) {
    const out = psql(["-v", "ON_ERROR_STOP=1", "-f", join(ROOT, m)]);
    say(!/^ERROR/m.test(out), `applied ${m}`);
  }
  // The BEFORE pass left an RTL username behind; put it back so the AFTER pass
  // measures the constraint rather than the sanitizer's leftovers.
  psql([
    "-c",
    "update public.profiles set username='sly-raven-202' where id='22222222-2222-2222-2222-222222222222'",
  ]);

  console.log("\nAFTER — the same probes, all refused");
  const after = verdicts(psql(["-f", join(ROOT, "supabase/tests/10_attack_probes.sql")]), [
    "VULNERABLE",
    "CLOSED",
    "SKIP",
  ]);
  if (after.length !== before.length) fail.push("AFTER ran a different number of probes than BEFORE");
  for (const v of after) say(v.tag === "CLOSED", `${v.tag}: ${v.msg}`);

  psql([
    "-c",
    // The newcomer's row only exists if a probe just created one, which is the
    // BEFORE pass reporting the hole open. It must not survive into the next.
    "delete from public.friends; delete from public.results; delete from public.saves;" +
      " delete from public.profiles where id = '44444444-4444-4444-4444-444444444444';",
  ]);
  console.log("\nSTILL WORKS — the app's own reads and writes");
  const pos = verdicts(psql(["-f", join(ROOT, "supabase/tests/20_still_works.sql")]), ["PASS", "FAIL"]);
  if (pos.length === 0) fail.push("no checks ran in the STILL WORKS pass");
  for (const v of pos) say(v.tag === "PASS", `${v.tag}: ${v.msg}`);

  console.log("");
  if (fail.length) {
    console.error(`RLS gate FAILED — ${fail.length} check(s):`);
    for (const f of fail) console.error(`  • ${f}`);
    return 1;
  }
  console.log(`RLS gate passed — ${before.length} probe(s) closed, ${pos.length} behaviour(s) intact.`);
  return 0;
}

let code = 1;
try {
  code = main();
} catch (err) {
  console.error(`RLS gate errored: ${err?.stack ?? err}`);
  code = 1;
} finally {
  cleanup();
}
process.exit(code);
