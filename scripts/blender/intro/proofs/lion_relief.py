"""Height map for the Lydian lion trite's obverse, drawn from primitives (no reference image in the
container): a lion's head facing right, jaws open, the radiate knob on the brow, a scalloped mane.
Writes a 16-bit PNG height map; 0 = field, 1 = highest relief. Pure numpy + Pillow."""
import math
import sys

import numpy as np
from PIL import Image

N = int(sys.argv[2]) if len(sys.argv) > 2 else 768
ys, xs = np.mgrid[1:-1:N * 1j, -1:1:N * 1j]


def seg_d(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((xs - ax) * dx + (ys - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(xs - ax - dx * t, ys - ay - dy * t)


def dome(d, r, h, p=0.5):
    return h * np.clip(1 - (d / r) ** 2, 0, 1) ** p


def ell(cx, cy, rx, ry, ang=0.0):
    c, s = math.cos(ang), math.sin(ang)
    u = ((xs - cx) * c + (ys - cy) * s) / rx
    v = (-(xs - cx) * s + (ys - cy) * c) / ry
    return np.hypot(u, v)


def smax(a, b, k=0.06):
    hh = np.clip(0.5 + 0.5 * (a - b) / k, 0, 1)
    return a * hh + b * (1 - hh) + k * hh * (1 - hh)


H = np.zeros((N, N))
feats = []
# cranium and cheek
feats.append(dome(ell(-0.12, 0.12, 0.52, 0.46), 1.0, 0.50))
feats.append(dome(ell(0.12, -0.02, 0.32, 0.26), 1.0, 0.55))
# upper jaw and nose
feats.append(dome(seg_d(0.08, 0.16, 0.70, 0.10), 0.16, 0.62))
feats.append(dome(np.hypot(xs - 0.72, ys - 0.19), 0.10, 0.70))
# lower jaw, dropped open
feats.append(dome(seg_d(0.02, -0.24, 0.60, -0.36), 0.10, 0.46))
# brow ridge over the eye
feats.append(dome(seg_d(0.14, 0.36, 0.42, 0.31), 0.05, 0.70))
# eye
feats.append(dome(np.hypot(xs - 0.30, ys - 0.25), 0.065, 0.78))
# the radiate knob on the forehead, with rays
feats.append(dome(np.hypot(xs - 0.06, ys - 0.50), 0.085, 0.85))
for k in range(9):
    a = math.radians(-20 + k * 25)
    feats.append(dome(seg_d(0.06 + 0.10 * math.cos(a), 0.50 + 0.10 * math.sin(a),
                            0.06 + 0.19 * math.cos(a), 0.50 + 0.19 * math.sin(a)), 0.022, 0.62))
# ear
feats.append(dome(ell(-0.26, 0.52, 0.10, 0.14, 0.4), 1.0, 0.58))
# mane: three rows of tufts curling round the back of the head and under the jaw
rng = np.random.default_rng(3)
for row, (R, n, h) in enumerate(((0.62, 13, 0.52), (0.76, 15, 0.46), (0.90, 17, 0.40))):
    for i in range(n):
        a = math.radians(95 + i * (170 / (n - 1)))           # from the top round the back to under the jaw
        cx, cy = -0.10 + R * math.cos(a), 0.05 + R * 0.92 * math.sin(a)
        feats.append(dome(ell(cx, cy, 0.075, 0.045, a + math.pi / 2 + 0.5), 1.0, h + rng.uniform(-0.04, 0.04)))
for f in feats:
    H = smax(H, f, 0.05)

# open mouth: cut down between the jaws, then teeth along both edges
mouth = (ys < 0.06 - 0.12 * (xs - 0.1)) & (ys > -0.22 - 0.22 * (xs - 0.1)) & (xs > 0.12)
H = np.where(mouth, np.minimum(H, 0.12), H)
teeth = np.zeros_like(H)
for x in np.linspace(0.30, 0.66, 5):
    y_top = 0.06 - 0.12 * (x - 0.1)
    teeth = np.maximum(teeth, dome(seg_d(x, y_top + 0.01, x + 0.01, y_top - 0.07), 0.022, 0.5))
    y_bot = -0.22 - 0.22 * (x - 0.1)
    teeth = np.maximum(teeth, dome(seg_d(x - 0.02, y_bot - 0.01, x - 0.01, y_bot + 0.06), 0.02, 0.42))
H = np.maximum(H, np.where(mouth, teeth, 0))
# a struck, worn surface: small dents and a soft edge
H += 0.02 * rng.standard_normal(H.shape)
k = np.ones(9) / 9
H = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, H)
H = np.apply_along_axis(lambda c: np.convolve(c, k, mode="same"), 0, H)
H = np.clip(H / H.max(), 0, 1)
Image.fromarray((H * 65535).astype(np.uint16)).save(sys.argv[1])
print("wrote", sys.argv[1], H.shape)
