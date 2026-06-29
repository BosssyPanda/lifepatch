# Game Audio Workspace

Working area for the LifePatch game-music production stack.

## Layout
- `prompts/` — text prompts / design briefs for AI generation drafts (high-level mood/instrumentation only — never "copy X song" or "in the style of [living artist]").
- `references/` — reference notes used only as high-level design language (tempo range, instrumentation, density, mood). No copyrighted audio.
- `qc/` — QC reports from `cinematic-audio-qc` (pass/revise/reject + fixes).
- `exports/` — rendered/exported draft audio + their metadata.

## Workflow (see CLAUDE.md → "Game Music and Adaptive Audio Rules")
1. Define gameplay purpose + emotion.
2. Define BPM / key / time signature / bar length.
3. Composition plan first (MIDI-first when exact beats matter).
4. Adaptive layers/stems if gameplay state changes.
5. Draft audio only after a beat map exists.
6. Export `*.music.json` metadata per cue (see `public/audio/meta/example-track.music.json`).
7. QC loop points, BPM, loudness, originality, implementation readiness.
8. Integrate via `src/audio/` (Tone.js transport, howler for SFX, @tonejs/midi).

## Originality
Original, cinematic, beat-locked, game-functional. Never copy existing songs/beats/melodies/riffs/drops/arrangements. References are design language only.
