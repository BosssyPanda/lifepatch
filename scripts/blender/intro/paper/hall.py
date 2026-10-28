"""The building of the paper money scene: a Song-period office front, open to the street like the shops in
Zhang Zeduan's Along the River during the Qingming Festival, with the counter across its front.

Everything is built from code: a low stone platform, round columns on stone bases, a beam along the column
tops with bracket sets (dougong) on each column, a hip-and-gable roof of tube tiles whose corners lift a
little (Song roofs curve gently; the steep upturn is later), a back wall with vertical-bar windows, side
walls, and the counter. Sizes are in metres; the hall is centred on x = 0, its front row of columns on y = Y0.
"""
import math

import bpy
import bmesh  # noqa: E402  (after bpy)
from mathutils import Vector

import kit
from kit import mat

Y0 = 1.55          # front columns
DEPTH = 1.9        # front to back columns
BAYS = (-2.05, -0.7, 0.7, 2.05)
COL_H = 1.8        # column height above the platform
COL_R = 0.105
PLAT_H = 0.16      # platform height
PLAT_PAD = 0.39    # platform beyond the columns: in front, flush with the counter's panelled front


def tone(hex_str):
    return kit.mat("clay", tone=hex_str)


def platform():
    """The stone platform the hall stands on, with a step down to the street in front."""
    x0, x1 = BAYS[0] - PLAT_PAD, BAYS[-1] + PLAT_PAD
    y0, y1 = Y0 - PLAT_PAD, Y0 + DEPTH + PLAT_PAD
    stone = mat("clay_dim")
    p = kit.box("platform", (x1 - x0, y1 - y0, PLAT_H), loc=((x0 + x1) / 2, (y0 + y1) / 2, PLAT_H / 2),
                material=stone, bevel=0.015)
    # paving joints: shallow slots across the top, one per stone course
    parts = [p]
    return parts


def column(name, x, y):
    base = kit.cyl(name + "_base", COL_R * 1.6, 0.07, loc=(x, y, PLAT_H + 0.035), material=mat("clay_dim"),
                   segs=32, bevel=0.012)
    plinth = kit.box(name + "_plinth", (COL_R * 4.2, COL_R * 4.2, 0.03), loc=(x, y, PLAT_H + 0.005),
                     material=mat("clay_dim"), bevel=0.006)
    shaft = kit.cyl(name, COL_R, COL_H - 0.07, loc=(x, y, PLAT_H + 0.07 + (COL_H - 0.07) / 2), material=mat("wood"),
                    segs=32, r2=COL_R * 0.9)
    return [plinth, base, shaft]


def bracket(name, x, y, z, front=True, s=0.8):
    """One bracket set (dougong) on a column top: a big block, a cross of bracket arms with small blocks
    on their ends, and a second, longer arm. Read from the front it is the stepped block-and-arm cluster
    under the eaves."""
    w = mat("wood")

    def blk(n, size, at):
        return kit.box(name + n, tuple(v * s for v in size), loc=(x + at[0] * s, y + at[1] * s, z + at[2] * s),
                       material=w, bevel=0.01 * s)
    out = -1 if front else 1
    parts = [blk("_ludou", (0.24, 0.24, 0.13), (0, 0, 0.065))]
    # first arm along the facade, and one crossing it (out toward the eave)
    parts.append(blk("_gong1", (0.62, 0.085, 0.1), (0, 0, 0.18)))
    parts.append(blk("_ang1", (0.085, 0.6, 0.1), (0, out * 0.12, 0.18)))
    for dx in (-0.27, 0.0, 0.27):
        parts.append(blk(f"_dou{dx}", (0.13, 0.13, 0.075), (dx, 0, 0.2675)))
    parts.append(blk("_gong2", (0.95, 0.085, 0.1), (0, 0, 0.355)))
    for dx in (-0.43, 0.43):
        parts.append(blk(f"_dou2{dx}", (0.13, 0.13, 0.075), (dx, 0, 0.4425)))
    return parts, z + 0.48 * s


def frame():
    """Columns, the beam over each row, and a bracket set on every column top. Returns (objects, eave z)."""
    objs = []
    top = PLAT_H + COL_H
    for row, y in (("f", Y0), ("b", Y0 + DEPTH)):
        for i, x in enumerate(BAYS):
            objs += column(f"col{row}{i}", x, y)
        span = BAYS[-1] - BAYS[0] + 0.5
        objs.append(kit.box(f"beam{row}", (span, 0.13, 0.2), loc=(0, y, top - 0.1), material=mat("wood"), bevel=0.01))
        objs.append(kit.box(f"plate{row}", (span, 0.2, 0.06), loc=(0, y, top + 0.03), material=mat("wood"), bevel=0.008))
    z_eave = top
    for row, y in (("f", Y0), ("b", Y0 + DEPTH)):
        for i, x in enumerate(BAYS):
            parts, z_top = bracket(f"br{row}{i}", x, y, top + 0.06, front=row == "f")
            objs += parts
            z_eave = z_top
        # one more set in the middle of each bay (Song halls carry intermediate sets)
        for i in range(len(BAYS) - 1):
            parts, _ = bracket(f"bm{row}{i}", (BAYS[i] + BAYS[i + 1]) / 2, y, top + 0.06, front=row == "f")
            objs += parts
    # the eave purlin the rafters rest on, along each row's bracket tops
    for row, y in (("f", Y0), ("b", Y0 + DEPTH)):
        objs.append(kit.box(f"purlin{row}", (BAYS[-1] - BAYS[0] + 1.3, 0.16, 0.12),
                            loc=(0, y, z_eave + 0.06), material=mat("wood"), bevel=0.01))
    return objs, z_eave + 0.12


def roof(z0, overhang=0.95, rise=1.05, gable_at=0.62, tile_pitch=0.19, lift=0.22, res=0.03):
    """Hip-and-gable roof as a height field over its footprint, with tube tiles as ridges running down the
    slope, round tile ends along the eaves, a main ridge and two raised ridge ends.

    z(x, y) = min(P(dy), P(dx)) on the hipped lower part, where dy and dx are the distances in from the
    front/back and side eaves and P is a concave profile (Song roofs sag toward the eave). Above the
    gable height the side slopes stop and the two main slopes carry on to the ridge, which leaves a
    triangular gable at each end. Near each corner the eave lifts a little."""
    x0, x1 = BAYS[0] - overhang, BAYS[-1] + overhang
    y0, y1 = Y0 - overhang, Y0 + DEPTH + overhang
    W, D = x1 - x0, y1 - y0
    half_d = D / 2

    def P(d):
        t = min(max(d / half_d, 0.0), 1.0)
        return rise * (t ** 1.45)            # concave: flatter at the eave, steeper toward the ridge

    h_gable = rise * gable_at
    # the side slope reaches the gable height at this distance in from the side eave
    dx_g = half_d * (gable_at ** (1 / 1.45))

    nx = int(W / res)
    ny = int(D / res)
    xs = [x0 + W * i / nx for i in range(nx + 1)]
    ys = [y0 + D * j / ny for j in range(ny + 1)]
    # make sure the gable step falls exactly on a grid column at each end
    for xg in (x0 + dx_g, x1 - dx_g):
        k = min(range(len(xs)), key=lambda i: abs(xs[i] - xg))
        xs[k] = xg
    bm = bmesh.new()
    V = {}
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            dy = min(y - y0, y1 - y)
            dx = min(x - x0, x1 - x)
            main = P(dy)
            z = min(main, P(dx)) if dx < dx_g - 1e-6 else main
            if dx < dx_g - 1e-6 and P(dx) < main and abs(dx - (dx_g - 1e-6)) < res * 0.5:
                z = min(main, h_gable)
            # which slope this point is on, for the tile ridges (they run down the slope)
            on_side = dx < dx_g and P(dx) < main
            s = (y - y0) if on_side else (x - x0)
            ridge = 0.5 - 0.5 * math.cos(2 * math.pi * s / tile_pitch)
            amp = 0.045 * min(1.0, (min(dx, dy) + 0.02) / 0.12)
            z += amp * ridge ** 0.6
            # corner lift: strongest at the corner, fading along the eave and up the slope
            for cx, cy in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
                c = math.hypot(x - cx, y - cy)
                z += lift * max(0.0, 1.0 - c / 1.9) ** 2.6
            V[i, j] = bm.verts.new((x, y, z0 + z))
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((V[i, j], V[i + 1, j], V[i + 1, j + 1], V[i, j + 1]))
    roof_ob = kit.from_bmesh("roof", bm, tone("#5d5852"))
    so = roof_ob.modifiers.new("thick", "SOLIDIFY")
    so.thickness, so.offset = 0.09, -1.0
    objs = [roof_ob]

    # round tile ends along the front and back eaves, and the side eaves of the hipped part
    def eave_z(x, y):
        dy = min(y - y0, y1 - y)
        dx = min(x - x0, x1 - x)
        z = min(P(dy), P(dx))
        for cx, cy in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
            z += lift * max(0.0, 1.0 - math.hypot(x - cx, y - cy) / 1.9) ** 2.6
        return z0 + z

    ends = []
    n = int(W / tile_pitch)
    for k in range(n):
        x = x0 + (k + 0.5) * W / n
        for y, sgn in ((y0, -1), (y1, 1)):
            ends.append(kit.cyl(f"tileend{k}{sgn}", 0.05, 0.03, loc=(x, y + sgn * 0.005, eave_z(x, y) + 0.02),
                                rot=(math.pi / 2, 0, 0), material=tone("#5d5852"), segs=16))
    objs += ends

    # main ridge along the gable part, with a raised end at each gable
    rz = z0 + rise + 0.045
    rl = W - 2 * dx_g + 0.25
    objs.append(kit.box("ridge", (rl, 0.16, 0.2), loc=((x0 + x1) / 2, (y0 + y1) / 2, rz + 0.06),
                        material=tone("#4d4944"), bevel=0.03))
    for sx in (-1, 1):
        # ridge ends: a flat horn that rises and curls back over the ridge (the chiwen of Song roofs, kept
        # plain: no beast's face, only its silhouette)
        xe = (x0 + x1) / 2 + sx * rl / 2 - sx * 0.05
        yc = (y0 + y1) / 2
        pts = [(xe, yc, rz + 0.02), (xe + sx * 0.03, yc, rz + 0.2), (xe, yc, rz + 0.34),
               (xe - sx * 0.1, yc, rz + 0.38), (xe - sx * 0.17, yc, rz + 0.32)]
        objs.append(_horn(f"ridge_end{sx}", pts, 0.1, 0.035, tone("#4d4944"), flat=0.55))
    # the gable faces: flat triangles closing each end above the side slopes
    for sx, xg in ((-1, x0 + dx_g), (1, x1 - dx_g)):
        bm = bmesh.new()
        pts = [Vector((xg, y0 + half_d - half_d * (1 - 0.0), z0 + h_gable))]
        tri = []
        for k in range(17):
            t = k / 16
            y = y0 + D * t
            dy = min(y - y0, y1 - y)
            z = min(P(dy), rise)
            tri.append(bm.verts.new((xg + sx * 0.01, y, z0 + max(z, h_gable))))
        base = [bm.verts.new((xg + sx * 0.01, y0 + D * k / 16, z0 + h_gable)) for k in range(17)]
        for k in range(16):
            if tri[k].co.z - base[k].co.z > 1e-4 or tri[k + 1].co.z - base[k + 1].co.z > 1e-4:
                bm.faces.new((base[k], base[k + 1], tri[k + 1], tri[k]))
        del pts
        g = kit.from_bmesh(f"gable{sx}", bm, mat("clay_dim"))
        g.modifiers.new("thick", "SOLIDIFY").thickness = 0.03
        objs.append(g)
    return objs, (x0, x1, y0, y1)


def _horn(name, pts, r0, r1, material, flat=1.0, segs=16):
    """A tapering tube along pts, squashed across the ridge by `flat`, subdivided smooth."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = Vector((0, 1, 0))
        n = (n - t * n.dot(t)).normalized()
        bn = t.cross(n)
        r = r0 + (r1 - r0) * i / (len(pts) - 1)
        rings.append([bm.verts.new(p + (n * math.cos(a) * flat + bn * math.sin(a)) * r)
                      for a in (k / segs * math.tau for k in range(segs))])
    for i in range(len(pts) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    for ring, c in ((rings[0], pts[0]), (rings[-1], pts[-1])):
        cv = bm.verts.new(c)
        for k in range(segs):
            bm.faces.new((ring[k], ring[(k + 1) % segs], cv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = kit.from_bmesh(name, bm, material)
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 2
    return ob


def back_wall():
    """The back wall: plastered below, vertical-bar windows in every bay above, a dark room behind."""
    y = Y0 + DEPTH
    objs = []
    top = PLAT_H + COL_H - 0.2
    wall_m = mat("clay_dim")
    for i in range(len(BAYS) - 1):
        xa, xb = BAYS[i] + COL_R, BAYS[i + 1] - COL_R
        w = xb - xa
        cx = (xa + xb) / 2
        sill = PLAT_H + 0.95
        objs.append(kit.box(f"wall_lo{i}", (w, 0.12, sill - PLAT_H), loc=(cx, y, (sill + PLAT_H) / 2), material=wall_m))
        # window frame and bars
        fr = mat("wood")
        win_top = top - 0.18
        objs.append(kit.box(f"sill{i}", (w, 0.16, 0.06), loc=(cx, y - 0.01, sill + 0.03), material=fr, bevel=0.006))
        objs.append(kit.box(f"head{i}", (w, 0.16, 0.06), loc=(cx, y - 0.01, win_top), material=fr, bevel=0.006))
        objs.append(kit.box(f"wall_hi{i}", (w, 0.12, top - win_top), loc=(cx, y, (top + win_top) / 2), material=wall_m))
        # the window paper on the inside of the bars, lit by the day outside: it glows
        objs.append(kit.box(f"paper{i}", (w, 0.01, win_top - sill - 0.06), loc=(cx, y + 0.04, (sill + win_top) / 2),
                            material=window_paper()))
        nb = int(w / 0.085)
        for k in range(nb):
            bx = xa + (k + 0.5) * w / nb
            objs.append(kit.box(f"bar{i}_{k}", (0.035, 0.05, win_top - sill - 0.06),
                                loc=(bx, y - 0.02, (sill + win_top) / 2), rot=(0, 0, math.pi / 4), material=fr))
    return objs


def window_paper():
    """Paper pasted inside the window bars with daylight behind it: a soft, even glow."""
    key = "window_paper"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = kit.rgba(kit.look()["paper"])
    # the glow as its own Emission node (not the Principled's), so kit.dim darkens it with the rest of the era
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = kit.rgba(kit.look()["paper"])
    em.inputs["Strength"].default_value = 1.1
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(b.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return m


def side_walls():
    objs = []
    top = PLAT_H + COL_H - 0.2
    for sx, x in ((-1, BAYS[0]), (1, BAYS[-1])):
        objs.append(kit.box(f"side{sx}", (0.12, DEPTH - 2 * COL_R, top - PLAT_H),
                            loc=(x, Y0 + DEPTH / 2, (top + PLAT_H) / 2), material=mat("clay_dim")))
    return objs


def interior_floor():
    """A darker floor inside the hall, so the room behind the counter reads as inside."""
    return [kit.box("room", (BAYS[-1] - BAYS[0], DEPTH, 0.01), loc=(0, Y0 + DEPTH / 2, PLAT_H + 0.005),
                    material=tone("#6f6a63"))]


def counter(x0=-0.54, x1=0.54, depth=0.48, h=0.92, y=None):
    """The counter across the middle bay, at the front edge of the platform: panelled front, an overhanging
    top board. Narrow enough that a customer on the street can reach a note held out across it, and short
    enough to stand clear of the columns. Returns (objects, top z, front y, back y)."""
    y = Y0 - 0.15 if y is None else y      # panelled front 3 cm in from the platform edge, top board 3 cm over it
    w = x1 - x0
    cx = (x0 + x1) / 2
    wd = mat("wood")
    objs = [kit.box("counter_body", (w, depth - 0.06, h - 0.05 - PLAT_H),
                    loc=(cx, y, PLAT_H + (h - 0.05 - PLAT_H) / 2), material=wd, bevel=0.01)]
    objs.append(kit.box("counter_top", (w + 0.1, depth + 0.06, 0.05), loc=(cx, y, h - 0.025), material=wd,
                        bevel=0.012))
    # panel frames on the street side
    n = 4
    for k in range(n + 1):
        x = x0 + w * k / n
        objs.append(kit.box(f"stile{k}", (0.05, 0.02, h - 0.12 - PLAT_H), loc=(x, y - depth / 2 + 0.02,
                            PLAT_H + (h - 0.12 - PLAT_H) / 2 + 0.02), material=wd, bevel=0.005))
    objs.append(kit.box("rail_lo", (w, 0.02, 0.05), loc=(cx, y - depth / 2 + 0.02, PLAT_H + 0.06), material=wd,
                        bevel=0.005))
    objs.append(kit.box("rail_hi", (w, 0.02, 0.05), loc=(cx, y - depth / 2 + 0.02, h - 0.1), material=wd,
                        bevel=0.005))
    return objs, h, y - depth / 2, y + depth / 2


def build():
    objs = platform()
    fr, z_eave = frame()
    objs += fr
    ro, foot = roof(z_eave)
    objs += ro
    # no side walls: the hall stays open at the ends, so the room and the pine read through it
    objs += back_wall() + interior_floor()
    co, top, fy, by = counter()
    objs += co
    return objs, dict(counter_top=top, counter_front=fy, counter_back=by, roof=foot, eave=z_eave)
