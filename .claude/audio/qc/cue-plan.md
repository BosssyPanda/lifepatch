# LifePatch — Cinematic Adaptive Score: Cue Plan & Motif

Direction by **game-audio-director**; harmony by **music-composition**; grid by **beat-sync-composer**; layers by **adaptive-music-engine**. All material **original** — no copyrighted melodies/beats. One song, many intensities, so every screen transition is a crossfade of the *same* piece (never a hard cut).

## Global musical identity
- **Style:** tense lo-fi documentary — muted Rhodes/electric-piano, sub-bass pulse, ticking-clock percussion, vinyl-crackle texture. Anxious but cool; matches the SPENT gritty-editorial UI.
- **Key:** **A minor** (Aeolian; brief Dorian color = raise the 6th, F→F♯, for the "warmth"/win layer).
- **Tempo:** **76 BPM**, **4/4**. `secondsPerBeat = 60/76 ≈ 0.789`, `secondsPerBar ≈ 3.158`.
- **Loop:** 8-bar harmonic cycle (~25.3 s) that loops forever.
- **Chord cycle (2 bars each):** `Am(add9) → F maj7 → C maj7 → G6/B`. Roman: i – VI – III – VII. Dark, modern, unresolved — loops without a "final" cadence so it never sounds like it stopped.
- **Leitmotif (Rhodes):** 4 notes — **A4 · C5 · E5 · D5** (1 ♭3 5 4), the recognizable "LifePatch" hook. Stated sparse in menus, fragmented under tension, full + harmonized in the title detonation and a good-ending.
- **Originality note:** intervals/rhythm are generic tonal material; no transcription of any existing work.

## Stems (each its own gain; intensity crossfades them — see AudioEngine.ts)
| id | role | description | base gain |
|---|---|---|---|
| `sub` | bass | sine sub on chord roots, slow pulse | 0.0 (in from intensity ≥ .15) |
| `pad` | harmony | detuned saw/triangle pad playing the chord cycle | 0.0 |
| `rhodes` | melody | FM-ish electric piano stating the leitmotif | 0.0 |
| `tick` | rhythm | filtered-noise clock tick on the beat + soft kick on 1 | 0.0 |
| `crackle` | ambience | quiet vinyl/tape crackle — **always on** once started (the glue) | 0.06 |
| `tension` | tension | dissonant cluster (add ♭9) + slow noise riser; for crashes/bad events | 0.0 |
| `warmth` | harmony | major-6th extension + high shimmer; for wins/good endings | 0.0 |

## Phase presets (target stem mix; engine ramps over the crossfade time)
| preset | sub | pad | rhodes | tick | crackle | tension | warmth | feel |
|---|---|---|---|---|---|---|---|---|
| `intro` (escalating; driven live by cold-open beats) | →0.5 | →0.5 | frag | →0.4 | 0.06 | →0.5 | 0 | build dread → resolve on title |
| `menu` | 0.35 | 0.45 | 0.5 | 0.15 | 0.06 | 0 | 0.1 | calm, inviting, motif breathes |
| `gameplay` (base; ±intensity) | 0.4 | 0.4 | 0.25 | 0.3 | 0.06 | i·0.6 | w·0.5 | steady evolving bed |
| `recapGood` | 0.45 | 0.5 | 0.6 | 0.25 | 0.06 | 0 | 0.6 | warm, vindicated |
| `recapBad` | 0.5 | 0.4 | 0.2 | 0.2 | 0.06 | 0.55 | 0 | cold, defeated |

Crossfade between presets: **0.9–1.5 s** linear gain ramps. Transport keeps running across every phase → seamless.

**Music bed level (Phase-3 tester note):** `musicBus` runs at **0.78** (≈ −2 dB) under master so BGM sits slightly beneath SFX/accents.

## Market mood overlay (Phase 3 — big market events)
`AudioEngine.setMarketMood("calm" | "crash" | "boom")` — a persistent overlay applied *after* phase/intensity in `targetGains()`, so it survives every re-ramp. Ramp **3.2 s ≈ 1 bar** — weather, not a jumpscare. Driven by `YearLoop` from the last resolved year (`bigMarketEvent`: index ≤ −15% → crash, ≥ +30% → boom); clears on the next calm year and on leaving the run.
- **crash:** tension ≥ 0.6, warmth 0, rhodes ×0.45, pad ×0.8, sub +0.12, crackle 0.09, lead 0. Land accent `crash` = slow-attack (1.4 s) A1/A2/A♯2/E3 saw swell through a 520 Hz lowpass at −15 dB + soft A1 membrane at −10 dB. **No transient slam.**
- **boom:** warmth ≥ 0.45, tension 0, rhodes +0.12. Land accent `boom` = C-major(add6) triangle swell + C5–E5–G5–A5 figure.
- Metadata: `public/audio/meta/score-market-crash.music.json`, `score-market-boom.music.json` (registered in `musicManifest.ts`). Full-screen caption ceremony: `components/run/MarketEventBeat.tsx`.

## Adaptive intensity (gameplay) — 0..1
`intensity = clamp( 0.30 + debtPressure + lowHealth + lowMood + macroTension , 0, 1 )`
- `debtPressure` = up to +0.25 as debt rises vs cash.
- `lowHealth`/`lowMood` = up to +0.15 each as health/happiness drop.
- `macroTension` = +0.3 when the current year's `macroEvent.tone` is `bad`/`warning` (crash years).
- High intensity raises `tension`; a `good` outcome/big win briefly raises `warmth` (swell ~2 s then settle).

## Cinematic accents (intro/outro reveals — quantized to the next beat)
`thump` (muted downbeat), `hit` (harder), `stab` (dissonant Rhodes cluster), `riser` (noise sweep to next bar), `title` (full harmonized leitmotif + sub boom + cymbal), recap: `rise`/`ping`/`thud`/`stampGood`/`stampBad`. Each cold-open / recap beat fires one accent as its phrase slams in.

## Never-hard-stop rule
Every stop = gain ramp then teardown (music ≥ 0.8 s, sfx/ambience ≥ 0.3 s). No `osc.stop()`/`Howl.stop()` without a preceding fade. Phase changes crossfade; leaving a screen hands the transport to the next preset.

## Never-die rule (Phase-3 dropout fix)
The context must survive anything the UI throws at it:
- **SFX throttle:** `playSfx` enforces a per-name minimum gap (coins/cash 140 ms, default 40 ms), and PortfolioPanel rate-limits trade ticks to 1 per 150 ms — a slider drag can no longer machine-gun hundreds of voices and starve the render thread.
- **Cheap voices:** the `coins` ping is a 2-partial triangle/sine sparkle (the per-call `MetalSynth` was the engine's heaviest voice and the overload vector).
- **Self-heal:** the engine listens for context `statechange` + runs a 4 s watchdog, and `useAudio` retries `ctx.resume()` on visibility/focus/pointer/key — if the browser ever suspends/interrupts the context (mobile route change, tab switch, overload), audio comes back instead of staying silent.

## SFX — SHIPPED: synthesized in-engine ($0, no auth)
The only connected audio-gen MCP (`generate_audio`) is **text-to-speech only** and refuses standalone SFX/music; the realistic-sample providers (ElevenLabs / Replicate / belt) need paid auth not yet set up. So all SFX + ambience below are **synthesized in `AudioEngine.ts`** (Tone.js) and routed through `sfxBus`/`ambBus` (mute + fades apply). `src/audio/sfxBank.ts` is a ready drop-in to override any of these with real recorded foley once a provider is authorized — no caller changes needed.

### SFX names (synth voices today; file-overridable later → `public/audio/sfx/`)
One-shots: `paper` (card pick), `confirm`, `coins` (buy), `cash` (sell), `stamp` (pay-debt/verdict), `page` (advance year), `chime` (retire), `soft` (quit/close — now a short air swish), `click`, `hover`, `modal` (Almanac — now a two-step paper slide), stings `good/bad/warning/neutral`, `boom` (title), `uitick` (count-up).
Phase-3 tester note: the low-pitched sine beeps (`soft` 320→200 Hz, `modal` 220→520 Hz) read as pointless — both are now **non-tonal noise gestures**, no beeps.
Ambience loops (by event `tag`): Career→`amb_office`, Family→`amb_room`, Housing→`amb_keys`, Health→`amb_hospital`, Debt→`amb_coins`, The Feed→`amb_feed`, Curveball→`amb_unease`, Windfall→`amb_shimmer`, Life→`amb_room`, Leaks→`amb_hiss`.

## QC gate (cinematic-audio-qc) before "done"
Loudness sane (no clipping), loops seamless, **no abrupt stops**, originality OK, every cue has `*.music.json` metadata, mute works, reduced-motion respected.
