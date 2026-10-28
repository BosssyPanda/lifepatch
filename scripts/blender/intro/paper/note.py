"""The jiaozi note: its printed face, and the paper sheet that carries it.

No jiaozi survives, so the design follows the one Song description of how the notes were made, Li You's
Song chao shi shi (quoted in modern studies): the merchant houses "printed them on paper of one kind; the
printed design used houses, trees and people, the shop's signature marks, and each house's secret marks,
red and black interleaved, as private marks; the amount was written in by hand, any amount" (同用一色纸印造，
印文用屋木人物，铺户押字，各自隐密题号，朱墨间错，以为私记。书填贯，不限多少).

So the face here has: a double ruled border; a row of cash coins across the top (money drawn as money, as on
later Song and Jin note plates); a picture panel of a house, a tree and people, cut like a woodblock from
the scene's own hall (woodcut.py); a band of key fret; an empty ruled column where the amount was written
in; and three seal squares in a second, paler ink (the LEDGER look keeps paper money in the ink scale, so
the red becomes grey). No characters are drawn: nothing is invented to look like Chinese script. The shop
owners' signature marks are left off too: every monogram drawn for them read as a Latin letter or a Greek
phi.

    python scripts/blender/intro/paper/note.py --out note.png [--picture woodcut.png]
"""
import math
import os
import sys

import numpy as np

W, H = 960, 1280            # 0.15 x 0.20 m at 6.4 px/mm
SIZE = (0.15, 0.20)         # metres
PAPER = (0.957, 0.941, 0.902)   # #f4f0e6
INK = (0.075, 0.067, 0.063)     # #131110
INK2 = (0.42, 0.40, 0.38)       # the seals' second ink, in grey


def _noise(h, w, scale, rng):
    """Smooth value noise, 0..1."""
    gh, gw = max(2, int(h / scale) + 2), max(2, int(w / scale) + 2)
    g = rng.random((gh, gw))
    yy = np.linspace(0, gh - 1.001, h)
    xx = np.linspace(0, gw - 1.001, w)
    y0, x0 = yy.astype(int), xx.astype(int)
    fy, fx = (yy - y0)[:, None], (xx - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def _rect(m, x0, y0, x1, y1, t):
    """A rectangle outline of thickness t (pixels) into mask m."""
    m[y0:y0 + t, x0:x1] = 1
    m[y1 - t:y1, x0:x1] = 1
    m[y0:y1, x0:x0 + t] = 1
    m[y0:y1, x1 - t:x1] = 1


def _coin(m, cx, cy, r):
    """A cash coin seen face on: an outer rim, an inner rim round the square hole, the hole open."""
    yy, xx = np.mgrid[0:m.shape[0], 0:m.shape[1]]
    d = np.hypot(xx - cx, yy - cy)
    sq = np.maximum(np.abs(xx - cx), np.abs(yy - cy))
    ring = (d < r) & (d > r * 0.84)
    hole_rim = (sq < r * 0.36) & (sq > r * 0.26)
    field = (d < r * 0.84) & (sq >= r * 0.36)
    m[ring | hole_rim] = 1
    m[field] = np.maximum(m[field], 0.0)


def _stroke(m, pts, w0, w1, rng):
    """A brush stroke along a polyline, width tapering from w0 to w1 (pixels)."""
    H_, W_ = m.shape
    pts = np.asarray(pts, dtype=float)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    L = seg[-1]
    n = max(2, int(L / 1.5))
    s = np.linspace(0, L, n)
    xs = np.interp(s, seg, pts[:, 0])
    ys = np.interp(s, seg, pts[:, 1])
    for k in range(n):
        t = s[k] / L
        r = (w0 + (w1 - w0) * t) / 2 * (0.9 + 0.2 * rng.random())
        x0, x1 = int(max(0, xs[k] - r - 1)), int(min(W_, xs[k] + r + 2))
        y0, y1 = int(max(0, ys[k] - r - 1)), int(min(H_, ys[k] + r + 2))
        yy, xx = np.mgrid[y0:y1, x0:x1]
        m[y0:y1, x0:x1] = np.maximum(m[y0:y1, x0:x1], (np.hypot(xx - xs[k], yy - ys[k]) < r).astype(float))


def _bezier(p0, p1, p2, p3, n=60):
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3)


def _fret(m, x0, x1, y0, h, rng):
    """A band of key fret (square spirals in a row): ornament, not script."""
    n = int((x1 - x0) / h)
    step = (x1 - x0) / n
    t = max(3, int(h * 0.1))
    for k in range(n):
        ox = x0 + k * step
        a = h * 0.8
        pts = [(ox + 0.1 * h, y0 + 0.9 * h), (ox + 0.1 * h, y0 + 0.1 * h), (ox + 0.1 * h + a, y0 + 0.1 * h),
               (ox + 0.1 * h + a, y0 + 0.75 * h), (ox + 0.35 * h, y0 + 0.75 * h), (ox + 0.35 * h, y0 + 0.35 * h),
               (ox + 0.65 * h, y0 + 0.35 * h)]
        _stroke(m, pts, t, t, rng)
    m[int(y0 + 0.9 * h):int(y0 + 0.9 * h) + t, int(x0):int(x1)] = 1


def _seal(m, cx, cy, r, rng):
    """A seal impression: a square frame and an inner fret of square spirals (no characters)."""
    _rect(m, int(cx - r), int(cy - r), int(cx + r), int(cy + r), max(3, int(r * 0.12)))
    q = r * 0.62
    for sx in (-1, 1):
        for sy in (-1, 1):
            ox, oy = cx + sx * q * 0.55, cy + sy * q * 0.55
            a = q * 0.42
            pts = [(ox - a, oy - a), (ox + a, oy - a), (ox + a, oy + a), (ox - a * 0.4, oy + a),
                   (ox - a * 0.4, oy - a * 0.2), (ox + a * 0.3, oy - a * 0.2), (ox + a * 0.3, oy + a * 0.4)]
            _stroke(m, pts, r * 0.09, r * 0.09, rng)


def design(picture=None, seed=7):
    """The printed face as an RGB float array (H, W, 3), top row first."""
    rng = np.random.default_rng(seed)
    ink = np.zeros((H, W))
    ink2 = np.zeros((H, W))
    b = 40
    _rect(ink, b, b, W - b, H - b, 14)
    _rect(ink, b + 26, b + 26, W - b - 26, H - b - 26, 5)
    x0, x1 = b + 26, W - b - 26
    # a row of cash coins across the top
    top0 = b + 26
    band = 150
    ink[top0 + band:top0 + band + 5, x0:x1] = 1
    n = 5
    for k in range(n):
        cx = x0 + (k + 0.5) * (x1 - x0) / n
        _coin(ink, cx, top0 + band / 2 + 2, 56)
    # picture panel: houses, trees and people, cropped to the picture and as tall as it needs
    p0 = top0 + band + 30
    pw = x1 - x0 - 72
    ph = 560
    pic = None
    if picture is not None:
        rows = np.where(picture.max(axis=1) > 0)[0]
        cols = np.where(picture.max(axis=0) > 0)[0]
        mg = int(0.03 * picture.shape[1])
        crop = picture[max(rows[0] - mg, 0):rows[-1] + mg, max(cols[0] - mg, 0):cols[-1] + mg]
        ph = int(pw * crop.shape[0] / crop.shape[1])
        pic = _fit(crop, ph, pw)
    p1 = p0 + ph + 24
    _rect(ink, x0 + 24, p0, x1 - 24, p1, 6)
    if pic is not None:
        ink[p0 + 12:p0 + 12 + ph, x0 + 36:x0 + 36 + pw] = np.maximum(ink[p0 + 12:p0 + 12 + ph, x0 + 36:x0 + 36 + pw], pic)
    # a band of key fret under the picture
    _fret(ink, x0 + 24, x1 - 24, p1 + 26, 46, rng)
    # lower field: the column where the amount was written in by hand, left empty (no invented writing),
    # with the house seals in a second ink beside it and one stamped across its foot
    f0, f1 = p1 + 26 + 46 + 40, H - b - 66
    col_w = 190
    cx = (x0 + x1) / 2
    _rect(ink, int(cx - col_w / 2), f0, int(cx + col_w / 2), f1, 5)
    side = (x1 - x0 - col_w) / 4
    _seal(ink2, x0 + side, f0 + (f1 - f0) * 0.42, 80, rng)
    _seal(ink2, x1 - side, f0 + (f1 - f0) * 0.58, 80, rng)
    _seal(ink2, cx, (f0 + f1) / 2 + 10, 58, rng)
    # secret marks: a few small ticks in the border corners
    for (cx, cy) in ((b + 13, b + 13), (W - b - 13, H - b - 13)):
        _stroke(ink, [(cx - 8, cy - 8), (cx + 8, cy + 8)], 5, 5, rng)
    # print texture: block printing leaves the ink uneven, broken where the block was dry
    cover = 0.78 + 0.22 * _noise(H, W, 9, rng) + 0.12 * (rng.random((H, W)) - 0.5)
    cover = np.clip(cover, 0, 1)
    a1 = np.clip(ink * cover * 1.1, 0, 1)
    a2 = np.clip(ink2 * (0.6 + 0.4 * _noise(H, W, 14, rng)), 0, 1) * 0.85
    paper = np.array(PAPER) * (0.965 + 0.035 * _noise(H, W, 60, rng))[..., None]
    paper -= 0.025 * (rng.random((H, W)) > 0.997)[..., None]          # fibres and specks
    img = paper * (1 - a2[..., None]) + np.array(INK2) * a2[..., None]
    img = img * (1 - a1[..., None]) + np.array(INK) * a1[..., None]
    # the edges of the sheet a little darker and worn
    yy, xx = np.mgrid[0:H, 0:W]
    e = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy))
    img *= (0.93 + 0.07 * np.clip(e / 20.0, 0, 1))[..., None]
    return np.clip(img, 0, 1)


def _fit(pic, h, w):
    """Resize a 0..1 ink mask to h x w (cropping to keep its aspect), averaging, then cut back to ink or
    paper at a low threshold so the knife lines stay bold when the picture is made smaller."""
    from PIL import Image
    ph, pw = pic.shape
    s = max(h / ph, w / pw)
    nh, nw = int(math.ceil(ph * s)), int(math.ceil(pw * s))
    im = Image.fromarray((pic * 255).astype(np.uint8)).resize((nw, nh), Image.BOX)
    small = np.asarray(im, dtype=float) / 255.0
    oy, ox = (nh - h) // 2, (nw - w) // 2
    return (small[oy:oy + h, ox:ox + w] > 0.3).astype(float)


def save_png(img, path):
    from PIL import Image
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(path)


# ------------------------------------------------------------------------------------------------ Blender side

def _bpy():
    import bpy
    return bpy


def material(png=None):
    """A paper material printed with the note face (from png, or generated now)."""
    bpy = _bpy()
    key = "jiaozi_" + (os.path.basename(png) if png else "gen")
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    if png:
        im = bpy.data.images.load(png)
    else:
        arr = design()
        im = bpy.data.images.new("jiaozi_face", W, H, alpha=False)
        rgba = np.concatenate([arr, np.ones((H, W, 1))], axis=2)[::-1]
        im.pixels[:] = rgba.astype(np.float32).ravel()
        im.pack()
    im.colorspace_settings.name = "sRGB"
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.82
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = im
    tex.interpolation = "Cubic"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    # paper fibre: a faint bump
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 400.0
    nz.inputs["Detail"].default_value = 4.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def sheet(name, size, png=None, curl=0.0):
    """A sheet of paper (face up = +Z, long side along Y) printed with the note."""
    bpy = _bpy()
    import bmesh
    import kit
    w, h = size
    bm = bmesh.new()
    nx, ny = 20, 32
    verts = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = (i / nx - 0.5) * w
            y = (j / ny - 0.5) * h
            z = curl * (2 * (i / nx) - 1) ** 2 * w
            verts[i, j] = bm.verts.new((x, y, z))
    uv = bm.loops.layers.uv.new()
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
            for lp, (a, c) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uv].uv = (a / nx, c / ny)
    ob = kit.from_bmesh(name, bm, material(png))
    so = ob.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.0012
    del bpy
    return ob


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]

    def arg(n, d=None):
        return args[args.index(n) + 1] if n in args else d

    if arg("--out"):
        pic = None
        if arg("--picture"):
            from PIL import Image
            pic = 1.0 - np.asarray(Image.open(arg("--picture")).convert("L"), dtype=float) / 255.0
        save_png(design(pic), arg("--out"))
        print("[note]", arg("--out"))
