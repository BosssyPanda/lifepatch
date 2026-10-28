"""The cave's paintings, as a pigment map for the rock: 1 where the wall is black with pigment, 0 where
it is bare. The wall's material mixes charcoal over the stone by it.

Two kinds of work, both as old as the scene or older:
- Hand stencils: a hand pressed to the wall and pigment blown round it, leaving the hand bare in a
  dark halo (Sulawesi's are at least 51,200 years old). The hands are silhouettes of the statues' own
  MakeHuman hands (hands.py), a man's, a woman's and a child's.
- Animals traced from photographs of real Ice Age paintings (`--trace photo.jpg:u,v,width,turn`): the
  pigment is lifted from the photo by how much darker each point is than the rock around it, so red
  ochre comes out mid grey and charcoal black (DESIGN.md: neutral greys only). The art is far too old
  for copyright; only its marks are kept, not the photo's colour or light.

The stroke tools below (Canvas.stroke, smudge) drew the first, rejected attempt at animals from code
(2026-10-28: it read as a children's book); they are kept for the charcoal grain they lay.

Runs under plain Python with numpy, scipy and Pillow:
  python paintings.py --out panel.png --hands DIR [--trace photo.jpg:0.5,0.7,0.3,0] [--size 2048x1024]
"""
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# --------------------------------------------------------------------------------------------
# Curves and strokes
# --------------------------------------------------------------------------------------------


def catmull(pts, n=24):
    """A smooth curve through every point (centripetal-ish Catmull-Rom, ends repeated)."""
    p = np.asarray(pts, dtype=np.float64)
    if len(p) < 3:
        t = np.linspace(0, 1, n * max(1, len(p) - 1))[:, None]
        return p[0] * (1 - t) + p[-1] * t
    q = np.vstack([p[0] * 2 - p[1], p, p[-1] * 2 - p[-2]])
    out = []
    for i in range(1, len(q) - 2):
        p0, p1, p2, p3 = q[i - 1], q[i], q[i + 1], q[i + 2]
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        t2, t3 = t * t, t * t * t
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(p[-1:])
    return np.vstack(out)


class Canvas:
    """A charcoal drawing `w` x `h` pixels. Coordinates are in pixels, y down."""

    def __init__(self, w, h, seed=1):
        self.w, self.h = w, h
        self.ink = np.zeros((h, w), np.float32)
        rng = np.random.default_rng(seed)
        # the grain the charcoal catches on: fine speckle plus a coarser mottling of the stone
        fine = ndimage.gaussian_filter(rng.random((h, w)).astype(np.float32), 0.7)
        coarse = ndimage.gaussian_filter(rng.random((h, w)).astype(np.float32), 6.0)
        fine = (fine - fine.mean()) / fine.std()
        coarse = (coarse - coarse.mean()) / coarse.std()
        self.grain = 0.6 * fine + 0.4 * coarse
        self.rng = rng

    def _stamp(self, layer, x, y, r, a):
        x0, x1 = int(max(0, x - r - 2)), int(min(self.w, x + r + 3))
        y0, y1 = int(max(0, y - r - 2)), int(min(self.h, y + r + 3))
        if x0 >= x1 or y0 >= y1:
            return
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
        m = np.clip(r + 0.8 - d, 0, 1) * a
        sub = layer[y0:y1, x0:x1]
        np.maximum(sub, m, out=sub)

    def stroke(self, pts, width, taper=(0.25, 0.35), press=1.0, wobble=0.25, dry=0.35):
        """One charcoal line along a smooth curve through pts. width in pixels at full pressure;
        taper: fractions of the length that thin in at the start and out at the end; dry: how much
        the grain breaks it up (0 = solid)."""
        c = catmull(pts)
        seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        L = s[-1]
        if L < 1:
            return
        # resample evenly, a stamp every third of a pixel
        n = int(L * 3) + 2
        ts = np.linspace(0, L, n)
        xs = np.interp(ts, s, c[:, 0])
        ys = np.interp(ts, s, c[:, 1])
        u = ts / L
        t0, t1 = taper
        prof = np.minimum(np.clip(u / max(t0, 1e-3), 0, 1), np.clip((1 - u) / max(t1, 1e-3), 0, 1))
        prof = np.sqrt(prof)
        # the hand's pressure wavers slowly along the line
        k = self.rng.uniform(0, math.tau, 3)
        waver = 1 + wobble * (0.6 * np.sin(u * 7.1 + k[0]) + 0.4 * np.sin(u * 17.3 + k[1]))
        layer = np.zeros_like(self.ink)
        for x, y, p, wv in zip(xs, ys, prof, waver):
            r = max(0.5, width * 0.5 * p * wv)
            self._stamp(layer, x, y, r, min(1.0, press * (0.55 + 0.45 * p)))
        self._lay(layer, dry)

    def smudge(self, poly, strength=0.45, soft=10.0, toward=None, falloff=0.6):
        """Charcoal rubbed into an area with the fingers: a soft fill inside the closed curve poly,
        optionally darker toward the point `toward` (falling off over `falloff` of the shape's size)."""
        c = catmull(list(poly) + [poly[0]], n=16)
        from PIL import ImageDraw
        im = Image.new("L", (self.w, self.h), 0)
        ImageDraw.Draw(im).polygon([tuple(p) for p in c], fill=255)
        m = np.asarray(im, np.float32) / 255.0
        m = ndimage.gaussian_filter(m, soft)
        if toward is not None:
            yy, xx = np.mgrid[0:self.h, 0:self.w]
            size = max(np.ptp(c[:, 0]), np.ptp(c[:, 1]))
            d = np.sqrt((xx - toward[0]) ** 2 + (yy - toward[1]) ** 2) / (size * falloff)
            m = m * np.clip(1 - d, 0, 1) ** 1.5
        self._lay(m * strength, 0.5)

    def _lay(self, layer, dry):
        # grain breaks the charcoal: thin passes lose more to the hollows than heavy ones
        g = np.clip(1 + dry * self.grain - dry * 0.25 * (1 - layer), 0, 1)
        self.ink = 1 - (1 - self.ink) * (1 - layer * g)

    def image(self):
        return Image.fromarray((np.clip(self.ink, 0, 1) * 255).astype(np.uint8), "L")


# --------------------------------------------------------------------------------------------
# The animals. Each draws into the canvas at (ox, oy) with scale s (pixels per unit); flip mirrors.
# Local units: x to the right, y down; every animal faces left unless flipped.
# --------------------------------------------------------------------------------------------


def _xf(ox, oy, s, flip=False, rot=0.0):
    ca, sa = math.cos(rot), math.sin(rot)

    def f(pts):
        out = []
        for x, y in pts:
            x = -x if flip else x
            out.append((ox + (x * ca - y * sa) * s, oy + (x * sa + y * ca) * s))
        return out
    return f


def horse_head(cv, ox, oy, s, flip=False, rot=0.0, w=1.0, shade=True, mane=True):
    """A horse's head and neck in profile, facing left; the unit is the head's length."""
    T = _xf(ox, oy, s, flip, rot)
    lw = 0.035 * s * w
    # forehead down the face to the nose: nearly straight, a little dished
    cv.stroke(T([(0.86, 0.06), (0.70, 0.12), (0.50, 0.24), (0.30, 0.37), (0.14, 0.47), (0.04, 0.55)]), lw)
    # muzzle: round over the nostril and down to the upper lip, the mouth slit, the chin
    cv.stroke(T([(0.06, 0.53), (-0.01, 0.60), (0.00, 0.67), (0.06, 0.71)]), lw * 1.1, taper=(0.1, 0.2))
    cv.stroke(T([(0.05, 0.71), (0.16, 0.705), (0.26, 0.70)]), lw * 0.55, taper=(0.1, 0.5))
    cv.stroke(T([(0.07, 0.73), (0.10, 0.79), (0.20, 0.80), (0.30, 0.79)]), lw * 0.9, taper=(0.15, 0.2))
    # under the jaw to the great round cheek, and up to the throat
    cv.stroke(T([(0.28, 0.79), (0.42, 0.80), (0.55, 0.82), (0.66, 0.79), (0.74, 0.70), (0.76, 0.58)]), lw * 1.15)
    # the cheek's ridge
    cv.stroke(T([(0.40, 0.56), (0.52, 0.53), (0.62, 0.57), (0.68, 0.66)]), lw * 0.5, taper=(0.3, 0.4), dry=0.5)
    # eye and nostril
    cv.stroke(T([(0.555, 0.30), (0.60, 0.285), (0.635, 0.305), (0.60, 0.32), (0.56, 0.31)]), lw * 0.7, taper=(0.1, 0.1))
    cv.stroke(T([(0.10, 0.52), (0.13, 0.56), (0.11, 0.60)]), lw * 0.6, taper=(0.2, 0.3))
    # ears, upright
    cv.stroke(T([(0.80, 0.10), (0.76, -0.04), (0.78, -0.16), (0.84, -0.04), (0.88, 0.05)]), lw * 0.8, taper=(0.2, 0.2))
    # neck: the crest behind the ears, the underside from the throat
    cv.stroke(T([(0.88, 0.04), (1.02, 0.10), (1.16, 0.22), (1.28, 0.40), (1.36, 0.60)]), lw * 1.1, taper=(0.1, 0.6))
    cv.stroke(T([(0.76, 0.60), (0.86, 0.74), (0.98, 0.92), (1.08, 1.10)]), lw, taper=(0.1, 0.7))
    if mane:
        # the stiff upright mane of Ice Age horses: short strokes standing off the crest
        crest = catmull([(0.90, 0.02), (1.02, 0.08), (1.16, 0.20), (1.28, 0.38), (1.35, 0.55)], n=12)
        seg = np.linalg.norm(np.diff(crest, axis=0), axis=1)
        sacc = np.concatenate([[0], np.cumsum(seg)])
        for k, d in enumerate(np.linspace(0.02, sacc[-1] * 0.92, 11)):
            x = np.interp(d, sacc, crest[:, 0])
            y = np.interp(d, sacc, crest[:, 1])
            i = min(int(np.searchsorted(sacc, d)), len(crest) - 1)
            tx, ty = crest[i] - crest[max(0, i - 1)]
            nx, ny = ty, -tx
            nl = math.hypot(nx, ny) or 1
            nx, ny = nx / nl, ny / nl
            ln = 0.10 + 0.03 * math.sin(k * 2.3)
            cv.stroke(T([(x + nx * 0.015, y + ny * 0.015), (x + nx * ln + tx * 0.2, y + ny * ln + ty * 0.2)]),
                      lw * 0.55, taper=(0.05, 0.6), dry=0.5)
    if shade:
        # the muzzle rubbed dark, the way Chauvet's horses are shaded
        cv.smudge(T([(0.04, 0.55), (0.30, 0.40), (0.40, 0.56), (0.30, 0.79), (0.06, 0.72)]),
                  strength=0.55, soft=0.03 * s, toward=T([(0.0, 0.62)])[0], falloff=0.9)
        cv.smudge(T([(0.42, 0.56), (0.66, 0.60), (0.72, 0.72), (0.56, 0.80), (0.40, 0.76)]),
                  strength=0.25, soft=0.04 * s)


def rhino(cv, ox, oy, s, flip=False, rot=0.0, w=1.0):
    """A woolly rhinoceros in profile facing left: low head, two horns, humped shoulders. Unit = body length."""
    T = _xf(ox, oy, s, flip, rot)
    lw = 0.018 * s * w
    # back: from the long front horn's base over the head, the shoulder hump and down the rump
    cv.stroke(T([(0.10, 0.14), (0.18, 0.08), (0.30, 0.02), (0.42, -0.06), (0.55, -0.07), (0.72, -0.03),
                 (0.88, 0.02), (0.98, 0.10), (1.02, 0.22), (1.00, 0.34)]), lw * 1.1, taper=(0.05, 0.2))
    # front horn, long and swept forward; the second, short, behind it
    cv.stroke(T([(0.06, 0.20), (-0.04, 0.10), (-0.14, -0.04), (-0.20, -0.16)]), lw * 1.2, taper=(0.05, 0.9))
    cv.stroke(T([(0.10, 0.13), (0.00, 0.02), (-0.20, -0.16)]), lw * 0.9, taper=(0.05, 0.9))
    cv.stroke(T([(0.17, 0.09), (0.16, -0.01), (0.12, -0.07)]), lw * 0.9, taper=(0.05, 0.9))
    # snout and jaw
    cv.stroke(T([(0.06, 0.20), (0.04, 0.26), (0.08, 0.30), (0.18, 0.31), (0.26, 0.30)]), lw, taper=(0.1, 0.4))
    # ear, eye
    cv.stroke(T([(0.30, 0.03), (0.33, -0.06), (0.37, 0.02)]), lw * 0.7, taper=(0.2, 0.2))
    cv.stroke(T([(0.21, 0.15), (0.235, 0.14), (0.25, 0.155)]), lw * 0.6, taper=(0.2, 0.2))
    # belly, sagging between the short legs
    cv.stroke(T([(0.30, 0.34), (0.42, 0.40), (0.60, 0.42), (0.78, 0.40), (0.88, 0.36)]), lw, taper=(0.3, 0.3))
    # legs: short pillars, front pair and back pair
    for x0, x1 in ((0.32, 0.30), (0.42, 0.42)):
        cv.stroke(T([(x0, 0.32), (x0 - 0.01, 0.46), (x1, 0.55)]), lw * 0.9, taper=(0.1, 0.4))
    for x0, x1 in ((0.86, 0.86), (0.96, 0.98)):
        cv.stroke(T([(x0, 0.32), (x0 + 0.01, 0.46), (x1, 0.55)]), lw * 0.9, taper=(0.1, 0.4))
    # the dark band across the middle that marks Chauvet's rhinos
    cv.smudge(T([(0.50, -0.05), (0.62, -0.05), (0.64, 0.41), (0.52, 0.41)]), strength=0.5, soft=0.015 * s)


def stag(cv, ox, oy, s, flip=False, rot=0.0, w=1.0):
    """A red deer stag in profile facing left, head up, branched antlers. Unit = body length."""
    T = _xf(ox, oy, s, flip, rot)
    lw = 0.016 * s * w
    # head and neck: muzzle, forehead, the neck's front and back
    cv.stroke(T([(-0.05, -0.30), (0.00, -0.36), (0.08, -0.40), (0.14, -0.42)]), lw, taper=(0.1, 0.2))
    cv.stroke(T([(-0.05, -0.30), (-0.03, -0.26), (0.06, -0.25), (0.12, -0.24)]), lw * 0.8, taper=(0.1, 0.3))
    cv.stroke(T([(0.12, -0.24), (0.16, -0.12), (0.20, 0.00), (0.24, 0.10)]), lw, taper=(0.1, 0.3))
    cv.stroke(T([(0.14, -0.42), (0.22, -0.36), (0.30, -0.20), (0.38, -0.06), (0.46, 0.00)]), lw, taper=(0.1, 0.1))
    # ear, eye
    cv.stroke(T([(0.17, -0.38), (0.25, -0.44), (0.21, -0.36)]), lw * 0.7, taper=(0.2, 0.2))
    cv.stroke(T([(0.09, -0.36), (0.11, -0.365)]), lw * 0.7, taper=(0.3, 0.3))
    # back and rump, belly
    cv.stroke(T([(0.46, 0.00), (0.66, 0.00), (0.86, 0.01), (0.98, 0.05), (1.02, 0.12)]), lw, taper=(0.1, 0.2))
    cv.stroke(T([(0.24, 0.10), (0.30, 0.22), (0.50, 0.26), (0.72, 0.25), (0.92, 0.22)]), lw, taper=(0.2, 0.3))
    cv.stroke(T([(1.02, 0.12), (1.00, 0.20), (0.94, 0.25)]), lw * 0.9, taper=(0.1, 0.5))
    # tail
    cv.stroke(T([(1.02, 0.06), (1.06, 0.10)]), lw * 0.7, taper=(0.1, 0.6))
    # legs: thin, long, one pair striding
    for pts in (((0.28, 0.20), (0.24, 0.42), (0.22, 0.62)), ((0.36, 0.24), (0.38, 0.44), (0.42, 0.63)),
                ((0.86, 0.22), (0.84, 0.42), (0.80, 0.62)), ((0.95, 0.20), (0.98, 0.40), (1.02, 0.60))):
        cv.stroke(T(pts), lw * 0.75, taper=(0.1, 0.3))
    # antlers: two beams sweeping back with forward tines
    for side, sx in ((0, 0.0), (1, 0.05)):
        beam = [(0.15 + sx, -0.44), (0.18 + sx, -0.58), (0.26 + sx, -0.72), (0.34 + sx, -0.84), (0.40 + sx, -0.92)]
        cv.stroke(T(beam), lw * 0.75, taper=(0.05, 0.6))
        for (bx, by), (tx, ty) in (((0.17 + sx, -0.52), (0.08 + sx, -0.58)), ((0.22 + sx, -0.66), (0.14 + sx, -0.76)),
                                   ((0.30 + sx, -0.79), (0.26 + sx, -0.92)), ((0.36 + sx, -0.88), (0.36 + sx, -1.0))):
            cv.stroke(T([(bx, by), (tx, ty)]), lw * 0.55, taper=(0.05, 0.7))


# --------------------------------------------------------------------------------------------
# Hand stencils and traced paintings
# --------------------------------------------------------------------------------------------


def _paste(cv, img, cx, cy, op):
    """Combine a float image into cv.ink centred at pixel (cx, cy) with op(old, new)."""
    h, w = img.shape
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    dx1, dy1 = min(cv.w, x0 + w), min(cv.h, y0 + h)
    if dx0 >= dx1 or dy0 >= dy1:
        return
    sub = img[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0]
    cv.ink[dy0:dy1, dx0:dx1] = op(cv.ink[dy0:dy1, dx0:dx1], sub)


def stencil(cv, mask_path, cx, cy, length_px, turn=0.0, mirror=False, spray=0.55, strength=0.85, seed=0):
    """A hand stencil: the hand's silhouette (white on black, fingers pointing down the image, the
    hand's length about 2/3 of the image) laid at (cx, cy) about length_px long, turned by `turn`
    radians (0 = fingers up), with pigment blown round it."""
    m = Image.open(mask_path).convert("L")
    if mirror:
        m = m.transpose(Image.FLIP_LEFT_RIGHT)
    size = int(length_px * 1.55)
    m = m.resize((size, size), Image.BILINEAR).rotate(180 + math.degrees(turn), Image.BILINEAR, expand=True)
    hand = np.asarray(m, np.float32) / 255.0
    # the forearm fades out: pigment was blown round the hand and wrist only
    hh, ww = hand.shape
    pad = int(length_px * spray)
    a = np.pad(hand, pad)
    rng = np.random.default_rng(seed)
    # the halo: dense next to the skin, thinning outward, speckled like blown droplets
    near = ndimage.gaussian_filter(ndimage.maximum_filter(a, size=max(3, pad // 4)), pad * 0.25)
    far = ndimage.gaussian_filter(a, pad * 0.55)
    halo = np.clip(0.75 * near / max(near.max(), 1e-6) + 0.6 * far / max(far.max(), 1e-6), 0, 1)
    speck = ndimage.gaussian_filter(rng.random(a.shape).astype(np.float32), 0.8)
    speck = np.clip((speck - speck.mean()) / speck.std() * 0.35 + 0.75, 0, 1)
    ring = halo * speck * (1 - ndimage.gaussian_filter(a, 1.2))
    # irregular outer edge: blown pigment never makes a clean ellipse
    edge = ndimage.gaussian_filter(rng.random(a.shape).astype(np.float32), pad * 0.15)
    edge = (edge - edge.min()) / max(np.ptp(edge), 1e-6)
    ring *= np.clip((halo - 0.22 + 0.5 * (edge - 0.5)) / 0.25, 0, 1)
    _paste(cv, ring * strength, cx, cy, lambda o, n: 1 - (1 - o) * (1 - n))


def trace(cv, photo, cx, cy, width_px, turn=0.0, gain=1.6, feather=0.12):
    """Lift the pigment out of a photo of a cave painting and lay it on the wall: how much darker each
    point is than the bare rock round it (its local brightest), scaled by gain, its edges feathered so
    the crop doesn't show."""
    im = Image.open(photo).convert("RGB")
    k = width_px / im.width
    im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS).rotate(math.degrees(turn), Image.BICUBIC,
                                                                                 expand=True)
    rgb = np.asarray(im, np.float32) / 255.0
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    valid = (rgb.sum(axis=2) > 0.02).astype(np.float32)   # the corners rotate() filled with black
    lum = np.where(valid > 0, lum, 1.0)
    # bare rock: the bright local background
    bg = ndimage.gaussian_filter(ndimage.maximum_filter(lum, size=max(5, int(width_px * 0.06))), width_px * 0.02)
    dark = np.clip((bg - lum) / np.maximum(bg, 0.2), 0, 1)
    # red ochre is saturated but not very dark; count its colour as pigment too
    # yellow stains and the rock's own mottling are faint: only clear marks count as pigment
    ink = np.clip(gain * (dark + 0.35 * sat), 0, 1) * valid
    ink = np.clip((ink - 0.42) / 0.45, 0, 1) ** 0.8
    h, w = ink.shape
    yy, xx = np.mgrid[0:h, 0:w]
    f = feather * min(h, w)
    fade = np.clip(np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]) / f, 0, 1)
    fade = ndimage.gaussian_filter(fade * ndimage.minimum_filter(valid, size=5), 3)
    _paste(cv, ink * fade, cx, cy, lambda o, n: 1 - (1 - o) * (1 - n))


def panel(w=2048, h=1024, hands=None, traces=(), seed=3):
    """The painted wall: traced animals across the top, hand stencils lower down at arm's reach.
    Panel units: u 0..1 left to right over PANEL_SIZE[0] metres, v 0..1 bottom to top over PANEL_SIZE[1]."""
    cv = Canvas(w, h, seed)
    px_per_m = w / 3.4

    def at(u, v):
        return u * w, (1 - v) * h

    for photo, (u, v, width_m, turn) in traces:
        trace(cv, photo, *at(u, v), width_m * px_per_m, turn)
    if hands:
        # (who, u, v, turn, mirror): a cluster at the left by the horses, a few at the right,
        # the child's among the grown-ups'
        for i, (who, u, v, turn, mirror) in enumerate((
                ("man", 0.17, 0.52, 0.25, False), ("woman", 0.24, 0.62, -0.1, True), ("child", 0.205, 0.41, 0.35, False),
                ("man", 0.11, 0.37, -0.2, True), ("woman", 0.29, 0.45, 0.15, False), ("man", 0.32, 0.66, -0.35, True),
                ("woman", 0.13, 0.66, 0.4, False), ("child", 0.26, 0.31, -0.25, True), ("man", 0.38, 0.55, 0.1, False),
                ("man", 0.70, 0.58, -0.3, True), ("child", 0.76, 0.47, 0.1, True), ("woman", 0.64, 0.45, 0.2, False),
                ("woman", 0.81, 0.62, -0.15, False), ("man", 0.58, 0.67, 0.3, True))):
            length = {"man": 0.218, "woman": 0.181, "child": 0.141}[who]
            stencil(cv, os.path.join(hands, f"hand_{who}.png"), *at(u, v), length * px_per_m, turn, mirror,
                    strength=0.8 + 0.15 * ((i * 7) % 3) / 2, seed=seed + i)
    return cv


def main():
    def a(name, default=None):
        return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

    w, h = (int(x) for x in a("--size", "2048x1024").split("x"))
    traces = []
    for i, t in enumerate(sys.argv):
        if t == "--trace":
            path, spec = sys.argv[i + 1].rsplit(":", 1)
            traces.append((path, tuple(float(x) for x in spec.split(","))))
    panel(w, h, hands=a("--hands"), traces=traces).image().save(a("--out"))
    print("wrote", a("--out"))


if __name__ == "__main__":
    main()
