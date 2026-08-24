// Play the Daily Ledger end to end and photograph every state of it.
//
//   npm run dev &
//   node scripts/qa/daily-shot.mjs
//   QA_VIEWPORT=mobile node scripts/qa/daily-shot.mjs
//
// Three states have to be right and only one of them is reachable by clicking:
// today untouched, today half-lived, today filed. The middle and last are seeded
// straight into the store the strip reads, because a real 21-year run through the
// UI is twenty minutes of clicking and this gate has to run on every commit.
import { Run, BASE as BASE_URL, DESKTOP, MOBILE } from "./harness.mjs";
import { createRequire } from "module";
import { engineDir } from "./build-engine.mjs";

// Builds the engine if the tree has moved past what is compiled — see build-engine.mjs.
const OUT = engineDir();
const require = createRequire(`${OUT}/`);
const engine = require(`${OUT}/lib/runEngine.js`);
const daily = require(`${OUT}/lib/daily.js`);
const rng = require(`${OUT}/lib/rng.js`);

const viewport = process.env.QA_VIEWPORT === "mobile" ? MOBILE : DESKTOP;
const tag = process.env.QA_VIEWPORT === "mobile" ? "mobile" : "desktop";
const DEVICE = "device-qa-daily";

/** Play today's puzzle headlessly, stopping after `years` (or to the end). */
function playDaily(years = Infinity) {
  const p = daily.todaysDaily();
  if (!p) throw new Error("there is no daily today — check DAILY_EPOCH");
  let s = engine.initRun("story", p.backgroundId, "Casey", p.seed, false, { daily: p.date });
  const rand = rng.mulberry32(p.seed);
  let n = 0;
  while (s.status === "playing" && n < years) {
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
    }
    if (rand() < 0.55) s = engine.trade(s, rand() < 0.5 ? "gold" : "savings", Math.round(rand() * 3500));
    s = engine.advanceYear(s);
    n++;
  }
  return { puzzle: p, state: s };
}

function store(date, state) {
  return {
    "lifepatch.deviceId": DEVICE,
    [`lifepatch.daily.${date}`]: JSON.stringify({ date, state, updatedAt: new Date().toISOString() }),
  };
}

async function toModeSelect(run, seedStorage) {
  const page = await run.open(viewport, { seedStorage });
  await run.settle();
  if (!(await run.click("begin a run", { wait: 1600 }))) run.finding("HIGH", "nav", "no CTA into the mode select");
  // The mode select is a centred column taller than a phone, so it opens part-way
  // down. The strip is at the top of it, which is where these shots have to look.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  return page;
}

async function main() {
  const finished = playDaily();
  const halfway = playDaily(9);
  const { puzzle } = finished;
  console.log(`daily #${puzzle.number} · ${puzzle.date} · seed ${puzzle.seed} · ${puzzle.backgroundId}`);

  // ── 1. today untouched ────────────────────────────────────────────────────
  let run = new Run(`daily-${tag}`);
  await toModeSelect(run, { "lifepatch.deviceId": DEVICE });
  await run.snap("01-strip-fresh");
  let text = (await run.text()).toLowerCase();
  for (const needle of [`daily ledger`, `${String(puzzle.number).padStart(3, "0")}`, "play today"]) {
    if (!text.includes(needle)) run.finding("HIGH", "strip", `fresh strip missing "${needle}"`);
  }
  // The three mode cards must survive above/below it.
  for (const mode of ["story", "infinite", "rat race"]) {
    if (!text.includes(mode)) run.finding("HIGH", "strip", `the strip displaced the ${mode} card`);
  }
  // The day fixes the opening, so it has to say which one.
  if (!text.includes("everyone starts as")) run.finding("HIGH", "strip", "the strip does not name the day's opening");

  // Starting it must land straight in the run — no auth gate, no setup screen.
  if (!(await run.click("play today", { wait: 2600 }))) {
    run.finding("HIGH", "strip", "Play today did nothing");
  } else {
    const inRun = (await run.text()).toLowerCase();
    if (/save your life|who do you become/.test(inRun)) {
      run.finding("HIGH", "daily", "the daily stopped at a screen it fixes for the player");
    }
    await run.snap("02-daily-year-one");
  }
  let summary = run.report();
  await run.close();
  let bad = summary.counts.HIGH + summary.consoleErrors.length;

  // ── 2. today half-lived ───────────────────────────────────────────────────
  run = new Run(`daily-${tag}-resume`);
  await toModeSelect(run, store(puzzle.date, halfway.state));
  await run.snap("03-strip-resume");
  text = (await run.text()).toLowerCase();
  if (!text.includes("resume today")) run.finding("HIGH", "strip", "a half-lived day is not offered back");
  if (!text.includes("years in")) run.finding("HIGH", "strip", "the strip does not say how far in you are");
  summary = run.report();
  await run.close();
  bad += summary.counts.HIGH + summary.consoleErrors.length;

  // ── 3. today filed ────────────────────────────────────────────────────────
  run = new Run(`daily-${tag}-done`);
  const page = await toModeSelect(run, store(puzzle.date, finished.state));
  await run.snap("04-strip-done");
  text = (await run.text()).toLowerCase();
  if (!text.includes("read the statement")) run.finding("HIGH", "strip", "a finished day offers no way back to it");
  if (text.includes("play today")) run.finding("HIGH", "strip", "a finished day still offers a second attempt");

  if (!(await run.click("read the statement", { wait: 2600 }))) {
    run.finding("HIGH", "strip", "Read the statement did nothing");
  } else {
    const report = await run.text();
    const lower = report.toLowerCase();
    if (!lower.includes(`daily ledger · no. ${puzzle.number}`.toLowerCase())) {
      run.finding("HIGH", "report", "the statement does not carry the puzzle number");
    }
    for (const g of ["▲", "▬", "▼"]) {
      if (!report.includes(g)) run.finding("MED", "report", `no ${g} cell in the grid`);
    }
    if (!lower.includes("copy the grid")) run.finding("HIGH", "report", "no way to copy the grid");
    // The one thing the grid may never carry — read off the figure itself rather
    // than a slice of page text, which bleeds into the sections either side of it.
    const grid = await page.evaluate(() => {
      const fig = document.querySelector('figure[role="img"]');
      return fig ? { text: fig.innerText, label: fig.getAttribute("aria-label") ?? "" } : null;
    });
    if (!grid) {
      run.finding("HIGH", "report", "the grid is not rendered as a labelled figure");
    } else {
      for (const h of finished.state.history) {
        if (grid.text.includes(String(h.year))) run.finding("HIGH", "report", `the grid leaked the year ${h.year}`);
      }
      // A row of glyphs read aloud is geometry, not a result.
      if (!/\d+ years?:/.test(grid.label)) run.finding("HIGH", "report", `the grid's label says nothing: "${grid.label}"`);
      console.log(`  grid label: ${grid.label}`);
    }
    // Photograph the grid where it actually is, not the top of the statement.
    await page.evaluate(() => document.querySelector('figure[role="img"]')?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(500);
    await run.snap("05-report-grid");

    // The clipboard block itself, read back out of the page's own permission.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    if (await run.click("copy the grid", { wait: 900 })) {
      const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
      console.log(`  clipboard:\n${copied.split("\n").map((l) => `    ${l}`).join("\n")}`);
      if (copied && !/LIFEPATCH DAILY #\d+/.test(copied)) {
        run.finding("HIGH", "report", "the copied block has no header");
      }
      for (const h of finished.state.history) {
        if (copied.includes(String(h.year))) run.finding("HIGH", "report", `the copied block leaked ${h.year}`);
      }
    }
  }
  summary = run.report();
  await run.close();
  bad += summary.counts.HIGH + summary.consoleErrors.length;

  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
