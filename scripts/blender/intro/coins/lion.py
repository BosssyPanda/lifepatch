"""The lion on the trite's obverse, sculpted in code as a height map.

What the die shows (checked against several photographs of real Lydian lion-head trites; none is traced,
the shapes below are drawn here): a lion's head facing right, the jaws wide open in a round roar with a fang
down from the upper jaw and one up from the lower; a short, bulbous muzzle; a heavy brow over the eye; a
round ear at the back of the skull; a knob with short rays on the brow; the mane as rows of wavy locks on
the neck behind and below the cheek.

Lesson from the failed first try (proofs/lion_relief.py): separate primitives laid side by side, with long
parallel jaws and a comb of teeth, read as a cartoon crocodile. Here the head is one inflated mass and the
features are swellings and hollows in it, the muzzle short and round, the mouth a round hollow.

Coordinates: u to the right, v up, both 0..1 across the die square; the head faces +u. Heights are 0 at the
field and 1 at the highest point (coin.Coin scales them by relief_h). Writes a 16-bit grey PNG and, with
--preview, a raking-light shaded view for checking against photos.

  python coins/lion.py --out lion.png [--res 768] [--preview lion_shaded.png]
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


N = int(arg("--res", "768"))
V, U = np.mgrid[1:0:N * 1j, 0:1:N * 1j]          # row 0 is the top of the die (v = 1)


# ------------------------------------------------------------------------------------------- tools

def spline(pts, closed=True, n=24):
    """Catmull-Rom curve through control points (u, v)."""
    p = np.asarray(pts, float)
    if closed:
        p = np.vstack([p[-1], p, p[0], p[1]])
    else:
        p = np.vstack([p[0], p, p[-1]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(p[-2])
    return np.array(out)


def mask(curve):
    im = Image.new("L", (N, N), 0)
    ImageDraw.Draw(im).polygon([(u * (N - 1), (1 - v) * (N - 1)) for u, v in curve], fill=255)
    return np.asarray(im) > 127


def inflate(m, radius, power=0.5):
    """A pillow over a mask: 0 at its edge, 1 once `radius` (die units) inside, rounded like clay."""
    d = ndimage.distance_transform_edt(m) / N
    t = np.clip(d / radius, 0, 1)
    return (1 - (1 - t) ** 2) ** power


def blob(cu, cv, ru, rv=None, ang=0.0, power=1.6):
    rv = rv or ru
    c, s = math.cos(ang), math.sin(ang)
    x = ((U - cu) * c + (V - cv) * s) / ru
    y = (-(U - cu) * s + (V - cv) * c) / rv
    return np.clip(1 - (x * x + y * y), 0, 1) ** power


def stroke(pts, r0, r1=None, n=10, power=1.2):
    """A raised lock: a tube along a smooth curve, its radius running r0 -> r1. power 0.5 is a round
    section with a hard edge; above 1 it melts into the surface like modelled clay."""
    r1 = r0 if r1 is None else r1
    c = spline(pts, closed=False, n=n)
    radii = np.linspace(r0, r1, len(c))
    out = np.zeros((N, N))
    lo = np.clip(((c.min(0) - max(r0, r1)) * (N - 1)).astype(int) - 2, 0, N - 1)
    hi = np.clip(((c.max(0) + max(r0, r1)) * (N - 1)).astype(int) + 3, 0, N)
    cs = slice(lo[0], hi[0])
    rs = slice(N - 1 - min(hi[1], N - 1), N - lo[1])
    uu, vv = U[rs, cs], V[rs, cs]
    best = np.full(uu.shape, np.inf)
    rad = np.zeros(uu.shape)
    for (a, b, ra, rb) in zip(c[:-1], c[1:], radii[:-1], radii[1:]):
        d = b - a
        L2 = max(d @ d, 1e-12)
        t = np.clip(((uu - a[0]) * d[0] + (vv - a[1]) * d[1]) / L2, 0, 1)
        dist = np.hypot(uu - a[0] - d[0] * t, vv - a[1] - d[1] * t)
        r = ra + (rb - ra) * t
        k = dist / r < best
        best = np.where(k, dist / r, best)
        rad = np.where(k, r, rad)
    out[rs, cs] = np.clip(1 - best * best, 0, 1) ** power
    return out


def smax(a, b, k=0.05):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0, 1)
    return a * h + b * (1 - h) + k * h * (1 - h)


def smin(a, b, k=0.05):
    return -smax(-a, -b, k)


# ------------------------------------------------------------------------------------------- the head

def offset_curve(curve, dist):
    """The polyline moved sideways by `dist` (positive = to the right of its direction of travel)."""
    c = np.asarray(curve)
    t = np.gradient(c, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    return c + dist * np.stack([t[:, 1], -t[:, 0]], 1)


def resample(curve, step):
    c = np.asarray(curve)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]
    s = np.arange(0, seg[-1], step)
    return np.stack([np.interp(s, seg, c[:, 0]), np.interp(s, seg, c[:, 1])], 1)


def build():
    """Swellings are added to the head and hollows pressed into it (no constant levels: a level lifts
    the whole field)."""
    # the head in profile, facing right: skull, brow, a short heavy muzzle, the jaws, the mane to the back
    # and under the throat
    head = mask(spline([(0.30, 0.90), (0.50, 0.94), (0.66, 0.91), (0.80, 0.83), (0.92, 0.76), (0.96, 0.66),
                        (0.94, 0.56), (0.95, 0.48), (0.90, 0.43), (0.93, 0.33), (0.92, 0.25), (0.84, 0.19),
                        (0.72, 0.15), (0.58, 0.10), (0.42, 0.05), (0.22, 0.08), (0.08, 0.25), (0.05, 0.50),
                        (0.11, 0.72), (0.20, 0.86)]))
    # the face: everything in front of the line where the mane starts (behind the ear, down the cheek)
    face_c = spline([(0.40, 0.95), (0.70, 0.98), (1.0, 0.85), (1.0, 0.14), (0.67, 0.11), (0.52, 0.30),
                     (0.42, 0.48), (0.39, 0.66), (0.40, 0.84)])
    face = mask(face_c) & head
    mane = head & ~face

    H = 0.34 * inflate(head, 0.16, 0.9)
    H += 0.26 * inflate(face, 0.16, 0.7)
    H += 0.16 * blob(0.57, 0.48, 0.17, 0.17, power=1.3)                   # the round of the cheek

    # muzzle: a heavy round nose, and the swell of the upper lip under it
    H += 0.40 * blob(0.85, 0.67, 0.12, 0.10, 0.2, power=1.2)
    H += 0.22 * blob(0.86, 0.52, 0.10, 0.08, 0.3)
    H += 0.10 * stroke([(0.86, 0.69), (0.88, 0.60), (0.86, 0.52)], 0.06, 0.05, power=2.0)
    # brow: one heavy ridge over the eye that runs forward into the top of the nose
    H += 0.08 * stroke([(0.50, 0.70), (0.60, 0.75), (0.70, 0.765), (0.82, 0.75)], 0.06, 0.07, power=2.5)
    # wrinkles across the top of the muzzle
    for k in range(3):
        H += 0.06 * stroke([(0.75 + 0.035 * k, 0.81), (0.765 + 0.035 * k, 0.76), (0.76 + 0.035 * k, 0.71)], 0.013, 0.009)

    # the roar: the jaws stand open; a hollow from the corner of the mouth out to the edge of the head
    # (round, like an O, not a slot: a slot read as a box)
    mouth = mask(spline([(1.02, 0.45), (0.86, 0.465), (0.74, 0.44), (0.655, 0.37), (0.67, 0.29), (0.76, 0.245),
                         (0.88, 0.26), (1.02, 0.29)]))
    H *= 1 - 0.85 * inflate(mouth, 0.08, 1.2)
    # lower jaw: a thick lobe under the hollow, its tip turned up at the front
    H += 0.18 * stroke([(0.60, 0.21), (0.72, 0.19), (0.84, 0.21), (0.91, 0.26)], 0.055, 0.045) * (1 - mouth)
    # fangs: down from the upper lip, up from the lower jaw
    H = np.maximum(H, 0.55 * stroke([(0.855, 0.47), (0.845, 0.41), (0.83, 0.37)], 0.028, 0.007, power=0.6))
    H = np.maximum(H, 0.50 * stroke([(0.845, 0.26), (0.84, 0.31), (0.825, 0.35)], 0.026, 0.007, power=0.6))
    # the eye: an almond under a heavy lid, its corners pointed, the pupil a pellet at the front
    H -= 0.08 * blob(0.61, 0.625, 0.115, 0.065, 0.12)
    H += 0.12 * stroke([(0.53, 0.655), (0.61, 0.652), (0.70, 0.628)], 0.022, 0.012)     # upper lid, straight
    H += 0.07 * stroke([(0.535, 0.645), (0.59, 0.592), (0.695, 0.625)], 0.013, 0.009)   # lower lid, a V under it
    H += 0.09 * blob(0.63, 0.625, 0.024, power=1.0)
    # brow overhang, cut back at the front so it does not read as a second sausage
    H += 0.10 * stroke([(0.50, 0.68), (0.58, 0.695), (0.68, 0.685), (0.74, 0.66)], 0.035, 0.025, power=1.5)

    # the knob on the brow behind the nose, with short rays fanning up
    kc = (0.71, 0.80)
    H += 0.18 * blob(kc[0], kc[1], 0.045, power=0.9)
    for k in range(5):
        a = math.radians(40 + k * 25)
        p0 = (kc[0] + 0.048 * math.cos(a), kc[1] + 0.048 * math.sin(a))
        p1 = (kc[0] + 0.082 * math.cos(a), kc[1] + 0.082 * math.sin(a))
        H += 0.07 * stroke([p0, p1], 0.010, 0.007) * head

    # the ear: a round boss at the back of the skull, hollowed in the middle
    H += 0.16 * blob(0.34, 0.82, 0.06, 0.07, 0.5)
    H -= 0.09 * blob(0.345, 0.815, 0.028, 0.036, 0.5)

    # the mane: tight rows of comma locks, laid along the cheek line and stepping outward, each lock
    # running back and down and curling at its tip
    edge = spline([(0.40, 0.84), (0.39, 0.66), (0.42, 0.48), (0.52, 0.30), (0.67, 0.11)], closed=False)
    rng = np.random.default_rng(7)
    locks = np.zeros((N, N))
    for row in range(4):
        line = resample(offset_curve(edge, 0.045 + 0.09 * row), 0.08)
        line = line[(row % 2):]
        for (pu, pv), nxt in zip(line[:-1], line[1:]):
            t = nxt - np.array([pu, pv])
            t /= np.linalg.norm(t)
            back = np.array([t[1], -t[0]])                            # away from the face
            d = (back * 0.75 + np.array([-0.35, -0.6]) * (0.15 + 0.2 * (row % 2)) + rng.normal(0, 0.06, 2))
            d /= np.linalg.norm(d)
            side = np.array([-d[1], d[0]])
            L = 0.12 * (0.75 + 0.5 * rng.random())
            pts = [(pu, pv), (pu + d[0] * L * 0.5 + side[0] * 0.01, pv + d[1] * L * 0.5 + side[1] * 0.01),
                   (pu + d[0] * L + side[0] * 0.006, pv + d[1] * L + side[1] * 0.006),
                   (pu + d[0] * L * 1.05 - side[0] * 0.018, pv + d[1] * L * 1.05 - side[1] * 0.018)]
            locks = np.maximum(locks, stroke(pts, 0.04, 0.012) * (0.85 + 0.3 * rng.random()))
    grown = ndimage.binary_dilation(head, iterations=max(1, N // 40)) & ~face
    H += 0.17 * locks * inflate(grown, 0.02)

    # a soft fall-off into the field
    H = ndimage.gaussian_filter(H, N / 600)
    H = np.clip(H, 0, None)
    return H / H.max()


def shade(H, relief=0.11, light=(-0.6, 0.6, 0.55)):
    """Raking light from the upper left, like a coin photograph. `relief` is the relief's height over the
    die's width (1.25 mm over 11 mm)."""
    gy, gx = np.gradient(H * relief * N)
    nx, ny, nz = -gx, gy, np.ones_like(H)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    lx, ly, lz = np.array(light) / np.linalg.norm(light)
    d = np.clip((nx * lx + ny * ly + nz * lz) / n, 0, 1)
    return (np.clip(0.15 + 0.85 * d, 0, 1) * 255).astype(np.uint8)


if __name__ == "__main__":
    H = build()
    Image.fromarray((H * 65535).astype(np.uint16)).save(arg("--out", "lion.png"))
    pv = arg("--preview")
    if pv:
        Image.fromarray(shade(H)).save(pv)
    print(f"[lion] {N}x{N}", flush=True)
