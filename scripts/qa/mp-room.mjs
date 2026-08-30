// A whole match, driven by two clients.
//
//   node scripts/qa/mp-room.mjs                 # the cloud transport
//   QA_MP_LOCAL=1 node scripts/qa/mp-room.mjs   # the same-device transport
//
// Every other gate in this repo tests multiplayer by reading it. Nothing had ever
// RUN a room: create, join, start, lose a player mid-match, ghost-play their life,
// and give it back when they return. That sequence is where the reports come from
// ("it won't let me back in", "it played my life for me"), it is roughly a
// thousand lines of `hooks/useMatch.tsx`, and none of it was executed by anything.
//
// Two transports, one script, because the interesting logic is above both of them.
// `QA_MP_LOCAL=1` drives the BroadcastChannel stand-in, which needs the two clients
// to be two TABS of one browser context (BroadcastChannel does not cross contexts)
// and gives each a fixed `lifepatch.mp.tab` so a reopened tab keeps its player id —
// which is what the device id does in production. Without the flag it drives
// Supabase Realtime, and the two clients are separate contexts, which is closer to
// two people but needs a websocket the runner can actually open.
//
// The assertions are the sentences a player would say, not the internals.
import { chromium } from "playwright";
import { globSync, mkdirSync } from "fs";
import path from "path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const LOCAL = process.env.QA_MP_LOCAL === "1";
const SHOTS = path.join(process.env.QA_SHOT_DIR ?? "/tmp/lifepatch-qa", "mp");
/** Two 30s years plus the slack a real boundary needs. */
const ABSENCE_MS = Number(process.env.QA_MP_ABSENCE_MS ?? 75_000);
/** Story runs 1990–2010 inclusive (`lib/modes.ts`), so year indices run 1..21. */
const LAST_YEAR = 21;

mkdirSync(SHOTS, { recursive: true });

function chromiumPath() {
  const found = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome");
  return found.length ? found.sort().at(-1) : undefined;
}

/** Console noise that is environmental, not a defect under test. */
const IGNORED = [
  /Download the React DevTools/i, /React DevTools/i, /Fast Refresh/i,
  /Next\.js Dev Tools/i, /webpack-hmr/i, /Autoplay is only allowed/i,
  /The AudioContext was not allowed to start/i,
  /play\(\) failed because the user didn't interact/i,
];

const findings = [];
const fail = (where, detail) => { findings.push({ where, detail }); console.log(`  FAIL  ${where} — ${detail}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

class Client {
  /** `tab` is the fixed per-client token the local transport scopes player ids by. */
  constructor(browser, label, tab) { this.browser = browser; this.label = label; this.tab = tab; this.errors = []; }
  async open(sharedCtx) {
    this.ctx = sharedCtx ?? (await this.browser.newContext({ viewport: { width: 1280, height: 900 } }));
    await this.newPage();
  }
  /**
   * A fresh tab that is still THIS player.
   *
   * localStorage survives in the context, which is what a player reopening the game
   * after a crash actually has. The seeded tab token is the local transport's
   * equivalent: `tabScopedId` splits tabs by `sessionStorage`, so without pinning it
   * a reopened tab would come back as a different person and the roster would be
   * right to refuse it — a test artefact, not the bug under test.
   */
  async newPage() {
    this.page = await this.ctx.newPage();
    await this.page.addInitScript((tab) => {
      try {
        sessionStorage.setItem("lp_introSeen", "1");
        if (tab) sessionStorage.setItem("lifepatch.mp.tab", tab);
      } catch {}
    }, this.tab);
    await this.page.route(/va\.vercel-scripts\.com/, (r) =>
      r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    this.page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (IGNORED.some((re) => re.test(t))) return;
      // The URL, not just the sentence. "Failed to load resource:
      // net::ERR_CONNECTION_RESET" names nothing, and a run that reports eight of
      // them tells you only that eight things went wrong somewhere — which is a
      // diagnostic that costs an hour every time it fires. The console message
      // carries its location separately from its text; both belong in the report.
      const where = m.location()?.url;
      this.errors.push((where ? `${t}  ← ${where}` : t).slice(0, 300));
    });
    this.page.on("pageerror", (e) => this.errors.push("PAGEERROR: " + String(e.message ?? e).slice(0, 300)));
    await this.page.goto(BASE, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1500);
  }
  async text() { return (await this.page.evaluate(() => document.body.innerText)).replace(/\s+/g, " "); }
  /**
   * The standings, row by row, read off the list itself.
   *
   * Scraping `body.innerText` for this does not work and looked like it did: the
   * market ticker prints "S&P Y01 −3.1%" all over the run screen, so a `/Y\d+/`
   * sweep of the page finds four ticker years for every two real ones. The rail is
   * one `<ol>` and it is the only thing being asked about.
   */
  /**
   * This device's stored record for a room: whose life it holds, and what year.
   *
   * Which of the three rejoin sources served a run — own disk, the room's cache,
   * a seed rebuild — is not visible on screen, and the difference decides what the
   * screen should say. Reading the record is how this script tells them apart
   * instead of guessing. It is only an answer when read BEFORE the rejoin: the
   * rejoin writes this key itself.
   */
  async stored(code) {
    return this.page.evaluate((room) => {
      try {
        const raw = localStorage.getItem(`lifepatch.mp.${room}`);
        if (!raw) return null;
        const rec = JSON.parse(raw);
        const device = localStorage.getItem("lifepatch.deviceId") ?? "";
        const tab = sessionStorage.getItem("lifepatch.mp.tab");
        const mine = tab ? `${device}:${tab}` : device;
        return { holder: rec?.playerId ?? null, mine, year: rec?.state?.year ?? null };
      } catch {
        return null;
      }
    }, code);
  }
  async rail() {
    return this.page.$$eval('section[aria-label="Live standings"] ol > li', (els) =>
      els.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
  }
  async click(name, wait = 900) {
    // Hit-testing and the transitions that reveal a control both want the page in
    // front; the other client's page is the one that was.
    await this.page.bringToFront().catch(() => {});
    const el = this.page.getByRole("button", { name: new RegExp(name, "i") }).first();
    if (!(await el.count())) return false;
    if (!(await el.isVisible().catch(() => false))) return false;
    if (!(await el.isEnabled().catch(() => false))) return false;
    let good = true;
    await el.click({ timeout: 8000 }).catch(() => { good = false; });
    await this.page.waitForTimeout(wait);
    return good;
  }
  async clickAny(names, wait = 900) { for (const n of names) if (await this.click(n, wait)) return n; return null; }
  async snap(label) { await this.page.screenshot({ path: path.join(SHOTS, `${this.label}-${label}.png`) }).catch(() => {}); }
  /** Landing → mode select → Story → guest → the Setup screen the room panel sits on. */
  async toSetup() {
    // Polled on a timer, not on rAF (playwright's default): rAF does not run in a
    // tab that is not in front, and one of these two clients never is.
    await this.page
      .waitForFunction(() => !document.body.innerText.includes("Best with sound"), null, {
        timeout: 20000,
        polling: 300,
      })
      .catch(() => {});
    await this.clickAny(["begin a run", "^begin$", "^start", "play"], 1600);
    await this.click("story", 900);
    await this.clickAny(["start story", "^start "], 1600);
    await this.clickAny(["play as guest"], 1600);
    await this.clickAny(["begin a new life", "new life", "^continue —"], 1600);
    await this.page.waitForTimeout(600);
  }
}

/** Poll until `read()` is truthy, or give up. Rooms settle on their own schedule. */
async function until(read, ms, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() >= end) return null;
    await new Promise((r) => setTimeout(r, step));
  }
}

/**
 * Two clients means one of them is always the tab you are not looking at, and
 * Chromium throttles that tab hard: `setTimeout` drops to roughly once a minute
 * and `requestAnimationFrame` stops altogether. That is a real condition the room
 * code handles on purpose (see `PRESENCE_STALE_MS`), but it is not the condition
 * under test here — two players are two machines, both awake — and left on it the
 * background client's framer-motion transitions never finish, so its screens never
 * arrive and every assertion after the first reads as a missing feature.
 */
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});
const A = new Client(browser, "host", LOCAL ? "hosttab" : null);
const B = new Client(browser, "guest", LOCAL ? "guesttab" : null);
let skipped = false;

try {
  console.log(`\nSETUP — two clients on the ${LOCAL ? "same-device" : "cloud"} transport`);
  await A.open();
  // BroadcastChannel is per browsing context: the stand-in transport can only see
  // a second TAB, never a second context.
  await B.open(LOCAL ? A.ctx : undefined);
  await A.toSetup();
  await B.toSetup();

  const panel = await A.text();
  if (!/Play with friends/i.test(panel)) {
    fail("setup", "the friends panel never rendered on the Story setup screen");
    throw new Error("no panel");
  }
  if (/build doesn.t have one configured/i.test(panel)) {
    console.log("\n  SKIP — this build has no transport at all.");
    console.log("         Set NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY, or run the dev");
    console.log("         server with NEXT_PUBLIC_MP_LOCAL=1 and pass QA_MP_LOCAL=1.");
    skipped = true;
    throw new Error("skip");
  }
  ok("the room panel is live");

  // ── create ────────────────────────────────────────────────────────────────
  if (!(await A.click("create a room", 3000))) fail("create", "Create a room did not fire");
  // Case-insensitive on purpose: `.eyebrow` uppercases its label, so a literal
  // "Room code" here would be asserting on the stylesheet rather than the room.
  const code = await until(async () => (await A.text()).match(/room code\s+([A-Z0-9]{6})/i)?.[1] ?? null, 20000);
  if (!code) {
    fail("create", "no room code reached the lobby — the channel never subscribed");
    throw new Error("no room");
  }
  ok(`a room opened: ${code}`);
  await A.snap("01-lobby");

  // ── join ──────────────────────────────────────────────────────────────────
  if (!(await B.click("join with a code", 700))) fail("join", "Join with a code did not open the form");
  await B.page.locator('input[placeholder="KX7F2M"]').fill(code);
  if (!(await B.click("^join", 3000))) fail("join", "Join did not fire");
  if (!(await until(async () => /At the table/i.test(await B.text()), 20000))) {
    fail("join", `the second client never reached the lobby: ${(await B.text()).slice(0, 300)}`);
    throw new Error("no join");
  }
  ok("a second client took a seat through presence");
  if (!(await until(async () => /2 (players|at the table)|At the table/i.test(await A.text()), 10000))) {
    fail("lobby", "the host never saw the second player arrive");
  } else ok("the host's roster shows both");
  await A.snap("02-lobby-two");

  // 30s years — the shortest the host can pick, so an absence worth testing is a
  // minute rather than three.
  const thirty = A.page.getByRole("button", { name: /^\[?30s?\]?$/ }).first();
  if (await thirty.count()) { await thirty.click().catch(() => {}); await A.page.waitForTimeout(600); }

  // ── start ─────────────────────────────────────────────────────────────────
  if (!(await A.click("start the match", 3000))) fail("start", "Start the match did not fire");
  if (!(await until(async () => /Year ends in|Live standings/i.test(await A.text()), 15000))) {
    fail("start", "the host never reached the running match");
    throw new Error("no start");
  }
  if (!(await until(async () => /Year ends in|Live standings/i.test(await B.text()), 15000))) {
    fail("start", "the guest never received the start — the room split in two");
  } else ok("both clients entered the running match together");
  await A.snap("03-running");
  await B.snap("03-running");

  const count = (await A.text()).match(/(\d+) IN THE ROOM/)?.[1];
  if (count !== "2") fail("rail", `the host's standings count ${count ?? "no"} players, not 2`);
  else ok("the standings list both players");

  // ── the drop ──────────────────────────────────────────────────────────────
  console.log("\nDROP — the guest's tab closes hard, mid-match");
  /**
   * The guest plays one year for real before the tab goes.
   *
   * Without it they never report an advance, the room has no life of theirs to
   * cache, and the rejoin is served by the seed rebuild — whose floor is the
   * constant 1. That path is worth covering but it proves nothing about the one
   * that broke: a floor that has to survive the player's own report, the host's
   * ghost fast-forward, and the hand-back (`SnapshotMsg.selfYear`). Waiting for
   * their row to turn a year is what puts a real number into the room's cache.
   */
  const playedOne = await until(async () => {
    // No leading \b: the rail renders the marker hard against the name
    // ("PLAYERYOU"), so there is no word boundary in front of it to anchor to.
    const mine = (await B.rail()).find((r) => /you\b/i.test(r));
    const y = Number(mine?.match(/\bY(\d+)\b/)?.[1]);
    return Number.isFinite(y) && y > 1 ? y : null; // Y1 is where everyone starts
  }, 45_000, 500);
  if (playedOne) ok(`the guest played year ${playedOne - 1} themselves before dropping`);
  else console.log("    note: the guest dropped inside year 1, so the room rebuilds their seat from the seed");
  await B.page.close();
  console.log(`  waiting out two year boundaries (${Math.round(ABSENCE_MS / 1000)}s)…`);
  await new Promise((r) => setTimeout(r, ABSENCE_MS));
  await A.snap("04-host-after-drop");
  const dropped = await A.rail();
  console.log(`    rail: ${JSON.stringify(dropped)}`);
  // Case-insensitive throughout: `.eyebrow` uppercases these marks, so a literal
  // "Auto" would be testing the stylesheet.
  const marked = dropped.filter((r) => /\bauto\b|\baway\b|\babsent\b/i.test(r));
  if (marked.length !== 1) fail("ghost", `expected exactly one marked seat, got ${marked.length}`);
  else ok("the room marked the dropped seat");
  if (dropped.some((r) => /\babsent\b/i.test(r))) {
    fail("ghost", "the dropped seat reads Absent — the room lost the life it was supposed to keep playing");
  }
  const years = dropped.map((r) => r.match(/\bY(\d+)\b/)?.[1] ?? "?");
  if (years.length === 2 && years[0] !== years[1]) {
    fail("ghost", `the two rows are years apart (Y${years.join(" vs Y")}) — the absent life stopped being played`);
  } else if (years.length === 2) ok(`both rows are at Y${years[0]} — the absent life was auto-played in step`);

  // ── the rejoin ────────────────────────────────────────────────────────────
  console.log("\nREJOIN — the same device comes back");
  await B.newPage();
  await B.toSetup();
  await B.snap("05-rejoin-offer");
  if (!new RegExp(`rejoin\\s+${code}`, "i").test(await B.text())) {
    fail("rejoin", `the one-tap way back was not offered: ${(await B.text()).slice(0, 400)}`);
  } else ok(`the setup screen offered "Rejoin ${code}"`);

  /**
   * Read BEFORE the click, because this is the record that will SERVE the rejoin.
   *
   * Sampling it afterwards proves nothing: a successful rejoin's own `saveMatch`
   * stamps this key with the returning player's id, so the read always came back
   * "ours" whatever had actually served it — which is how a run that fell through
   * to the room's cache was reported as one that used its own disk.
   */
  const rec = await B.stored(code);
  const ownRecord = !!rec && rec.holder === rec.mine;
  console.log(`    the record that will serve it: ${JSON.stringify(rec)} (this player's own: ${ownRecord})`);

  /**
   * Armed BEFORE the click, because the question is "was it ever shown", not "is
   * it on screen now". The line belongs to the year the player came back into and
   * `applyTick` clears it at the next boundary, so any sample taken afterwards
   * races a 30-second year and reports a working notice as missing.
   */
  const noticeSeen = B.page
    .waitForFunction(
      () =>
        /years?\s+\d+(?:\u2013\d+)?\s+w(?:as|ere)\s+played for you while you were away/i.exec(
          document.body.innerText,
        )?.[0] ?? false,
      null,
      { polling: 100, timeout: 40000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  if (!(await B.click(`rejoin ${code}`, 6000))) fail("rejoin", "the rejoin button did not fire");
  /**
   * Captured at the FIRST frame of the run screen, not read afterwards.
   *
   * The catch-up line belongs to the year the player came back into and
   * `applyTick` clears it at the next boundary — correctly. Sampling the page a
   * few seconds later therefore races a 30-second year and reports a working
   * notice as missing, which is exactly what it did.
   */
  const back = await until(async () => {
    const t = await B.text();
    return /year ends in/i.test(t) ? t : null;
  }, 25000, 200);
  if (!back) {
    fail("rejoin", `never got back into the match: ${(await B.text()).slice(0, 400)}`);
  } else ok("the guest is back in the running match");
  await B.snap("06-rejoined");

  /**
   * The catch-up line — unconditional, because all three rejoin sources can now
   * name the range.
   *
   * It names a RANGE, and a range needs a floor: the last year the player played
   * themselves. This device's own record and a seed rebuild both carry one in the
   * life they hand over. The room's cache does not — it is already fast-forwarded
   * to the room's year — so the floor travels beside it as `SnapshotMsg.selfYear`.
   * Under `QA_MP_LOCAL=1` the local record is usually the OTHER tab's (one
   * `lifepatch.mp.<ROOM>` key, two players, and `loadMatch` correctly refuses a
   * record it doesn't own), so this run exercises exactly the cache path that used
   * to leave a returning player with no explanation for their net worth.
   */
  const notice = await noticeSeen;
  if (notice) {
    /**
     * Not just "a line appeared". A range is a claim about this player's life, so
     * it has to be one that could have happened: it starts at a real year, it does
     * not run backwards, it stays inside the story, and its floor is not LATER
     * than the year the room had already reached without them — a player cannot
     * have played a year they were absent for. Deliberately no tight upper bound:
     * the room keeps turning years between the rail read and the rejoin, and a
     * bound that raced the clock would fail a correct notice.
     */
    // Both wordings: "Year 3 was played…" for a single year, "Years 1–2 were
    // played…" (en dash, as rendered) for a range.
    const [, lo, hi] = /years?\s+(\d+)(?:\u2013(\d+))?\s+w(?:as|ere)\s+played/i.exec(notice) ?? [];
    const from = Number(lo);
    const to = Number(hi ?? lo);
    const away = Number(years[0]); // the room's year while they were gone
    const sane = Number.isFinite(from) && from >= 1 && to >= from && to <= LAST_YEAR && from <= away;
    if (!sane) {
      fail("rejoin", `the catch-up notice names a range that never happened: "${notice}" (room was at Y${away})`);
    } else ok(`the catch-up notice names the years the room played: "${notice}"`);
  } else if (back) {
    fail("rejoin", "no catch-up notice — the player is not told why their net worth moved");
  }
  if (back && /No room with that code|isn.t running any more|already started/i.test(back)) {
    fail("rejoin", "a live room turned a seated player away");
  }

  // The room has to notice them back, or it will go on ghost-playing a life its
  // owner is sitting there living.
  await A.page.waitForTimeout(8000);
  await A.snap("07-host-after-rejoin");
  const hostRail = await A.rail();
  console.log(`    rail: ${JSON.stringify(hostRail)}`);
  // The load-bearing guarantee of the whole rejoin: the life handed back is the
  // life the standings watched. Both rails are compared rather than trusted.
  const guestRail = await B.rail();
  const figures = (rows) => rows.map((r) => r.match(/(Y\d+)\s+(−?\$[\d,]+)/)?.slice(1).join(" ") ?? "?").sort();
  const hostFigures = figures(hostRail);
  const guestFigures = figures(guestRail);
  if (JSON.stringify(hostFigures) !== JSON.stringify(guestFigures)) {
    fail("rejoin", `the two clients disagree about the room: host ${JSON.stringify(hostFigures)} vs guest ${JSON.stringify(guestFigures)}`);
  } else ok(`both clients show the same standings: ${JSON.stringify(hostFigures)}`);

  const stillMarked = hostRail.filter((r) => /\bauto\b|\baway\b|\babsent\b/i.test(r));
  if (stillMarked.length > 0) {
    fail("rejoin", `the host still shows the returned player away: ${JSON.stringify(stillMarked)}`);
  } else ok("the host sees the returned player as present again");
  // A seat nobody has spoken for prints a dash instead of a figure. By now both
  // players have reported, so a dash left in the rail is a row that lost its life.
  const dashed = hostRail.filter((r) => /—/.test(r));
  if (dashed.length > 0) fail("rail", `a seat still has no figure: ${JSON.stringify(dashed)}`);
} catch (e) {
  if (!skipped) fail("fatal", String(e.message ?? e));
} finally {
  for (const c of [A, B]) {
    if (c.errors.length) {
      console.log(`\n  console errors (${c.label}):`);
      for (const e of c.errors.slice(0, 8)) console.log(`    ${e}`);
    }
  }
  const consoleErrors = A.errors.length + B.errors.length;
  await browser.close();
  if (skipped) process.exit(0);
  console.log(`\nmp-room (${LOCAL ? "same-device" : "cloud"}): ${findings.length} failure(s) · ${consoleErrors} console error(s)`);
  console.log(`screenshots: ${SHOTS}`);
  process.exit(findings.length || consoleErrors ? 1 : 0);
}
