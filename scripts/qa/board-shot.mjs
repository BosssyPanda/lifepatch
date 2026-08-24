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

const viewport = process.env.QA_VIEWPORT === "mobile" ? MOBILE : DESKTOP;
const tag = process.env.QA_VIEWPORT === "mobile" ? "mobile" : "desktop";

const BACKGROUNDS = ["student", "trade", "hustler"];
const VERDICTS = ["Rich Enough", "Comfortable", "Broke but Free", "Buried in Debt"];

function rows() {
  const out = [];
  for (let i = 0; i < 14; i++) {
    // Every third row is a legacy row: no background, no replay, nothing claimed.
    const legacy = i % 3 === 2;
    out.push({
      id: `local-${i}`,
      userId: `player-${i}`,
      mode: "story",
      score: 900_000 - i * 61_337,
      verdict: VERDICTS[i % VERDICTS.length],
      metrics: legacy
        ? { netWorth: 900_000 - i * 61_337, age: 43 }
        : {
            netWorth: 900_000 - i * 61_337,
            age: 43,
            seed: 1000 + i,
            backgroundId: BACKGROUNDS[i % BACKGROUNDS.length],
            engine: 6,
            verified: 1,
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
