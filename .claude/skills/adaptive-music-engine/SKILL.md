---
name: adaptive-music-engine
description: Use when implementing interactive or adaptive game music in code, including layers, stems, stingers, transitions, intensity, and beat-synced gameplay events.
---

# Adaptive Music Engine Skill

Use this skill for game runtime audio implementation.

## Goal

Build music systems that react to gameplay while staying musically synchronized.

## Runtime Concepts

The engine should support:

- load cue
- play cue
- stop cue
- pause/resume
- crossfade
- stem volume control
- intensity control
- stinger playback
- next-bar transition
- next-section transition
- beat callbacks
- bar callbacks
- loop region
- reduced audio mode
- mute/music volume settings

## Tool Routing

For browser games:
- Use Tone.js for beat-synced music, transport, scheduling, and musical timing.
- Use howler.js for simpler SFX, ambience, UI sounds, and reliable audio playback.
- Use @tonejs/midi when MIDI import/export or MIDI-based playback is needed.

Do not add more audio libraries unless clearly necessary.

## File Pattern

Prefer:

src/audio/
  AudioProvider.tsx
  MusicDirector.ts
  AdaptiveMusicEngine.ts
  BeatClock.ts
  musicManifest.ts
  audioTypes.ts
  useMusic.ts
  useSfx.ts

public/audio/
  music/
  stems/
  sfx/
  ambience/
  meta/

## Implementation Rules

- Keep music data separate from code.
- Store cue metadata in JSON.
- Support volume sliders.
- Respect user mute.
- Handle browser autoplay restrictions.
- Do not start audio until user gesture if browser requires it.
- Avoid memory leaks by unloading unused sounds.
- Use bar-quantized transitions for gameplay state changes.

## Completion Standard

A music system is complete only if:
- it can load at least one cue
- it can play/stop
- it can change intensity
- it can trigger a stinger
- it can transition on a bar boundary
- it has metadata
- it has a simple usage example
