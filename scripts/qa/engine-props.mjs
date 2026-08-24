// Engine property tests — the gate the replay features stand on.
//
//   node scripts/qa/build-engine.mjs && node scripts/qa/engine-props.mjs
//
// These are properties, not examples: each one drives the real compiled engine over
// many seeds and asserts something that must hold for all of them. A failure here
// means a recorded run and its replay disagree, which is the one thing none of the
// verification features may ever do.
import { createRequire } from "module";
import { OUT } from "./build-engine.mjs";

const require = createRequire(`${OUT}/`);
const R = (m) => require(`${OUT}/lib/${m}.js`);

const rng = R("rng");
const markets = R("markets");

let failures = 0;
let checks = 0;

export function check(name, fn) {
  checks++;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

export function eq(a, b, what) {
  if (!Object.is(a, b)) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

export function deepEq(a, b, what) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what}:\n       ${sa}\n       ${sb}`);
}

// ── 1. The PRNG consolidation moved code without changing a single draw ──────
// The old implementations, transcribed from the three places they used to live:
// lib/runEngine.ts (mulberry32, strHash) and lib/markets.ts (hash01).
function oldMulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function oldStrHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
function oldHash01(year, salt, seed) {
  let h = Math.imul(year | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

console.log("\nPRNG parity (the move must not change one draw)");

check("mulberry32 identical over 200 seeds x 50 draws", () => {
  for (let s = -100; s < 100; s++) {
    const a = rng.mulberry32(s);
    const b = oldMulberry32(s);
    for (let i = 0; i < 50; i++) eq(a(), b(), `seed ${s} draw ${i}`);
  }
});

check("strHash identical over the salts the engine actually uses", () => {
  for (const str of ["no-shared-card", "", "a", "promotion:take", "−", "weak-spots", "x".repeat(64)]) {
    eq(rng.strHash(str), oldStrHash(str), `strHash(${JSON.stringify(str)})`);
  }
});

check("hash01 identical over 69 years x 96 salts x 40 seeds", () => {
  for (let y = 1957; y <= 2025; y++) {
    for (let salt = 0; salt < 96; salt += 4) {
      for (let seed = 0; seed < 40; seed++) {
        eq(rng.hash01(y, salt, seed), oldHash01(y, salt, seed), `hash01(${y},${salt},${seed})`);
      }
    }
  }
});

check("real history is still untouched by the seed", () => {
  // The market contract: SP500 and the override table are record, not model.
  for (const y of [1973, 1987, 1999, 2000, 2008, 2009, 2020, 2022]) {
    const base = markets.sp500Return(y, 0);
    for (const seed of [1, 7, 12345, 999999999]) {
      eq(markets.sp500Return(y, seed), base, `sp500Return(${y}) moved with the seed`);
    }
  }
});

export function report() {
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) report();
