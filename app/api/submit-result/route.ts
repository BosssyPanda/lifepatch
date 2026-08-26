import { NextResponse } from "next/server";

import { resultFromRun } from "@/lib/cloud/resultRow";
import { checkDaily, isFail, MAX_BODY_BYTES, parseTicket } from "@/lib/cloud/ticketGuard";
import { replayRun } from "@/lib/replay";
import { netWorth } from "@/lib/runEngine";
import { supabaseAdmin, userIdFromToken } from "@/lib/supabaseAdmin";

/**
 * The only place a life-sim score becomes a row.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * A score used to be whatever the browser said it was. The client computed the
 * number, computed the verdict, replayed its own journal against its own claim,
 * and wrote its own `verified: 1` — then inserted the row itself under a policy
 * that only asked whether `user_id` matched the session. Every input to that chain
 * is controlled by the party making the claim, so the badge attested to nothing
 * and the score was a suggestion. That is the headline finding this route exists
 * to answer.
 *
 * ── What happens now ────────────────────────────────────────────────────────
 * The client sends the run's ACTIONS — the `ReplayTicket`: seed, background, and
 * the journal of what was chosen, traded, paid and sold, year by year. It does not
 * send a score, and if it did this route would ignore it. The server re-simulates
 * the run with the same engine and derives the score, the verdict and every metric
 * from the state that replay lands on. There is no number here to disagree with.
 *
 * That is a real reduction in what a modified client can claim, and it is worth
 * being precise about where the line falls. `scripts/qa/verify-route.mjs` measures
 * both sides of it:
 *
 *   REFUSED — a journal the engine could not have produced. A choice whose
 *   outcome is not the one the seed rolls, a deal `drawEvents` did not deal (or
 *   the same cards in a different order), the same actions replayed under a
 *   different seed or background, a year appended, spliced out or renumbered.
 *   All of it disagrees with the replay at the first step, and all of it is
 *   refused: 288 attempts, 288 refusals.
 *
 *   NOT REFUSED — a journal that is legal but is not what happened: an extra
 *   trade the state could genuinely have funded, inserted mid-life. This cannot
 *   be caught here and no amount of server-side replay would change that. The
 *   journal is the ONLY record of what the player did, so a legal journal is a
 *   legal run by definition, and the score derived from it is the score those
 *   actions really produce. Editing a journal into a better one is the same class
 *   of thing as scripting the real game, reached more cheaply — and measurably
 *   not a lever: over 36 runs the invented trade moved the score up on 7 of them
 *   and down on 14.
 *
 * So: this ends score FABRICATION — claiming a number, or a life the engine could
 * not produce. It does not end run OPTIMISATION by a determined player. Nothing in
 * the UI claims it does; see the wording on the share page and the board legend.
 *
 * ── Degrading ───────────────────────────────────────────────────────────────
 * With `SUPABASE_SERVICE_ROLE_KEY` unset this route answers 503 and the client
 * falls back to inserting the row itself. That is the intended state of a
 * deployment that has not run Part B of `supabase/schema.sql` yet: runs still
 * reach the board, they simply arrive without the flag that says a server derived
 * them. Part A already refuses a client-written `verified` key, so the badge is
 * honest from the moment the schema lands, whether or not this route is live.
 */

export const runtime = "nodejs";
/** Never cached, never prerendered: every call writes. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    // Not an error the player caused, and not one they can do anything about. The
    // client reads this exact status as "post it yourself" — see `submitResult`.
    return NextResponse.json({ error: "verification is not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const userId = await userIdFromToken(token);
  if (!userId) return NextResponse.json({ error: "sign in to post a score" }, { status: 401 });

  // Checked BEFORE reading, against the declared size. Reading first and then
  // measuring means the body is already buffered by the time the limit applies,
  // which is most of what the limit was for — and `String.length` counts UTF-16
  // units, so a limit named in bytes was letting through roughly three times as
  // many of them for non-ASCII content.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  const raw = await req.text();
  // Again on what actually arrived: `content-length` is a claim, and a chunked
  // request does not make one at all.
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "malformed body" }, { status: 400 });

  const parsed = parseTicket((body as Record<string, unknown>).ticket);
  if (isFail(parsed)) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const daily = checkDaily((body as Record<string, unknown>).daily, parsed);
  // `reject: "daily"` is read by the client, which strips the tag and posts the
  // run as an ordinary one rather than losing it. The run happened; what failed
  // is the claim about WHICH DAY it was an attempt at, and that claim is the only
  // part that has to go.
  if (isFail(daily)) {
    return NextResponse.json({ error: daily.error, reject: "daily" }, { status: daily.status });
  }

  // The replay IS the verification. There is nothing to compare it against,
  // because nothing else was sent to compare.
  const replayed = replayRun(parsed);
  if (!replayed) {
    return NextResponse.json({ error: "this run does not replay" }, { status: 422 });
  }
  if (replayed.status !== "ended") {
    return NextResponse.json({ error: "this run has not finished" }, { status: 422 });
  }

  const derived = Math.round(netWorth(replayed));

  // ── The one thing the client is allowed to assert ──────────────────────────
  // Not the score — the score is derived above and the claim cannot raise it.
  // What this catches is DIVERGENCE: the replay reproduced a life, but not the
  // one the player was shown. That is what a save carried across an engine bump
  // looks like (`migrateSave` says so in as many words), and what any run
  // finished across a content deploy looks like.
  //
  // Without the check those runs would still get a row, still get the flag, and
  // still carry `engine: RUN_VERSION` — because `replayRun` starts from
  // `initRun`, so the server's copy has no `migratedFrom` to stamp. A number the
  // player never saw would go onto the board beside runs it is not comparable
  // to, wearing the mark that says a server vouched for it.
  //
  // So: divergence is refused, and the client posts it unverified with its own
  // provenance intact. The mark keeps meaning "the server replayed this run and
  // got the number you were shown". When they DO agree, the run genuinely
  // reproduces under today's engine and belongs on today's board.
  const claimed = (body as Record<string, unknown>).claimedScore;
  if (typeof claimed === "number" && Number.isFinite(claimed) && Math.round(claimed) !== derived) {
    return NextResponse.json(
      { error: "this run does not replay to the score it was shown", reject: "diverged" },
      { status: 409 },
    );
  }

  const row = resultFromRun(daily ? { ...replayed, daily } : replayed);
  const metrics = {
    ...row.metrics,
    // Written here and nowhere else. The row-level policy in Part A refuses this
    // key on a client insert, so its presence means exactly one thing: the server
    // replayed the recorded actions and this score is what they produce.
    verified: 1,
  };

  const { data, error } = await supabaseAdmin
    .from("results")
    .insert({ user_id: userId, mode: row.mode, score: row.score, verdict: row.verdict, metrics })
    .select("*")
    .single();

  if (error) {
    // 23505 is the unique index on (user_id, mode, metrics->>'seed'). Two tabs, or
    // a response lost after the insert committed: the row exists and this request
    // is a duplicate of the one that made it. Hand back the row rather than an
    // error, so the client marks the run posted and stops retrying.
    if (error.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("results")
        .select("*")
        .eq("user_id", userId)
        .eq("mode", row.mode)
        .eq("metrics->>seed", String(parsed.seed))
        .limit(1)
        .maybeSingle();
      if (existing) return NextResponse.json({ row: existing }, { status: 200 });
    }
    // The message is deliberately not relayed: a Postgres error names tables,
    // columns and constraints, and this endpoint answers unauthenticated-ish
    // callers. It is logged where the operator can read it instead.
    console.error("submit-result: insert failed", error);
    return NextResponse.json({ error: "could not record the run" }, { status: 502 });
  }

  // The score the SERVER derived, echoed back so the client can show the player
  // the number that actually landed rather than the one it computed locally.
  return NextResponse.json({ row: data, score: derived }, { status: 201 });
}
