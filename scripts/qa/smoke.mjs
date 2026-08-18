// Smoke journeys — the regression net re-run at every gate.
//
//   node scripts/qa/smoke.mjs            (desktop)
//   QA_VIEWPORT=mobile node scripts/qa/smoke.mjs
//   QA_REDUCED=1 node scripts/qa/smoke.mjs
//
// Exits non-zero when a HIGH finding or a console error appears.
import { Run, DESKTOP, MOBILE } from "./harness.mjs";

const viewport = process.env.QA_VIEWPORT === "mobile" ? MOBILE : DESKTOP;
const tag = process.env.QA_VIEWPORT === "mobile" ? "mobile" : "desktop";

async function landing(run) {
  const page = await run.open(viewport);
  await run.snap("01-landing-hero");

  const text = await run.text();
  if (!/LIFEPATCH/i.test(text)) run.finding("HIGH", "landing", "wordmark missing from hero");

  // walk the whole page so every lazy section mounts
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += Math.round(viewport.height * 0.8)) {
    await page.evaluate((n) => window.scrollTo({ top: n, behavior: "instant" }), y);
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(700);
  await run.snap("02-landing-bottom");

  const canvases = await page.$$eval("canvas", (els) => els.length);
  console.log(`  landing canvases: ${canvases}`);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
}

async function intoModeSelect(run) {
  const hit = await run.clickAny(["begin a run", "^begin$", "^start", "play"], { wait: 1800 });
  if (!hit) { run.finding("HIGH", "landing", "no CTA reached the mode select"); return false; }
  await run.snap("03-mode-select");
  const text = await run.text();
  for (const mode of ["Story", "Infinite", "Rat Race"]) {
    if (!new RegExp(mode, "i").test(text)) run.finding("MED", "mode-select", `mode "${mode}" not offered`);
  }
  return true;
}

/** Dismiss coach toasts, lesson panels and resolution cards blocking the board. */
async function clearOverlays(run) {
  for (let i = 0; i < 6; i++) {
    const hit = await run.clickAny(
      [
        "got it",
        "small deal", // exercise the deal-card path rather than always skipping
        "^buy", "^pay", "^accept", "^sell", "^take",
        "^pass", "skip this opportunity", "not now", "^decline",
        "keep & continue", "^continue", "^ok\\b", "^done", "^close",
      ],
      { wait: 900 },
    );
    if (hit) continue;
    // unknown blocker (pop quizzes, coach panels): answer with the first
    // non-chrome control rather than stalling the journey
    const fallback = await clickFirstNonChrome(run);
    if (!fallback) return;
  }
}

const CHROME = /^(sound|vol|exit|open the almanac|glossary|roll|…|skip to content|leaderboard|share|learn)/i;

async function clickFirstNonChrome(run) {
  const buttons = run.page.locator("button:not([disabled])");
  const n = Math.min(await buttons.count(), 40);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    const label = ((await b.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ");
    if (!label || CHROME.test(label)) continue;
    await b.click({ timeout: 5000 }).catch(() => {});
    await run.page.waitForTimeout(800);
    return label.slice(0, 40);
  }
  return null;
}

async function ratRace(run) {
  const page = run.page;
  // mode select: pick the card, then the CTA names the chosen mode
  if (!(await run.click("rat race", { wait: 900 }))) {
    run.finding("HIGH", "mode-select", "Rat Race card not clickable");
    return;
  }
  if (!(await run.clickAny(["start rat race", "^start "], { wait: 1800 }))) {
    run.finding("HIGH", "mode-select", "Start CTA did not fire for Rat Race");
    return;
  }
  await run.snap("04-ratrace-professions");

  // profession → dream → board
  if (!(await run.pickCard(0))) run.finding("HIGH", "rat-race-setup", "no profession card to pick");
  if (!(await run.click("pick your dream", { wait: 1200 }))) {
    run.finding("HIGH", "rat-race-setup", "profession CTA stayed disabled");
    return;
  }
  await run.snap("05-ratrace-dreams");
  if (!(await run.pickCard(0))) run.finding("HIGH", "rat-race-setup", "no dream card to pick");
  if (!(await run.click("enter the rat race", { wait: 2200 }))) {
    run.finding("HIGH", "rat-race-setup", "dream CTA stayed disabled");
    return;
  }
  await run.snap("06-ratrace-tutorial");

  // the tutorial freezes the board until it is dismissed
  await run.clickAny(["skip tutorial"], { wait: 1200 });
  await run.snap("06b-ratrace-board");

  const text = await run.text();
  if (!/roll/i.test(text)) run.finding("HIGH", "rat-race", "no ROLL control on the board screen");

  // three turns, resolving whatever card each landing throws up
  for (let turn = 1; turn <= 3; turn++) {
    // the hub shows "…" while the previous turn is still resolving, and coach
    // toasts sit above the board until acknowledged
    let rolled = false;
    for (let attempt = 0; attempt < 6 && !rolled; attempt++) {
      rolled = await run.click("^roll", { wait: 2600 });
      if (rolled) break;
      await clearOverlays(run);
      await page.waitForTimeout(900);
    }
    if (!rolled) {
      run.finding("MED", "rat-race", `ROLL unavailable on turn ${turn}`);
      console.log("    controls here:", JSON.stringify(await run.controls()));
      console.log("    screen text:", (await run.text()).slice(0, 400));
      break;
    }
    // resolve whatever the landing produced — deal cards, doodads, market offers
    await clearOverlays(run);
    await run.snap(`07-ratrace-turn-${turn}`);
  }

  // the freedom meter must be sane, and must not celebrate an underwater player
  const freedom = await run.readNear("freedom", 120);
  const netWorth = await run.readNear("net worth", 60);
  console.log("  freedom readout:", freedom);
  console.log("  net worth readout:", netWorth);
  const pct = freedom?.match(/(\d+)\s*%/);
  if (pct && (Number(pct[1]) < 0 || Number(pct[1]) > 100)) {
    run.finding("HIGH", "rat-race", `freedom out of range: ${pct[1]}%`);
  }
}

async function storyRun(run) {
  const page = run.page;
  await page.goto(process.env.QA_BASE_URL ?? "http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  if (!(await run.clickAny(["begin a run", "^begin$", "^start", "play"], { wait: 1600 }))) return;
  if (!(await run.click("story", { wait: 900 }))) {
    run.finding("MED", "mode-select", "Story card not clickable");
    return;
  }
  if (!(await run.clickAny(["start story", "^start "], { wait: 1600 }))) {
    run.finding("HIGH", "mode-select", "Start CTA did not fire for Story");
    return;
  }
  await run.snap("08-story-auth");

  // auth gate: dev builds accept any email and keep the save on-device
  const email = page.locator("#email");
  if (await email.count()) {
    await email.fill("qa@lifepatch.test");
    await run.clickAny(["continue with email", "email me a magic link"], { wait: 1800 });
  }
  await run.clickAny(["begin a new life", "new life", "^continue —"], { wait: 1600 });
  await run.snap("09-story-setup");

  // setup: choose a background, then the CTA names the chosen life
  if (!(await run.pickCard(0))) run.finding("MED", "story-setup", "no background card to pick");
  await run.clickAny(["start your life", "^start", "^begin"], { wait: 2000 });
  await run.snap("10-story-year-1");

  const text = await run.text();
  if (!/(19|20)\d{2}/.test(text)) run.finding("MED", "story", "no year visible in the run HUD");

  // answer events + advance three years
  for (let year = 1; year <= 3; year++) {
    // every life event must be answered before ADVANCE unlocks; choices are the
    // enabled buttons inside the event list items
    for (let i = 0; i < 8; i++) {
      const choice = page.locator("li > button:not([disabled])").first();
      if (!(await choice.count())) break;
      await choice.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      // consequence beats can take over the screen — let them settle / dismiss
      await run.clickAny(["^continue", "^ok", "got it", "^next"], { wait: 500 });
    }
    const advanced = await run.clickAny(["advance", "next year", "^commit", "continue"], { wait: 2200 });
    if (!advanced) {
      run.finding("MED", "story", `could not advance past year ${year}`);
      console.log("    controls here:", JSON.stringify(await run.controls()));
      break;
    }
    await run.snap(`11-story-year-${year + 1}`);
  }

  // portfolio sliders should exist and be operable
  const sliders = await page.$$('input[type="range"]');
  console.log(`  portfolio sliders: ${sliders.length}`);
  if (sliders.length) {
    const box = await sliders[0].boundingBox();
    if (box) {
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(box.x + (box.width * i) / 12, box.y + box.height / 2);
        await page.waitForTimeout(45);
      }
      await page.mouse.up();
      await page.waitForTimeout(600);
      await run.snap("12-story-allocated");
    }
  }
}

const run = new Run(`smoke-${tag}`);
try {
  await landing(run);
  if (await intoModeSelect(run)) await ratRace(run);
  await storyRun(run);
} catch (e) {
  run.finding("HIGH", "harness", `journey threw: ${e.message}`);
} finally {
  const summary = run.report();
  await run.close();
  const failed = summary.counts.HIGH > 0 || summary.counts.consoleErrors > 0;
  process.exit(failed ? 1 : 0);
}
