#!/usr/bin/env node
/**
 * Create a cue metadata file from CLI args (no audio analysis).
 *
 * Usage:
 *   node scripts/audio/create-music-meta.js \
 *     --id main-theme --bpm 120 --key "A minor" --bars 16 \
 *     --loopStartBar 5 --loopEndBar 13 [--timeSig 4/4] [--title "Main Theme"]
 *
 * Writes public/audio/meta/<id>.music.json with computed timing + empty
 * sections/stems/cuePoints/transitions for you to fill in.
 */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const id = args.id;
const bpm = Number(args.bpm);
const bars = Number(args.bars);

if (!id || !Number.isFinite(bpm) || !Number.isFinite(bars)) {
  console.error("usage: node scripts/audio/create-music-meta.js --id <id> --bpm <n> --key <key> --bars <n> --loopStartBar <n> --loopEndBar <n> [--timeSig 4/4] [--title <t>]");
  process.exit(1);
}

const timeSig = args.timeSig || "4/4";
const beatsPerBar = Number(timeSig.split("/")[0]) || 4;
const secondsPerBeat = 60 / bpm;
const secondsPerBar = secondsPerBeat * beatsPerBar;
const loopStartBar = args.loopStartBar != null ? Number(args.loopStartBar) : 1;
const loopEndBar = args.loopEndBar != null ? Number(args.loopEndBar) : bars + 1;

const round = (n) => Math.round(n * 1e6) / 1e6;

const meta = {
  id,
  title: args.title || id,
  bpm,
  key: args.key || "UNKNOWN",
  timeSignature: timeSig,
  bars,
  beatsPerBar,
  secondsPerBeat: round(secondsPerBeat),
  secondsPerBar: round(secondsPerBar),
  durationSec: round(bars * secondsPerBar),
  loopStartBar,
  loopEndBar,
  loopStartSec: round((loopStartBar - 1) * secondsPerBar),
  loopEndSec: round((loopEndBar - 1) * secondsPerBar),
  sections: [],
  cuePoints: [],
  stems: [],
  intensityLayers: [],
  transitions: [],
  licenseNotes: "Original. No third-party samples or copyrighted material.",
  sourceNotes: "Created via create-music-meta.js.",
  generatedBy: "create-music-meta.js",
  humanReviewRequired: true,
};

const outDir = path.join(__dirname, "..", "..", "public", "audio", "meta");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${id}.music.json`);
fs.writeFileSync(outPath, JSON.stringify(meta, null, 2) + "\n");
console.log(`wrote ${outPath}`);
console.log(`bpm=${bpm} bars=${bars} secPerBeat=${meta.secondsPerBeat} secPerBar=${meta.secondsPerBar} loop=${meta.loopStartSec}s..${meta.loopEndSec}s`);
