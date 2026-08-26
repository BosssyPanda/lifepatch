// Does `supabase/schema.sql` actually do what its comments say?
//
// Row-level security is the only thing standing between a public API key and
// everyone's data, and it is written in a language nothing else in this repo
// type-checks, lints or runs. A policy that reads correctly and behaves
// differently is the normal failure mode — the friends INSERT policy in this very
// file was written to force `status = 'pending'`, which read as consent and in
// fact made accepting a friend request impossible, because an acceptance IS an
// insert. Nothing but running it would have said so.
//
// So this runs it. A throwaway Postgres, the schema file VERBATIM, and then the
// claims: who can write what, who can read whom, whether re-running the file is
// safe, and whether the Part B cutover does what the block promises.
//
//   node scripts/qa/schema-policies.mjs
//
// Skips (exit 0) where there is no local Postgres, so it is safe in any CI.
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const PORT = process.env.QA_PG_PORT ?? "55433";
// Postgres refuses to run as root, and this sandbox is root. A socket directory
// and a data directory both have to be writable by the `postgres` system user.
const BASE = "/var/tmp/lifepatch-qa-pg";
const SOCK = "/var/tmp";

function pgBin() {
  for (const v of ["16", "17", "15", "14"]) {
    const p = `/usr/lib/postgresql/${v}/bin`;
    if (spawnSync("test", ["-x", `${p}/initdb`]).status === 0) return p;
  }
  return spawnSync("which", ["initdb"]).status === 0 ? "" : null;
}

const BIN = pgBin();
if (BIN === null || spawnSync("which", ["psql"]).status !== 0) {
  console.log("schema-policies: no local Postgres — SKIPPED");
  console.log("  (install postgresql to run the row-level-security checks)");
  process.exit(0);
}

const asPostgres = (cmd) =>
  execFileSync("su", ["postgres", "-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function psql(sql, { file = false, stopOnError = true, quiet = true } = {}) {
  const args = ["-h", SOCK, "-p", PORT, "-U", "postgres", "-X"];
  if (quiet) args.push("-q");
  if (stopOnError) args.push("-v", "ON_ERROR_STOP=1");
  args.push(file ? "-f" : "-c", sql);
  const r = spawnSync("psql", args, { encoding: "utf8" });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status };
}

/**
 * Run one statement as a role, with `auth.uid()` set — and say what happened.
 *
 * `-t -A` so a single-column select comes back as a bare value, and NOT `-q` so
 * command tags (`UPDATE 0`) are readable: "the policy silently matched no rows"
 * and "the policy refused the write" are different outcomes and both need to be
 * distinguishable from the outside.
 */
function as(role, uid, sql) {
  const body = `set test.uid = '${uid}'; set role ${role}; ${sql}`;
  const args = ["-h", SOCK, "-p", PORT, "-U", "postgres", "-X", "-t", "-A", "-c", body];
  const raw = spawnSync("psql", args, { encoding: "utf8" });
  const r = { out: (raw.stdout ?? "") + (raw.stderr ?? ""), code: raw.status };
  const denied = /violates row-level security policy/.test(r.out);
  const constraint = /violates check constraint/.test(r.out);
  const duplicate = /duplicate key value/.test(r.out);
  const otherError = /^(psql:)?.*ERROR:/m.test(r.out) && !denied && !constraint && !duplicate;
  return { ...r, denied, constraint, duplicate, otherError, ok: r.code === 0 };
}

/** The last non-empty, non-tag line of psql output — i.e. the value selected. */
function value(r) {
  const lines = r.out.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^(SET|RESET|INSERT|UPDATE|DELETE|SELECT)\b/.test(lines[i])) return lines[i];
  }
  return "";
}

let checks = 0;
const fails = [];
function ck(cond, msg, detail) {
  checks++;
  if (!cond) fails.push(detail ? `${msg}\n      ${detail.trim().split("\n").slice(-2).join(" ")}` : msg);
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

// ── bring a database up ─────────────────────────────────────────────────────
try {
  asPostgres(`${BIN}/pg_ctl -D ${BASE} stop -m immediate`);
} catch {}
spawnSync("rm", ["-rf", BASE]);
spawnSync("mkdir", ["-p", BASE]);
spawnSync("chown", ["postgres:postgres", BASE]);
spawnSync("chmod", ["700", BASE]);
try {
  asPostgres(`${BIN}/initdb -D ${BASE} -U postgres --auth=trust`);
  asPostgres(`${BIN}/pg_ctl -D ${BASE} -o '-p ${PORT} -k ${SOCK}' -l ${BASE}/log start`);
} catch (err) {
  console.log("schema-policies: could not start Postgres — SKIPPED");
  console.log(`  ${String(err).split("\n")[0]}`);
  process.exit(0);
}
// pg_ctl returns once it is accepting connections, but the socket can lag a beat.
let up = false;
for (let i = 0; i < 40 && !up; i++) up = psql("select 1", { stopOnError: false }).code === 0;
if (!up) {
  console.log("schema-policies: Postgres never came up — SKIPPED");
  process.exit(0);
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const SCHEMA = path.join(ROOT, "supabase/schema.sql");

function finish() {
  try {
    asPostgres(`${BIN}/pg_ctl -D ${BASE} stop -m immediate`);
  } catch {}
  spawnSync("rm", ["-rf", BASE]);
  console.log(`\n${fails.length === 0 ? "PASS" : "FAIL"} — ${checks} checks, ${fails.length} failures`);
  for (const f of fails) console.log(`  ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

try {
  psql(path.join(HERE, "sql/prelude.sql"), { file: true });

  // ── the file itself ───────────────────────────────────────────────────────
  const first = psql(SCHEMA, { file: true });
  ck(first.code === 0, "supabase/schema.sql must run clean on an empty project", first.out);
  psql(path.join(HERE, "sql/seed.sql"), { file: true });

  console.log("── friendship needs two people, and accepting must be possible ──");
  {
    const ask = as("authenticated", A, `insert into public.friends values ('${A}','${B}','pending');`);
    ck(ask.ok, "A can ask B", ask.out);

    // The one the review caught: an acceptance is an INSERT, because the person
    // accepting has no edge yet. A policy that forces `pending` makes the whole
    // feature unreachable while reading like consent.
    const accept = as("authenticated", B, `insert into public.friends values ('${B}','${A}','accepted');`);
    ck(accept.ok, "B can ACCEPT — an acceptance is an insert, not an update", accept.out);

    const selfDeclare = as("authenticated", C, `insert into public.friends values ('${C}','${A}','accepted');`);
    ck(selfDeclare.denied, "C cannot declare themselves A's accepted friend", selfDeclare.out);

    const honest = as("authenticated", C, `insert into public.friends values ('${C}','${A}','pending');`);
    ck(honest.ok, "C can ask A the honest way", honest.out);

    const promote = as("authenticated", C, `update public.friends set status='accepted' where user_id='${C}';`);
    ck(promote.denied, "C cannot promote their own edge with no reply from A", promote.out);

    const forge = as("authenticated", C, `insert into public.friends values ('${A}','${C}','pending');`);
    ck(forge.denied, "C cannot write an edge on A's behalf", forge.out);

    // ── the delete side, which the friends UI is the first caller of ────────
    // `delete using (auth.uid() = user_id)` was the whole rule, and it made a
    // request undismissable: the target never wrote the row, so the only answer
    // they could give was yes. It also made unfriending one-sided — my edge went,
    // theirs stayed, and `listIncoming` re-presented the person I had just removed
    // as a brand-new request. Both halves are policy, so both are tested here.
    // Two layers, two claims. A client meets the policy; a writer holding the
    // service role bypasses policies entirely and meets the CHECK. `psql` here
    // runs as the table owner, which is the closest this harness gets to that.
    const selfEdge = as("authenticated", C, `insert into public.friends values ('${C}','${C}','pending');`);
    ck(selfEdge.denied, "a client cannot write an edge to themselves", selfEdge.out);

    const selfEdgeOwner = psql(`insert into public.friends values ('${C}','${C}','pending');`, { stopOnError: false, quiet: false });
    ck(/violates check constraint "friends_not_self"/.test(selfEdgeOwner.out), "and neither can a writer that bypasses RLS", selfEdgeOwner.out);

    const meddle = as("authenticated", B, `delete from public.friends where user_id='${C}' and friend_id='${A}';`);
    ck(/^DELETE 0$/m.test(meddle.out), "B cannot delete an edge they are no part of", meddle.out);

    const dismiss = as("authenticated", A, `delete from public.friends where user_id='${C}' and friend_id='${A}';`);
    ck(/^DELETE 1$/m.test(dismiss.out), "A can DISMISS C's request — the edge they are the target of", dismiss.out);

    const gone = as("authenticated", A, `select count(*) from public.friends where user_id='${C}';`);
    ck(value(gone) === "0", "and the dismissed request is actually gone", gone.out);

    const unfriend = as(
      "authenticated",
      A,
      `delete from public.friends where (user_id='${A}' and friend_id='${B}') or (user_id='${B}' and friend_id='${A}');`,
    );
    ck(/^DELETE 2$/m.test(unfriend.out), "unfriending takes BOTH edges, not just mine", unfriend.out);
  }

  console.log("── profiles stop being a directory of account ids ──");
  {
    const own = as("authenticated", C, `select count(*) from public.profiles;`);
    ck(value(own) === "1", "a player reads exactly one profile row: their own", own.out);

    const named = as("authenticated", C, `select count(*) from public.profiles_for(array['${A}','${B}']::uuid[]);`);
    ck(value(named) === "2", "the display lookup answers for ids you already have", named.out);

    const everyone = as("authenticated", C, `select count(*) from public.profiles_for(array[]::uuid[]);`);
    ck(value(everyone) === "0", "there is no way to ask the lookup for everyone", everyone.out);

    const byCode = as("authenticated", C, `select username from public.find_by_friend_code('bbb222');`);
    ck(value(byCode) === "calm-heron-202", "a friend code resolves to a name", byCode.out);
    ck(!/BBB222/.test(byCode.out), "and never hands back a code", byCode.out);

    const walk = as("authenticated", C, `select count(*) from public.profiles where id <> '${C}';`);
    ck(value(walk) === "0", "no other profile row is readable at all", walk.out);
  }

  console.log("── a row cannot vouch for itself ──");
  {
    const plain = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',5e5,'Comfortable','{"seed":1,"engine":7}');`);
    ck(plain.ok, "an ordinary result posts", plain.out);

    const claim = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',9e5,'Financially Free','{"seed":2,"verified":1}');`);
    ck(claim.denied, "a client-written `verified` flag is refused", claim.out);

    const theirs = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${A}','story',1,'Comfortable','{"seed":3}');`);
    ck(theirs.denied, "a row for somebody else is refused", theirs.out);

    const twice = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',9e9,'Comfortable','{"seed":1,"engine":7}');`);
    ck(twice.duplicate, "the same run cannot be posted twice", twice.out);

    const edit = as("authenticated", C, `update public.results set score = 9e9 where user_id = '${C}';`);
    ck(/UPDATE 0/.test(edit.out), "a posted score cannot be edited", edit.out);

    const phish = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',1,'CLICK HERE TO CLAIM YOUR PRIZE','{"seed":9}');`);
    ck(phish.constraint, "an invented verdict cannot reach the OG card", phish.out);

    const huge = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',1,'Comfortable', jsonb_build_object('seed',10,'pad',repeat('x',20000)));`);
    ck(huge.constraint, "metrics cannot be used as free storage", huge.out);

    const server = as("service_role", "", `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',7e5,'Comfortable','{"seed":42,"verified":1,"engine":7}');`);
    ck(server.ok, "the service role writes the verified row", server.out);
  }

  console.log("── the streak is computed in the database, not sent to it ──");
  {
    const run = (d) => value(as("authenticated", A, `select current || '/' || longest from public.bump_streak('${d}');`));
    ck(run("2026-03-01") === "1/1", "day one");
    ck(run("2026-03-01") === "1/1", "the same day again does not double-count");
    ck(run("2026-03-02") === "2/2", "a consecutive day extends it");
    ck(run("2026-03-09") === "1/2", "a gap resets the run but keeps the record");
    ck(run("2026-03-10") === "2/2", "and it builds again from there");
  }

  console.log("── running the file twice must be safe ──");
  {
    const count = () => value(as("service_role", "", `select count(*) from public.results;`));
    const before = count();
    const again = psql(SCHEMA, { file: true });
    ck(again.code === 0, "schema.sql re-runs clean against a populated database", again.out);
    const after = count();
    ck(before === after, `no rows lost on re-run (${before} → ${after})`);
  }

  console.log("── PART B: the cutover ──");
  {
    // Extracted from the file and uncommented, so what is tested is the block the
    // operator will actually run rather than a copy of it that can drift.
    const body = execFileSync("sed", ["-n", '/^-- drop policy if exists "results - insert own"/,$p', SCHEMA], { encoding: "utf8" })
      .split("\n").map((l) => l.replace(/^-- ?/, "")).join("\n");
    ck(/create policy "results - insert own"/.test(body), "Part B is where the file says it is");
    const f = path.join(mkdtempSync(path.join(tmpdir(), "lp-partb-")), "partb.sql");
    writeFileSync(f, body);
    const applied = psql(f, { file: true });
    ck(applied.code === 0, "Part B applies", applied.out);

    const story = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',1,'Comfortable','{"seed":8777}');`);
    ck(story.denied, "after the cutover the browser cannot post a Story run", story.out);

    const infinite = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','infinite',1,'Comfortable','{"seed":8778}');`);
    ck(infinite.denied, "nor an Infinite one", infinite.out);

    const rat = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','cashflow',1,'Still Racing','{"seed":8779,"scoreVersion":3}');`);
    ck(rat.ok, "the Rat Race still posts from the browser — it has nothing to replay", rat.out);

    const ratClaim = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','cashflow',1,'Still Racing','{"seed":8780,"verified":1}');`);
    ck(ratClaim.denied, "and still cannot vouch for itself", ratClaim.out);

    const server = as("service_role", "", `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',123,'Comfortable','{"seed":8781,"verified":1,"engine":7}');`);
    ck(server.ok, "the server is the only remaining way a Story row is written", server.out);

    // And the escape hatch the file promises: re-running Part A undoes it.
    const undo = psql(SCHEMA, { file: true });
    ck(undo.code === 0, "Part A re-runs after the cutover", undo.out);
    const back = as("authenticated", C, `insert into public.results (user_id,mode,score,verdict,metrics) values ('${C}','story',1,'Comfortable','{"seed":8782}');`);
    ck(back.ok, "re-running Part A undoes the cutover, exactly as the file says", back.out);
  }
} catch (err) {
  fails.push(`harness threw: ${String(err).split("\n")[0]}`);
  checks++;
}

finish();
