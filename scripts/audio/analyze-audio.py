#!/usr/bin/env python3
"""
Analyze an audio file and write starter cue metadata.

Usage:
    .venv-audio/bin/python scripts/audio/analyze-audio.py <audio-file> [--out <dir>]

Estimates tempo, duration, sample rate, and beat times, then writes a
<id>.music.json next to the audio (or into public/audio/meta by default).

Fails gracefully if audio dependencies are not installed.
"""
import argparse
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_META_DIR = os.path.join(REPO, "public", "audio", "meta")


def main() -> int:
    ap = argparse.ArgumentParser(description="Analyze audio -> starter cue metadata")
    ap.add_argument("audio", help="path to an audio file (wav/ogg/mp3/flac...)")
    ap.add_argument("--out", default=DEFAULT_META_DIR, help="output dir for *.music.json")
    args = ap.parse_args()

    if not os.path.isfile(args.audio):
        print(f"error: file not found: {args.audio}", file=sys.stderr)
        return 1

    try:
        import librosa
        import numpy as np
    except Exception as e:  # graceful: deps missing
        print(f"error: audio deps missing ({type(e).__name__}: {e}).", file=sys.stderr)
        print("install: .venv-audio/bin/pip install librosa numpy", file=sys.stderr)
        return 1

    try:
        y, sr = librosa.load(args.audio, sr=None, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        bpm = round(float(np.atleast_1d(tempo)[0]), 2)
        beat_times = [round(float(t), 4) for t in librosa.frames_to_time(beat_frames, sr=sr)]
    except Exception as e:
        print(f"error: analysis failed ({type(e).__name__}: {e})", file=sys.stderr)
        return 1

    cue_id = os.path.splitext(os.path.basename(args.audio))[0]
    beats_per_bar = 4
    seconds_per_beat = round(60.0 / bpm, 6) if bpm else None
    seconds_per_bar = round(seconds_per_beat * beats_per_bar, 6) if seconds_per_beat else None

    print(f"file:        {args.audio}")
    print(f"sampleRate:  {sr} Hz")
    print(f"duration:    {duration:.3f} s")
    print(f"tempo (BPM): {bpm}")
    print(f"beats found: {len(beat_times)} (first 8: {beat_times[:8]})")

    meta = {
        "id": cue_id,
        "title": cue_id,
        "bpm": bpm,
        "key": "UNKNOWN",
        "timeSignature": "4/4",
        "sampleRate": int(sr),
        "durationSec": round(duration, 4),
        "bars": round(duration / seconds_per_bar, 2) if seconds_per_bar else None,
        "beatsPerBar": beats_per_bar,
        "secondsPerBeat": seconds_per_beat,
        "secondsPerBar": seconds_per_bar,
        "loopStartBar": None,
        "loopEndBar": None,
        "loopStartSec": None,
        "loopEndSec": None,
        "beatTimesSec": beat_times,
        "sections": [],
        "cuePoints": [],
        "stems": [],
        "intensityLayers": [],
        "transitions": [],
        "licenseNotes": "TODO: confirm original / no copyrighted material.",
        "sourceNotes": f"Auto-analyzed from {os.path.basename(args.audio)} via analyze-audio.py (librosa).",
        "generatedBy": "analyze-audio.py",
        "humanReviewRequired": True,
    }

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, f"{cue_id}.music.json")
    with open(out_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"wrote:       {out_path}")
    print("note: BPM/beats are estimates — verify loop points and key by hand.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
