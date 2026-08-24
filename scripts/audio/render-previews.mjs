#!/usr/bin/env node
/**
 * Offline preview renderer for the LifePatch score.
 *
 * Renders "The Debtor's March" to WAV files you can actually listen to, without
 * a browser tab, an audio device, or ffmpeg. The point is that the music can be
 * auditioned and signed off BEFORE the engine is rewritten around it, and
 * re-auditioned after any edit to `src/audio/score.ts`.
 *
 * How it avoids lying to you: every note, pattern, gain and instrument setting
 * comes from `src/audio/score.ts` — the same module the engine builds from. The
 * renderer owns the wiring; it owns none of the music. If a preview and the game
 * ever disagree, the disagreement is in the wiring, not in the notes.
 *
 * Tone.js needs a Web Audio implementation, which Node has not got, so the
 * render happens inside headless Chromium via Playwright and the samples come
 * back as Float32 arrays. `Tone.Offline` renders faster than real time.
 *
 * Usage:
 *   node scripts/audio/render-previews.mjs [--out DIR] [--only cue1,cue2]
 *
 * Exits non-zero if any QC assertion fails, so it doubles as a regression gate.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, globSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  CHORDS, ROOTS, LEAD_THEME, KEYS_FIGURES, COUNTER_LINE, COUNTER_NOTE_VALUE,
  BASS_LINE, SNARE_PATTERN, TICKS_PATTERN, TICK_STAMP_BARS, CARRIAGE_RETURN,
  GRIDS, PRESETS, INTENSITY_RULES, VOICES, STINGERS, STINGER_TIMBRES, STEM_IDS,
  STINGER_ENVELOPE_CAP, STINGER_MAX_SOUNDING_SEC, STING_TONES, rampGain,
  MIX, POLYPHONY, VELOCITY, STINGER_PRIMITIVES, SFX_PRIMITIVES, stingerSoundingSec,
  SCORE_BPM_REF, BEATS_PER_BAR, BARS_PER_SEGMENT, SECONDS_PER_BAR, SECONDS_PER_BEAT,
  CYCLE_SECONDS, SAMPLES_PER_BEAT_44K1, BARS_PER_CYCLE,
} from "../../src/audio/score.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const TONE_BUNDLE = path.join(REPO, "node_modules/tone/build/Tone.js");
const SAMPLE_RATE = 44100;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT_DIR = arg("--out", path.join(REPO, ".preview-audio"));
const ONLY = arg("--only", null)?.split(",").map((s) => s.trim());

/**
 * `--solo <phase>` renders one file per stem, that stem alone at its phase gain
 * and every other stem silent.
 *
 * This exists because "the bed has a deep ringing in it" is not a question you
 * can answer from a mix. Nine layers are playing; the only way to say WHICH one
 * is making a sound — rather than guess from a spectrum and then "fix" the
 * wrong layer — is to listen to them one at a time and measure them one at a
 * time. It is the audio equivalent of bisecting.
 */
const SOLO_PHASE = arg("--solo", null);

/**
 * `--solo-gain 1` renders each soloed stem at a fixed gain instead of its phase
 * gain, which is what makes stems COMPARABLE.
 *
 * A stem's phase gain is a fader position; what you need in order to set fader
 * positions honestly is each stem's loudness at the SAME fader position. Without
 * this you cannot tell a layer that is quiet because its fader is down from one
 * that is quiet because its voice is intrinsically weak — and a preset table
 * written in the belief that 0.42 means the same thing for the piano as for the
 * sub is a table that does not mean what it says.
 */
const SOLO_GAIN = arg("--solo-gain", null);

function chromiumPath() {
  const found = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome");
  return found.length ? found.sort().at(-1) : undefined;
}

// ---------------------------------------------------------------------------
// The cue list
// ---------------------------------------------------------------------------

/**
 * `cycles: 2` on the title theme is deliberate: one cycle proves the tune, two
 * prove the LOOP — whether arriving back at bar 1 feels like the march coming
 * round again or like a tape starting over. That is the single most common way
 * game music fails, and it is inaudible in a one-cycle render.
 */
const CUES = [
  { id: "01-title-theme", phase: "title", cycles: 2, tailSec: 2.5,
    note: "THE THEME SONG. Full anthem, two cycles so you hear the loop turn over." },
  { id: "02-menu", phase: "menu", cycles: 1, tailSec: 2,
    note: "Menus/mode select — the anthem heard from the next room." },
  { id: "03-gameplay-calm", phase: "gameplay", intensity: 0.2, cycles: 1, tailSec: 2,
    note: "Playing, finances healthy. Focused, piano forward, no tune competing." },
  { id: "04-gameplay-stressed", phase: "gameplay", intensity: 0.9, cycles: 1, tailSec: 2,
    note: "Playing, deep in debt. Same material leaning harder + the economy's grind." },
  { id: "05-intro-coldopen", phase: "intro", intensity: 0.75, cycles: 1, tailSec: 2,
    note: "The cold open bed. No tune — the theme has not been earned yet." },
  { id: "06-recap-good", phase: "recapGood", cycles: 1, tailSec: 2.5,
    note: "Good ending. Hopeful: lead and countermelody together." },
  { id: "07-recap-bad", phase: "recapBad", cycles: 1, tailSec: 2.5,
    note: "Bad ending. Dramatic: tension, no tune." },
  { id: "08-stinger-title", stinger: "title", tailSec: 1.6,
    note: "REPLACES THE INTRO BEEP. The anthem stamp: A-C#-D." },
  { id: "09-stinger-stamp-good", stinger: "stampGood", tailSec: 1.4,
    note: "REPLACES THE GOOD OUTRO BEEP. 'APPROVED'." },
  { id: "10-stinger-stamp-bad", stinger: "stampBad", tailSec: 1.4,
    note: "REPLACES THE BAD OUTRO BEEP. The red stamp." },
  { id: "11-stinger-consequence", stinger: "consequence", tailSec: 2,
    note: "Money lands: impact, descent, settle." },
  { id: "12-stings-reveal", stings: ["good", "bad", "warning", "neutral"], tailSec: 1.2,
    note: "Outcome reveal chimes. good: C-major triad → D major (the win colour). bad: A+D# → D+Eb (D# was the one pitch genuinely foreign to D minor). warning: D+G (a 4th) → A+Bb (a minor 2nd, the same grind the tension stem uses). neutral: unchanged." },
];

/** One cue per stem, that stem alone. See `--solo`. */
function soloCues(phase) {
  return STEM_IDS.map((id, i) => ({
    id: `solo-${String(i + 1).padStart(2, "0")}-${id}`,
    phase, solo: id, cycles: 1, tailSec: 2,
    note: `"${id}" alone, at its ${phase} gain, every other stem silent.`,
  }));
}

/**
 * Resolve a phase + intensity to the stem gains the engine would ramp to.
 *
 * Uses `rampGain` from score.ts rather than reimplementing the arithmetic, so a
 * preview cannot drift from the game by a rounding convention.
 */
function stemGainsFor(phase, intensity = 0) {
  const base = { ...PRESETS[phase] };
  const rules = INTENSITY_RULES[phase];
  if (rules) for (const [stem, ramp] of Object.entries(rules)) base[stem] = rampGain(ramp, intensity);
  return base;
}

// ---------------------------------------------------------------------------
// WAV writing (16-bit PCM, no ffmpeg)
// ---------------------------------------------------------------------------

function writeWav(file, channels, sampleRate) {
  const numCh = channels.length;
  const frames = channels[0].length;
  const dataBytes = frames * numCh * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numCh * 2, 28);
  buf.writeUInt16LE(numCh * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(s * 32767), off);
      off += 2;
    }
  }
  writeFileSync(file, buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

const dbfs = (x) => (x <= 0 ? -Infinity : 20 * Math.log10(x));

/**
 * Checks that would each, on their own, have caught a real failure we could
 * otherwise only find by listening to every render every time.
 */
function qc(cue, L, R, sampleRate) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  let peak = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]); if (a > peak) peak = a;
    const b = Math.abs(R[i]); if (b > peak) peak = b;
    sum += L[i]; sumSq += L[i] * L[i];
  }
  const rms = Math.sqrt(sumSq / L.length);
  const dc = sum / L.length;

  add("non-silent", rms > 1e-4, `rms ${rms.toFixed(5)}`);
  // Headroom, not loudness: these are previews, and anything at 0 dBFS is
  // already clipped by the time you hear it.
  add("peak <= -1 dBFS", peak <= 0.891, `peak ${peak.toFixed(4)} (${dbfs(peak).toFixed(2)} dBFS)`);
  add("no DC offset", Math.abs(dc) < 0.01, `dc ${dc.toFixed(6)}`);

  // A splice shows up as a jump that dwarfs the LOCAL signal, which is the
  // only way to ask the question honestly here: this score contains noise (the
  // air bed, the snare, the typewriter clacks), and white noise routinely puts
  // adjacent samples a full amplitude apart. An absolute sample-step threshold
  // flags every snare hit and would have to be set so high it caught nothing.
  // Comparing each step against the surrounding 10 ms instead means a snare
  // reads as normal for its neighbourhood and a discontinuity does not.
  const win = Math.round(0.01 * sampleRate);
  let worstRatio = 0, worstAt = -1;
  for (let i = win; i < L.length - win; i += 16) {
    let local = 0;
    for (let k = i - win; k < i + win; k++) local += Math.abs(L[k]);
    local /= win * 2;
    if (local < 1e-4) continue;
    const step = Math.abs(L[i] - L[i - 1]);
    const ratio = step / local;
    if (ratio > worstRatio) { worstRatio = ratio; worstAt = i; }
  }
  add("no splice/discontinuity", worstRatio < 12,
    `worst step/local-level ${worstRatio.toFixed(1)}x at ${(worstAt / sampleRate).toFixed(3)}s`);

  if (cue.cycles >= 2) {
    // Does the ARRANGEMENT come round again? Compared as RMS envelopes rather
    // than raw samples, because sample-exact repetition is not a property this
    // music has or wants: the air bed is noise, and the tremolo and tension
    // LFOs run free at rates that do not divide the cycle. Their phase differs
    // every time round — by design, so the loop breathes instead of stamping.
    // The envelope still answers the real question, which is whether the same
    // events happen at the same moments.
    const cycle = Math.round(CYCLE_SECONDS * sampleRate);
    const hop = Math.round(0.05 * sampleRate);
    const env = (start) => {
      const out = [];
      for (let i = start; i + hop < start + cycle; i += hop) {
        let s = 0;
        for (let k = i; k < i + hop; k++) s += L[k] * L[k];
        out.push(Math.sqrt(s / hop));
      }
      return out;
    };
    const a = env(0), b = env(cycle);
    const n = Math.min(a.length, b.length);
    const mean = (x) => x.reduce((p, c) => p + c, 0) / x.length;
    const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const r = num / (Math.sqrt(da) * Math.sqrt(db) || 1);
    // 0.80, chosen from measurement rather than taste. The aligned loop scores
    // ~0.84; it cannot score 1.0 because the air bed is noise and every snare
    // and typewriter hit is independently random. Deliberately misaligning the
    // comparison — the failure this check exists to catch — scores 0.49 to 0.63
    // (tested at one beat, half a bar, one bar and two bars of offset). 0.80
    // sits in the gap with margin on both sides.
    add("loop repeats (envelope r > 0.80)", r > 0.80,
      `envelope correlation ${r.toFixed(4)} cycle-to-cycle`);
  }
  return { checks, peak, rms, dc };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const SCORE = {
  CHORDS, ROOTS, LEAD_THEME, KEYS_FIGURES, COUNTER_LINE, COUNTER_NOTE_VALUE,
  BASS_LINE, SNARE_PATTERN, TICKS_PATTERN, TICK_STAMP_BARS, CARRIAGE_RETURN,
  GRIDS, VOICES, STINGERS, STINGER_TIMBRES, STING_TONES,
  MIX, POLYPHONY, VELOCITY, STINGER_PRIMITIVES, SFX_PRIMITIVES,
  SCORE_BPM_REF, BEATS_PER_BAR, BARS_PER_SEGMENT, SECONDS_PER_BAR, SECONDS_PER_BEAT,
  CYCLE_SECONDS, BARS_PER_CYCLE,
};

/**
 * Preflight assertions on the score data itself, before a single sample is
 * rendered.
 *
 * These exist because three separate places in the score and its metadata
 * claimed to be "checked" or "asserted" by this renderer and were not — the
 * sample-exact tempo, the stinger envelope cap, and the one-bar sounding
 * limit. A comment that claims an invariant nobody enforces is worse than no
 * comment: it is the reason a reviewer stops looking. So the claims are made
 * true here rather than deleted there.
 */
function preflight() {
  const problems = [];

  // The reason 108 BPM was chosen over anything else in the 104-112 window.
  const perBeat = (SAMPLE_RATE * 60) / SCORE_BPM_REF;
  if (!Number.isInteger(perBeat) || perBeat !== SAMPLES_PER_BEAT_44K1) {
    problems.push(`tempo is no longer sample-exact: ${SAMPLE_RATE}x60/${SCORE_BPM_REF} = ${perBeat}, expected the integer ${SAMPLES_PER_BEAT_44K1}`);
  }

  // Every pluck timbre must stay inside the cap, or an accent could ring on.
  for (const [name, t] of Object.entries(STINGER_TIMBRES)) {
    for (const [field, max] of Object.entries(STINGER_ENVELOPE_CAP)) {
      if (t.envelope[field] > max) {
        problems.push(`stinger timbre "${name}" has ${field} ${t.envelope[field]} > cap ${max}`);
      }
    }
  }

  // The whole point of the rewrite: nothing may still be sounding a bar later.
  let worst = 0;
  for (const [id, spec] of Object.entries(STINGERS)) {
    const end = stingerSoundingSec(spec);
    worst = Math.max(worst, end);
    if (end > STINGER_MAX_SOUNDING_SEC) {
      problems.push(`stinger "${id}" sounds for ${end.toFixed(3)}s, over the one-bar cap of ${STINGER_MAX_SOUNDING_SEC.toFixed(3)}s`);
    }
  }

  if (problems.length) {
    console.error("Preflight FAILED:");
    for (const p of problems) console.error("  ✗ " + p);
    process.exit(1);
  }
  console.log(
    `Preflight: tempo sample-exact, ${Object.keys(STINGER_TIMBRES).length} timbres inside the envelope cap, `
    + `${Object.keys(STINGERS).length} stingers inside one bar `
    + `(worst ${worst.toFixed(3)}s of ${STINGER_MAX_SOUNDING_SEC.toFixed(3)}s).`);
}

preflight();
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
await page.goto("about:blank");
await page.addScriptTag({ content: readFileSync(TONE_BUNDLE, "utf8") });
await page.addScriptTag({ content: readFileSync(path.join(HERE, "score-graph.js"), "utf8") });

const toneVersion = await page.evaluate(() => window.Tone?.version);
if (!toneVersion) throw new Error("Tone.js failed to load in the render page");
console.log(`Tone.js ${toneVersion} · ${SCORE_BPM_REF} BPM · cycle ${CYCLE_SECONDS.toFixed(4)}s · ${SAMPLES_PER_BEAT_44K1} samples/beat\n`);

const summary = [];
let failures = 0;

for (const cue of (SOLO_PHASE ? soloCues(SOLO_PHASE) : CUES)) {
  if (ONLY && !ONLY.includes(cue.id)) continue;

  // How long the cue's own material lasts, before `tailSec` of ring-out. The
  // sting cue has to derive this from how many stings it lists: they are laid
  // out 1.1s apart from 0.25s (see score-graph's renderCue), so a fixed 2.2s
  // silently rendered only the first two and a bit — the `neutral` chime fell
  // off the end of the buffer entirely, and no QC check can see a sound that
  // was never scheduled.
  const STING_AT = 0.25, STING_STEP = 1.1;
  const musicSec = cue.cycles ? cue.cycles * CYCLE_SECONDS
    : cue.stinger ? stingerSoundingSec(STINGERS[cue.stinger])
    : cue.stings ? STING_AT + cue.stings.length * STING_STEP
    : 2.2;
  // Derive the duration from a whole number of samples so the buffer length is
  // never at the mercy of float truncation inside OfflineAudioContext.
  const totalSamples = Math.round((musicSec + cue.tailSec) * SAMPLE_RATE);
  const duration = totalSamples / SAMPLE_RATE;

  let gains = cue.phase ? stemGainsFor(cue.phase, cue.intensity ?? 0) : null;
  if (gains && cue.solo) {
    // Default: the soloed stem keeps exactly the gain the phase would give it,
    // so its level here is the level it contributes to that mix. With
    // --solo-gain it is forced to a common value instead, for calibration.
    const g = SOLO_GAIN !== null ? Number(SOLO_GAIN) : gains[cue.solo];
    gains = Object.fromEntries(STEM_IDS.map((id) => [id, id === cue.solo ? g : 0]));
  }

  process.stdout.write(`  ${cue.id} … `);
  const rendered = await page.evaluate(
    async ({ score, cue, gains, duration, sampleRate }) =>
      await window.renderCue({ score, cue, gains, duration, sampleRate }),
    { score: SCORE, cue, gains, duration, sampleRate: SAMPLE_RATE },
  );

  const L = Float32Array.from(rendered.L);
  const R = Float32Array.from(rendered.R);
  const file = path.join(OUT_DIR, `${cue.id}.wav`);
  const bytes = writeWav(file, [L, R], SAMPLE_RATE);

  const { checks, peak, rms } = qc(cue, L, R, SAMPLE_RATE);
  const bad = checks.filter((c) => !c.pass);
  failures += bad.length;
  console.log(
    `${(duration).toFixed(1)}s · ${(bytes / 1e6).toFixed(1)}MB · peak ${dbfs(peak).toFixed(1)} dBFS` +
    (bad.length ? `  ❌ ${bad.length} QC FAIL` : "  ✓"),
  );
  for (const c of bad) console.log(`      ❌ ${c.name} — ${c.detail}`);

  summary.push({ id: cue.id, note: cue.note, file, durationSec: +duration.toFixed(3),
    peakDbfs: +dbfs(peak).toFixed(2), rms: +rms.toFixed(5),
    checks: checks.map((c) => ({ ...c })) });
}

await browser.close();

if (pageErrors.length) {
  console.log("\nPage errors during render:");
  for (const e of pageErrors.slice(0, 10)) console.log("  " + e);
  failures += pageErrors.length;
}

writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify({
  bpm: SCORE_BPM_REF, key: "D minor", cycleSeconds: CYCLE_SECONDS,
  samplesPerBeat: SAMPLES_PER_BEAT_44K1, sampleRate: SAMPLE_RATE,
  toneVersion, cues: summary,
}, null, 2));

console.log(`\n${summary.length} cues → ${OUT_DIR}`);
console.log(failures ? `${failures} QC FAILURES` : "All QC checks passed.");
process.exit(failures ? 1 : 0);
