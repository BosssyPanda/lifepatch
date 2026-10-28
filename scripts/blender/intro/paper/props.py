"""Props of the paper money scene: Sichuan's iron cash (single coins and coin strings), the porter's pole,
cords and baskets, a bolt of silk, stacks of notes, an inkstone and brush, strongboxes, and a pine.

Iron coins: Sichuan's money was iron cash, worth about a tenth of a bronze coin in trade (1005), which is
why carrying it was a burden and why deposit notes began there. A coin here is a round cash coin with a
square hole, 25 mm across. A string is coins threaded on a cord; seen from a few metres it is a dark ribbed
rope, so it is drawn as a tube whose material cuts a ridge every coin thickness along its length.
"""
import math
import random

import bpy
import bmesh  # noqa: E402  (after bpy)
from mathutils import Matrix, Vector, noise

import kit
from kit import mat

COIN_R = 0.0125
COIN_T = 0.0019
IRON = "#4b4844"


def iron_material():
    """Dark iron, a little metallic, with ridges every coin along the string (UV u runs along it, 1 = 1 m)."""
    key = "iron_cash"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = kit.rgba(IRON)
    b.inputs["Metallic"].default_value = 0.55
    b.inputs["Roughness"].default_value = 0.62
    uv = nt.nodes.new("ShaderNodeUVMap")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = math.pi / COIN_T
    sn = nt.nodes.new("ShaderNodeMath")
    sn.operation = "SINE"
    ab = nt.nodes.new("ShaderNodeMath")
    ab.operation = "ABSOLUTE"
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 0.35
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.7
    bump.inputs["Distance"].default_value = 0.0008
    nt.links.new(uv.outputs["UV"], sep.inputs[0])
    nt.links.new(sep.outputs["X"], mul.inputs[0])
    nt.links.new(mul.outputs[0], sn.inputs[0])
    nt.links.new(sn.outputs[0], ab.inputs[0])
    nt.links.new(ab.outputs[0], pw.inputs[0])
    nt.links.new(pw.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def coin(name, loc, rot=(0, 0, 0)):
    """One iron cash coin: a disc with a raised rim and a square hole (bmesh, so the hole is real)."""
    bm = bmesh.new()
    segs = 28
    r_out, r_rim, h = COIN_R, COIN_R * 0.82, 0.0035
    outer = [bm.verts.new((r_out * math.cos(a), r_out * math.sin(a), 0)) for a in
             (k / segs * math.tau for k in range(segs))]
    # inner square hole, sampled at the same angles so rings can be bridged
    sq = []
    for k in range(segs):
        a = k / segs * math.tau
        c, s = math.cos(a), math.sin(a)
        t = 0.0035 / max(abs(c), abs(s))
        sq.append(bm.verts.new((t * c, t * s, 0)))
    for k in range(segs):
        bm.faces.new((outer[k], outer[(k + 1) % segs], sq[(k + 1) % segs], sq[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    ob = kit.from_bmesh(name, bm, iron_material(), smooth=False)
    so = ob.modifiers.new("thick", "SOLIDIFY")
    so.thickness, so.offset = h * 0.6, -1.0
    del r_rim
    return kit.place(ob, loc, rot)


def _sweep(name, pts, r, material, segs=10, ridged=True):
    """A tube along a polyline; UV u = distance along it in metres (the iron material ridges per coin)."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    rings, dist = [], [0.0]
    for i in range(1, len(pts)):
        dist.append(dist[-1] + (pts[i] - pts[i - 1]).length)
    prev_n = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = prev_n if prev_n is not None else (t.cross(Vector((0, 0, 1))) if abs(t.z) < 0.95 else Vector((1, 0, 0)))
        n = (n - t * n.dot(t)).normalized()
        prev_n = n
        bn = t.cross(n)
        rings.append([bm.verts.new(p + (n * math.cos(a) + bn * math.sin(a)) * r)
                      for a in (k / segs * math.tau for k in range(segs))])
    for i in range(len(pts) - 1):
        for k in range(segs):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
            for lp, (ii, kk) in zip(f.loops, ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k))):
                lp[uvl].uv = (dist[ii], kk / segs)
    for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / segs)
        for k in range(segs):
            bm.faces.new((ring[k], ring[(k + 1) % segs], c) if sgn > 0 else (ring[(k + 1) % segs], ring[k], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return kit.from_bmesh(name, bm, material)


def cash_string(name, path, material=None):
    """A string of cash along a path (world points). The coins' faces show at the two ends."""
    return _sweep(name, path, COIN_R, material or iron_material(), segs=14)


def coil(name, c, r=0.07, turns=1.6, z0=0.0, rot=0.0, seed=0, lying=True):
    """A string of cash lying in a loose loop on a surface (top at c.z), as strings were heaped: a spiral of
    slightly varying radius that stacks a coin-width higher where it crosses itself."""
    rnd = random.Random(seed)
    pts = []
    n = int(turns * 40)
    for i in range(n + 1):
        t = i / n
        a = rot + t * turns * math.tau
        rr = r * (1.0 + 0.18 * math.sin(a * 1.5 + seed) + rnd.uniform(-0.02, 0.02))
        z = c[2] + COIN_R + (2 * COIN_R * 0.95) * math.floor(t * turns)
        pts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), z))
    return cash_string(name, pts)


def basket(name, c, r=0.2, h=0.26, material=None):
    """A round woven basket: a slightly flared tub with a rim roll; the weave is a bump in the material."""
    m = material or wicker_material()
    body = kit.cyl(name, r * 0.88, h, loc=(c[0], c[1], c[2] + h / 2), material=m, segs=40, r2=r)
    so = body.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.012
    # open the top: delete the cap face
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    tops = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=tops, context="FACES")
    bm.to_mesh(me)
    bm.free()
    rim = bpy.data.objects.new(name + "_rim", bpy.data.meshes.new(name + "_rim"))
    kit.link(rim)
    bmr = bmesh.new()
    bmesh.ops.create_cone(bmr, cap_ends=False, segments=40, radius1=r + 0.006, radius2=r + 0.006, depth=0.02)
    bmr.to_mesh(rim.data)
    bmr.free()
    rim.data.materials.append(m)
    rim.location = (c[0], c[1], c[2] + h - 0.005)
    rim.modifiers.new("thick", "SOLIDIFY").thickness = 0.012
    return [body, rim]


def wicker_material():
    key = "wicker"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = kit.rgba(kit.look()["wood"])
    b.inputs["Roughness"].default_value = 0.85
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "Z"
    wv.inputs["Scale"].default_value = 110.0
    wv.inputs["Distortion"].default_value = 1.5
    ch = nt.nodes.new("ShaderNodeTexChecker")
    ch.inputs["Scale"].default_value = 60.0
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY"
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    bump.inputs["Distance"].default_value = 0.003
    nt.links.new(tc.outputs["Object"], wv.inputs["Vector"])
    nt.links.new(tc.outputs["Object"], ch.inputs["Vector"])
    nt.links.new(wv.outputs["Fac"], mix.inputs[0])
    nt.links.new(ch.outputs["Fac"], mix.inputs[1])
    nt.links.new(mix.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def silk_bolt(name, loc, length=0.46, r=0.065, rot_z=0.0):
    """A bolt of silk: cloth rolled tight, the loose end hanging a little over the roll."""
    m = kit.mat("clay", tone="#d9d3c6")
    roll = kit.cyl(name, r, length, loc=loc, rot=(0, math.pi / 2, rot_z), material=m, segs=48, bevel=0.01)
    return [roll]


def note_stack(name, loc, n=24, size=(0.15, 0.24), rot_z=0.0, seed=1, paper=None):
    """A stack of notes: thin sheets each a little off square, so the edge reads as paper, not a block."""
    rnd = random.Random(seed)
    obs = []
    m = paper or kit.mat("paper")
    for k in range(n):
        z = loc[2] + 0.0009 * k + 0.00045
        dx, dy = rnd.uniform(-0.004, 0.004), rnd.uniform(-0.004, 0.004)
        obs.append(kit.box(f"{name}{k}", (size[0], size[1], 0.0008), loc=(loc[0] + dx, loc[1] + dy, z),
                           rot=(0, 0, rot_z + rnd.uniform(-0.02, 0.02)), material=m))
    return obs


def inkstone(name, loc, rot_z=0.0):
    ink = kit.mat("clay", tone="#3b3834")
    stone = kit.box(name, (0.13, 0.2, 0.025), loc=(loc[0], loc[1], loc[2] + 0.0125), rot=(0, 0, rot_z),
                    material=ink, bevel=0.006)
    well = kit.box(name + "_well", (0.09, 0.05, 0.004), loc=(loc[0], loc[1] + 0.06, loc[2] + 0.024),
                   rot=(0, 0, rot_z), material=kit.mat("clay", tone="#1d1b19"), bevel=0.002)
    return [stone, well]


def brush(name, loc, rot_z=0.0):
    """A writing brush lying on the counter: a thin shaft and a tapered tip."""
    d = Vector((math.cos(rot_z), math.sin(rot_z), 0))
    shaft = kit.cyl(name, 0.0045, 0.2, loc=Vector(loc) + Vector((0, 0, 0.005)),
                    rot=(0, math.pi / 2, rot_z), material=kit.mat("wood"), segs=12)
    tip = kit.cyl(name + "_tip", 0.006, 0.035, loc=Vector(loc) + d * 0.115 + Vector((0, 0, 0.006)),
                  rot=(0, math.pi / 2, rot_z), material=kit.mat("clay", tone="#2b2826"), segs=12, r2=0.0005)
    return [shaft, tip]


def strongbox(name, loc, size=(0.7, 0.45, 0.42), rot_z=0.0):
    """A wooden strongbox bound with iron straps and a lock plate."""
    w, d, h = size
    wood = kit.mat("wood")
    band = kit.mat("clay", tone="#4b4844")
    obs = [kit.box(name, size, loc=(loc[0], loc[1], loc[2] + h / 2), rot=(0, 0, rot_z), material=wood, bevel=0.012)]
    R = Matrix.Rotation(rot_z, 3, "Z")
    for dx in (-w * 0.32, w * 0.32):
        obs.append(kit.box(name + f"_band{dx}", (0.045, d + 0.012, h + 0.012),
                           loc=Vector(loc) + R @ Vector((dx, 0, h / 2)), rot=(0, 0, rot_z), material=band, bevel=0.003))
    obs.append(kit.box(name + "_lid", (w + 0.012, d + 0.012, 0.03), loc=Vector(loc) + R @ Vector((0, 0, h - 0.06)),
                       rot=(0, 0, rot_z), material=band, bevel=0.003))
    obs.append(kit.box(name + "_lock", (0.08, 0.012, 0.1), loc=Vector(loc) + R @ Vector((0, -d / 2 - 0.004, h - 0.13)),
                       rot=(0, 0, rot_z), material=band, bevel=0.003))
    return obs


def pine(name, base, height=3.4, seed=3):
    """A pine in the manner of Song landscape painting: a leaning trunk that bends back on itself, a few
    branches, and flat lumpy pads of needles held level at their ends."""
    rnd = random.Random(seed)
    bark = kit.mat("clay", tone="#8a857c")
    needles = kit.mat("clay", tone="#b5b0a5")
    obs = []
    b = Vector(base)
    # trunk: lean one way, then back, tapering
    pts = [b]
    lean = Vector((0.25, 0.05, 0))
    for k in range(1, 9):
        t = k / 8
        off = lean * math.sin(t * math.pi * 0.9) + Vector((-0.12, 0.0, 0)) * t * t
        pts.append(b + off + Vector((0, 0, height * 0.82 * t)))
    obs.append(_taper(name + "_trunk", pts, 0.11, 0.035, bark))
    pads = []
    for k, (t, ang, ln) in enumerate(((0.45, 2.8, 0.9), (0.6, -0.3, 0.8), (0.74, 2.5, 0.6), (0.86, 0.2, 0.55))):
        i = int(t * (len(pts) - 1))
        root = pts[i]
        d = Vector((math.cos(ang), math.sin(ang) * 0.5, 0.25)).normalized()
        tip = root + d * ln
        mid = root + d * ln * 0.5 + Vector((0, 0, 0.12))
        obs.append(_taper(name + f"_br{k}", [root, mid, tip], 0.04, 0.015, bark))
        pads.append((tip + Vector((0, 0, 0.05)), 0.42 * ln + 0.1))
    pads.append((pts[-1] + Vector((0, 0, 0.08)), 0.5))
    for k, (c, r) in enumerate(pads):
        obs.append(kit.lumpy(name + f"_pad{k}", 1.0, loc=c, scale=(r, r * 0.75, r * 0.26), material=needles,
                             amp=0.22, freq=2.6, subdiv=4, seed=seed * 10 + k))
    del rnd
    return obs


def _taper(name, pts, r0, r1, material, segs=14):
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = prev_n if prev_n is not None else Vector((1, 0, 0))
        n = (n - t * n.dot(t)).normalized()
        prev_n = n
        bn = t.cross(n)
        r = r0 + (r1 - r0) * i / (len(pts) - 1)
        rings.append([bm.verts.new(p + (n * math.cos(a) + bn * math.sin(a)) * r * (1 + 0.06 * noise.noise(p * 7 + Vector((a, 0, 0)))))
                      for a in (k / segs * math.tau for k in range(segs))])
    for i in range(len(pts) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    c = bm.verts.new(pts[-1])
    for k in range(segs):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % segs], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = kit.from_bmesh(name, bm, material)
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    return ob
