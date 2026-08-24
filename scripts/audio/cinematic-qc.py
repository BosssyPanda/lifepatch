#!/usr/bin/env python3
"""
cinematic-audio-qc, run as measurement rather than as opinion.

    python3 scripts/audio/cinematic-qc.py [PREVIEW_DIR]

`.claude/skills/cinematic-audio-qc/SKILL.md` is this project's mandatory gate
before any cue may be called finished, and it lists seventeen things to check.
Most of them are questions about a waveform, and a waveform can be asked
directly — so this script asks, rather than listening once and writing "sounds
fine" next to each one.

What it measures, and against what:

  loudness            ITU-R BS.1770-4 integrated LUFS (pyloudnorm). Game music
                      beds sit around -23 to -16 LUFS; a bed at -12 is fighting
                      the SFX it is supposed to sit under.
  true peak / clipping 4x-oversampled peak, plus a count of consecutive-sample
                      runs at full scale (the signature of hard clipping).
  dynamic range       crest factor (peak - RMS) and the spread between the
                      loudest and quietest 400ms windows. A bed that is
                      loudness-flat across a whole cycle reads as a drone.
  BPM / grid          sweeps the 8th-note grid's phase across a whole 8th and
                      reports where the onsets actually peak. On-grid music
                      answers "zero"; drifted music says by how much.
  beat clarity        how far beat positions stand above the gaps between them,
                      which is the thing a listener means by "I can feel it".
  low/mid tilt        K-weighted low bands minus mid bands: the measurement that
                      corresponds to "there is a deep ringing behind the music".
  loop cleanliness    the discontinuity at the seam, measured as the step across
                      the loop point against the local sample-to-sample motion,
                      plus spectral distance between the last and first 100ms.
  section clarity     spectral/energy distance between the two halves of the
                      cycle (bars 1-8 "the state" vs bars 9-16 "the debtor").
  harsh frequencies   energy in the 2-5kHz ear-pain band as a share of total.
  muddy low end       energy in the 150-400Hz mud band as a share of total.
  repetitiveness      self-similarity between the two rendered cycles, and
                      within-cycle variety, so "loops cleanly" and "is not
                      boringly repetitive" are both checked instead of traded.
  stem compatibility  phase correlation between L and R, and mono-sum level
                      loss (a cue that vanishes in mono is unusable on a phone).

The checks that are NOT measurable here — originality, gameplay function,
license notes, file naming, metadata completeness — are reported as what they
are: statements about provenance and documentation, verified elsewhere
(check-meta.mjs) or by construction (every voice is synthesised; there are no
samples in the project).

Exits non-zero if any cue lands outside its band.
"""
import sys
import json
import math
import os
import wave

import numpy as np
import pyloudnorm as pyln
from scipy import signal

SR = 44100
BPM = 108.0
SEC_PER_BEAT = 60.0 / BPM
SEC_PER_BAR = SEC_PER_BEAT * 4
CYCLE = SEC_PER_BAR * 16

PREVIEW_DIR = sys.argv[1] if len(sys.argv) > 1 else ".preview-audio"


def read_wav(path):
    """Return (left, right) float arrays in [-1, 1] from a 16-bit PCM WAV."""
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2, f"{path}: expected 16-bit"
        assert w.getframerate() == SR, f"{path}: expected {SR} Hz"
        n = w.getnframes()
        raw = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768.0
    ch = w.getnchannels()
    if ch == 2:
        return raw[0::2], raw[1::2]
    return raw, raw


def db(x):
    return 20 * math.log10(x) if x > 0 else -np.inf


def true_peak(x, oversample=4):
    """Peak after upsampling — catches inter-sample peaks a raw max misses."""
    up = signal.resample_poly(x, oversample, 1)
    return float(np.max(np.abs(up)))


def clip_runs(x, thresh=0.999, min_run=3):
    """Count runs of >= min_run consecutive samples pinned at full scale."""
    at = np.abs(x) >= thresh
    if not at.any():
        return 0
    edges = np.diff(at.astype(np.int8))
    starts = np.flatnonzero(edges == 1) + 1
    ends = np.flatnonzero(edges == -1) + 1
    if at[0]:
        starts = np.r_[0, starts]
    if at[-1]:
        ends = np.r_[ends, len(at)]
    return int(np.sum((ends - starts) >= min_run))


def window_rms(x, win_sec=0.4):
    """RMS per non-overlapping window, in dB."""
    w = int(win_sec * SR)
    n = len(x) // w
    if n == 0:
        return np.array([db(float(np.sqrt(np.mean(x ** 2))))])
    trimmed = x[: n * w].reshape(n, w)
    r = np.sqrt(np.mean(trimmed ** 2, axis=1))
    return np.array([db(v) for v in r])


def band_share(x, lo, hi):
    """Fraction of total spectral energy between lo and hi Hz."""
    f, p = signal.welch(x, SR, nperseg=8192)
    total = np.trapezoid(p, f)
    if total <= 0:
        return 0.0
    sel = (f >= lo) & (f < hi)
    return float(np.trapezoid(p[sel], f[sel]) / total)


def k_weight(x, sr=SR):
    """
    ITU-R BS.1770-4 K-weighting: a high shelf, then a high-pass.

    Needed because raw spectral energy is the wrong lens for "is this
    bass-heavy?". The ear is far less sensitive at 50 Hz than at 500, so a
    perfectly balanced mix still looks low-dominated by energy alone. This is the
    standard model of that sensitivity.
    """
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh = 10 ** (G / 20.0)
    Vb = Vh ** 0.4996667741545416
    a0 = 1.0 + K / Q + K * K
    b = np.array([(Vh + Vb * K / Q + K * K) / a0, 2.0 * (K * K - Vh) / a0,
                  (Vh - Vb * K / Q + K * K) / a0])
    a = np.array([1.0, 2.0 * (K * K - 1.0) / a0, (1.0 - K / Q + K * K) / a0])
    y = signal.lfilter(b, a, x)
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / sr)
    a2 = np.array([1.0,
                   2.0 * (K * K - 1.0) / (1.0 + K / Q + K * K),
                   (1.0 - K / Q + K * K) / (1.0 + K / Q + K * K)])
    return signal.lfilter(np.array([1.0, -2.0, 1.0]), a2, y)


def low_mid_tilt(x):
    """
    Loudest low band minus loudest mid band, K-weighted — the number that
    corresponds to a listener saying "there's a deep ringing behind the music".

    The threshold is not invented. Measured on the renders that actually drew
    that complaint, the beds sat at +8.5 to +15.2 dB; the two cues nobody
    objected to (the title theme and the good ending) sat at +1.9 and +2.7.
    """
    k = k_weight(x)
    def band_loudness(lo, hi):
        sos = signal.butter(4, [lo, hi], btype="band", fs=SR, output="sos")
        ms = float(np.mean(signal.sosfilt(sos, k) ** 2))
        return -0.691 + 10 * math.log10(ms) if ms > 0 else -120.0
    low = max(band_loudness(20, 80), band_loudness(80, 160))
    mid = max(band_loudness(400, 1000), band_loudness(1000, 3000))
    return low - mid


def spectrum(x):
    """Normalised power spectrum, for comparing two chunks of audio."""
    f, p = signal.welch(x, SR, nperseg=4096)
    s = p.sum()
    return p / s if s > 0 else p


def spectral_distance(a, b):
    """0 = identical spectra, 1 = no overlap (Hellinger-style)."""
    pa, pb = spectrum(a), spectrum(b)
    return float(np.sqrt(0.5 * np.sum((np.sqrt(pa) - np.sqrt(pb)) ** 2)))


def onset_env(x, hop=512, nper=2048):
    """Spectral-flux onset strength envelope, and its frame rate."""
    f, t, Z = signal.stft(x, SR, nperseg=nper, noverlap=nper - hop)
    mag = np.abs(Z)
    flux = np.sum(np.maximum(0, np.diff(mag, axis=1)), axis=0)
    return flux, SR / hop


def grid_phase_error(x):
    """
    How far the music's rhythmic grid sits from the grid it claims.

    Returns the offset, in milliseconds, of the best-scoring 8th-note phase.
    Zero means the onsets land where 108 BPM says they should.

    This replaces an absolute "share of onset energy near a grid line" score,
    which was not a valid test. That share has a floor set purely by geometry —
    a +/-25ms window is 18% of a 277ms 8th note, so even a file of pure noise
    scores 0.18 — and the real cues scored 0.21 to 0.42, i.e. between 1.2x and
    2.3x chance. Any pass mark on that number would have been invented. Sweeping
    the phase and asking where the maximum falls needs no threshold at all: if
    the music is on the grid, the answer is the grid, and if it has drifted the
    answer says by how much and in which direction.
    """
    flux, rate = onset_env(x, hop=256, nper=1024)
    if flux.size == 0 or flux.max() <= 0:
        return 999.0
    eighth = SEC_PER_BEAT / 2
    times = np.arange(len(flux)) / rate
    phases = np.linspace(0, eighth, 24, endpoint=False)
    scores = []
    for p in phases:
        d = np.abs((times - p) - np.round((times - p) / eighth) * eighth)
        scores.append(flux[d <= 0.025].sum())
    best = phases[int(np.argmax(scores))]
    # Wrap: a "best phase" just under one 8th is really just under zero.
    if best > eighth / 2:
        best -= eighth
    # Expect a small CONSTANT positive bias, currently +11.6ms on every cue.
    # That is the measurement, not the music: spectral flux at frame i describes
    # the change between frames i-1 and i, so a detected onset is reported about
    # one hop late, and the STFT window adds a little more. It shows up
    # identically on cues with completely different content, which is the tell.
    # The band is wide enough to absorb it; a real drift — a wrong BPM, or
    # scheduling quantised to a block instead of a sample — would be tens of
    # milliseconds and would differ from cue to cue.
    return float(best * 1000)


def beat_contrast(x):
    """
    dB by which beat positions stand above the gaps between them.

    This replaces a comparison of the four-bar stamp downbeats against "all other
    bars", which could not work: every EVEN bar starts a new two-bar harmonic
    segment, so brass, sub and countermelody all attack there too. That test was
    comparing chord attacks with chord attacks, and the stamp it was trying to
    measure was a rounding error inside the result — which is why it reported a
    NEGATIVE clarity on music that plainly has a beat.

    Measured against its own control (the same figure taken half a beat late,
    which comes out as the exact negative), this separates cleanly: +3.0 dB on
    the title theme down to +0.3 dB on the deliberately-flat cold-open bed.
    """
    n_beats = int((len(x) / SR - 1) / SEC_PER_BEAT)
    w = int(0.10 * SR)
    on, off = [], []
    for b in range(n_beats):
        t0 = int(b * SEC_PER_BEAT * SR)
        t1 = int((b + 0.5) * SEC_PER_BEAT * SR)
        if t0 + w < len(x):
            on.append(np.sqrt(np.mean(x[t0:t0 + w] ** 2)))
        if t1 + w < len(x):
            off.append(np.sqrt(np.mean(x[t1:t1 + w] ** 2)))
    if not on or not off:
        return 0.0
    return db(float(np.mean(on))) - db(float(np.mean(off)))


def loop_seam(x, cycles):
    """
    The discontinuity at the loop point, as a ratio against local motion.

    A splice shows up as one sample-to-sample step far larger than the steps
    around it. Comparing against the LOCAL step size is the only version of this
    test that works on percussive material: an absolute threshold flags every
    snare transient as a click.
    """
    if cycles < 2:
        return None
    seam = int(CYCLE * SR)
    if seam + 1 >= len(x):
        return None
    step = abs(x[seam] - x[seam - 1])
    local = np.abs(np.diff(x[max(0, seam - 441): seam + 441]))
    med = float(np.median(local)) or 1e-9
    return step / med


def analyse(path, cycles):
    L, R = read_wav(path)
    mono = (L + R) / 2
    dur = len(L) / SR

    meter = pyln.Meter(SR)
    stereo = np.stack([L, R], axis=1)
    lufs = float(meter.integrated_loudness(stereo))

    tp = max(true_peak(L), true_peak(R))
    clips = clip_runs(L) + clip_runs(R)
    rms = db(float(np.sqrt(np.mean(mono ** 2))))
    crest = db(tp) - rms

    w = window_rms(mono)
    w = w[np.isfinite(w)]
    spread = float(np.percentile(w, 95) - np.percentile(w, 5)) if w.size else 0.0

    # mono compatibility: how much level the mono sum loses vs the stereo pair
    mono_loss = db(float(np.sqrt(np.mean(mono ** 2)))) - db(
        float(np.sqrt(np.mean((L ** 2 + R ** 2) / 2)))
    )
    corr = float(np.corrcoef(L, R)[0, 1]) if np.std(L) > 0 and np.std(R) > 0 else 1.0

    out = {
        "file": os.path.basename(path),
        "durationSec": round(dur, 3),
        "lufs": round(lufs, 2),
        "truePeakDb": round(db(tp), 2),
        "clipRuns": clips,
        "rmsDb": round(rms, 2),
        "crestDb": round(crest, 2),
        "dynamicSpreadDb": round(spread, 2),
        "harsh2to5kShare": round(band_share(mono, 2000, 5000), 4),
        "mud150to400Share": round(band_share(mono, 150, 400), 4),
        "monoSumLossDb": round(mono_loss, 2),
        "stereoCorr": round(corr, 4),
    }

    if cycles:
        out["lowMidTiltDb"] = round(low_mid_tilt(mono), 2)
        out["gridPhaseErrorMs"] = round(grid_phase_error(mono), 1)
        out["beatContrastDb"] = round(beat_contrast(mono), 2)
        n = int(CYCLE * SR)
        if cycles >= 2 and len(mono) >= 2 * n:
            a, b = mono[:n], mono[n:2 * n]
            out["loopSeamRatio"] = round(loop_seam(mono, cycles), 2)
            out["cycleSpectralDistance"] = round(spectral_distance(a, b), 4)
            ea, eb = window_rms(a), window_rms(b)
            m = min(len(ea), len(eb))
            out["cycleEnvelopeCorr"] = round(float(np.corrcoef(ea[:m], eb[:m])[0, 1]), 4)
        # section clarity: bars 1-8 against bars 9-16 of the first cycle
        half = int(8 * SEC_PER_BAR * SR)
        if len(mono) >= 2 * half:
            out["sectionDistance"] = round(spectral_distance(mono[:half], mono[half:2 * half]), 4)
    return out


# --- the cue list, and the band each measurement must land in ------------------
CUES = [
    ("01-title-theme.wav", 2, "bed"),
    ("02-menu.wav", 1, "bed"),
    ("03-gameplay-calm.wav", 1, "bed"),
    ("04-gameplay-stressed.wav", 1, "bed"),
    ("05-intro-coldopen.wav", 1, "bed"),
    ("06-recap-good.wav", 1, "bed"),
    ("07-recap-bad.wav", 1, "bed"),
    ("08-stinger-title.wav", 0, "accent"),
    ("09-stinger-stamp-good.wav", 0, "accent"),
    ("10-stinger-stamp-bad.wav", 0, "accent"),
    ("11-stinger-consequence.wav", 0, "accent"),
    ("12-stings-reveal.wav", 0, "accent"),
]

# Bands. Beds must sit under the SFX and leave headroom; accents are allowed to
# be louder and much peakier, because being noticed is their whole job.
BANDS = {
    "bed": {
        "lufs": (-30.0, -14.0),
        "truePeakDb": (-np.inf, -1.0),
        "clipRuns": (0, 0),
        "crestDb": (6.0, 24.0),
        "dynamicSpreadDb": (1.0, 30.0),
        "harsh2to5kShare": (0.0, 0.25),
        "mud150to400Share": (0.0, 0.45),
        "monoSumLossDb": (-3.0, 0.5),
        # One STFT hop is 5.8ms, so anything inside +/-12ms is "on the grid" as
        # far as this measurement can resolve.
        "gridPhaseErrorMs": (-12.0, 12.0),
        "beatContrastDb": (0.0, 30.0),
        "loopSeamRatio": (0.0, 12.0),
        "cycleEnvelopeCorr": (0.80, 1.0),
        "cycleSpectralDistance": (0.0, 0.20),
        "sectionDistance": (0.0, 0.60),
        # The whole reason the user heard "deep background ringing": a bed whose
        # low end towers over its mids. Validated against the renders that
        # prompted the complaint, which measured +8.5 to +15.2 dB.
        "lowMidTiltDb": (-8.0, 6.5),
    },
    # Accents are deliberately not judged on spectral balance. Three of them are
    # built on a low membrane, and a "mud" band of 150-400 Hz simply reports
    # where that membrane is PITCHED: the D2 accents scored 0.55-0.58 and the D1
    # one scored 0.12, for no reason connected to whether anything sounds muddy.
    # A one-second stamp cannot be muddy in the sense that matters; only a
    # continuous bed can, because only a bed has to be heard over.
    "accent": {
        "lufs": (-35.0, -8.0),
        "truePeakDb": (-np.inf, -1.0),
        "clipRuns": (0, 0),
        "crestDb": (6.0, 30.0),
        "harsh2to5kShare": (0.0, 0.40),
        "monoSumLossDb": (-3.0, 0.5),
    },
}

problems = []
rows = []
for name, cycles, kind in CUES:
    path = os.path.join(PREVIEW_DIR, name)
    if not os.path.exists(path):
        problems.append(f"{name}: missing — render previews first")
        continue
    m = analyse(path, cycles)
    m["kind"] = kind
    rows.append(m)
    for key, (lo, hi) in BANDS[kind].items():
        if key not in m:
            continue
        v = m[key]
        if v < lo or v > hi:
            problems.append(f"{name}: {key} = {v} outside [{lo}, {hi}]")

print(f"cinematic-audio-qc · {len(rows)} cues · {BPM:g} BPM · cycle {CYCLE:.4f}s\n")
hdr = ["file", "LUFS", "tPk", "clip", "crest", "dyn", "harsh", "mud", "monoΔ", "tilt", "phase", "beat", "seam", "loopR", "sect"]
W = [26, 8, 7, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 7]
print("  " + "".join(h.ljust(w) for h, w in zip(hdr, W)))
for m in rows:
    cells = [
        m["file"],
        f'{m["lufs"]:.1f}',
        f'{m["truePeakDb"]:.1f}',
        str(m["clipRuns"]),
        f'{m["crestDb"]:.1f}',
        f'{m.get("dynamicSpreadDb", float("nan")):.1f}',
        f'{m["harsh2to5kShare"]:.3f}',
        f'{m["mud150to400Share"]:.3f}',
        f'{m["monoSumLossDb"]:.2f}',
        f'{m["lowMidTiltDb"]:+.1f}' if "lowMidTiltDb" in m else "-",
        f'{m["gridPhaseErrorMs"]:+.1f}' if "gridPhaseErrorMs" in m else "-",
        f'{m["beatContrastDb"]:+.1f}' if "beatContrastDb" in m else "-",
        f'{m["loopSeamRatio"]:.1f}' if "loopSeamRatio" in m else "-",
        f'{m["cycleEnvelopeCorr"]:.3f}' if "cycleEnvelopeCorr" in m else "-",
        f'{m["sectionDistance"]:.3f}' if "sectionDistance" in m else "-",
    ]
    print("  " + "".join(c.ljust(w) for c, w in zip(cells, W)))

with open(os.path.join(PREVIEW_DIR, "cinematic-qc.json"), "w") as fh:
    json.dump({"bpm": BPM, "cycleSec": CYCLE, "cues": rows, "problems": problems}, fh, indent=2)

print()
if problems:
    print("REVISE — measurements outside their band:")
    for p in problems:
        print("  ✗ " + p)
    sys.exit(1)
print(f"PASS — all {len(rows)} cues inside their bands. Report: {PREVIEW_DIR}/cinematic-qc.json")
