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
  SCORE_CUE, STEM_IDS, PRESETS, STINGERS, INTENSITY_RULES,
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

// ---------------------------------------------------------------------------
// Prose figures
// ---------------------------------------------------------------------------

/**
 * The checks above validate structured fields. They are not enough.
 *
 * Four separate times, a mix value was changed in `score.ts` and in the
 * `defaultGain` column, while the SAME number written out in a sentence two
 * lines below — "menu: lead 0.15, keys forward at 0.45" — was left behind. The
 * script then reported that all documents agreed with the score, because by its
 * own definition of agreement they did. A reader does not make that distinction:
 * prose is the part they actually read, and stale prose beside fresh fields is
 * worse than no prose, because the fresh fields lend it credibility.
 *
 * So wherever these documents state a mix figure in a form a machine can
 * recognise, it is checked. Only recognised forms are checked — this is not an
 * attempt to parse English, and unrecognised prose is still left alone:
 *
 *   `<stem> = <base> + i*<slope>`         a gameplay intensity ramp
 *   `tension = max(0, (i - <t>) * <p>)`   the same, thresholded
 *   `<stem> <a> -> <b>` in a sentence naming `per INTENSITY_RULES.<phase>`
 *   markdown table rows in the cue plan
 */
const num = (t) => Number(String(t).replace(/[`*]/g, "").replace(/[−–]/g, "-").trim());
const eq = (a, b) => Math.abs(a - b) < 5e-3;

/** Check one claimed figure against the score, reporting the sentence it is in. */
function claim(doc, label, claimed, actual) {
  if (!eq(claimed, actual)) fail(doc, `prose says ${label} = ${claimed}, score says ${actual}`);
}

for (const { file } of DOCS) {
  const notes = JSON.parse(readFileSync(path.join(META_DIR, file), "utf8")).sourceNotes ?? "";

  // `bass = 0.37 + i*0.11`
  for (const m of notes.matchAll(/\b(\w+) = (-?[\d.]+) ([+-]) i\*(-?[\d.]+)/g)) {
    const [, stem, base, sign, slope] = m;
    const rule = INTENSITY_RULES.gameplay?.[stem];
    if (!rule) { fail(file, `prose describes an intensity ramp for "${stem}", which has none`); continue; }
    claim(file, `${stem} base`, num(base), rule.base);
    claim(file, `${stem} per-intensity`, (sign === "-" ? -1 : 1) * num(slope), rule.perIntensity);
  }

  // `tension = max(0, (i - 0.45) * 0.99)`
  for (const m of notes.matchAll(/\b(\w+) = max\(0, \(i - ([\d.]+)\) \* ([\d.]+)\)/g)) {
    const [, stem, threshold, slope] = m;
    const rule = INTENSITY_RULES.gameplay?.[stem];
    if (!rule) { fail(file, `prose describes an intensity ramp for "${stem}", which has none`); continue; }
    claim(file, `${stem} threshold`, num(threshold), rule.threshold ?? 0);
    claim(file, `${stem} per-intensity`, num(slope), rule.perIntensity);
  }

  // `snare 0.45 -> 0.75, ticks 0.3 -> 0.52 ... per INTENSITY_RULES.intro`
  for (const sentence of notes.split(/(?<=[.)])\s+/)) {
    const phase = sentence.match(/per INTENSITY_RULES\.(\w+)/)?.[1];
    if (!phase) continue;
    const rules = INTENSITY_RULES[phase];
    if (!rules) { fail(file, `prose cites INTENSITY_RULES.${phase}, which does not exist`); continue; }
    for (const m of sentence.matchAll(/\b(\w+) ([\d.]+) -> ([\d.]+)/g)) {
      const [, stem, from, to] = m;
      const rule = rules[stem];
      if (!rule) { fail(file, `prose ramps "${stem}" in ${phase}, which has no rule there`); continue; }
      claim(file, `${phase}.${stem} at i=0`, num(from), rule.base);
      claim(file, `${phase}.${stem} at i=1`, num(to),
        Math.min(1, rule.base + Math.max(0, 1 - (rule.threshold ?? 0)) * rule.perIntensity));
    }
  }
}

// The cue plan's tables are the same numbers again, in a third place.
const PLAN = path.join(REPO, ".claude/audio/qc/cue-plan.md");
const planLines = readFileSync(PLAN, "utf8").split("\n");
const planName = "cue-plan.md";
for (let i = 0; i < planLines.length; i++) {
  const cells = planLines[i].split("|").map((c) => c.trim());
  const stem = cells[1]?.replace(/`/g, "");
  if (!STEM_IDS.includes(stem)) continue;

  const header = planLines.slice(0, i).reverse().find((l) => l.startsWith("| stem |"));
  if (!header) continue;
  const cols = header.split("|").map((c) => c.replace(/`/g, "").trim());

  if (cols[2] === "intro") {
    // the phase-preset table: one column per phase
    for (let c = 2; c < cols.length - 1; c++) {
      const phase = cols[c];
      if (!(phase in PRESETS)) continue;
      claim(planName, `${phase}.${stem}`, num(cells[c]), PRESETS[phase][stem]);
    }
  } else if (cols[2] === "base") {
    // an intensity table; which phase it is comes from the heading above it
    const heading = planLines.slice(0, i).reverse().find((l) => /^\*\*`\w+`\*\*/.test(l));
    const phase = heading?.match(/^\*\*`(\w+)`\*\*/)?.[1];
    const rule = phase && INTENSITY_RULES[phase]?.[stem];
    if (!rule) { fail(planName, `intensity table row "${stem}" matches no INTENSITY_RULES entry`); continue; }
    claim(planName, `${phase}.${stem} base`, num(cells[2]), rule.base);
    claim(planName, `${phase}.${stem} per-intensity`, num(cells[3].split(" ")[0]), rule.perIntensity);
    if (cells[4] && cells[4] !== "\u2014") claim(planName, `${phase}.${stem} threshold`, num(cells[4]), rule.threshold ?? 0);
  }
}

if (problems.length) {
  console.error("\nMix figures written in prose disagree with src/audio/score.ts:");
  for (const p of problems) console.error(`  \u2717 ${p}`);
  process.exit(1);
}
console.log(`Cue metadata: ${DOCS.length} documents agree with the score (tempo, form, loop points, ${STEM_IDS.length} stems, cue points, transitions, licence).`);
