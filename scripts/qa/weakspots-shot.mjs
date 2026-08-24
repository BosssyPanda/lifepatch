// The weak-spot section of the report, with a real record behind it.
//
//   npm run dev &
//   node scripts/qa/weakspots-shot.mjs
//   QA_VIEWPORT=mobile node scripts/qa/weakspots-shot.mjs
//
// The tallies are localStorage under the progress id, so a player who has been
// getting two concepts wrong is seeded directly rather than played into existence.
// The run itself carries the snapshot the engine actually drew from, so the shot
// proves both halves: what the deck already did, and what it will do next.
import { Run, DESKTOP, MOBILE } from "./harness.mjs";
import { createRequire } from "module";
import { engineDir } from "./build-engine.mjs";

// Builds the engine if the tree has moved past what is compiled — see build-engine.mjs.
const OUT = engineDir();
const require = createRequire(`${OUT}/`);
const engine = require(`${OUT}/lib/runEngine.js`);
const eventConcepts = require(`${OUT}/lib/eventConcepts.js`);
const rng = require(`${OUT}/lib/rng.js`);
const { conceptTitle } = require(`${OUT}/lib/concepts.js`);

const viewport = process.env.QA_VIEWPORT === "mobile" ? MOBILE : DESKTOP;
const tag = process.env.QA_VIEWPORT === "mobile" ? "mobile" : "desktop";
const DEVICE = "device-qa-weak";

/** Concepts several cards teach, most-taught first, so the bias has something to act on. */
function taughtConcepts() {
  const byConcept = {};
  for (const e of engine.LIFE_EVENTS) {
    for (const c of eventConcepts.conceptsForEvent(e.id)) (byConcept[c] ??= []).push(e.id);
  }
  return Object.entries(byConcept)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id]) => id);
}

function finishedRun(seed, weakSpots) {
  let s = engine.initRun("story", "student", "Casey", seed, false, { weakSpots });
  const rand = rng.mulberry32(seed);
  while (s.status === "playing") {
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
    }
    if (rand() < 0.5) s = engine.trade(s, "index", Math.round(rand() * 4000));
    s = engine.advanceYear(s);
  }
  return s;
}

async function main() {
  // Four DISTINCT concepts: two the player keeps blowing, one they have never got
  // wrong, and one they have met only once. The last two are the controls — neither
  // may be named, for two different reasons.
  const [a, b, flawless, thin] = taughtConcepts();
  if (!thin) throw new Error("fewer than four concepts are reachable from the event table");
  const tallies = {
    [a]: { hit: 1, miss: 4 },
    [b]: { hit: 2, miss: 3 },
    [flawless]: { hit: 6, miss: 0 },
    [thin]: { hit: 0, miss: 1 },
  };
  const run = new Run(`weak-${tag}`);
  const state = finishedRun(31, [a, b]);
  console.log(`weak spots: ${a} (${conceptTitle(a)}), ${b} (${conceptTitle(b)})`);

  const page = await run.open(viewport, {
    seedStorage: {
      "lifepatch.deviceId": DEVICE,
      [`lifepatch.weakSpots.${DEVICE}`]: JSON.stringify(tallies),
      [`lifepatch.save.${DEVICE}.story`]: JSON.stringify({ mode: "story", state, updatedAt: new Date().toISOString() }),
    },
  });

  await run.settle();
  if (!(await run.click("begin a run", { wait: 1600 }))) run.finding("HIGH", "nav", "no CTA into the mode select");
  if (!(await run.pickCard(0, { wait: 900 }))) run.finding("HIGH", "nav", "no Story card to pick");
  if (!(await run.click("^start ", { wait: 1800 }))) run.finding("HIGH", "nav", "the mode CTA never armed");
  if (!(await run.click("play as guest", { wait: 1600 }))) run.finding("HIGH", "nav", "no guest door");
  if (!(await run.click("^continue", { wait: 2600 }))) run.finding("HIGH", "nav", "the saved run was not offered");

  const text = await run.text();
  const lower = text.toLowerCase();
  if (!lower.includes("weak spots")) run.finding("HIGH", "report", "no weak-spot section on the statement");
  for (const id of [a, b]) {
    if (!text.includes(conceptTitle(id))) run.finding("HIGH", "report", `"${conceptTitle(id)}" is not named`);
  }
  // Never name a concept that was never got wrong, or one met only once.
  if (text.includes(conceptTitle(flawless))) {
    run.finding("HIGH", "report", `"${conceptTitle(flawless)}" was never got wrong and is named anyway`);
  }
  if (text.includes(conceptTitle(thin))) {
    run.finding("HIGH", "report", `"${conceptTitle(thin)}" was met once and is called a weak spot`);
  }
  // Both halves of the honesty: what the deck already did, and what it will do.
  if (!lower.includes("deck was already weighted toward")) {
    run.finding("HIGH", "report", "the report does not admit this run was already biased");
  }
  // The figure is COUNTED from the journal, so it has to agree with the journal.
  const quoted = text.match(/(\d+) of the (\d+) cards it dealt you/i);
  if (quoted) {
    const [, biased, dealt] = quoted.map(Number);
    if (!(biased > 0 && biased <= dealt)) {
      run.finding("HIGH", "report", `the card count is impossible: ${biased} of ${dealt}`);
    }
  }
  if (!lower.includes("will deal more cards")) {
    run.finding("HIGH", "report", "the report does not say what happens next");
  }

  const i = text.search(/weak spots/i);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => /^WEAK SPOTS/i.test(d.innerText ?? ""));
    el?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(500);
  await run.snap("01-weak-spots");
  console.log(`  section: ${text.slice(i, i + 320).replace(/\s+/g, " ")}`);

  const summary = run.report();
  await run.close();
  process.exit(summary.counts.HIGH > 0 || summary.consoleErrors.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
