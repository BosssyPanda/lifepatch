---
name: beat-sync-composer
description: Use when composing or implementing beat-locked music, exact BPM timing, bar grids, loop points, stems, transitions, stingers, or game-event synchronization.
---

# Beat Sync Composer Skill

You are responsible for exact musical timing.

Use this skill when:
- the user asks for exact beats
- music must sync with gameplay
- loops must be seamless
- transitions must land on downbeats
- generated music needs BPM/key/bar metadata
- the game needs a beat map

## Required Metadata

Every music asset must have:

- id
- bpm
- key
- timeSignature
- sampleRate
- durationSec
- bars
- beatsPerBar
- secondsPerBeat
- secondsPerBar
- loopStartBar
- loopEndBar
- loopStartSec
- loopEndSec
- cuePoints
- sections
- stems
- transitionRules

## Timing Formula

secondsPerBeat = 60 / BPM
secondsPerBar = secondsPerBeat * beatsPerBar

Cue points should be quantized to:
- beat
- bar
- 2 bars
- 4 bars
- 8 bars
- 16 bars

## Composition Rules

Prefer bar-safe forms:

- 4-bar intro
- 8-bar loop
- 16-bar loop
- 32-bar loop
- 1-bar stinger
- 2-bar stinger
- 4-bar transition

Avoid weird loop lengths unless the gameplay requires them.

## Integration Rules

When implementing in code:
- never rely on random setTimeout timing for musical sync
- use an audio transport or Web Audio scheduling
- schedule transitions ahead of time
- only change intensity at safe musical boundaries
- track current bar, beat, and section
- expose events like onBeat, onBar, onSection, onLoop

## QC

For every generated/exported cue:
- calculate BPM and duration
- calculate exact loop start/end seconds
- verify bars are whole numbers or explain why not
- verify stingers land on the next bar or next downbeat
- create JSON metadata next to the audio file
