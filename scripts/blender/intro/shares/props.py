"""Props of the shares scene: the cash chest of silver with the 1606 receipt (the era's money), Spanish
pieces of eight struck as cobs, the bookkeeper's table, register, inkwell and pen, the quay, posts,
chests and barrels.

Paper is drawn from code as strokes that read as a hand-written page (loops, ascenders, descenders,
signatures) without forming any letters, so nothing is invented that could be misread as a real text.
"""
import math
import random

import bpy
import bmesh  # after bpy: the bpy module only provides it once loaded
from mathutils import Vector, noise

import kit
from kit import mat

# --------------------------------------------------------------------------------------------
# Hand-written paper, drawn as strokes
# --------------------------------------------------------------------------------------------

# letter shapes in em units (x-height 1), drawn from the baseline at x = 0
_GLYPHS = {
    "hump": [(0.0, 0.05), (0.12, 0.85), (0.3, 1.0), (0.45, 0.7), (0.5, 0.1), (0.62, 0.0)],
    "loop": [(0.0, 0.25), (0.35, 0.85), (0.55, 0.95), (0.3, 0.75), (0.22, 0.25), (0.48, 0.0), (0.7, 0.12)],
    "tall": [(0.0, 0.1), (0.28, 1.4), (0.38, 2.3), (0.22, 2.05), (0.24, 0.5), (0.42, 0.0), (0.6, 0.1)],
    "deep": [(0.0, 0.5), (0.28, 1.0), (0.45, 0.6), (0.4, -0.7), (0.25, -1.25), (0.12, -0.85), (0.55, 0.0)],
    "dot": [(0.0, 0.05), (0.15, 0.95), (0.25, 0.0), (0.4, 0.08)],
}
_KINDS = ["hump"] * 9 + ["loop"] * 6 + ["tall"] * 3 + ["deep"] * 2 + ["dot"] * 2


def _catmull(pts, n=6):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
                                    + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3) for d in (0, 1)))
    out.append(pts[-1])
    return out


def _word(rnd, x, y, em, slant=0.16):
    """One cursive word starting at (x, y) (pixels, y down): a joined chain of letter-like strokes."""
    pts = []
    for _ in range(rnd.randint(2, 7)):
        g = _GLYPHS[rnd.choice(_KINDS)]
        w = g[-1][0] * rnd.uniform(0.9, 1.25)
        for gx, gy in g:
            gy *= rnd.uniform(0.85, 1.12)
            pts.append((x + (gx * w / g[-1][0] + gy * slant) * em, y - gy * em))
        x += w * em
    return _catmull(pts, n=10), x


def _pen(draw, pts, em, ink, hair=1):
    """Draw a path with a broad-edged quill held at a fixed angle: each step sweeps the nib, so strokes
    across the nib come out thick and strokes along it hairline, as in a hand of around 1600. A round
    pen (even line width) is what made the first draft read as modern school cursive."""
    a = math.radians(38)
    nx, ny = math.cos(a) * em * 0.062, -math.sin(a) * em * 0.062
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        draw.polygon([(x0 - nx, y0 - ny), (x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny)], fill=ink)
    draw.line(pts, fill=ink, width=hair)


def _line(draw, rnd, x0, x1, y, em, ink, width):
    x = x0 + rnd.uniform(0, em * 0.6)
    while x < x1 - em * 2.5:
        pts, x = _word(rnd, x, y + rnd.uniform(-0.12, 0.12) * em, em)
        _pen(draw, pts, em, ink, width // 2 or 1)
        x += em * rnd.uniform(0.7, 1.3)


def _initial(draw, rnd, x, y, em, ink):
    """A large looped capital opening the note: a tall stem with a loop at its head and a tail that
    sweeps back under the first word."""
    pts = [(x + em * 0.9, y - em * 2.6), (x + em * 0.2, y - em * 3.1), (x - em * 0.3, y - em * 2.4),
           (x + em * 0.4, y - em * 1.9), (x + em * 0.9, y - em * 2.6), (x + em * 0.7, y - em * 0.9),
           (x + em * 0.3, y + em * 0.4), (x - em * 0.4, y + em * 0.6), (x - em * 0.2, y + em * 0.1),
           (x + em * 1.6, y + em * 0.05)]
    _pen(draw, _catmull(pts, n=14), em * 1.6, ink)


def _signature(draw, rnd, cx, cy, em, ink, width):
    """A signature with a flourish under it: a large word and a long looping underline."""
    pts, x = _word(rnd, cx - em * 3, cy, em * 1.5)
    _pen(draw, pts, em * 1.2, ink)
    fl = []
    for k in range(60):
        t = k / 59
        fl.append((cx - em * 3.5 + t * em * 7 + math.sin(t * 9) * em * 0.6, cy + em * (0.9 + 0.5 * math.sin(t * 4.5))))
    _pen(draw, fl, em * 0.8, ink)


def paper_pil(w, h, kind, seed, paper, inkc):
    """The drawn page as a Pillow image (see paper_image)."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter

    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h), paper)
    d = ImageDraw.Draw(im)
    em = w / 46
    wd = max(2, int(w / 420))
    if kind == "receipt":
        m = w * 0.1
        y = h * 0.12
        # an opening capital, a first line set a little larger, then the body at an uneven pitch
        _initial(d, rnd, m + em * 1.2, y, em * 1.1, inkc)
        _line(d, rnd, m + em * 4, w - m - em * 2, y, em * 1.25, inkc, wd + 1)
        y += em * 3.6
        for k in range(8):
            _line(d, rnd, m + rnd.uniform(-0.3, 0.3) * em, w - m - (em * 6 if k == 7 else 0), y, em, inkc, wd)
            y += em * rnd.uniform(2.7, 3.2)
        y += em * 1.5
        _line(d, rnd, w * 0.45, w - m, y, em, inkc, wd)
        _signature(d, rnd, w * 0.68, h * 0.8, em, inkc, wd)
        _signature(d, rnd, w * 0.32, h * 0.87, em * 0.9, inkc, wd)
    elif kind == "ledger":
        m = w * 0.08
        d.line([(m * 2.2, h * 0.06), (m * 2.2, h * 0.95)], fill=inkc, width=wd)
        d.line([(w * 0.74, h * 0.06), (w * 0.74, h * 0.95)], fill=inkc, width=wd)
        _line(d, rnd, m * 3, w * 0.7, h * 0.07, em * 1.2, inkc, wd + 1)
        y = h * 0.13
        rows = 0
        while y < h * 0.93:
            filled = rows < rnd.randint(14, 17) if seed % 2 else True
            if filled:
                _line(d, rnd, m * 2.6, w * (0.5 + 0.18 * rnd.random()), y, em * 0.85, inkc, wd)
                _line(d, rnd, w * 0.77, w * (0.84 + 0.06 * rnd.random()), y, em * 0.85, inkc, wd)
            d.line([(m, y + em * 0.55), (w - m, y + em * 0.55)], fill=tuple(int(0.75 * a + 0.25 * b) for a, b in zip(paper, inkc)),
                   width=1)
            y += em * 2.6
            rows += 1
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    arr = np.asarray(im, dtype=np.float32) / 255.0
    # four hundred years: the sheet darkens a little toward its edges and unevenly across it
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum(np.minimum(xx, w - 1 - xx) / w, np.minimum(yy, h - 1 - yy) / h)
    tone = 0.93 + 0.07 * np.clip(edge / 0.06, 0, 1)
    lo = np.asarray(Image.fromarray((np.random.default_rng(seed).random((h // 64 + 2, w // 64 + 2)) * 255).astype(np.uint8))
                    .resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
    tone *= 0.97 + 0.03 * lo
    arr *= tone[..., None]
    if kind == "receipt":
        # two folds across the sheet: a faint crease shadow
        for f in (1 / 3, 2 / 3):
            r = int(h * f)
            arr[r - 2:r + 2] *= 0.93
    return arr


def paper_image(name, w, h, kind, seed=1):
    """kind 'receipt': a single hand-written note (an opening capital, a few lines, a shorter line with the
    sum, two signatures) folded in three; 'ledger': a register page ruled into a narrow margin, a column of
    names and a column of sums."""
    import numpy as np

    lk = kit.look()
    paper = tuple(int(c * 255) for c in kit._srgb01(lk["paper"]))
    inkc = tuple(int(c * 255) for c in kit._srgb01(lk["print"]))
    arr = paper_pil(w, h, kind, seed, paper, inkc)
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.concatenate([arr, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img.pixels[:] = rgba[::-1].ravel()
    img.pack()
    return img


def _paper_mat(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.78
    b.inputs["Subsurface Weight"].default_value = 0.05
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Cubic"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    kit._bump(nt, b, scale=120.0, strength=0.05, distance=0.001)
    return m


def sheet(name, size, img, folds=(), curl=0.0, nx=36, ny=48, seed=1):
    """A sheet of paper (face +Z, top edge toward +Y) with soft fold ridges across it and a slight curl."""
    w, h = size
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    vs = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            s, t = i / nx, j / ny
            z = curl * (2 * s - 1) ** 2 * w
            for f in folds:
                z += 0.0025 * math.exp(-((t - f) / 0.02) ** 2)   # a fold that was pressed flat again
            z += 0.0006 * noise.noise(Vector((s * 3 + seed, t * 3, 0.5)))
            vs[i, j] = bm.verts.new(((s - 0.5) * w, (t - 0.5) * h, z))
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
            for lp, (a, c) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uv].uv = (a / nx, c / ny)
    ob = kit.from_bmesh(name, bm, _paper_mat(name + "_mat", img))
    s = ob.modifiers.new("thick", "SOLIDIFY")
    s.thickness, s.offset = 0.0012, -1.0
    return ob


# --------------------------------------------------------------------------------------------
# Pieces of eight: hammered cobs
# --------------------------------------------------------------------------------------------


def _cob_height(n=256, seed=1):
    """The reverse of a cob of eight reales as a height map in [0, 1]: a cross of Jerusalem with crossbars
    at its ends, castles in two quarters and lions in the other two, a beaded border, struck off-centre
    (part of the design runs off the flan). Drawn as simple silhouettes, so it reads at a few centimetres."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter

    rnd = random.Random(seed)
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    ox, oy = n * rnd.uniform(-0.08, 0.08), n * rnd.uniform(-0.08, 0.08)
    c = (n / 2 + ox, n / 2 + oy)

    def P(x, y):
        return (c[0] + x * n, c[1] + y * n)

    a, t, e = 0.36, 0.035, 0.12  # arm length, half thickness, end bar half length
    d.rectangle([P(-a, -t), P(a, t)], fill=255)
    d.rectangle([P(-t, -a), P(t, a)], fill=255)
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if sx:
            d.rectangle([P(sx * a - t, -e), P(sx * a + t, e)], fill=255)
        else:
            d.rectangle([P(-e, sy * a - t), P(e, sy * a + t)], fill=255)

    def castle(cx, cy, s):
        d.rectangle([P(cx - s, cy - s * 0.2), P(cx + s, cy + s)], fill=200)
        for k in (-1, 0, 1):
            h = 0.75 if k == 0 else 0.5
            d.rectangle([P(cx + k * s * 0.7 - s * 0.22, cy - s * (0.2 + h)), P(cx + k * s * 0.7 + s * 0.22, cy - s * 0.2)], fill=200)
        d.rectangle([P(cx - s * 0.18, cy + s * 0.4), P(cx + s * 0.18, cy + s)], fill=60)  # gate

    def lion(cx, cy, s):
        # a lion rampant in outline: body, raised forelegs, head, tail
        body = [(0.0, 0.55), (-0.25, 0.2), (-0.2, -0.25), (0.05, -0.55), (0.3, -0.5), (0.25, -0.2), (0.4, 0.0),
                (0.15, 0.1), (0.3, 0.6), (0.1, 0.65)]
        d.polygon([P(cx + x * s * 1.6, cy + y * s * 1.6) for x, y in body], fill=200)
        d.ellipse([P(cx - s * 0.05, cy - s * 1.25), P(cx + s * 0.55, cy - s * 0.7)], fill=200)
        d.line([P(cx - s * 0.35, cy + s * 0.6), P(cx - s * 0.7, cy + s * 0.1), P(cx - s * 0.55, cy - s * 0.4)], fill=200,
               width=max(2, n // 60))

    q = 0.19
    castle(-q, -q, 0.08)
    castle(q, q, 0.08)
    lion(q, -q, 0.075)
    lion(-q, q, 0.075)
    # beaded border, partly off the flan
    for k in range(48):
        ang = k / 48 * math.tau
        x, y = P(0.47 * math.cos(ang), 0.47 * math.sin(ang))
        r = n * 0.012
        d.ellipse([x - r, y - r, x + r, y + r], fill=170)
    im = im.filter(ImageFilter.GaussianBlur(n / 220))
    return np.asarray(im, dtype=np.float32) / 255.0


def _cob_form(seed, r):
    """A cob's outline (radius at an angle, clipped by two or three straight cuts) and its wedge (how much
    thicker one side is), drawn from its seed in the same order for the render coin and the web coin."""
    rnd = random.Random(seed)
    cuts = [(rnd.uniform(0, math.tau), rnd.uniform(0.87, 0.95)) for _ in range(rnd.randint(2, 3))]

    def outline(a):
        rr = 1.0 + 0.05 * noise.noise(Vector((math.cos(a) * 1.7 + seed, math.sin(a) * 1.7, 0.3)))
        for ca, cd in cuts:   # a straight clip: the chord at distance cd from the centre
            da = math.cos(a - ca)
            if da > 1e-3:
                rr = min(rr, cd / da)
        return rr * r

    return outline, rnd.uniform(-0.25, 0.25)


def cob(name, r=0.019, thick=0.0024, relief=0.00035, seed=1, material=None, design=True):
    """A cob: an irregular flan clipped with straight cuts, thicker on one side, the cross side up (+Z)."""

    hmap = _cob_height(256, seed) if design else None
    outline, wedge = _cob_form(seed, r)

    def h(x, y):
        if hmap is None:
            return 0.0
        n = hmap.shape[0]
        u = (x / r * 0.5 + 0.5) * (n - 1)
        v = (0.5 - y / r * 0.5) * (n - 1)
        i, j = int(min(max(u, 0), n - 2)), int(min(max(v, 0), n - 2))
        fu, fv = u - i, v - j
        return (hmap[j, i] * (1 - fu) * (1 - fv) + hmap[j, i + 1] * fu * (1 - fv) + hmap[j + 1, i] * (1 - fu) * fv
                + hmap[j + 1, i + 1] * fu * fv)

    bm = bmesh.new()
    K, M = 40, 144
    top, bot = {}, {}
    for k in range(K + 1):
        t = k / K
        for m in range(M if k else 1):
            a = m / M * math.tau
            rr = outline(a) * t
            x, y = rr * math.cos(a), rr * math.sin(a)
            th = thick * (1 + wedge * x / r) * (1 - 0.25 * t ** 6)
            top[k, m] = bm.verts.new((x, y, th / 2 + relief * h(x, y)))
            bot[k, m] = bm.verts.new((x, y, -th / 2 - relief * 0.5 * (1 - abs(noise.noise(Vector((x * 300, y * 300, 1)))))))
    for grid, flip in ((top, False), (bot, True)):
        for m in range(M):
            f = (grid[0, 0], grid[1, m], grid[1, (m + 1) % M])
            bm.faces.new(f[::-1] if flip else f)
        for k in range(1, K):
            for m in range(M):
                f = (grid[k, m], grid[k + 1, m], grid[k + 1, (m + 1) % M], grid[k, (m + 1) % M])
                bm.faces.new(f[::-1] if flip else f)
    for m in range(M):
        bm.faces.new((top[K, m], bot[K, m], bot[K, (m + 1) % M], top[K, (m + 1) % M]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    metal = material or _silver()
    ob = kit.from_bmesh(name, bm, metal)
    ob["cob_seed"] = seed
    return ob


COB_ATLAS = (4, 2)   # cells across and down in the web coins' normal atlas; the last cell is flat


def cob_normal_atlas(seeds, cell=256, r=0.019, relief=0.00035):
    """The relief of each cob design (one per seed, in order) as a tangent-space normal map, side by side
    in one image (COB_ATLAS cells, filled from the bottom-left, the last left flat for backs and rims).
    Computed from the same height map the render coin is displaced by, so the web coin's light falls
    the same way without its 23 000 triangles. Returns a float RGB array, rows bottom-up as Blender
    stores images."""
    import numpy as np

    cols, rows = COB_ATLAS
    assert len(seeds) < cols * rows
    out = np.zeros((rows * cell, cols * cell, 3), dtype=np.float32)
    out[...] = (0.5, 0.5, 1.0)
    px = 2 * r / cell
    from scipy.ndimage import gaussian_filter

    for k, seed in enumerate(seeds):
        # bottom-up, so the row index grows with +y; softened by a pixel, as the render coin's mesh
        # softens it (the sharp steps hatched the relief on the page)
        hb = gaussian_filter(_cob_height(cell, seed)[::-1], 1.2) * relief
        dy, dx = np.gradient(hb, px)
        nrm = np.dstack([-dx, -dy, np.ones_like(hb)])
        nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
        c, rr = k % cols, k // cols
        out[rr * cell:(rr + 1) * cell, c * cell:(c + 1) * cell] = nrm * 0.5 + 0.5
    return out


def cob_web(name, seed, cell_index, r=0.019, thick=0.0024, segs=32, material=None):
    """A light copy of cob(seed) for the browser: the same clipped outline and wedge, flat faces (about
    260 triangles), the relief left to the normal atlas. The top's UVs land on cell cell_index of the
    atlas; the back and the rim on its last, flat cell."""
    outline, wedge = _cob_form(seed, r)
    cols, rows = COB_ATLAS
    c, rr = cell_index % cols, cell_index // cols
    fc, fr = (cols * rows - 1) % cols, (cols * rows - 1) // cols
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rings = (0.0, 0.75, 1.0)
    top, bot = {}, {}
    for k, t in enumerate(rings):
        for m in range(segs if k else 1):
            a = m / segs * math.tau
            rad = outline(a) * t
            x, y = rad * math.cos(a), rad * math.sin(a)
            th = thick * (1 + wedge * x / r) * (1 - 0.25 * t ** 6)
            top[k, m] = bm.verts.new((x, y, th / 2))
            bot[k, m] = bm.verts.new((x, y, -th / 2))

    def face(vs, flat=False):
        f = bm.faces.new(vs)
        for lp in f.loops:
            x, y = lp.vert.co.x, lp.vert.co.y
            if flat:
                lp[uv].uv = ((fc + 0.5) / cols, (fr + 0.5) / rows)
            else:
                lp[uv].uv = ((c + x / r * 0.5 + 0.5) / cols, (rr + y / r * 0.5 + 0.5) / rows)
        return f

    for grid, flip in ((top, False), (bot, True)):
        for m in range(segs):
            f = (grid[0, 0], grid[1, m], grid[1, (m + 1) % segs])
            face(f[::-1] if flip else f, flat=flip)
        for k in range(1, len(rings) - 1):
            for m in range(segs):
                f = (grid[k, m], grid[k + 1, m], grid[k + 1, (m + 1) % segs], grid[k, (m + 1) % segs])
                face(f[::-1] if flip else f, flat=flip)
    K = len(rings) - 1
    for m in range(segs):
        face((top[K, m], bot[K, m], bot[K, (m + 1) % segs], top[K, (m + 1) % segs]), flat=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.from_bmesh(name, bm, material or _silver(), smooth=False)   # smoothed, the rim rounds over


def _silver():
    """Silver for the coins: roughness 0.3 (glossier coins mirror the dark room and read as bowls), a
    little darker in the low parts of the relief through its own bump only."""
    key = "cob_silver"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = mat("silver").copy()
    m.name = key
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.3
    b.inputs["Base Color"].default_value = (0.93, 0.92, 0.9, 1.0)
    return m


def coin_heap(name, center, size, base_z, n=110, seed=3, mound=0.05, protos=None, max_tilt=0.35):
    """Coins tipped into a box: each coin dropped onto a height field of the coins already there, tilted to
    its local slope, so the heap stacks instead of intersecting. Coins are linked copies of a few cobs."""
    import numpy as np
    from scipy.ndimage import uniform_filter

    rnd = random.Random(seed)
    w, d = size
    res = 0.002
    nx, ny = int(w / res), int(d / res)
    xs = (np.arange(nx) + 0.5) * res - w / 2
    ys = (np.arange(ny) + 0.5) * res - d / 2
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    # the floor of the heap: a low mound, so the middle stands higher than the corners
    H = mound * np.clip(1 - (X / (w / 2)) ** 2, 0, 1) * np.clip(1 - (Y / (d / 2)) ** 2, 0, 1)
    protos = protos or [cob(f"{name}_proto{k}", seed=seed * 10 + k) for k in range(5)]
    for p in protos:
        p.hide_render = True
        p.hide_viewport = True
    root = kit.link(bpy.data.objects.new(name, None))
    root.location = center
    obs = []
    for k in range(n):
        p = rnd.choice(protos)
        r = 0.019
        cx, cy = rnd.uniform(-w / 2 + r, w / 2 - r), rnd.uniform(-d / 2 + r, d / 2 - r)
        i0, i1 = max(int((cx - r - xs[0]) / res), 0), min(int((cx + r - xs[0]) / res), nx - 1)
        j0, j1 = max(int((cy - r - ys[0]) / res), 0), min(int((cy + r - ys[0]) / res), ny - 1)
        foot = H[i0:i1 + 1, j0:j1 + 1]
        top = float(foot.max())
        # the coin settles on the plane through the heap under it, not on the step of one coin's edge:
        # slope from the heap smoothed over a coin's width, clamped (a steeper coin would have slid off)
        S = uniform_filter(H[i0:i1 + 1, j0:j1 + 1], size=max(3, (i1 - i0) // 2))
        gx = float(S[-1, :].mean() - S[0, :].mean()) / max((i1 - i0) * res, 1e-6)
        gy = float(S[:, -1].mean() - S[:, 0].mean()) / max((j1 - j0) * res, 1e-6)
        tilt_x = max(-max_tilt, min(max_tilt, math.atan(gy))) + rnd.uniform(-0.08, 0.08)
        tilt_y = max(-max_tilt, min(max_tilt, -math.atan(gx))) + rnd.uniform(-0.08, 0.08)
        ob = bpy.data.objects.new(f"{name}{k}", p.data)
        kit.link(ob)
        ob.parent = root
        ob.location = (cx, cy, top + 0.0013 + r * 0.35 * min(abs(math.sin(tilt_x)) + abs(math.sin(tilt_y)), 0.5))
        ob.rotation_euler = (tilt_x, tilt_y, rnd.uniform(0, math.tau))
        if rnd.random() < 0.1:
            ob.rotation_euler.x += math.pi   # some lie shield side up
        disc = (X - cx) ** 2 + (Y - cy) ** 2 < r * r
        H = np.where(disc, np.maximum(H, top + 0.0026), H)
        obs.append(ob)
    root.location.z = base_z
    return root, protos


# --------------------------------------------------------------------------------------------
# Furniture and the chest
# --------------------------------------------------------------------------------------------


def iron_mat():
    """Iron bands in the LEDGER world: not metal (metal is spent on the money), a dark clay a step below
    the wood."""
    return mat("clay_dim", "#4a4640")


def chest(name, size=(0.44, 0.3, 0.22), lid_open=0.0, material=None, inside=None, bands=2, iron=None, band_at=None,
          hasp=True):
    """An iron-bound strongbox: walls, a flat lid hinged along the back edge (lid_open in radians, 0 shut),
    iron bands round the body and over the lid, a lock plate and side handles. band_at: the bands' places
    across the width as fractions from -0.5 to 0.5 (default evenly spaced). The local origin is the middle
    of the base; the front faces -Y."""
    w, d, h = size
    wood = material or mat("wood")
    iron = iron or iron_mat()
    inner = inside or mat("clay_dim", kit.look()["ground"])
    root = kit.link(bpy.data.objects.new(name, None))
    band_x = [f * w for f in band_at] if band_at else [(k + 1) / (bands + 1) * w - w / 2 for k in range(bands)]
    t = 0.022
    parts = [kit.box(name + "_floor", (w, d, t), loc=(0, 0, t / 2), material=wood)]
    for k, (sx, sy, lw, ld) in enumerate(((0, -1, w, t), (0, 1, w, t), (-1, 0, t, d), (1, 0, t, d))):
        parts.append(kit.box(f"{name}_wall{k}", (lw, ld, h), loc=(sx * (w - t) / 2, sy * (d - t) / 2, h / 2), material=wood,
                             bevel=0.004))
    parts.append(kit.box(name + "_lining", (w - 2 * t, d - 2 * t, 0.004), loc=(0, 0, t + 0.002), material=inner))
    # bands round the body
    for k, x in enumerate(band_x):
        parts.append(kit.box(f"{name}_band{k}", (0.03, d + 0.008, h + 0.004), loc=(x, 0, h / 2), material=iron, bevel=0.003))
    parts.append(kit.box(name + "_rim", (w + 0.008, d + 0.008, 0.025), loc=(0, 0, h - 0.0125), material=iron, bevel=0.003))
    parts.append(kit.box(name + "_foot", (w + 0.008, d + 0.008, 0.025), loc=(0, 0, 0.0125), material=iron, bevel=0.003))
    parts.append(kit.box(name + "_lock", (0.07, 0.008, 0.08), loc=(0, -d / 2 - 0.004, h - 0.05), material=iron, bevel=0.002))
    for sx in (-1, 1):
        ring = kit.curve_tube(f"{name}_handle{sx}", [Vector((sx * (w / 2 + 0.012), -0.04, h * 0.62)),
                                                     Vector((sx * (w / 2 + 0.03), 0, h * 0.5)),
                                                     Vector((sx * (w / 2 + 0.012), 0.04, h * 0.62))], 0.005, material=iron)
        parts.append(ring)
    # the lid, pivoting on the back top edge
    hinge = kit.link(bpy.data.objects.new(name + "_hinge", None))
    hinge.location = (0, d / 2, h)
    lid = kit.box(name + "_lid", (w + 0.01, d + 0.01, 0.03), loc=(0, -d / 2, 0.015), material=wood, bevel=0.004)
    lid.parent = hinge
    for k, x in enumerate(band_x):
        b = kit.box(f"{name}_lidband{k}", (0.03, d + 0.016, 0.036), loc=(x, -d / 2, 0.015), material=iron, bevel=0.003)
        b.parent = hinge
    if hasp:
        hp_ = kit.box(name + "_hasp", (0.05, 0.01, 0.07), loc=(0, -d - 0.008, -0.02), material=iron, bevel=0.002)
        hp_.parent = hinge
    hinge.rotation_euler = (-lid_open, 0, 0)   # negative about X swings the front edge up and over to the back
    parts.append(hinge)
    for p in parts:
        p.parent = root
    root["inner"] = (w - 2 * t, d - 2 * t, h - t)
    return root


def table(name, size=(2.0, 0.85), top_z=0.74, material=None):
    """A trestle writing table: a thick top on two splayed trestles joined by a stretcher. Origin at the
    floor under the middle; long side along X."""
    wd = material or mat("wood")
    w, d = size
    root = kit.link(bpy.data.objects.new(name, None))
    parts = [kit.box(name + "_top", (w, d, 0.05), loc=(0, 0, top_z - 0.025), material=wd, bevel=0.008)]
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.25)
        for sy in (-1, 1):
            leg = kit.box(f"{name}_leg{sx}{sy}", (0.07, 0.07, top_z * 1.04), loc=(x, sy * d * 0.26, top_z / 2 - 0.03),
                          rot=(sy * 0.16, 0, 0), material=wd, bevel=0.006)
            parts.append(leg)
        parts.append(kit.box(f"{name}_trestle{sx}", (0.08, d * 0.85, 0.08), loc=(x, 0, top_z - 0.09), material=wd, bevel=0.006))
        parts.append(kit.box(f"{name}_foot{sx}", (0.09, d * 0.9, 0.07), loc=(x, 0, 0.035), material=wd, bevel=0.006))
    parts.append(kit.box(name + "_stretcher", (w - 0.5, 0.06, 0.08), loc=(0, 0, 0.32), material=wd, bevel=0.006))
    for p in parts:
        p.parent = root
    return root


def stool(name, top_z, material=None):
    wd = material or mat("wood")
    root = kit.link(bpy.data.objects.new(name, None))
    parts = [kit.box(name + "_seat", (0.4, 0.32, 0.045), loc=(0, 0, top_z - 0.0225), material=wd, bevel=0.008)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(kit.box(f"{name}_leg{sx}{sy}", (0.045, 0.045, top_z), loc=(sx * 0.15, sy * 0.11, top_z / 2 - 0.02),
                                 rot=(sy * 0.08, -sx * 0.08, 0), material=wd))
    for p in parts:
        p.parent = root
    return root


def register(name, page_img_l, page_img_r, page=(0.30, 0.40), thick=0.05):
    """The company's register lying open: two page blocks curving up from the spine, a cover board under
    each, the spine between. Origin at the spine on the table; pages toward ±X, top edge toward +Y."""
    pw, ph = page
    root = kit.link(bpy.data.objects.new(name, None))
    cover = mat("clay_dim", "#5d5850")
    parts = []
    for side, img in ((-1, page_img_l), (1, page_img_r)):
        board = kit.box(f"{name}_board{side}", (pw + 0.012, ph + 0.016, 0.006), loc=(side * (pw / 2 + 0.006), 0, 0.003),
                        material=cover, bevel=0.002)
        parts.append(board)
        # the block of pages: thick at the spine, a curved top surface
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        nx, ny = 30, 20
        vs, vb = {}, {}
        for j in range(ny + 1):
            for i in range(nx + 1):
                s, t = i / nx, j / ny
                x = side * s * pw
                z = 0.006 + thick * (0.25 + 0.75 * (1 - s) ** 3) * (0.55 + 0.45 * math.cos(s * math.pi / 2)) + 0.006 * math.sin(s * math.pi)
                if s < 0.06:
                    z -= (0.06 - s) / 0.06 * thick * 0.45     # the page dips into the gutter
                vs[i, j] = bm.verts.new((x, (t - 0.5) * ph, z))
                vb[i, j] = bm.verts.new((x, (t - 0.5) * ph, 0.007))
        for j in range(ny):
            for i in range(nx):
                ij = ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
                if side < 0:
                    ij = ij[::-1]
                f = bm.faces.new([vs[k] for k in ij])
                for lp, (i_, j_) in zip(f.loops, ij):
                    s = i_ / nx
                    lp[uv].uv = (s if side > 0 else 1 - s, j_ / ny)
        # the edges of the page block
        for j in range(ny):
            q = (vb[nx, j], vb[nx, j + 1], vs[nx, j + 1], vs[nx, j])
            bm.faces.new(q if side > 0 else q[::-1])
        for jj, flip in ((0, side < 0), (ny, side > 0)):
            for i in range(nx):
                q = (vb[i, jj], vs[i, jj], vs[i + 1, jj], vb[i + 1, jj])
                bm.faces.new(q[::-1] if flip else q)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = kit.from_bmesh(f"{name}_pages{side}", bm, _paper_mat(f"{name}_paper{side}", img))
        parts.append(ob)
    parts.append(kit.cyl(name + "_spine", 0.012, ph + 0.016, loc=(0, 0, 0.004), rot=(math.pi / 2, 0, 0), material=cover, segs=12))
    for p in parts:
        p.parent = root
    return root


def inkwell(name, loc):
    root = kit.link(bpy.data.objects.new(name, None))
    pot = kit.cyl(name + "_pot", 0.035, 0.05, loc=(0, 0, 0.025), r2=0.026, material=mat("clay_dim", "#6b665d"), segs=24,
                  bevel=0.004)
    ink = kit.cyl(name + "_ink", 0.016, 0.004, loc=(0, 0, 0.049), material=mat("ink"), segs=16)
    for p in (pot, ink):
        p.parent = root
    root.location = loc
    return root


def quill(name, base, direction, length=0.27, material=None):
    """A goose quill: a thin shaft with a long vane along its upper two thirds, gently curved."""
    m = material or mat("paper")
    direction = Vector(direction).normalized()
    side = direction.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(direction).normalized()
    bm = bmesh.new()
    n = 24
    rows = []
    for k in range(n + 1):
        t = k / n
        c = Vector(base) + direction * (t * length) + up * (0.025 * t * t)
        vw = 0.0 if t < 0.3 else 0.012 * math.sin(math.pi * (t - 0.3) / 0.7) ** 0.6 + 0.002
        rows.append([bm.verts.new(c - side * vw * 0.4), bm.verts.new(c + side * vw)])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    ob = kit.from_bmesh(name, bm, m)
    ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.0015
    shaft = kit.curve_tube(name + "_shaft", [Vector(base) + direction * (t * length) + up * (0.025 * t * t) for t in (0, 0.5, 1.0)],
                           0.0022, material=m)
    shaft.parent = ob
    return ob


def purse(name, loc, size=0.07, material=None):
    """A leather money purse tied at the neck."""
    m = material or mat("clay_dim", "#77726a")
    bag = kit.lumpy(name, size, loc=loc, scale=(1.0, 0.9, 0.85), material=m, amp=0.18, freq=1.8, subdiv=4, seed=8)
    neck = kit.cyl(name + "_neck", size * 0.28, size * 0.5, loc=(0, 0, size * 0.85), material=m, segs=12, r2=size * 0.4)
    neck.parent = bag
    return bag


def barrel(name, loc, r=0.26, h=0.72):
    """A barrel with hoops."""
    bm = bmesh.new()
    segs, rings_n = 32, 12
    rings = []
    for k in range(rings_n + 1):
        t = k / rings_n
        rr = r * (0.84 + 0.16 * math.sin(math.pi * t))
        rings.append([bm.verts.new((rr * math.cos(i / segs * math.tau), rr * math.sin(i / segs * math.tau), t * h)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bm.faces.new(rings[-1])
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.from_bmesh(name, bm, mat("wood"))
    for k, t in enumerate((0.1, 0.3, 0.7, 0.9)):
        rr = r * (0.84 + 0.16 * math.sin(math.pi * t)) + 0.004
        hoop = kit.cyl(f"{name}_hoop{k}", rr, 0.03, loc=(0, 0, t * h), material=iron_mat(), segs=32)
        hoop.parent = ob
    return kit.place(ob, loc)


def post(name, loc, r=0.13, h=0.75):
    """A wooden mooring post with a rounded, rope-worn head."""
    m = mat("wood")
    p = kit.cyl(name, r, h, loc=(loc[0], loc[1], loc[2] + h / 2), material=m, segs=20, r2=r * 0.92, bevel=0.02)
    cap = kit.sphere(name + "_cap", r * 0.95, loc=(0, 0, h / 2), scale=(1, 1, 0.55), material=m)
    cap.parent = p
    return p


def rope_coil(name, loc, r=0.2, turns=5, thick=0.018):
    pts = []
    for k in range(turns * 40):
        t = k / 40
        a = t * math.tau
        rr = r - 0.022 * t
        pts.append(Vector((loc[0] + rr * math.cos(a), loc[1] + rr * math.sin(a), loc[2] + thick + 0.012 * (t % 1 < 0.5) * 0)))
    return kit.curve_tube(name, pts, thick, material=mat("clay_dim", "#77726a"))


def quay(name, x0, x1, y0, y_edge, water_z):
    """The quay: a paved top (big flags in a brick-bond pattern, as bump only), a stone wall down to the
    water with a timber capping, and fender piles in front of it."""
    stone = mat("ground").copy()
    stone.name = "quay_stone"
    nt = stone.node_tree
    b = nt.nodes["Principled BSDF"]
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.012
    br.inputs["Brick Width"].default_value = 0.9
    br.inputs["Row Height"].default_value = 0.6
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], br.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.01
    nt.links.new(br.outputs["Fac"], bump.inputs["Height"])
    old = [lk_ for lk_ in nt.links if lk_.to_socket == b.inputs["Normal"]]
    for lk_ in old:
        nt.links.remove(lk_)
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    depth = 0 - water_z + 0.6
    top = kit.box(name, (x1 - x0, y_edge - y0, depth), loc=((x0 + x1) / 2, (y0 + y_edge) / 2, -depth / 2), material=stone)
    cap = kit.box(name + "_cap", (x1 - x0, 0.3, 0.16), loc=((x0 + x1) / 2, y_edge - 0.12, 0.02), material=mat("wood"), bevel=0.01)
    piles = []
    x = x0 + 0.5
    k = 0
    while x < x1 - 0.3:
        piles.append(kit.cyl(f"{name}_pile{k}", 0.11, depth + 0.2, loc=(x, y_edge + 0.1, -depth / 2 + 0.05), material=mat("wood"),
                             segs=12))
        x += 1.6
        k += 1
    return top, cap, piles
