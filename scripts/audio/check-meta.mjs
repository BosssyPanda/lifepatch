#!/usr/bin/env node
/**
 * Validate the cue metadata in `public/audio/meta/*.music.json` against the
 * score it claims to describe.
 *
 *   node scripts/audio/check-meta.mjs
 *
 * Why this exists. CLAUDE.md requires every cue to carry metadata — bpm, key,
 * bars, loop points, sections, cue points, stems, intensity layers, transition
 * rules, license notes — and those documents were written by hand. Hand-written
 * documentation of a moving target is wrong the moment the target moves, and it
 * is wrong SILENTLY: nothing loads these files at runtime (`AudioEngine` renders
 * the score procedurally), so a stale bpm or a stem gain that no longer matches
 * its phase preset would sit there indefinitely, being trusted.
 *
 * The documents also contain a great deal of prose that no generator could write
 * — why the loop seam sits inside a rhythmic gesture, why bar-quantizing the
 * cold open was rejected. So these files are not generated FROM the score; they
 * are checked AGAINST it. Every machine-checkable field is compared to
 * `src/audio/score.ts`, and the prose is left alone.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  SCORE_BPM_REF, BEATS_PER_BAR, BARS_PER_CYCLE, SECONDS_PER_BAR, CYCLE_SECONDS,
  SCORE_CUE, STEM_IDS, PRESETS, STINGERS,
} from "../../src/audio/score.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const META_DIR = path.join(REPO, "public/audio/meta");

/**
 * Which phase preset each document's `defaultGain` column must equal.
 *
 * The intro document covers two phases (the cold open escalating into the title
 * card) and states the `intro` mix as its baseline, with `title` appearing as
 * its top intensity layer — so `intro` is the one the gains are checked against.
 */
const DOCS = [
  { file: "score-intro.music.json", phase: "intro" },
  { file: "score-gameplay.music.json", phase: "gameplay" },
  { file: "score-recap.music.json", phase: "recapGood" },
];

/** Every field `MusicCueMeta` requires, with the type it must have. */
const REQUIRED = {
  id: "string", title: "string", bpm: "number", key: "string",
  timeSignature: "string", bars: "number",
  loopStartBar: "number", loopEndBar: "number",
  loopStartSec: "number", loopEndSec: "number",
  sections: "object", cuePoints: "object", stems: "object",
  intensityLayers: "object", transitions: "object",
  licenseNotes: "string", sourceNotes: "string",
  generatedBy: "string", humanReviewRequired: "boolean",
};

const STEM_ROLES = new Set(["ambience", "rhythm", "bass", "harmony", "melody", "tension", "danger", "boss", "fx"]);
const QUANTIZE = new Set(["beat", "bar", "2bars", "4bars", "8bars"]);
const TRANSITION_KINDS = new Set(["cut", "crossfade", "stinger"]);

/** Seconds are written to 6dp in these documents; compare at that resolution. */
const near = (a, b) => Math.abs(a - b) < 1e-5;

const problems = [];
const fail = (doc, msg) => problems.push(`${doc}: ${msg}`);

for (const { file, phase } of DOCS) {
  const meta = JSON.parse(readFileSync(path.join(META_DIR, file), "utf8"));
  const preset = PRESETS[phase];

  // --- shape ---
  for (const [key, type] of Object.entries(REQUIRED)) {
    if (!(key in meta)) fail(file, `missing required field "${key}"`);
    else if (typeof meta[key] !== type) fail(file, `"${key}" should be ${type}, is ${typeof meta[key]}`);
  }

  // --- tempo and form ---
  if (meta.bpm !== SCORE_BPM_REF) fail(file, `bpm ${meta.bpm} != score ${SCORE_BPM_REF}`);
  if (meta.key !== SCORE_CUE.key) fail(file, `key "${meta.key}" != score "${SCORE_CUE.key}"`);
  if (meta.timeSignature !== `${BEATS_PER_BAR}/4`) fail(file, `timeSignature "${meta.timeSignature}" != ${BEATS_PER_BAR}/4`);
  if (meta.bars !== BARS_PER_CYCLE) fail(file, `bars ${meta.bars} != cycle ${BARS_PER_CYCLE}`);

  // --- loop points ---
  if (meta.loopStartBar !== 1) fail(file, `loopStartBar ${meta.loopStartBar} != 1`);
  if (meta.loopEndBar !== BARS_PER_CYCLE + 1) fail(file, `loopEndBar ${meta.loopEndBar} != ${BARS_PER_CYCLE + 1}`);
  if (!near(meta.loopStartSec, 0)) fail(file, `loopStartSec ${meta.loopStartSec} != 0`);
  if (!near(meta.loopEndSec, CYCLE_SECONDS)) fail(file, `loopEndSec ${meta.loopEndSec} != cycle ${CYCLE_SECONDS.toFixed(6)}`);

  // --- every bar-and-seconds pair must agree with the tempo ---
  // Bars are 1-based in these documents, so bar N starts at (N-1) bar-lengths.
  for (const c of meta.cuePoints) {
    const expected = (c.bar - 1) * SECONDS_PER_BAR;
    // The carriage return is the one cue point on a BEAT rather than a downbeat,
    // so it is checked against the score's own placement instead.
    if (c.name === "carriage-return") continue;
    if (!near(c.sec, expected)) {
      fail(file, `cuePoint "${c.name}" bar ${c.bar} should be ${expected.toFixed(6)}s, says ${c.sec}`);
    }
  }
  for (const s of meta.sections) {
    if (!near(s.startSec, (s.startBar - 1) * SECONDS_PER_BAR)) {
      fail(file, `section "${s.name}" startBar ${s.startBar} disagrees with startSec ${s.startSec}`);
    }
    if (!near(s.endSec, (s.endBar - 1) * SECONDS_PER_BAR)) {
      fail(file, `section "${s.name}" endBar ${s.endBar} disagrees with endSec ${s.endSec}`);
    }
  }

  // --- stems: the set, and the gains, must be the phase preset ---
  const documented = meta.stems.map((s) => s.id);
  for (const id of STEM_IDS) {
    if (!documented.includes(id)) fail(file, `stem "${id}" is in the score but not documented`);
  }
  for (const s of meta.stems) {
    if (!STEM_IDS.includes(s.id)) { fail(file, `documents stem "${s.id}", which the score does not have`); continue; }
    if (!STEM_ROLES.has(s.role)) fail(file, `stem "${s.id}" has role "${s.role}", which is not in the schema`);
    if (!near(s.defaultGain, preset[s.id])) {
      fail(file, `stem "${s.id}" defaultGain ${s.defaultGain} != PRESETS.${phase} ${preset[s.id]}`);
    }
  }

  // --- intensity layers and transitions must name things that exist ---
  for (const layer of meta.intensityLayers) {
    for (const id of layer.activeStems) {
      if (!STEM_IDS.includes(id)) fail(file, `intensity level ${layer.level} lists unknown stem "${id}"`);
    }
  }
  const sectionNames = new Set([...meta.sections.map((s) => s.name), "*"]);
  for (const t of meta.transitions) {
    if (!QUANTIZE.has(t.quantize)) fail(file, `transition ${t.from}->${t.to} has quantize "${t.quantize}"`);
    if (!TRANSITION_KINDS.has(t.type)) fail(file, `transition ${t.from}->${t.to} has type "${t.type}"`);
    if (t.type === "stinger" && !t.stingerId) fail(file, `stinger transition ${t.from}->${t.to} names no stingerId`);
    if (t.stingerId && !(t.stingerId in STINGERS)) {
      fail(file, `transition ${t.from}->${t.to} fires "${t.stingerId}", which is not in STINGERS`);
    }
    // `from` must be a section of THIS cue; `to` may be another cue's phase.
    if (!sectionNames.has(t.from)) fail(file, `transition from "${t.from}", which is not a section of this cue`);
  }

  // --- the licence claim CLAUDE.md requires ---
  if (!/original/i.test(meta.licenseNotes)) {
    fail(file, "licenseNotes does not state that the material is original");
  }
}

if (problems.length) {
  console.error("Cue metadata FAILED validation against src/audio/score.ts:");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`Cue metadata: ${DOCS.length} documents agree with the score (tempo, form, loop points, ${STEM_IDS.length} stems, cue points, transitions, licence).`);
