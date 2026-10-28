"""Props for the silver scene (Kanesh, 20th to 19th century BCE), all built from code.

What each prop is based on (sources in README.md):
- the balance: a beam with two pans hung from its ends, held up by a cord (the earliest Near Eastern
  balance; Kultepe sealings show a seated figure holding one);
- the weights: polished hematite, ovoid with a flattened base, like the dated hematite weights from
  Ebla and Larsa (hematite and rock-crystal weights are documented at Kultepe, their shapes not checked);
- the silver: plain cast lumps, because the shape this silver was traded in is not known;
- tablets: pillow-shaped, 4.6 cm across like the Met's loan tablet, written in rows of wedges; the
  envelope is a clay case round it with a rolled seal band;
- the archive: tablets kept in jars, a wooden chest and a reed basket, as found in the merchants' houses.
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

import kit
from kit import mat

# ------------------------------------------------------------------------------------------- materials


def hematite():
    """Polished hematite: near black with a steel-grey sheen."""
    key = ("hematite", None)
    if key in kit._STATE["mats"]:
        return kit._STATE["mats"][key]
    m, nt, b = kit._principled("hematite")
    b.inputs["Base Color"].default_value = kit.rgba("#2e2d2f")
    b.inputs["Metallic"].default_value = 0.55
    b.inputs["Roughness"].default_value = 0.32
    kit._bump(nt, b, scale=90.0, strength=0.04, distance=0.001)
    kit._STATE["mats"][key] = m
    return m


def silver_cast():
    """Cast silver, a little tarnished in the hollows: the kit's silver with a rougher, uneven skin."""
    key = ("silver_cast", None)
    if key in kit._STATE["mats"]:
        return kit._STATE["mats"][key]
    m, nt, b = kit._principled("silver_cast")
    b.inputs["Base Color"].default_value = (*kit.SILVER, 1.0)
    b.inputs["Metallic"].default_value = 1.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 140.0
    nz.inputs["Detail"].default_value = 8.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = 0.2
    ramp.inputs["To Max"].default_value = 0.4
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Value"])
    nt.links.new(ramp.outputs["Result"], b.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.45
    bump.inputs["Distance"].default_value = 0.0012
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    kit._STATE["mats"][key] = m
    return m


def timber():
    """Wood for beams and furniture: darker than the look's default wood, so the statues stay the
    brightest things in the room after the money."""
    lk = kit.look()
    return mat("wood", "#5f5b54" if lk["key_name"] == "a" else "#6a4a2e")


def metal_dim():
    """The balance's bronze: in LEDGER a dim clay so only the money is metal; bronze in the warm look."""
    return mat("bronze") if kit.look()["key_name"] == "b" else mat("clay_dim", "#6f6a62")


# ------------------------------------------------------------------------------------------- script

def _cuneiform(size=1024, lines=13, seed=1, band=None):
    """Height map of a written clay face: rows of wedges (a triangular head pressed deep, a tail drawn
    out shallower), between ruled lines. band=(y0, y1) leaves that strip of rows empty (for a seal).
    Values 1 = untouched surface, lower = pressed in. Each wedge is stamped in its own small window."""
    rnd = random.Random(seed)
    h = np.ones((size, size), np.float32)
    row_h = size / (lines + 0.6)

    def win(x0, x1, y0, y1):
        x0, y0 = max(int(x0) - 1, 0), max(int(y0) - 1, 0)
        x1, y1 = min(int(x1) + 2, size), min(int(y1) + 2, size)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        return (slice(y0, y1), slice(x0, x1)), xx, yy

    ys = np.arange(size, dtype=np.float32)[:, None]
    for r in range(lines):
        cy = (r + 0.8) * row_h
        if band and band[0] * size < cy < band[1] * size:
            continue
        # ruled line under the row
        ly = cy + row_h * 0.45
        h[:, int(size * 0.04):int(size * 0.96)] -= 0.3 * np.exp(-((ys - ly) / 1.4) ** 2)
        x = size * 0.06 + rnd.uniform(0, 8)
        while x < size * 0.92:
            kind = rnd.random()
            if kind < 0.6:      # horizontal wedge: head on the left, tail drawn out to the right
                L = rnd.uniform(0.4, 1.0) * row_h
                head = row_h * 0.16
                sl, xx, yy = win(x, x + L, cy - head - 1, cy + head + 1)
                t = np.clip((xx - x) / L, 0, 1)
                w = head * (1 - t) + 1.0
                m = (xx >= x) & (xx <= x + L) & (np.abs(yy - cy) <= w)
                depth = 0.75 * (1 - 0.65 * t)
                prof = np.clip(1 - np.abs(yy - cy) / (w + 1e-3), 0, 1) ** 0.5
                h[sl] = np.where(m, np.minimum(h[sl], 1 - depth * prof), h[sl])
                x += L + rnd.uniform(0.15, 0.45) * row_h
            elif kind < 0.85:   # vertical wedge: head on top
                L = rnd.uniform(0.55, 0.85) * row_h
                head = row_h * 0.13
                top = cy - L * 0.5
                sl, xx, yy = win(x - head - 1, x + head + 1, top, top + L)
                t = np.clip((yy - top) / L, 0, 1)
                w = head * (1 - t) + 1.0
                m = (yy >= top) & (yy <= top + L) & (np.abs(xx - x) <= w)
                depth = 0.75 * (1 - 0.65 * t)
                prof = np.clip(1 - np.abs(xx - x) / (w + 1e-3), 0, 1) ** 0.5
                h[sl] = np.where(m, np.minimum(h[sl], 1 - depth * prof), h[sl])
                x += head * 2 + rnd.uniform(0.15, 0.4) * row_h
            else:               # Winkelhaken: the stylus corner pressed in at a slant, a '<'
                r0 = row_h * 0.26
                sl, xx, yy = win(x, x + r0, cy - r0, cy + r0)
                u = (xx - x) / r0
                v = np.abs(yy - cy) / r0
                m = (u >= 0) & (u <= 1) & (v <= u * 0.8)
                h[sl] = np.where(m, np.minimum(h[sl], 1 - 0.7 * np.clip(1 - u, 0, 1) ** 0.6), h[sl])
                x += r0 * 1.4 + rnd.uniform(0.2, 0.5) * row_h
            if rnd.random() < 0.06:
                x += row_h * 0.8   # a word gap
    return h


def _seal_band(size=1024, y0=0.4, y1=0.62, seed=3):
    """A cylinder seal rolled across the clay: the roll presses a flat band, and the seal's cut design
    comes out raised in it. Kept to a row of standing robed figures and small fillers, not a readable
    scene: no original seal was traced, so no specific design is claimed."""
    rnd = random.Random(seed)
    h = np.ones((size, size), np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    a, b = y0 * size, y1 * size
    hgt = b - a
    inside = (yy > a) & (yy < b)
    floor, top = 0.8, 0.93
    h = np.where(inside, floor, h)

    def raise_(mask_d):
        # mask_d: signed distance-ish (positive inside); crisp edge over ~1.5 px
        return np.clip(mask_d / 3.0, 0, 1)

    relief = np.zeros_like(h)
    x = size * 0.03
    while x < size:
        hw = rnd.uniform(0.07, 0.09) * hgt              # half width at the shoulders
        head_c, head_r = a + hgt * 0.22, hgt * 0.075
        relief = np.maximum(relief, raise_(head_r - np.hypot(xx - x, yy - head_c)))
        y_sh, y_ft = head_c + head_r * 1.2, b - hgt * 0.08
        t = np.clip((yy - y_sh) / (y_ft - y_sh), 0, 1)
        bw = hw * (0.8 + 0.7 * t)                         # a long robe flaring to the hem
        body = (yy >= y_sh) & (yy <= y_ft)
        relief = np.maximum(relief, raise_(np.where(body, bw - np.abs(xx - x), -9)))
        # forearms held forward at the waist
        arm = (np.abs(yy - (y_sh + hgt * 0.12)) < hgt * 0.025) & (xx > x) & (xx < x + hw * 2.0)
        relief = np.maximum(relief, arm.astype(np.float32))
        x += rnd.uniform(0.34, 0.42) * hgt
        if rnd.random() < 0.6:   # a filler: a small disc or a short upright
            cy = a + hgt * rnd.uniform(0.25, 0.55)
            r0 = hgt * 0.045
            relief = np.maximum(relief, raise_(r0 - np.hypot(xx - x, yy - cy)))
            x += hgt * 0.16
    h = np.where(inside, floor + (top - floor) * relief, h)
    # the rolled edges: a slight ridge where the seal's ends pushed clay aside
    for e in (a, b):
        h += 0.05 * np.exp(-((yy - e) / 2.0) ** 2)
    return h


_IMAGES = {}


def _image(name, arr):
    if name in _IMAGES:
        return _IMAGES[name]
    size = arr.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    rgba = np.dstack([arr, arr, arr, np.ones_like(arr)])[::-1]  # Blender stores rows bottom-up
    img.pixels[:] = rgba.ravel()
    img.pack()
    img.colorspace_settings.name = "Non-Color"
    _IMAGES[name] = img
    return img


def clay_written(name, height_img, tone=None, depth=0.0012):
    """A clay material whose face carries the written height map (box-projected over the object's
    bounds, so every face gets the script). Tablet clay is a shade darker than the statues, so a tablet
    reads in a white hand."""
    lk = kit.look()
    m, nt, b = kit._principled(name)
    base = tone or ("#a49e93" if lk["key_name"] == "a" else "#9c8063")
    b.inputs["Base Color"].default_value = kit.rgba(base)
    b.inputs["Roughness"].default_value = 0.85
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = height_img
    tex.projection = "BOX"
    tex.projection_blend = 0.05
    tex.extension = "EXTEND"
    mp = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = depth
    nt.links.new(tex.outputs["Color"], bump.inputs["Height"])
    # pressed wedges catch a little shadow-dirt: darken by depth
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = kit.rgba(base)
    dark = [c * 0.55 for c in kit.lin(base)]
    mix.inputs["B"].default_value = (*dark, 1.0)
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], inv.inputs[1])
    nt.links.new(inv.outputs[0], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 400.0
    nt.links.new(tc.outputs["Object"], fine.inputs["Vector"])
    bump2 = nt.nodes.new("ShaderNodeBump")
    bump2.inputs["Strength"].default_value = 0.15
    bump2.inputs["Distance"].default_value = 0.0004
    nt.links.new(fine.outputs["Fac"], bump2.inputs["Height"])
    nt.links.new(bump2.outputs["Normal"], bump.inputs["Normal"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


# ------------------------------------------------------------------------------------------- shapes

def pillow(name, size, puff=0.25, material=None, seed=0, wobble=0.04):
    """A rounded clay slab: a subdivided box whose faces bulge (the way a hand-pressed tablet does)."""
    w, d, t = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in bm.verts:
        p = v.co * 2.0   # -1..1
        # superellipsoid-like rounding: pull the corners in, puff the faces out
        r = Vector((p.x, p.y, p.z))
        ax, ay, az = abs(r.x), abs(r.y), abs(r.z)
        k = 1.0 - 0.18 * (ax * ay + ay * az + az * ax) / 3.0
        z_puff = 1.0 + puff * (1 - ax ** 2) * (1 - ay ** 2)
        n = noise.noise(r * 1.3 + off) * wobble
        v.co = Vector((r.x * w / 2 * k * (1 + n), r.y * d / 2 * k * (1 + n), r.z * t / 2 * k * z_puff))
    ob = kit.from_bmesh(name, bm, material)
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 2
    return ob


def tablet(name, loc=(0, 0, 0), rot=(0, 0, 0), size=(0.046, 0.046, 0.016), seed=1, material=None):
    m = material or clay_written(f"script{seed % 3}", _image(f"cuneiform{seed % 3}", _cuneiform(seed=seed % 3)))
    ob = pillow(name, size, puff=0.12, material=m, seed=seed)
    return kit.place(ob, loc, rot)


def envelope(name, loc=(0, 0, 0), rot=(0, 0, 0), size=(0.064, 0.052, 0.027), seed=4):
    """The loan's clay case: names written on it, and a seal rolled across it."""
    arr = np.minimum(_cuneiform(seed=11, lines=12, band=(0.34, 0.68)), _seal_band(y0=0.36, y1=0.66, seed=seed))
    m = clay_written("envelope_clay", _image("envelope_h", arr), tone="#9a9489" if kit.look()["key_name"] == "a" else None,
                     depth=0.0016)
    ob = pillow(name, size, puff=0.16, material=m, seed=seed, wobble=0.07)
    return kit.place(ob, loc, rot)


def silver_piece(name, loc, size, seed, flat=0.42):
    """A lump of cast silver: an irregular cake, flat underneath and domed on top, its outline lobed
    where the metal ran, its skin pitted."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1.0)
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    lobes = [rnd.uniform(0, math.tau) for _ in range(3)]
    stretch = rnd.uniform(1.0, 1.6)
    for v in bm.verts:
        x, y, z = v.co
        a = math.atan2(y, x)
        r = 1.0 + 0.16 * math.sin(2 * a + lobes[0]) + 0.1 * math.sin(3 * a + lobes[1]) + 0.06 * math.sin(5 * a + lobes[2])
        r += 0.08 * noise.noise(Vector((math.cos(a), math.sin(a), 0)) * 2.0 + off)
        zz = z * (flat if z > 0 else flat * 0.35)
        p = Vector((x * r * stretch, y * r, zz))
        p += Vector((0, 0, 1)) * 0.04 * noise.noise(p * 3.0 + off) * (1 if z > -0.3 else 0.3)
        v.co = p * size
    ob = kit.from_bmesh(name, bm, silver_cast())
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    kit.place(ob, (loc[0], loc[1], loc[2] - size * flat * 0.5), (rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08),
                                                                  rnd.uniform(0, math.tau)))
    return ob


def silver_heap(name, center, top_z, n=14, spread=0.045, seed=2, size=(0.008, 0.016)):
    """Pieces of silver lying on a surface at top_z, the larger ones underneath."""
    rnd = random.Random(seed)
    obs = []
    placed = []
    for i in range(n):
        s = rnd.uniform(*size)
        for _try in range(30):
            a, r = rnd.uniform(0, math.tau), spread * math.sqrt(rnd.random())
            p = Vector((center[0] + r * math.cos(a), center[1] + r * math.sin(a)))
            # stack: rest on the highest piece below within reach
            z = top_z
            ok = True
            for (q, qs, qz) in placed:
                dd = (p - q).length
                if dd < (s + qs) * 0.55:
                    ok = False
                    break
                if dd < (s + qs) * 1.0:
                    z = max(z, qz + qs * 0.45)
            if ok:
                break
        placed.append((p, s, z))
        obs.append(silver_piece(f"{name}{i}", (p.x, p.y, z + s * 0.36), s, seed * 31 + i))
    return obs


def weight(name, loc, length, rot_z=0.0):
    """A hematite weight: ovoid with a flattened base and flattened short ends."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.5)
    for v in bm.verts:
        x, y, z = v.co
        z = max(z, -0.32)          # flat base
        x = max(min(x, 0.47), -0.47)   # flattened short ends
        v.co = Vector((x * length, y * length * 0.48, (z + 0.32) * length * 0.5))
    ob = kit.from_bmesh(name, bm, hematite())
    return kit.place(ob, loc, (0, 0, rot_z))


def balance(name, grip, axis, cord=0.10, half=0.17, drop=0.17, tilt=0.0):
    """The hand balance hanging from a fist at `grip`: a cord down to the beam's middle, a beam along
    `axis` (horizontal), and from each end three cords to a shallow pan. Returns the root and the
    centre of each pan's floor (end -1, end +1)."""
    m = metal_dim()
    root = kit.link(bpy.data.objects.new(name, None))
    ax = Vector((axis[0], axis[1], 0)).normalized()
    up = Vector((0, 0, 1))
    c = Vector(grip) - up * cord
    side = ax.cross(up)
    pieces = []
    pieces.append(kit.curve_tube(name + "_cord", [Vector(grip) + up * 0.01, c + up * 0.004], 0.0022, material=m))
    beam_dir = (ax * math.cos(tilt) + up * math.sin(tilt)).normalized()
    ends = [c - beam_dir * half, c + beam_dir * half]
    # a beam swelling a little to the middle, with a small loop at the middle and each end
    pts = [c - beam_dir * half * (1 - k / 20.0 * 2) for k in range(21)]
    beam = kit.curve_tube(name + "_beam", pts, 0.0055, material=m)
    beam.data.bevel_resolution = 4
    pieces.append(beam)
    for e in ends + [c]:
        ring = bpy.data.curves.new(name + "_ring", "CURVE")
        ring.dimensions = "3D"
        ring.bevel_depth = 0.0012
        sp = ring.splines.new("POLY")
        sp.points.add(11)
        for i, p in enumerate(sp.points):
            a = i / 12 * math.tau
            q = e + (up * math.cos(a) + beam_dir * math.sin(a)) * 0.006 + up * (0.006 if e is c else -0.006)
            p.co = (*q, 1)
        sp.use_cyclic_u = True
        ring.materials.append(m)
        pieces.append(kit.link(bpy.data.objects.new(name + "_ring", ring)))
    pans = []
    for k, e in enumerate(ends):
        hook = e - up * 0.012
        rim = hook - up * drop
        pan = kit.cyl(f"{name}_pan{k}", 0.066, 0.014, loc=rim - up * 0.007, material=m, r2=0.076, bevel=0.002,
                      segs=48)
        # dish it: lower the centre of the bottom face a little
        pieces.append(pan)
        for j in range(3):
            a = j / 3 * math.tau + 0.3
            q = rim + (ax * math.cos(a) + side * math.sin(a)) * 0.072
            pieces.append(kit.curve_tube(f"{name}_c{k}{j}", [q, hook], 0.0011, material=m))
        pans.append(rim - up * 0.009)
    for p in pieces:
        p.parent = root
    return root, pans


def jar(name, loc, h=0.55, r=0.2, neck=0.55, material=None, seed=0, mouth=None):
    """A storage jar thrown on a wheel: a flat foot, a full shoulder, a short neck and a rolled rim."""
    mouth = mouth or r * neck
    prof = [(0.0, 0.0), (r * 0.42, 0.0), (r * 0.5, h * 0.03), (r * 0.82, h * 0.22), (r, h * 0.5),
            (r * 0.93, h * 0.68), (r * 0.72, h * 0.83), (mouth * 0.95, h * 0.92), (mouth, h * 0.97),
            (mouth * 1.12, h * 0.99), (mouth * 1.16, h * 1.02), (mouth * 1.06, h * 1.045), (mouth * 0.92, h * 1.03),
            (mouth * 0.9, h * 0.93)]
    segs = 48
    bm = bmesh.new()
    rings = []
    rnd = random.Random(seed)
    lean = rnd.uniform(-0.01, 0.01)
    for (pr, pz) in prof:
        ring = []
        for i in range(segs):
            a = i / segs * math.tau
            wob = 1.0 + 0.01 * noise.noise(Vector((math.cos(a), math.sin(a), pz * 4 + seed)))
            ring.append(bm.verts.new((pr * wob * math.cos(a) + lean * pz, pr * wob * math.sin(a), pz)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bm.faces.new([v for v in reversed(rings[0])])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.from_bmesh(name, bm, material or mat("clay_dim"))
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    ob["mouth_r"] = mouth * 0.9
    ob["mouth_z"] = h * 0.93
    return kit.place(ob, loc)


def tablets_in(name, jar_ob, n=6, seed=0):
    """Tablets standing on edge in a jar's mouth, packed the way an archive jar was filled."""
    rnd = random.Random(seed)
    r = jar_ob["mouth_r"]
    z0 = jar_ob.location.z + jar_ob["mouth_z"] - 0.012
    obs = []
    for i in range(n):
        x = (i - (n - 1) / 2) * (2 * r / (n + 0.5))
        lim = math.sqrt(max(r * r - x * x, 1e-6))
        y = rnd.uniform(-0.3, 0.3) * lim
        t = tablet(f"{name}{i}", loc=(jar_ob.location.x + x, jar_ob.location.y + y, z0),
                   rot=(math.pi / 2 + rnd.uniform(-0.25, 0.25), rnd.uniform(-0.2, 0.2), math.pi / 2 + rnd.uniform(-0.3, 0.3)),
                   size=(0.046 + rnd.uniform(-0.006, 0.01), 0.046 + rnd.uniform(-0.004, 0.012), 0.016), seed=seed + i)
        obs.append(t)
    return obs


def basket(name, loc, r=0.2, h=0.2, stakes=24, rows=13, material=None):
    """A reed basket: upright stakes with weavers passing in front of and behind them, row by row."""
    m = material or timber()
    obs = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=48, radius1=r * 0.9, radius2=r * 0.9, depth=0.012)
    base = kit.from_bmesh(name + "_base", bm, m)
    base.location = (0, 0, 0.006)
    obs.append(base)
    for k in range(rows):
        z = 0.012 + (k + 0.5) * (h - 0.012) / rows
        rr = r * (0.9 + 0.1 * z / h)
        pts = []
        n = stakes * 8
        for i in range(n + 1):
            a = i / n * math.tau
            wave = math.sin(a * stakes / 2 + k * math.pi)
            pts.append(Vector(((rr + 0.003 * wave) * math.cos(a), (rr + 0.003 * wave) * math.sin(a), z)))
        t = kit.curve_tube(f"{name}_w{k}", pts[:-1], (h - 0.012) / rows * 0.55, material=m, closed=True)
        obs.append(t)
    rim = [Vector((r * 1.0 * math.cos(i / 96 * math.tau), r * 1.0 * math.sin(i / 96 * math.tau), h + 0.004))
           for i in range(96)]
    obs.append(kit.curve_tube(name + "_rim", rim, 0.008, material=m, closed=True))
    root = kit.link(bpy.data.objects.new(name, None))
    for o in obs:
        o.parent = root
    root.location = loc
    return root


def bale(name, loc, size=(0.6, 0.42, 0.34), rot_z=0.0, seed=0, material=None):
    """A bale of cloth from the caravan: a wrapped bundle, squared off by its load, the wrapping
    gathered into folds at the ends, tied round with cords that bite into it."""
    from mathutils.bvhtree import BVHTree
    w, d, h = size
    m = material or mat("clay_dim")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=14, use_grid_fill=True)
    off = Vector((seed * 2.1, seed * 1.3, seed * 3.7))
    for v in bm.verts:
        p = v.co * 2
        ax, ay, az = abs(p.x), abs(p.y), abs(p.z)
        k = 1.0 - 0.12 * (ax * ay + ay * az + az * ax) / 3.0
        sag = 1.0 - 0.05 * max(0.0, p.z) * (1 - ax ** 2) * (1 - ay ** 2)
        # the wrapping gathers into radial folds on the two ends
        end = max(0.0, ax - 0.75) / 0.25
        ang = math.atan2(p.z, p.y)
        fold = end * 0.035 * math.sin(7 * ang + seed)
        crease = 1.0 + 0.015 * noise.noise(p * 2.5 + off) + 0.008 * noise.noise(p * 8 + off)
        v.co = Vector((p.x * w / 2 * k * crease, p.y * d / 2 * k * crease * (1 + fold),
                       p.z * h / 2 * k * sag * crease * (1 + fold)))
    tree = BVHTree.FromBMesh(bm)
    ob = kit.from_bmesh(name, bm, m)
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 2
    cord = timber()
    parts = [ob]

    def loop(plane_pt, u, v, n=72):
        pts = []
        for j in range(n):
            a = j / n * math.tau
            dirv = (u * math.cos(a) + v * math.sin(a)).normalized()
            hit, _n, _i, _d = tree.ray_cast(plane_pt + dirv * 2.0, -dirv, 4.0)
            if hit is not None:
                pts.append(hit - dirv * 0.002)
        return pts

    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    for i, fx in enumerate((-0.27, 0.27)):
        parts.append(kit.curve_tube(f"{name}_cord{i}", loop(Vector((fx * w, 0, 0)), Y, Z), 0.007, material=cord,
                                    closed=True))
    parts.append(kit.curve_tube(f"{name}_cordL", loop(Vector((0, 0, 0)), X, Z), 0.007, material=cord, closed=True))
    root = kit.link(bpy.data.objects.new(name + "_root", None))
    for p in parts:
        p.parent = root
        p.location.z += h / 2
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def stool(name, loc, top, size=(0.42, 0.36), rot_z=0.0, material=None):
    m = material or timber()
    w, d = size
    root = kit.link(bpy.data.objects.new(name, None))
    seat = kit.box(name + "_seat", (w, d, 0.05), loc=(0, 0, top - 0.025), material=m, bevel=0.008)
    seat.parent = root
    for i, (x, y) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        leg = kit.cyl(f"{name}_leg{i}", 0.022, top - 0.05, loc=(x * (w / 2 - 0.05), y * (d / 2 - 0.05), (top - 0.05) / 2),
                      material=m, r2=0.018)
        leg.parent = root
    for sy in (-1, 1):
        r = kit.box(f"{name}_rung{sy}", (w - 0.1, 0.02, 0.02), loc=(0, sy * (d / 2 - 0.05), top * 0.3), material=m)
        r.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def table(name, loc, size=(1.3, 0.72, 0.74), rot_z=0.0, material=None):
    """A plain wooden table: a thick plank top on four square legs, with stretchers."""
    m = material or timber()
    w, d, h = size
    root = kit.link(bpy.data.objects.new(name, None))
    parts = [kit.box(name + "_top", (w, d, 0.05), loc=(0, 0, h - 0.025), material=m, bevel=0.01)]
    for k in range(1, 3):
        parts.append(kit.box(f"{name}_gap{k}", (w * 0.998, 0.003, 0.004), loc=(0, -d / 2 + d * k / 3, h + 0.0005),
                             material=mat("rock")))
    for i, (x, y) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        parts.append(kit.box(f"{name}_leg{i}", (0.07, 0.07, h - 0.05), loc=(x * (w / 2 - 0.08), y * (d / 2 - 0.08), (h - 0.05) / 2),
                             material=m, bevel=0.006))
    for sx in (-1, 1):
        parts.append(kit.box(f"{name}_str{sx}", (0.035, d - 0.2, 0.045), loc=(sx * (w / 2 - 0.08), 0, 0.16), material=m))
    for p in parts:
        p.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    root["top"] = h
    return root


# ------------------------------------------------------------------------------------------- walls

def mudbrick_material():
    """Plastered mudbrick: the clay of the room, with brick courses showing faintly through the plaster."""
    key = ("mudbrick", None)
    if key in kit._STATE["mats"]:
        return kit._STATE["mats"][key]
    lk = kit.look()
    tone = "#4a4540" if lk["key_name"] == "a" else "#9a7a5c"
    m, nt, b = kit._principled("mudbrick")
    b.inputs["Base Color"].default_value = kit.rgba(tone)
    b.inputs["Roughness"].default_value = 0.92
    tc = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.5
    br.squash = 1.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.008
    br.inputs["Mortar Smooth"].default_value = 0.8
    br.inputs["Brick Width"].default_value = 0.38
    br.inputs["Row Height"].default_value = 0.10
    br.inputs["Color1"].default_value = (1, 1, 1, 1)
    br.inputs["Color2"].default_value = (0.85, 0.85, 0.85, 1)
    br.inputs["Mortar"].default_value = (0, 0, 0, 1)
    nt.links.new(tc.outputs["Object"], br.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 6.0
    nz.inputs["Detail"].default_value = 10.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    # where the plaster is thick (noise high) the bricks vanish
    mixh = nt.nodes.new("ShaderNodeMath")
    mixh.operation = "MULTIPLY_ADD"
    mixh.inputs[1].default_value = -0.6   # Fac is 1 in the mortar: sink it
    nt.links.new(br.outputs["Fac"], mixh.inputs[0])
    nt.links.new(nz.outputs["Fac"], mixh.inputs[2])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    bump.inputs["Distance"].default_value = 0.01
    nt.links.new(mixh.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    kit._STATE["mats"][key] = m
    return m


def wall(name, start, end, height, thick=0.4, footing=0.5, door=None, beam_z=None, seed=0):
    """A house wall: a footing of rough stones, plastered mudbrick above, and a timber course laid
    into the brickwork. door=(centre along the wall, width, height) cuts a doorway with a timber lintel."""
    s, e = Vector((start[0], start[1], 0.0)), Vector((end[0], end[1], 0.0))
    L = (e - s).length
    ax = (e - s).normalized()
    yaw = math.atan2(ax.y, ax.x)
    root = kit.link(bpy.data.objects.new(name, None))
    parts = []
    stone = mat("rock")
    brick = mudbrick_material()
    wood = mat("wood", "#3f3b36" if kit.look()["key_name"] == "a" else "#5a3c22")
    spans = [(0.0, L)]
    if door:
        c, w, dh = door
        spans = [(0.0, c - w / 2), (c + w / 2, L)]
    rnd = random.Random(seed)
    for a, b in spans:
        if b - a < 0.02:
            continue
        mid = (a + b) / 2
        # stones: two courses of lumps along the footing
        x = a + 0.12
        while x < b - 0.1:
            sz = rnd.uniform(0.13, 0.2)
            for z0 in (footing * 0.27, footing * 0.73):
                parts.append(kit.lumpy(f"{name}_st{len(parts)}", sz, loc=(x + rnd.uniform(-0.03, 0.03), rnd.uniform(-0.02, 0.02), z0),
                                       scale=(1.35, thick / sz / 2.0 * 0.95, footing / sz / 4.2), material=stone,
                                       amp=0.18, freq=1.3, subdiv=3, seed=seed * 101 + len(parts)))
            x += sz * 2.3
        core = kit.box(f"{name}_fcore{a:.2f}", (b - a, thick * 0.8, footing * 0.95), loc=(mid, 0, footing * 0.475),
                       material=stone)
        parts.append(core)
    # the brickwork and its timber course are one piece each, with the doorway cut out, so no seams show
    upper = kit.box(f"{name}_brick", (L, thick, height - footing), loc=(L / 2, 0, footing + (height - footing) / 2),
                    material=brick)
    beams = []
    if beam_z:
        for sy in (-1, 1):
            beams.append(kit.box(f"{name}_beam{sy}", (L, 0.12, 0.13), loc=(L / 2, sy * (thick / 2 - 0.05), beam_z),
                                 material=wood))
    for ob in [upper] + beams:
        if door:
            c, w, dh = door
            cut = kit.box(f"{name}_cut", (w, thick + 0.4, dh + 0.16), loc=(c, 0, (dh + 0.16) / 2 - 0.01))
            mod = ob.modifiers.new("door", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.object = cut
            cut.hide_render = True
            cut.hide_viewport = True
            parts.append(cut)
        bev = ob.modifiers.new("bevel", "BEVEL")
        bev.width = 0.03 if ob is upper else 0.012
        bev.segments = 3
        bev.limit_method = "ANGLE"
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.modifiers.new("wn", "WEIGHTED_NORMAL")
        parts.append(ob)
    if door:
        c, w, dh = door
        parts.append(kit.box(f"{name}_lintel", (w + 0.5, thick + 0.04, 0.16), loc=(c, 0, dh + 0.08), material=wood, bevel=0.012))
        parts.append(kit.box(f"{name}_sill", (w, thick, 0.06), loc=(c, 0, 0.03), material=stone, bevel=0.01))
        for sx in (-1, 1):
            parts.append(kit.box(f"{name}_jamb{sx}", (0.1, thick + 0.02, dh), loc=(c + sx * (w / 2 - 0.05), 0, dh / 2),
                                 material=wood, bevel=0.01))
    for p in parts:
        p.parent = root
    root.location = s
    root.rotation_euler = (0, 0, yaw)
    return root
