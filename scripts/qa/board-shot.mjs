// Photograph the leaderboard with a real board behind it.
//
//   npm run dev &
//   node scripts/qa/board-shot.mjs
//   QA_VIEWPORT=mobile node scripts/qa/board-shot.mjs
//
// Without Supabase keys the board reads `lifepatch.results` out of localStorage,
// so a representative board can be seeded directly: rows that recorded their
// background and replayed, and rows from before either was recorded. The point of
// the shot is the mixed board — three tab strips, a filter that hides rows, and a
// mark that must read in monochrome.
import { Run, BASE as BASE_URL, DESKTOP, MOBILE } from "./harness.mjs";
import { createRequire } from "module";
import { engineDir } from "./build-engine.mjs";

// Builds the engine if the tree has moved past what is compiled — see build-engine.mjs.
const OUT = engineDir();
const daily = createRequire(`${OUT}/`)(`${OUT}/lib/daily.js`);

const viewport = process.env.QA_VIEWPORT === "mobile" ? MOBILE : DESKTOP;
const tag = process.env.QA_VIEWPORT === "mobile" ? "mobile" : "desktop";

const BACKGROUNDS = ["student", "trade", "hustler"];
// Real verdicts only. "Broke but Free" was in here and the game has never produced
// it — so the board screenshots were showing players a row that cannot exist, and
// now that `results_verdict_known` pins the set, a fixture off that list is a
// fixture testing nothing. Story/Infinite rows get life-sim verdicts; the Rat Race
// rows below get its three. See lib/verdict.ts.
const CASHFLOW_VERDICTS = ["Escaped the Rat Race", "Still Racing", "Buried in Debt"];

/**
 * The verdict a life-sim score would ACTUALLY have earned — `deriveVerdict`'s
 * thresholds, restated (the shot runs against the served build, not the module).
 *
 * The fixture used to hand out verdicts round-robin, independent of the number
 * next to them, which put "$715,989 · UNDERWATER" on the board — a row the engine
 * cannot produce, since `underwater` is the branch for a net worth at or below
 * zero. Same defect as the invented verdict string this file already lost: a
 * screenshot of impossible data checks the layout and nothing else.
 *
 * `happy` stands in for the happiness ≥ 60 test, which separates a small positive
 * net worth into "Rich Enough" and "Getting By"; the fixture has no happiness
 * field, so it is passed per row to keep both branches on the board.
 */
function verdictFor(netWorth, happy) {
  if (netWorth >= 1_000_000) return "Financially Free";
  if (netWorth >= 250_000) return "Comfortable";
  if (netWorth > 0) return happy ? "Rich Enough" : "Getting By";
  return "Underwater";
}

const TODAY = daily.todaysDaily()?.date ?? null;

function rows() {
  const out = [];
  // Four of today's puzzle, filed by four different players, so the Today board is
  // a real board rather than a single row.
  for (let i = 0; i < 4 && TODAY; i++) {
    out.push({
      id: `local-d${i}`,
      userId: `player-${i}`,
      mode: "story",
      score: 1_120_000 - i * 380_000,
      verdict: verdictFor(1_120_000 - i * 380_000, i % 2 === 0),
      metrics: {
        netWorth: 1_120_000 - i * 380_000,
        age: 43,
        seed: 99_000 + i,
        backgroundId: BACKGROUNDS[0],
        engine: 7,
        verified: 1,
        daily: TODAY,
      },
      createdAt: new Date(`${TODAY}T09:00:00Z`).toISOString(),
    });
  }
  for (let i = 0; i < 14; i++) {
    // Every third row is a legacy row: no background, no replay, nothing claimed.
    const legacy = i % 3 === 2;
    out.push({
      id: `local-${i}`,
      userId: `player-${i}`,
      mode: "story",
      score: 1_240_000 - i * 111_337,
      verdict: verdictFor(1_240_000 - i * 111_337, i % 3 === 0),
      metrics: legacy
        ? { netWorth: 1_240_000 - i * 111_337, age: 43 }
        : {
            netWorth: 1_240_000 - i * 111_337,
            age: 43,
            seed: 1000 + i,
            backgroundId: BACKGROUNDS[i % BACKGROUNDS.length],
            engine: 7,
            verified: 1,
          },
      createdAt: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
    });
  }
  // The Rat Race board had NO fixture rows at all, so its screenshot only ever
  // captured the empty state and the one board with its own score label and its own
  // three verdicts went visually unchecked.
  for (let i = 0; i < 6; i++) {
    const escaped = i < 2;
    const lost = i === 5;
    out.push({
      id: `local-cf${i}`,
      userId: `player-${i}`,
      mode: "cashflow",
      score: 310_000 - i * 44_500,
      verdict: lost
        ? CASHFLOW_VERDICTS[2]
        : escaped
          ? CASHFLOW_VERDICTS[0]
          : CASHFLOW_VERDICTS[1],
      metrics: {
        scoreVersion: 3,
        netWorth: 250_000 - i * 40_000,
        passiveIncome: 5_000 - i * 700,
        payday: 5_000 - i * 700,
        expenses: 2_400 + i * 120,
        bankLoan: lost ? 60_000 : 0,
        turns: 18 + i,
        escaped: escaped ? 1 : 0,
        lost: lost ? 1 : 0,
      },
      createdAt: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
    });
  }
  return out;
}

async function main() {
  const run = new Run(`board-${tag}`);
  const seedStorage = { "lifepatch.results": JSON.stringify(rows()) };
  for (let i = 0; i < 14; i++) {
    seedStorage[`lifepatch.profile.player-${i}`] = JSON.stringify({
      id: `player-${i}`,
      username: ["kestrel", "junebug", "orbit", "tallow", "cinder", "pigeon", "marlow"][i % 7] + (i + 11),
      avatarSeed: `seed-${i}`,
      friendCode: `LP-${1000 + i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    });
  }
  const page = await run.open(viewport, { seedStorage });
  await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await run.snap("01-board-any-start");

  const text = (await run.text()).toLowerCase();
  for (const needle of ["ranked by net worth", "replayed", "any start"]) {
    if (!text.includes(needle)) run.finding("HIGH", "board", `missing from the board: "${needle}"`);
  }

  // The filter must actually narrow the board, and say why rows went missing.
  const before = await page.locator("ol li").count();
  if (!(await run.clickTab("broke grad", { wait: 1400 }))) {
    run.finding("HIGH", "board", "the background strip has no Broke Grad tab");
  } else {
    const after = await page.locator("ol li").count();
    console.log(`  rows: ${before} → ${after} filtered`);
    if (after >= before) run.finding("HIGH", "board", `filter did not narrow the board (${before} → ${after})`);
    const filtered = (await run.text()).toLowerCase();
    if (!filtered.includes("only runs that recorded which background")) {
      run.finding("HIGH", "board", "the filter hides rows without saying so");
    }
    await run.snap("02-board-one-background");
  }

  // Rat Race has professions, not backgrounds: the strip must not be offered.
  if (await run.clickTab("rat race", { wait: 1400 })) {
    const cash = (await run.text()).toLowerCase();
    if (cash.includes("any start")) run.finding("HIGH", "board", "the background strip survived onto the Rat Race board");
    if (cash.includes("/mo")) run.finding("HIGH", "board", "the Rat Race score is still printed as a monthly figure");
    if (!cash.includes("net worth plus a year of cash flow")) {
      run.finding("HIGH", "board", "the Rat Race board does not say what its number is");
    }
    await run.snap("03-board-ratrace");
  }

  // Today's puzzle: its own board, and no background strip on it — the day fixes
  // the opening for everybody, so there is nothing left to segment.
  await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  if (!TODAY) {
    run.finding("HIGH", "board", "there is no daily today — check DAILY_EPOCH");
  } else if (!(await run.clickTab("^today$", { wait: 1600 }))) {
    run.finding("HIGH", "board", "the Story board offers no Today tab");
  } else {
    const n = await page.locator("ol li").count();
    console.log(`  today's board: ${n} rows`);
    if (n !== 4) run.finding("HIGH", "board", `Today should show the 4 seeded daily rows, showed ${n}`);
    const t = (await run.text()).toLowerCase();
    if (t.includes("any start")) run.finding("HIGH", "board", "the background strip survived onto the daily board");
    if (!t.includes("today's puzzle")) run.finding("HIGH", "board", "the daily board does not say what it is");
    await run.snap("05-board-today");
    // And it must not exist behind Infinite, which has no daily.
    await run.clickTab("^infinite$", { wait: 1400 });
    const inf = await run.text();
    if (/\bTODAY\b/.test(inf)) run.finding("HIGH", "board", "the Today tab survived onto the Infinite board");
  }

  // The same board inside the in-game overlay, which is a card with a height
  // budget rather than a page — three wrapped tab strips must not eat the list.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await run.settle();
  if (!(await run.click("begin a run", { wait: 1600 }))) {
    run.finding("HIGH", "nav", "no CTA into the mode select");
  } else if (!(await run.click("leaderboard", { wait: 1600 }))) {
    run.finding("HIGH", "nav", "the mode select has no way into the board");
  } else {
    const visibleRows = await page.locator("ol li:visible").count();
    console.log(`  dialog shows ${visibleRows} rows`);
    if (visibleRows < 3) run.finding("HIGH", "board", `the overlay's tabs crowded the list to ${visibleRows} rows`);
    await run.snap("04-board-dialog");
  }

  const summary = run.report();
  await run.close();
  process.exit(summary.counts.HIGH > 0 || summary.consoleErrors.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
