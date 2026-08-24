// Drive the real app to a finished run's report and photograph it.
//
//   npm run dev &
//   node scripts/qa/build-engine.mjs
//   node scripts/qa/report-shot.mjs
//   QA_VIEWPORT=mobile node scripts/qa/report-shot.mjs
//
// The report is the screen this pass changes most — the ghost line, the gap, the
// weak spots — and every one of those is a rendering problem as much as an engine
// one. A chart whose second series leaves the frame typechecks perfectly.
//
// Reaching it by playing costs twenty-one turns, so a finished run is generated
// headlessly and seeded straight into the save slot the guest path reads.
import { createRequire } from "module";
import { Run, DESKTOP, MOBILE } from "./harness.mjs";
import { OUT } from "./build-engine.mjs";

const require = createRequire(`${OUT}/`);
const engine = require(`${OUT}/lib/runEngine.js`);
const replay = require(`${OUT}/lib/replay.js`);

const viewport = process.env.QA_VIEWPORT === "mobile" ? MOBILE : DESKTOP;
const tag = process.env.QA_VIEWPORT === "mobile" ? "mobile" : "desktop";
const DEVICE = "device-qa-report";

/**
 * A run worth photographing: it trades, it carries debt, it lives all 21 years, and
 * it ends far enough from its own ghost that the two lines are visibly different.
 */
function finishedRun(seed) {
  const rand = (function mul(a) { return () => ((a = (a + 0x6d2b79f5) | 0), ((a ^ (a >>> 15)) >>> 0) / 4294967296); })(seed);
  let s = engine.initRun("story", "student", "Casey", seed);
  while (s.status === "playing") {
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
    }
    // Half-hearted investing plus some debt service: a life the index can beat.
    if (rand() < 0.6) s = engine.trade(s, rand() < 0.5 ? "gold" : "savings", Math.round(rand() * 4000));
    if (rand() < 0.3) s = engine.payDebt(s, 1200);
    s = engine.advanceYear(s);
  }
  return s;
}

async function main() {
  let picked = null;
  for (let seed = 1; seed < 400 && !picked; seed++) {
    const s = finishedRun(seed);
    const g = replay.ghostFor(s);
    // Insist on a real gap and a full story, so the screenshot proves something.
    if (g && !g.truncated && s.history.length === 21 && Math.abs(g.gap) > 40000) picked = { s, g, seed };
  }
  if (!picked) throw new Error("no fixture run produced a visible gap");
  const { s, g, seed } = picked;
  console.log(`fixture: seed ${seed} · you ${Math.round(engine.netWorth(s))} · ghost ${g.final} · gap ${g.gap}`);

  const run = new Run(`report-${tag}`);
  const page = await run.open(viewport, {
    seedStorage: {
      "lifepatch.deviceId": DEVICE,
      [`lifepatch.save.${DEVICE}.story`]: JSON.stringify({ mode: "story", state: s, updatedAt: new Date().toISOString() }),
    },
  });

  await run.settle();
  if (!(await run.click("begin a run", { wait: 1600 }))) run.finding("HIGH", "nav", "no CTA into the mode select");
  // The mode cards lead with their eyebrow ("FINITE · HAS AN ENDING"), not the
  // mode's name, so they are picked positionally — Story is first.
  if (!(await run.pickCard(0, { wait: 900 }))) run.finding("HIGH", "nav", "no Story card to pick");
  if (!(await run.click("^start ", { wait: 1800 }))) run.finding("HIGH", "nav", "the mode CTA never armed");
  // The gate offers email or guest. The seeded save belongs to the device id, so
  // take the guest door — "continue" alone would submit the empty email form.
  if (!(await run.click("play as guest", { wait: 1600 }))) run.finding("HIGH", "nav", "no guest door on the auth gate");
  if (!(await run.click("^continue", { wait: 2600 }))) run.finding("HIGH", "nav", "the saved run was not offered");
  await run.snap(`10-report-top`);

  // Section labels are upper-cased in CSS and `innerText` reports the transformed
  // text, so the copy is matched case-insensitively.
  const text = (await run.text()).toLowerCase();
  for (const needle of ["the other version of this life", "the difference", "every spare dollar in the index"]) {
    if (!text.includes(needle)) run.finding("HIGH", "report", `missing from the report: "${needle}"`);
  }

  // Walk the whole statement so every section is photographed, not just the fold.
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0, i = 0; y < height; y += Math.round(viewport.height * 0.8), i++) {
    await page.evaluate((n) => window.scrollTo({ top: n, behavior: "instant" }), y);
    await page.waitForTimeout(420);
    await run.snap(`1${i + 1}-report-${i}`);
  }

  // The chart's own frame: nothing may be drawn outside it.
  const overflow = await page.evaluate(() => {
    const svg = Array.from(document.querySelectorAll("svg")).find((el) => (el.getAttribute("aria-label") ?? "").startsWith("Net worth by year"));
    if (!svg) return { missing: true };
    const vb = svg.viewBox.baseVal;
    const paths = Array.from(svg.querySelectorAll("path")).map((p) => {
      const b = p.getBBox();
      return { x: b.x, y: b.y, w: b.width, h: b.height, dash: p.getAttribute("stroke-dasharray") };
    });
    return { missing: false, vb: { w: vb.width, h: vb.height }, paths, label: svg.getAttribute("aria-label") };
  });
  if (overflow.missing) {
    run.finding("HIGH", "chart", "the annotated chart is not on the report");
  } else {
    console.log(`  chart ${overflow.vb.w}x${overflow.vb.h}, ${overflow.paths.length} paths`);
    const ghostPath = overflow.paths.find((p) => p.dash === "6 5");
    if (!ghostPath) run.finding("HIGH", "chart", "no dashed ghost path in the chart");
    for (const p of overflow.paths) {
      if (p.y < -0.5 || p.y + p.h > overflow.vb.h + 0.5 || p.x < -0.5 || p.x + p.w > overflow.vb.w + 0.5) {
        run.finding("HIGH", "chart", `a line is drawn outside the frame: ${JSON.stringify(p)}`);
      }
    }
    if (!/dashed second line/.test(overflow.label ?? "")) {
      run.finding("HIGH", "chart", "the ghost is not described in the chart's aria-label");
    }
  }

  const summary = run.report();
  await run.close();
  process.exit(summary.counts.HIGH > 0 || summary.consoleErrors.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
