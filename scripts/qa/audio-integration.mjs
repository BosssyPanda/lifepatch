// Audio integration journey — proves the score actually starts, and that the
// screens drive it into the phases they claim to.
//
//   node scripts/qa/audio-integration.mjs
//
// This exists because every other gate in the repo is blind to audio. Lint,
// typecheck and build all pass happily while the engine throws on its first
// user gesture, or while a phase change silently never fires — the two ways a
// score rewrite breaks that nobody notices until a player has already loaded
// the page. The engine exposes `window.__lpAudio` in development for exactly
// this, so the assertions below read the real engine's real state rather than
// inferring it from what is on screen.
//
// Headless Chromium has no audio device. That is fine: Tone still builds its
// graph and runs its Transport, which is what is under test. No autoplay flag
// is needed either — every boot here happens inside a Playwright click, which
// is a trusted user gesture, so `Tone.start()` resolves on its own; the harness
// filters the autoplay console warnings that headless emits regardless.
//
// RUN THIS AGAINST A DEV SERVER (`npm run dev`, or QA_BASE_URL). `__lpAudio` is
// compiled out of production builds by design, so against `npm start` every
// assertion below reports the engine as absent rather than as broken.
//
// WHY THIS JOURNEY DOES NOT CALL `run.settle()`, ALONE AMONG THE SIX.
//
// Every other journey opens with `settle()`, which waits for the Gate to stop
// being on screen — the fix for `skipIntro` promoting a returning visitor past
// a Gate that `AnimatePresence` is still crossfading out. This one opens with
// `skipIntro: false` and WANTS the Gate, because clicking its BEGIN is the
// trusted user gesture that boots the engine, and the first assertion below is
// that no engine exists before it. Waiting for the Gate to disappear first
// would wait for something only that click can cause: the journey would hang
// its full timeout and then report a HIGH about a Gate that was working
// correctly. The difference is deliberate; do not "fix" it by adding settle().
//
// The engine-build bootstrap the other journeys gained does not apply either:
// nothing here imports the compiled engine. This drives the real browser and
// reads `window.__lpAudio`, so the code under test is whatever the dev server
// is serving, which cannot go stale.
//
// Exits non-zero on any HIGH finding or console error.
import { Run, DESKTOP } from "./harness.mjs";

const run = new Run("audio-integration");

/** Read the engine's live state, or null when it has not booted. */
async function audio(page) {
  return page.evaluate(() => {
    const a = window.__lpAudio;
    return a ? { started: a.started, phase: a.phase, intensity: a.intensity } : null;
  });
}

/**
 * Wait for the engine to reach a phase. Phase changes are gain RAMPS driven by
 * ceremonies that quantize to the bar, so the right assertion is "gets there",
 * not "is there the instant the click returns".
 */
async function waitForPhase(page, want, timeout = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    const s = await audio(page);
    last = s?.phase ?? last;
    if (s?.phase === want) return true;
    await page.waitForTimeout(400);
  }
  console.log(`      (last seen phase: ${last ?? "engine not booted"})`);
  return false;
}

const page = await run.open(DESKTOP, { skipIntro: false });

// 1. Before any gesture there must be no engine at all. The score is gated on
//    a real interaction; booting it earlier would both violate autoplay policy
//    and pull the Tone chunk into first paint.
const before = await audio(page);
if (before?.started) run.finding("HIGH", "gate", "audio engine started before any user gesture");
console.log(`  pre-gesture: ${before ? `present, started=${before.started}` : "no engine (correct)"}`);
await run.snap("01-gate");

// 2. The gate gesture boots the engine into the cold open.
const entered = await run.clickAny(["begin", "enter", "start", "continue", "play"], { wait: 2500 });
if (!entered) {
  run.finding("HIGH", "gate", "found no control to enter the game");
} else {
  const booted = await waitForPhase(page, "intro", 15000);
  const s = await audio(page);
  if (!s?.started) run.finding("HIGH", "cold-open", "engine did not start after the gate gesture");
  else if (!booted) run.finding("MED", "cold-open", `engine started but never reached "intro" (saw "${s.phase}")`);
  else console.log(`  cold open: started=${s.started} phase=${s.phase} intensity=${s.intensity?.toFixed?.(2)}`);
  await run.snap("02-cold-open");
}

// 3. The cold open escalates intensity beat by beat. This assertion is the
//    reason `setIntensity` had to start applying in the intro phase at all —
//    it used to return early unless the phase was gameplay, so the escalation
//    the film was asking for never reached the mix.
const iSamples = [];
for (let i = 0; i < 10; i++) {
  const s = await audio(page);
  if (typeof s?.intensity === "number") iSamples.push(s.intensity);
  await page.waitForTimeout(1200);
}
if (iSamples.length > 2) {
  const rose = Math.max(...iSamples) > Math.min(...iSamples) + 0.05;
  console.log(`  intensity over cold open: ${iSamples.map((v) => v.toFixed(2)).join(" → ")}`);
  if (!rose) run.finding("MED", "cold-open", "intensity never rose during the cold open");
}

// 4. The title resolves out of the cold open — the one moment the anthem is
//    unambiguously the point.
if (await waitForPhase(page, "title", 30000)) {
  console.log("  title: reached");
  await run.snap("03-title");
} else {
  run.finding("MED", "title", "never reached the title phase");
}

// 5. Leaving the title for the menus crossfades to the toned-down mix.
await run.clickAny(["begin a run", "^begin$", "^start", "play"], { wait: 2500 });
if (await waitForPhase(page, "menu", 15000)) {
  console.log("  mode select: phase=menu");
  await run.snap("04-menu");
} else {
  const s = await audio(page);
  run.finding("MED", "menu", `mode select did not reach "menu" (saw "${s?.phase}")`);
}

// 6. The transport must still be running and the graph intact at the end. A
//    score that throws mid-journey can still leave the last phase set, so the
//    end state is checked directly.
const end = await audio(page);
if (!end?.started) run.finding("HIGH", "teardown", "engine is no longer started at the end of the journey");

const summary = run.report();
await run.close();

const high = summary.counts.HIGH;
const errs = summary.counts.consoleErrors;
console.log(high || errs ? `\nFAIL — ${high} high findings, ${errs} console errors` : "\nPASS");
process.exit(high || errs ? 1 : 0);
