# LifePatch — "The Debtor's March": Cue Plan & Motif

Direction by **game-audio-director**; harmony by **music-composition**; grid by **beat-sync-composer**; layers by **adaptive-music-engine**; sign-off by **cinematic-audio-qc**. All material **original** — no copyrighted melodies/beats. One song, many intensities, so every screen transition is a crossfade of the *same* piece (never a hard cut).

> **Where the music actually lives:** `src/audio/score.ts` is the single source of musical truth — every pitch, figure, velocity, preset and stinger is plain data there. `src/audio/AudioEngine.ts` (browser) and the offline preview renderer (Node) both build their graph from it, so a preview WAV cannot drift from the game. **This document is the brief; `score.ts` is the score.** If they ever disagree, `score.ts` is right and this file is stale.

## Cue card (the per-cue metadata CLAUDE.md mandates)

| field | value |
|---|---|
| cue id | `score.debtors-march` (documented as `score-intro` / `score-gameplay` / `score-recap` in `public/audio/meta/`) |
| BPM | **108** |
| key | **D minor** (natural minor; raised 7th C♯ at every cadence) |
| time signature | **4/4** |
| bar count | **16** (8 harmonic segments × 2 bars) |
| loop start / end | **0.000000 s → 35.555556 s** (bar 1 beat 1 → bar 17 beat 1) |
| sections | bars 1–8 "the state" (menace) · bars 9–16 "the debtor" (defiance) |
| cue points | segment boundary every 2 bars; 4-bar stamp on bars 1/5/9/13; half-cadence bar 15; carriage return bar 16 beat 4 (= 35.000 s) |
| stems | 9 — see the table below |
| intensity layers | see **Adaptive intensity**; encoded in `INTENSITY_RULES` |
| transition rules | phase changes are gain crossfades only; the Transport never stops, so every transition is bar-agnostic and seamless |
| license / source | 100% original, composed for this project. No existing song, beat, riff, drop or arrangement referenced or transcribed. Papers, Please and Undertale were **mood and instrumentation references only**. Rendered live from synthesis — no third-party samples anywhere. |

## Global musical identity

- **Style:** a defiant, satirical **minor-key march** — "ledger orchestra": synth-brass, a compressed upright piano, tight march percussion, and typewriter/rubber-stamp ticks where a marching band would have a snare rim. Papers-Please-adjacent bureaucratic menace with a catchy, singable hook.
- **Whose music is it:** **the march is the PLAYER's** (defiance). The economy gets the `tension` layer, and only that. This is the rule that keeps the score from becoming generic dread: when things get worse, the march does not get sadder — the grinding gets louder underneath it.
- **Key:** **D minor**, with two signature colours:
  - the **V-major cadence A → C♯** — the "defiant grin", the brand note. Every C♯ in the tune is a raised leading tone: it is why this reads as a march with somewhere to go rather than a modal drone sitting on D.
  - **D major / F♯** brightening, **reserved for wins** (`stampGood`, the `good` reveal sting, the recapGood colour). The picardy third is the only way this score says "you did it".
- **Tempo:** **108 BPM**, **4/4**. `beat = 555.556 ms`, `8th = 277.778 ms`, `bar = 2222.222 ms`.
  **Why 108:** `44100 × 60 / 108 = 24,500` samples per beat **exactly** — so bar = 98,000 and the 16-bar loop = 1,568,000, all integers. Offline renders trim to bit-exact loop points with no fractional-sample fudge, which is the difference between a seam you cannot hear and a seam that clicks once every 35 seconds forever. (Verified empirically in the preview renderer, which asserts it before trusting a loop point.)
- **Loop:** a **16-bar cycle, 35.5556 s**, that loops forever.
- **Chord cycle (2 bars each):** `Dm → B♭maj7 → Gm → **A (major)** → Dm → F → C → A7`.
  Roman: **i – ♭VImaj7 – iv – V – i – III – ♭VII – V7**. Roots (sub): `D1 B♭1 G1 A1 D1 F1 C2 A1`.
  Bars 1–8 are the state closing in: tonic, the flat-VI major seventh that makes the room feel wide and indifferent, the subdominant minor, then a **major** dominant — that A is the sound of someone grinning at a bailiff. Bars 9–16 are the debtor answering, through the only genuinely bright bars in the cycle (F → C), and ending **unresolved on A7**. The cycle does not cadence home; the *loop restart* is the resolution. That is what makes 35 seconds of repetition feel like a march instead of a treadmill.
- **Leitmotif / hook (the `lead`):** the stamp-cell **"D4 D4 F4 — A4"** ("da-da-DAH — DAH"), two pickup 8ths into a held note on beat 2 answered on beat 3. It recurs in bars 1, 3, 5, 9 and 13 — the ear learns one gesture and then follows where it is transplanted, which is what makes the tune singable back after one listen. It peaks on **C♯5 over the A-major chord** (bar 8, the grin). Bars 5–6 are the rubber-stamp figure **G4-G4-G4** = "DENIED-DENIED-DENIED". Range **D4–E5** — teen-singable, no leaps a person cannot pitch.
- **The seam is glued by rhythm:** bar 16 sits on A4, rests, then restates `A4 A4` on its last two 8ths as an **anacrusis straight into bar 1's `D4 D4`**. The loop point is therefore *inside* a rhythmic gesture, not between two of them.
- **Countermelody (`counter`):** one long tone per segment — `A4 F4 G4 E4 F4 A4 G4 C♯5`. Every tone is a chord tone or colour of its segment, and the cycle **always ends on C♯5**: whatever else is in the mix, the last thing said before the loop turns over is the leading tone.
- **Originality note:** intervals, rhythms and voicings are generic tonal material composed for this engine. No transcription of any existing work.

## Stems (each its own gain; the phase mix crossfades them — see `PRESETS` in `score.ts`)

Every stem is always **playing**; the phase decides which are audible. A phase change is a set of gain ramps, never a re-scheduling — that is what makes the transitions seamless.

| id | role | description | voice |
|---|---|---|---|
| `bass` | bass | sine sub on the segment roots + the march "oom": root on beat 1, fifth on beat 3 | sine sub (−8 dB) + triangle/saw blend (−14 dB), kept inside A1–D3 so it reads as footsteps, not an arpeggio |
| `brass` | harmony | the chord voicings — the march ensemble | `fatsawtooth ×3, spread 24` through a **filter envelope** sweeping 380 → 1600 Hz in 50 ms and falling back over 350 ms. That "bwah" swell is the entire difference between *ledger orchestra* and *ambient wash* |
| `keys` | harmony | compressed upright piano stamping per-segment comping figures — the stamp cell an octave down, so the piano is the tune's shadow rather than a competing idea | FM, harmonicity 3.01, modIndex 10, near-zero sustain (hammer then decay) |
| `snare` | rhythm | tight march rimshot; 4-bar velocity pattern, accents on beats 1 & 3, ghosts on the "a" of 1 / "&" of 2 / "&" of 4, and a **16th ruff into every 4th bar** | white-noise transient + 220 Hz triangle body, both high-passed at 400 Hz |
| `ticks` | rhythm | typewriter clacks on **offbeat 8ths** (in a march the "pah" answers the "oom"; here the "pah" is office machinery — the joke the whole score is built on) + a low stamp-thock on each 4-bar downbeat + one **carriage-return zip + ding** on bar 16 beat 4 | 12 ms noise click, highpass 4800 Hz; thock = D2 membrane; ding = triangle (`CARRIAGE_RETURN`) |
| `lead` | melody | the anthem voice carrying the hook. Only fully open in `title` and `recapGood` | dual detuned oscillators (pulse 0.35 + square at +7 cents) → light drive 0.12 → tempo-synced `8n` delay. The beating between two slightly-apart waves is what makes it read as something *blown* rather than a bell-pluck |
| `tension` | tension | **the economy's music, not the player's.** Two saws a minor 2nd apart, **D2 + E♭2** — the ♭2 of D minor, the most institutionally unpleasant interval available | LFO'd lowpass (700 Hz, 0.07 Hz rate) so it breathes instead of sitting still. Retuned from the old A2/A♯2 pair so it now grinds *against* the tonic |
| `air` | ambience | band-passed pink noise — **always on at 0.06** (the glue; successor to the vinyl crackle). It is why silence in this game sounds like a room rather than a dropped audio context | pink noise → bandpass 1200 Hz, Q 0.6, −20 dB |
| `counter` | melody | the countermelody long tones under a slow tremolo — warmth for the wins (successor to `warmth`; `swellWarmth()` keeps its public name and now targets this stem) | triangle → Tremolo 0.18 Hz, depth 0.45 |

## Phase presets (target stem mix; engine ramps over the crossfade time)

| stem | `intro` | `title` | `menu` | `gameplay` | `recapGood` | `recapBad` |
|---|---|---|---|---|---|---|
| `bass` | 0.50 | 0.50 | 0.35 | 0.36 | 0.45 | 0.50 |
| `brass` | 0.45 | 0.55 | 0.30 | 0.25 | 0.50 | 0.35 |
| `keys` | 0.15 | 0.30 | 0.45 | 0.42 | 0.50 | 0.20 |
| `snare` | 0.45 | 0.50 | 0.12 | 0.12 | 0.35 | 0.30 |
| `ticks` | 0.30 | 0.30 | 0.12 | 0.10 | 0.20 | 0.10 |
| `lead` | **0** | **0.70** | 0.15 | **0** | 0.55 | **0** |
| `tension` | 0.50 | 0 | 0 | 0 | 0 | 0.55 |
| `air` | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 |
| `counter` | 0 | 0.25 | 0.15 | 0 | 0.50 | 0 |
| **feel** | machinery + dread; the theme has not been *earned* yet | the anthem, unambiguously heroic | the anthem heard from the filing room next door | focused; the room closes in as finances worsen | hopeful — the tune returns and the counter's C♯ closes it | dramatic — the march is still there, the player is just not leading it |

Crossfade between presets: **0.9–1.5 s** linear gain ramps. Transport keeps running across every phase → seamless.
`brainGlow` (Money-Brain understanding) warms `counter` +0.22 and `brass` +0.08 in `menu`/`title`/`recapGood` only.

## Adaptive intensity — 0..1

`intensity = clamp( 0.30 + debtPressure + lowHealth + lowMood + macroTension , 0, 1 )` — **unchanged from the previous score**; only what it *does* to the mix changed.

- `debtPressure` = up to +0.25 as debt rises vs cash.
- `lowHealth` / `lowMood` = up to +0.15 each as health/happiness drop.
- `macroTension` = +0.3 when the current year's `macroEvent.tone` is `bad`/`warning` (crash years).

Evaluated by `rampGain()` in `score.ts` as `clamp01(base + max(0, i − threshold) × perIntensity)`. `base` **must** equal the phase's preset row or the mix would jump the instant anything called `setIntensity`.

**`gameplay`** — the adaptive core:

| stem | base | per intensity | threshold |
|---|---|---|---|
| `bass` | 0.36 | +0.18 | — |
| `keys` | 0.42 | **−0.15** (the comp gets out of the way) | — |
| `snare` | 0.12 | +0.30 | — |
| `ticks` | 0.10 | +0.25 | — |
| `tension` | 0 | +1.1 | **0.45** |

Nothing new is introduced at high intensity — it is the same material leaning on the player harder, which is why it never feels like the game changed soundtrack mid-thought. The tension threshold is what stops the grind being a permanent low-level whine.

**`intro`** — intensity now applies here too, so the cold open genuinely escalates. (It previously did not: `setIntensity` returned early unless the phase was `gameplay`, which made `ColdOpen`'s per-beat escalation inaudible.)

| stem | base | per intensity |
|---|---|---|
| `snare` | 0.45 | +0.30 |
| `ticks` | 0.30 | +0.22 |
| `tension` | 0.50 | +0.30 |

Phases absent from `INTENSITY_RULES` ignore intensity entirely and use their preset row.

## Cinematic accents (intro/outro reveals — quantized to the next 8th)

**Hard rule: no accent voice may still be sounding one bar (2.222 s) after it fires, release included** — `STINGER_MAX_SOUNDING_SEC`. Every accent timbre is inside `STINGER_ENVELOPE_CAP`: `attack ≤ 0.01, decay ≤ 0.35, sustain ≤ 0.05, release ≤ 0.5`. A voice inside those numbers is *physically incapable* of the failure this replaces.

> **What this replaces.** The previous `title` / `stampGood` / `stampBad` accents were PolySynth chord stacks held for a **full measure (3.16 s)** at −6 dB, fired over a beating detuned-saw drone in the cold open and the outro. That was the single most disliked sound in the game — the thing players called "loud beeping". It was not a wrong parameter; it was sustained pitched material with nowhere to go, overlapping itself. **Plucks cannot do that.** An accent may be loud, low, harsh, or all three — it may not *hang*.

| accent | material | ~length |
|---|---|---|
| `title` | **the anthem stamp**: `A4 → C♯5 → D5` as three crisp 8ths at 180 ms (brass-pluck, doubled one octave down) + D2 membrane boom + 4-hit snare ruff. Literally the tune's own cadence — the grin resolving | 1.1 s |
| `stampGood` | **"APPROVED"**: staccato D-major pluck `D4 / F♯4 / A4 / D5` + D2 membrane. The F♯ picardy wink is the win colour | 0.9 s |
| `stampBad` | **the red stamp**: saw-pluck cluster `D4 / E♭4 / A3` (the tension layer's own m2, struck once) + D1 membrane + short noise slap | 0.85 s |
| `consequence` | impact → descent → settle, retained in shape but retuned and shortened: D2 membrane + paper transient, descent arp `A4 G4 F4 D4` (the tune's own bar-10 figure), settle pluck `D3/A3/D4` at **`2n`** — *not* the `1m` hold it used to be | 1.85 s |
| `thump` / `hit` / `thud` / `stab` | retuned to D minor: D1 / G1 / A0 membranes; `stab` is a saw cluster on the ♭2 grind `D3/E♭3/A3` | 0.6–0.8 s |
| `mastered` / `levelup` / `streak` | arps `D4-F4-A4-D5` / `F4-A4-D5-F5` / `A3-D4-F4` | 0.8–1.0 s |
| `riser` / `rise` | unchanged — filtered-noise sweeps with no pitch material, already sub-bar | — |

Accents are requested `ACCENT_PREROLL_MS` (120 ms — comfortably under one 8th at 277.78 ms) before the visual instant they must coincide with, so `AudioEngine.accent()`'s own 8th-note quantization resolves them *onto* that instant instead of the 8th after it.

## Never-hard-stop rule

Every stop = gain ramp then teardown (**music ≥ 0.8 s, sfx/ambience ≥ 0.3 s**). No `osc.stop()` / `Howl.stop()` without a preceding fade. Phase changes crossfade; leaving a screen hands the transport to the next preset. The engine is gesture-gated (silent until a user gesture) and mute/volume are persisted (`lp_muted`); mute only ramps the master gain, so the Transport — and therefore the visual beat grid — keeps running for muted players.

## SFX — SHIPPED: synthesized in-engine ($0, no auth)

The only connected audio-gen MCP (`generate_audio`) is **text-to-speech only** and refuses standalone SFX/music; the realistic-sample providers (ElevenLabs / Replicate / belt) need paid auth not yet set up. So all SFX + ambience below are **synthesized in `AudioEngine.ts`** (Tone.js) and routed through `sfxBus`/`ambBus` (mute + fades apply). `src/audio/sfxBank.ts` is a ready drop-in to override any of these with real recorded foley once a provider is authorized — no caller changes needed.

**The UI SFX are byte-identical to the previous score.** `click`, `hover`, `uitick`, `paper`, `confirm`, `coins`, `cash`, `stamp`, `page`, `chime`, `soft`, `modal`, `rankUp`, `dice`, `diceLand` were never the problem and were not touched.

**Reveal stings** (`playSting`) keep their shapes, durations, envelopes and levels to the digit — players have already learned what they mean — and only their **pitches** moved into D minor:

| sting | was | now |
|---|---|---|
| `good` | C-major triad | **D major** `D5 / F♯5 / A5` (587.33 / 739.99 / 880 Hz) — the same picardy F♯ as `stampGood` |
| `bad` | A3 / D♯4 over A1 | **D3 / E♭4** over a D1 thock |
| `warning` | — | **A4 / B♭4** — the 5th of the key rubbing against its ♭6 |
| `neutral` | 440 Hz | **unchanged** — 440 Hz is A4, the dominant of D minor, so it was already in key |

**Ambience beds** lightly retuned into the new key, de-fanged, and thinned so density stays constant at the faster tempo: `amb_unease` drone A1/A♯1 → **D2/E♭2**; `amb_shimmer` E5 → **A5**; the ambience beeps retuned and dropped ~4 dB with reduced fire probability — `amb_hospital` 880 → **587.33 Hz (D5)**, `amb_coins` 2000 → **1760 Hz (A6)**, `amb_feed` 1320 → **1174.66 Hz (D6)**.

Ambience loops by event `tag`: Career→`amb_office`, Family→`amb_room`, Housing→`amb_keys`, Health→`amb_hospital`, Debt→`amb_coins`, The Feed→`amb_feed`, Curveball→`amb_unease`, Windfall→`amb_shimmer`, Life→`amb_room`, Leaks→`amb_hiss`.

## QC gate (cinematic-audio-qc) before "done"

1. **Originality** — no transcribed melody/beat/riff/arrangement; references were mood-only.
2. **Loop** — seam is continuous across `0 → 35.555556 s`; no step discontinuity, no click. The bar-16 anacrusis must be audible as a pickup into bar 1, not as a restart.
3. **Beat lock** — 24,500 samples/beat asserted; downbeat onsets within ±10 ms; every visual ceremony derives from `src/audio/tempo.ts`, never from a hand-written ms ladder.
4. **Loudness** — peak ≤ −1 dBFS, DC < 0.01, non-silent; no clipping when a stinger stacks on the bed plus a sting plus ambience.
5. **No accent hangs** — every `STINGERS` entry's `soundingSec` ≤ `STINGER_MAX_SOUNDING_SEC` (2.222 s) and every timbre inside `STINGER_ENVELOPE_CAP`. This is the regression test for the "beeping".
6. **No abrupt stops** — music ≥ 0.8 s fade, sfx/ambience ≥ 0.3 s.
7. **Metadata** — every cue has its `public/audio/meta/*.music.json` and it validates against `MusicCueMeta` in `src/audio/audioTypes.ts`.
8. **Implementation readiness** — mute works, gesture gate works, reduced-motion respected, and the mix is checked on a phone speaker (where the sub is simply gone and the march bass has to carry it).
