#!/usr/bin/env python3
"""
Measure how loud each stem actually is at an identical fader position, and say
what each voice's `volume` should be so that they match.

    node scripts/audio/render-previews.mjs --solo title --solo-gain 0.35 --out DIR
    python3 scripts/audio/calibrate-stems.py DIR

WHY THIS EXISTS.

`PRESETS` in src/audio/score.ts is a table of fader positions per phase, and the
whole dramaturgy of the score is written in it: in `gameplay` the piano is
forward at 0.42 while the sub sits under it at 0.36; in `title` the tune opens
to 0.7 and leads everything. That table is only meaningful if 0.42 means roughly
the same amount of sound for the piano as it does for the sub. It did not.
Measured at identical gain, the stems spanned more than 20 dB, so the presets
were describing a mix the engine was not playing: gameplay's "piano forward"
came out as a sub-bass rumble with a piano somewhere behind it.

WHAT IS MEASURED.

K-weighted RMS over a whole 16-bar cycle, in LUFS-like units.

- K-weighting is the ITU-R BS.1770 perceptual curve: it rolls off the very low
  end and lifts the presence region, which is why a 37 Hz sine and a snare of
  the same electrical level are not equally loud to a person.
- Over a whole cycle, UNGATED. This is the important departure from standard
  integrated loudness, which gates quiet passages out. Gating is right when you
  are measuring a finished master; it is wrong here, because a stem's rests are
  part of its contribution. A snare that plays four hits per bar and a pad that
  drones continuously should not be called equally loud merely because their hits
  are. Density counts, so the rests must be counted too.

The target is simple: at the same fader, every stem should measure the same. Then
`PRESETS` is an honest mix.
"""
import sys
import os
import wave
import math

import numpy as np
from scipy import signal

SR = 44100
D = sys.argv[1] if len(sys.argv) > 1 else ".preview-audio/calib"

# The stems, in the order score.ts declares them, with the voice whose `volume`
# field sets each one's level.
VOICE_OF = {
    "bass": "subBass + marchBass",
    "brass": "brass",
    "keys": "keys",
    "snare": "snare.noise + snare.body",
    "ticks": "tick + stampThock + carriageDing",
    "lead": "lead",
    "tension": "tension.a + tension.b",
    "air": "air",
    "counter": "counter",
}


def read(path):
    with wave.open(path, "rb") as w:
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    return (raw[0::2] + raw[1::2]) / 2


def k_weight(x, sr=SR):
    """
    ITU-R BS.1770-4 K-weighting: a high-shelf ("head" filter) then a high-pass
    (RLB). Coefficients are the standard ones for 48 kHz, re-derived here for the
    actual sample rate so they are correct at 44.1 kHz rather than close.
    """
    # Stage 1: high shelf, +4 dB above ~1.5 kHz.
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh = 10 ** (G / 20.0)
    Vb = Vh ** 0.4996667741545416
    a0 = 1.0 + K / Q + K * K
    b = np.array([(Vh + Vb * K / Q + K * K) / a0,
                  2.0 * (K * K - Vh) / a0,
                  (Vh - Vb * K / Q + K * K) / a0])
    a = np.array([1.0,
                  2.0 * (K * K - 1.0) / a0,
                  (1.0 - K / Q + K * K) / a0])
    y = signal.lfilter(b, a, x)

    # Stage 2: high-pass at ~38 Hz (RLB).
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / sr)
    b2 = np.array([1.0, -2.0, 1.0])
    a2 = np.array([1.0,
                   2.0 * (K * K - 1.0) / (1.0 + K / Q + K * K),
                   (1.0 - K / Q + K * K) / (1.0 + K / Q + K * K)])
    return signal.lfilter(b2, a2, y)


def cycle_loudness(x):
    """
    Ungated K-weighted loudness over the whole file.

    This is how much a stem CONTRIBUTES to the bed — level and density together.
    It is the right number for judging whether a layer is pulling the mix around,
    and the wrong number for setting a voice's level, which is why both are
    reported.
    """
    k = k_weight(x)
    ms = float(np.mean(k ** 2))
    return -0.691 + 10 * math.log10(ms) if ms > 0 else -np.inf


def playing_loudness(x, win_sec=float(os.environ.get("WIN_SEC", "0.02")), pct=98):
    """
    K-weighted loudness of the stem WHILE IT IS PLAYING: the 95th percentile of
    short-window loudness.

    This is the number to calibrate voices against, and the distinction matters.
    The piano plays 8th-note figures with rests between them and the sub holds a
    note for two bars straight; averaged across a cycle the piano looks far
    quieter, but that is density, not level. Equalising the AVERAGE would make
    every sparse part shout to make up for its own rests — which is not a mix,
    it is a compressor. Equalising the level WHEN PLAYING leaves density where
    the composer put it and puts every voice on the same scale.

    A high percentile rather than the peak, because a peak is one sample of one
    transient and says nothing about how loud a part sounds.

    The window is SHORT (20 ms) on purpose. A longer one silently penalises brief
    sounds by their own duty cycle: a 12 ms typewriter clack measured in a 100 ms
    window reads about 9 dB below its real level simply because the window is
    mostly silence, while a sustained sub-bass in the same window reads at full
    level. Calibrating on that would have shoved the percussion up by roughly the
    amount the measurement was wrong by. 20 ms is short enough to sit inside the
    shortest transient in the score and long enough to be stable on sustained
    material.
    """
    k = k_weight(x)
    w = int(win_sec * SR)
    n = len(k) // w
    if n == 0:
        return -np.inf
    ms = np.mean(k[: n * w].reshape(n, w) ** 2, axis=1)
    ms = ms[ms > 0]
    if ms.size == 0:
        return -np.inf
    return -0.691 + 10 * math.log10(float(np.percentile(ms, pct)))


# Target level when playing. Chosen so the corrected voice `volume` values all
# land in a safe range (roughly -30 to 0 dB) rather than needing positive gain on
# a polyphonic synth, which would clip a stem before its fader ever ran.
TARGET = float(os.environ.get("TARGET_PLAYING", "-26.0"))

rows = []
for fn in sorted(os.listdir(D)):
    if not fn.endswith(".wav"):
        continue
    stem = fn.replace(".wav", "").split("-", 2)[-1]
    x = read(os.path.join(D, fn))
    if np.max(np.abs(x)) < 1e-7:
        rows.append((stem, None, None, None))
        continue
    rows.append((stem, playing_loudness(x), cycle_loudness(x),
                 20 * math.log10(float(np.max(np.abs(x))))))

live = [r for r in rows if r[1] is not None and np.isfinite(r[1])]
if not live:
    print("No non-silent stems found — did the solo render run?")
    sys.exit(1)

print(f"Per-stem loudness at an identical fader position   (dir: {D})")
print(f"Target when playing = {TARGET:.1f} LUFS\n")
print(f"  {'stem':<10}{'playing':>10}{'cycle':>10}{'peak':>9}{'density':>10}"
      f"   change needed on `volume`")
print("  " + "-" * 82)
for stem, play, cyc, pk in rows:
    if play is None or not np.isfinite(play):
        print(f"  {stem:<10}{'silent':>10}")
        continue
    delta = TARGET - play
    flag = "" if abs(delta) < 1.0 else ("   <<<" if abs(delta) > 6 else "")
    print(f"  {stem:<10}{play:>10.1f}{cyc:>10.1f}{pk:>9.1f}{cyc - play:>+10.1f}"
          f"   {delta:+6.1f} dB on {VOICE_OF.get(stem, stem)}{flag}")

vals = [r[1] for r in live]
print(f"\n  spread when playing: {max(vals) - min(vals):.1f} dB")
print("  (Under ~4 dB means PRESETS' fader positions mean what they say.)")
print("  'density' is cycle minus playing: how much of the time a part rests.")
print("   It is reported, not corrected — that is the arrangement, not the mix.")
