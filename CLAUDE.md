# LifePatch — Project Instructions

LifePatch is a Next.js (App Router) + TypeScript browser game ("Survive the Internet Economy"). See `.claude/game-music-stack-audit.md` for the installed game-music production stack and its status.

## Game Music and Adaptive Audio Rules

This project uses a serious game-music workflow.

Use these verified/project music skills when relevant:
- game-audio-director
- beat-sync-composer
- adaptive-music-engine
- cinematic-audio-qc
- music-composition
- code-to-music
- ai-music-generation, only when installed and authenticated

Core rule:
Music must be original, cinematic, beat-locked, and game-functional. Do not copy existing songs, beats, melodies, riffs, drops, or arrangements.

Default workflow for any game music task:

1. Define gameplay purpose.
2. Define emotional target.
3. Define BPM, key, time signature, and bar length.
4. Create a composition plan before generating audio.
5. Prefer MIDI-first composition when exact beat control matters.
6. Create adaptive layers/stems when gameplay state can change.
7. Generate or render draft audio only after the beat map exists.
8. Export metadata JSON for every cue.
9. QC loop points, BPM, loudness, originality, and implementation readiness.
10. Integrate using src/audio systems when this is a frontend game.

Every music cue should include:
- cue id
- BPM
- key
- time signature
- bar count
- loop start/end
- sections
- cue points
- stems
- intensity layers
- transition rules
- license/source notes

Use Tone.js for beat-synced browser music and scheduling.
Use howler.js for simpler SFX, ambience, and UI sounds.
Use @tonejs/midi for MIDI-based workflows.
Use ffmpeg/librosa/pretty_midi/music21 for analysis and tooling.
Use Ableton only if Ableton MCP is verified and Ableton Live is installed.
Use ElevenLabs only for approved SFX, ambience, narration, or audio generation.
Use Replicate only after authentication and only with source/QC notes.

Do not call music finished unless:
- it is original
- it loops cleanly
- it has metadata
- it lands on exact beats/bars
- it has implementation notes
- it passed cinematic-audio-qc
