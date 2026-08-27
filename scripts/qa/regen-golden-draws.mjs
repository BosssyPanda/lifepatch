// Regenerate `golden-draws.json` — the fossil P9 checks the event draw against.
//
//   node scripts/qa/build-engine.mjs && node scripts/qa/regen-golden-draws.mjs
//
// RUN THIS ONLY WHEN THE DRAW WAS MEANT TO MOVE. The file's whole job is to fail
// when it moves by accident: the weak-spot bias touches `drawEvents`, which every
// replay, every verification and every match stands on. Regenerating it to make a
// red P9 go green would delete the only thing watching that code.
//
// The loop below MUST stay byte-identical to P9's in `engine-props.mjs` — same
// seeds, same modes, same backgrounds, same 30-year cap, same rng consumption
// order — or the file it writes pins nothing.
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { engineDir } from "./build-engine.mjs";

const OUT = engineDir();
const require = createRequire(`${OUT}/`);
const R = (m) => require(`${OUT}/lib/${m}.js`);
const engine = R("runEngine");
const rng = R("rng");
const BG_IDS = R("backgrounds").BACKGROUNDS.map((b) => b.id);

const golden = [];
for (let seed = 1; seed <= 120; seed++) {
  const mode = seed % 2 ? "infinite" : "story";
  let s = engine.initRun(mode, BG_IDS[seed % 3], "G", seed);
  const rand = rng.mulberry32(seed);
  const deals = [];
  let n = 0;
  while (s.status === "playing" && n < 30) {
    deals.push(s.pendingEvents.join(","));
    for (const id of [...s.pendingEvents]) {
      const ev = engine.LIFE_EVENTS.find((e) => e.id === id);
      if (ev) s = engine.applyLifeChoice(s, id, ev.choices[Math.floor(rand() * ev.choices.length)] ?? ev.choices[0]);
    }
    if (rand() < 0.5) s = engine.trade(s, "index", Math.round(rand() * 4000));
    s = engine.advanceYear(s);
    n++;
  }
  golden.push(deals.join("|"));
}

const path = new URL("./golden-draws.json", import.meta.url);
writeFileSync(path, `${JSON.stringify(golden, null, 0)}\n`);
console.log(`wrote ${golden.length} runs → scripts/qa/golden-draws.json`);
