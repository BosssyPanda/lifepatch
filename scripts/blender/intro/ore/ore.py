"""Scene one's hero, the gold ore, built from scratch in code (no downloads, no generated models).

What makes it read like the reference turnaround Cindy gave (uploads/hearth/cfbab62f…):
- a lemon-shaped lump, pointed at both ends, with a lumpy outline;
- big flat gold plates with crisp edges and deep crevices between them: knapped gold pieces of
  many sizes pressed into a rock core and fused into one surface;
- the host rock showing wherever no gold covers the core, mostly along a vein that winds round
  the ore: blocky dark grey granules, with white cauliflower quartz (fused round lumps) in it;
- a crumpled-foil texture on the gold, done in the shader so it can be baked into a normal map;
- the crack down the front that the camera dives into, its floor a separate glowing material.

    python scripts/blender/intro/ore/ore.py --out DIR --hdr studio.hdr [--views front,left,back,right]

renders look-dev views lit by the studio HDR (studio.py), to set beside the reference.
Units are metres; the finished ore stands ORE_HEIGHT tall with its foot at z=0, front facing -Y.
"""
import argparse
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Quaternion, Vector, kdtree, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import kit  # noqa: E402

ORE_HEIGHT = 1.1
SEED = 11

# The crack the camera dives into, as (x, z) points on the front face in the unit ore's space
# (height 2, z from -1 to 1), top to bottom.
CRACK = [(-0.10, 0.62), (0.02, 0.38), (-0.06, 0.14), (0.07, -0.12), (0.0, -0.36), (0.05, -0.56)]
CRACK_W = 0.08       # largest half-width of the slit at the surface (its glowing floor is half that)
CRACK_D = 0.16       # how deep it is cut

ROCK = "#262422"     # neutral dark grey (DESIGN.md: no warm browns)
ROCK_LIGHT = "#55524e"
QUARTZ = "#cfc2aa"   # milky quartz, below white so lit lumps keep their shading
ORE_GOLD = (1.0, 0.65, 0.19)    # linear; richer than kit.GOLD like the reference, rendered hue ~38° (amendment G: 37-41°)
DEEP_GOLD = (0.88, 0.5, 0.12)    # linear; the creases and the deeper patches

GOLD_K, ROCK_K, QUARTZ_K, CRACK_K = 0, 1, 2, 3
MATERIAL_OF = {GOLD_K: 0, ROCK_K: 1, QUARTZ_K: 1, CRACK_K: 2}


# --------------------------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------------------------


def _seg(p, a, b):
    """Distance from p to segment ab, and how far along it (0..1) the nearest point is."""
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(p[0] - ax - t * dx, p[1] - az - t * dz), t


def crack_at(x, z):
    """(distance to the crack, its half-width there). The crack is widest in the middle and closes
    to nothing at both ends; its edges are ragged."""
    x += 0.012 * noise.noise(Vector((0.0, 3.7, z * 16.0))) + 0.006 * noise.noise(Vector((1.3, 0.0, z * 40.0)))
    best = (9.0, 0.0)
    n = len(CRACK) - 1
    for k, (a, b) in enumerate(zip(CRACK, CRACK[1:])):
        d, t = _seg((x, z), a, b)
        if d < best[0]:
            best = (d, (k + t) / n)
    d, t = best
    w = CRACK_W * (0.25 + 0.75 * math.sin(math.pi * t) ** 0.7) * (0.8 + 0.4 * noise.noise(Vector((z * 9.0, 2.0, 0.0))))
    return d, w


def crack_dist(x, z):
    return crack_at(x, z)[0]


def _poisson(points, rmin, rnd, limit):
    """Pick well-spread points from a list (dart throwing)."""
    order = list(range(len(points)))
    rnd.shuffle(order)
    picked = []
    tree = kdtree.KDTree(limit)
    for i in order:
        if len(picked) >= limit:
            break
        p = points[i]
        if picked:
            tree.balance()
            _, _, d = tree.find(p)
            if d < rmin:
                continue
        tree.insert(p, len(picked))
        picked.append(p.copy())
    tree.balance()
    return picked, tree


def _hash(p):
    """A repeatable random number in [0, 1) for a point."""
    v = math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453
    return v - math.floor(v)


def _vein(p, off):
    """Signed distance-like value to the vein: a wavy plane cutting diagonally round the ore."""
    vn = Vector((0.80, 0.22, 0.56)).normalized()
    return p.dot(vn) - 0.04 + 0.12 * noise.noise(p * 1.8 + off) + 0.04 * noise.noise(p * 5.0 + off)


def _shape(p, off):
    """Unit sphere point -> lemon: pointed at both ends (the top more), fuller below the middle."""
    z = p.z
    rho = math.sqrt(max(0.0, 1.0 - z * z))
    if z > 0.94:
        z = 0.94 + (z - 0.94) * 0.4                 # no needle at the tip
    e = 1.35 + 0.75 * max(z, 0.0) + 0.85 * max(-z, 0.0)  # the top tapers to a point, the foot less
    r = (rho ** e) / max(rho, 1e-6)
    full = 1.0 - 0.03 * z
    q = Vector((p.x * r * 0.52 * full, p.y * r * 0.44 * full, z))
    q.x += 0.05 * max(z, 0.0) ** 2                      # the tip leans a little
    n = Vector((p.x * 0.6, p.y * 0.5, p.z * 0.5))
    lump = (0.10 * noise.noise(p * 1.4 + off) + 0.05 * noise.noise(p * 3.2 + off * 1.7)
            + 0.02 * noise.noise(p * 7.0 + off * 0.3))
    return q + n * lump


def _pocket(p, off):
    """How much host rock shows at p, 0..1: pockets along the vein, broken by gold bridges, and a
    few lone pockets elsewhere. Returns (amount, the vein value, the pocket's half-width, lone)."""
    vein = abs(_vein(p, off))
    w = 0.1 + 0.07 * noise.noise(p * 2.5 + off * 0.8)
    # decided per small cell, so pockets have angular, broken outlines rather than smooth ones
    q = (noise.voronoi(p * 7.0 + off)[1][0] - off) / 7.0
    qv = abs(_vein(q, off))
    qw = 0.1 + 0.07 * noise.noise(q * 2.5 + off * 0.8)
    bridge = noise.noise(q * 2.0 + off * 1.9)
    m = 1.0 if qv < qw and bridge > -0.15 else 0.0
    lone = 1.0 if noise.noise(q * 1.7 + off * 1.3) > 0.5 else 0.0
    if q.y < 0.05 and crack_dist(q.x, q.z) < 0.14:
        return 0.0, vein, w, 0.0                      # gold all round the crack
    return max(m, lone), vein, w, lone


def _crumple(p, scale, off):
    """Crumpled-sheet height: each Voronoi cell rises to a blunt peak, its sides flat facets that
    fold down into a sharp valley along the cell's border (F2 - F1), each cell to its own height."""
    d, cp = noise.voronoi(p * scale + off)
    return min(d[1] - d[0], 0.7) * (0.35 + 0.65 * _hash(cp[0]))


def _chunk(bm, centre, normal, r, flat, rnd):
    """One gold piece: a flattened lump knapped into flat faces, lying with its broad top facing
    out along `normal`."""
    made = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)["verts"]
    sx, sy = 1.0, rnd.uniform(0.65, 1.0)
    for v in made:
        v.co = Vector((v.co.x * r * sx, v.co.y * r * sy, v.co.z * r * flat))
    for k in range(rnd.randint(7, 10)):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1) * 0.6 + (0.9 if k < 2 else 0.0)))
        d.normalize()
        h = max(v.co.dot(d) for v in made)
        cut = h - (rnd.uniform(0.45, 0.7) * r * flat if k < 2 else rnd.uniform(0.1, 0.32) * r)
        for v in made:
            t = v.co.dot(d)
            if t > cut:
                v.co -= d * (t - cut)
    rot = normal.to_track_quat("Z", "Y") @ Quaternion((0, 0, 1), rnd.uniform(0, math.tau))
    for v in made:
        v.co = centre + rot @ v.co


def build_mesh(seed=SEED, voxel=0.005):
    """The ore is a rock core (the lemon shape) with gold pieces pressed into its surface, big
    flat plates first and then smaller pieces between them, fused into one surface. Wherever no
    gold covers the core, the host rock shows: mostly along the vein, where few pieces are laid."""
    rnd = random.Random(seed)
    off = Vector([rnd.uniform(-40, 40) for _ in range(3)])
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=6, radius=1.0)
    for v in bm.verts:
        v.co = _shape(v.co.copy(), off)
    for v in bm.verts:   # the core is crumpled too: it shows as gold between the pieces
        v.co += v.normal * (0.06 * _crumple(v.co, 3.0, off) - 0.03)
    bm.normal_update()
    core = bm.copy()
    sites = [(v.co.copy(), v.normal.copy()) for v in bm.verts]
    pts = [p for p, _ in sites]

    def width(p):   # pieces get smaller towards the pointed ends
        return 0.25 + 0.75 * max(0.0, 1.0 - abs(p.z) ** (1.4 if p.z > 0 else 2.0))

    big, _ = _poisson(pts, 0.27, rnd, 90)
    small, _ = _poisson(pts, 0.1, rnd, 280)
    tree = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    laid = 0
    for p in big:
        if _pocket(p, off)[0] > 0.3:
            continue                                   # the pockets are walled by plate edges
        n = sites[tree.find(p)[1]][1]
        t = Vector([rnd.uniform(-1, 1) for _ in range(3)]) * 0.35   # plates face every which way
        n = (n + t - n * n.dot(t)).normalized()
        r = rnd.uniform(0.24, 0.4) * width(p)
        flat = rnd.uniform(0.3, 0.4)
        _chunk(bm, p + n * r * flat * rnd.uniform(-0.6, -0.25), n, r, flat, rnd)
        laid += 1
    for p in small:
        if _pocket(p, off)[0] > 0.3:
            continue
        n = sites[tree.find(p)[1]][1]
        r = rnd.uniform(0.06, 0.11) * width(p)
        flat = rnd.uniform(0.35, 0.6)
        _chunk(bm, p + n * r * flat * rnd.uniform(-0.6, -0.1), n, r, flat, rnd)
        laid += 1
    print(f"[ore] {laid} gold pieces", flush=True)

    # fuse everything into one closed surface
    me = bpy.data.meshes.new("ore_parts")
    bm.to_mesh(me)
    bm.free()
    parts = bpy.data.objects.new("ore_parts", me)
    bpy.context.scene.collection.objects.link(parts)
    mod = parts.modifiers.new("fuse", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    dg = bpy.context.evaluated_depsgraph_get()
    fused = bpy.data.meshes.new_from_object(parts.evaluated_get(dg))
    bpy.data.objects.remove(parts)
    bpy.data.meshes.remove(me)
    bm = bmesh.new()
    bm.from_mesh(fused)
    bpy.data.meshes.remove(fused)
    bm.normal_update()
    verts = list(bm.verts)
    print(f"[ore] fused: {len(verts)} vertices", flush=True)

    # pockets of host rock: along the vein, broken by gold bridges, and a few elsewhere. Inside a
    # pocket the gold is pushed back down to the core, so the rock sits in a recess walled by the
    # plates' edges; quartz fills the middle of the vein's pockets.
    core_bvh = BVHTree.FromBMesh(core)
    core.free()
    info = [_pocket(v.co, off) for v in verts]
    mask = [i[0] for i in info]
    for _ in range(4):        # soften the pocket's edge over a few vertices: walls slope, not cliffs
        mask = [0.5 * mask[v.index] + 0.5 * sum(mask[e.other_vert(v).index] for e in v.link_edges) / max(len(v.link_edges), 1)
                for v in verts]
    kind = []
    for v, (_, vein, w, lone), m in zip(verts, info, mask):
        p = v.co
        if m > 0.0:
            hit = core_bvh.find_nearest(p)
            if hit[0] is not None:
                target = hit[0] - hit[1] * 0.012
                v.co = p.lerp(target, m * m * (3 - 2 * m))
        if m < 0.5:
            kind.append(GOLD_K)
        elif vein < w * 0.85 and noise.noise(p * 3.0 + off * 0.4) > -0.25 and lone < 0.5:
            kind.append(QUARTZ_K)
        else:
            kind.append(ROCK_K)

    # the host rock: blocky granules at random heights, easing in from the gold's edge; the
    # quartz bed a little lower (the quartz lumps fill it)
    gold_tree = kdtree.KDTree(len(verts))
    for i, v in enumerate(verts):
        if kind[i] == GOLD_K:
            gold_tree.insert(v.co, i)
    gold_tree.balance()
    for i, v in enumerate(verts):
        if kind[i] == GOLD_K:
            continue
        t = min(1.0, gold_tree.find(v.co)[2] / 0.03)
        t = t * t * (3 - 2 * t)
        d, cp = noise.voronoi(v.co * 9.0 + off)
        chunk = 0.05 * _hash(cp[0]) - 0.025
        d2, cp2 = noise.voronoi(v.co * 26.0 + off * 1.3)
        chunk += 0.016 * _hash(cp2[0]) - 0.008
        sink = 0.0 + (0.02 if kind[i] == QUARTZ_K else 0.0)
        v.co += v.normal * t * (-sink + chunk + 0.006 * noise.noise(v.co * 55.0))

    # the crack down the front: a ragged slit, widest in the middle, whose floor glows
    bm.normal_update()
    for i, v in enumerate(verts):
        if v.co.y > 0.05:
            continue
        c, w = crack_at(v.co.x, v.co.z)
        if c < w:
            v.co.y += CRACK_D * (1.0 - (c / w) ** 2)
            if c < w * 0.5:
                kind[i] = CRACK_K

    # a small flat foot so it sits on its stand
    for v in verts:
        if v.co.z < -0.9:
            v.co.z = -0.9 + (v.co.z + 0.9) * 0.15

    for f in bm.faces:
        ks = [kind[v.index] for v in f.verts]
        f.material_index = MATERIAL_OF[max(set(ks), key=ks.count)]
        f.smooth = True
    bm.normal_update()
    vein = [(verts[i].co.copy(), verts[i].normal.copy()) for i in range(len(verts)) if kind[i] == QUARTZ_K]
    me = bpy.data.meshes.new("ore_hi")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("ore_hi", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, vein, rnd


def quartz(vein, rnd):
    """Cauliflower quartz: fused round lumps filling the middle of the vein, crowned with smaller ones."""
    mb = bpy.data.metaballs.new("quartz_mb")
    mb.resolution = 0.007          # meshed at this size (new_from_object uses the viewport value)
    mb.render_resolution = 0.007
    mb.threshold = 0.6
    pts = [p for p, _ in vein]
    picks, _ = _poisson(pts, 0.04, rnd, 8000)
    tree = kdtree.KDTree(len(vein))
    for i, (p, n) in enumerate(vein):
        tree.insert(p, i)
    tree.balance()
    for p in picks:
        n = vein[tree.find(p)[1]][1]
        r = rnd.uniform(0.04, 0.075)
        e = mb.elements.new()
        e.co = p + n * (r * 0.45)
        e.radius = r
        e.stiffness = 4.0
        for _ in range(rnd.randint(3, 6)):
            d = Vector([rnd.uniform(-1, 1) for _ in range(3)])
            d = (d - n * d.dot(n)).normalized() * rnd.uniform(0.3, 0.8) + n * rnd.uniform(0.3, 0.8)
            c = mb.elements.new()
            c.co = e.co + d.normalized() * r * 0.55
            c.radius = r * rnd.uniform(0.45, 0.62)
            c.stiffness = 4.0
    ob = bpy.data.objects.new("quartz_mb", mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    bpy.context.scene.render.use_simplify = False
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    q = bpy.data.objects.new("quartz", me)
    bpy.context.scene.collection.objects.link(q)
    for p in q.data.polygons:
        p.use_smooth = True
    return q


# --------------------------------------------------------------------------------------------
# Materials (written so that colour, roughness and metalness can each be baked)
# --------------------------------------------------------------------------------------------


def _nodes(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes["Principled BSDF"]


def _facets(nt, coord, scale):
    """Height field of tiny flat facets, each tilted its own way (Voronoi cells, each a plane)."""
    N, L = nt.nodes, nt.links
    vo = N.new("ShaderNodeTexVoronoi")
    vo.voronoi_dimensions = "3D"
    vo.feature = "F1"
    vo.inputs["Scale"].default_value = scale
    vo.inputs["Randomness"].default_value = 1.0
    L.new(coord, vo.inputs["Vector"])
    rel = N.new("ShaderNodeVectorMath")
    rel.operation = "SUBTRACT"                  # from the cell's point, in the input's units
    L.new(coord, rel.inputs[0])
    L.new(vo.outputs["Position"], rel.inputs[1])
    tilt = N.new("ShaderNodeVectorMath")
    tilt.operation = "SUBTRACT"
    L.new(vo.outputs["Color"], tilt.inputs[0])
    tilt.inputs[1].default_value = (0.5, 0.5, 0.5)
    dot = N.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L.new(rel.outputs[0], dot.inputs[0])
    L.new(tilt.outputs[0], dot.inputs[1])
    h = N.new("ShaderNodeMath")
    h.operation = "MULTIPLY"
    L.new(dot.outputs["Value"], h.inputs[0])
    h.inputs[1].default_value = scale           # about ±0.5 across each facet, whatever the scale
    return h.outputs[0]


def gold_material():
    """Gold with a crumpled-foil surface: three sizes of tiny tilted facets, thin darker creases
    folded in between the larger ones, and a slow drift between bright and deeper gold."""
    m, nt, b = _nodes("gold")
    N, L = nt.nodes, nt.links
    tc = N.new("ShaderNodeTexCoord")
    warp = N.new("ShaderNodeTexNoise")          # bend the facet grid so the crumple is uneven
    warp.inputs["Scale"].default_value = 3.0
    L.new(tc.outputs["Object"], warp.inputs["Vector"])
    wc = N.new("ShaderNodeVectorMath")
    wc.operation = "SUBTRACT"
    L.new(warp.outputs["Color"], wc.inputs[0])
    wc.inputs[1].default_value = (0.5, 0.5, 0.5)
    ws = N.new("ShaderNodeVectorMath")
    ws.operation = "MULTIPLY_ADD"
    L.new(wc.outputs[0], ws.inputs[0])
    ws.inputs[1].default_value = (0.12, 0.12, 0.12)
    L.new(tc.outputs["Object"], ws.inputs[2])
    co = ws.outputs[0]
    # thin creases between the larger facets: darker, and folded in
    ve = N.new("ShaderNodeTexVoronoi")
    ve.voronoi_dimensions = "3D"
    ve.feature = "DISTANCE_TO_EDGE"
    ve.inputs["Scale"].default_value = 25.0
    L.new(co, ve.inputs["Vector"])
    crease = N.new("ShaderNodeMapRange")
    crease.inputs["From Min"].default_value = 0.0
    crease.inputs["From Max"].default_value = 0.07
    crease.inputs["To Min"].default_value = 1.0
    crease.inputs["To Max"].default_value = 0.0
    crease.interpolation_type = "SMOOTHSTEP"
    L.new(ve.outputs["Distance"], crease.inputs["Value"])
    h = N.new("ShaderNodeMath")
    h.operation = "MULTIPLY"
    L.new(crease.outputs["Result"], h.inputs[0])
    h.inputs[1].default_value = -0.1
    h = h.outputs[0]
    for scale, weight in ((18.0, 0.8), (34.0, 0.7), (80.0, 0.3)):
        add = N.new("ShaderNodeMath")
        add.operation = "MULTIPLY_ADD"
        L.new(_facets(nt, co, scale), add.inputs[0])
        add.inputs[1].default_value = weight
        L.new(h, add.inputs[2])
        h = add.outputs[0]
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.004
    L.new(h, bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    drift = N.new("ShaderNodeTexNoise")
    drift.inputs["Scale"].default_value = 2.5
    drift.inputs["Detail"].default_value = 2.0
    L.new(co, drift.inputs["Vector"])
    deep = N.new("ShaderNodeMapRange")
    deep.inputs["From Min"].default_value = 0.35
    deep.inputs["From Max"].default_value = 0.65
    deep.inputs["To Min"].default_value = 0.0
    deep.inputs["To Max"].default_value = 0.75
    L.new(drift.outputs["Fac"], deep.inputs["Value"])
    amount = N.new("ShaderNodeMath")
    amount.operation = "MULTIPLY_ADD"           # crease * 0.5 + drift
    L.new(crease.outputs["Result"], amount.inputs[0])
    amount.inputs[1].default_value = 0.15
    L.new(deep.outputs["Result"], amount.inputs[2])
    clamp = N.new("ShaderNodeClamp")
    L.new(amount.outputs[0], clamp.inputs["Value"])
    col = N.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.inputs["A"].default_value = (*ORE_GOLD, 1)
    col.inputs["B"].default_value = (*DEEP_GOLD, 1)
    L.new(clamp.outputs[0], col.inputs["Factor"])
    col.name = "base_color"
    L.new(col.outputs["Result"], b.inputs["Base Color"])
    rough = N.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.2
    rough.inputs["To Max"].default_value = 0.34
    L.new(clamp.outputs[0], rough.inputs["Value"])
    rough.name = "roughness"
    L.new(rough.outputs["Result"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = 1.0
    return m


def rock_material():
    """Dark grey host rock: blocky granules, some faces lighter, with a fine grit."""
    m, nt, b = _nodes("rock")
    N, L = nt.nodes, nt.links
    tc = N.new("ShaderNodeTexCoord")
    co = tc.outputs["Object"]
    cells = N.new("ShaderNodeTexVoronoi")
    cells.inputs["Scale"].default_value = 26.0
    L.new(co, cells.inputs["Vector"])
    pick = N.new("ShaderNodeSeparateColor")
    L.new(cells.outputs["Color"], pick.inputs["Color"])
    light = N.new("ShaderNodeMapRange")
    light.inputs["From Min"].default_value = 0.55
    light.inputs["From Max"].default_value = 1.0
    L.new(pick.outputs["Red"], light.inputs["Value"])
    col = N.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.inputs["A"].default_value = kit.rgba(ROCK)
    col.inputs["B"].default_value = kit.rgba(ROCK_LIGHT)
    L.new(light.outputs["Result"], col.inputs["Factor"])
    col.name = "base_color"
    L.new(col.outputs["Result"], b.inputs["Base Color"])
    rough = N.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.75
    rough.inputs["To Max"].default_value = 0.45
    L.new(light.outputs["Result"], rough.inputs["Value"])
    rough.name = "roughness"
    L.new(rough.outputs["Result"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = 0.0
    grit = N.new("ShaderNodeTexNoise")
    grit.inputs["Scale"].default_value = 120.0
    L.new(co, grit.inputs["Vector"])
    edge = N.new("ShaderNodeTexVoronoi")
    edge.feature = "DISTANCE_TO_EDGE"
    edge.inputs["Scale"].default_value = 26.0
    L.new(co, edge.inputs["Vector"])
    hsum = N.new("ShaderNodeMath")
    hsum.operation = "MULTIPLY_ADD"
    L.new(grit.outputs["Fac"], hsum.inputs[0])
    hsum.inputs[1].default_value = 0.3
    L.new(edge.outputs["Distance"], hsum.inputs[2])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    bump.inputs["Distance"].default_value = 0.004
    L.new(hsum.outputs[0], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def quartz_material():
    m, nt, b = _nodes("quartz")
    N, L = nt.nodes, nt.links
    b.inputs["Base Color"].default_value = kit.rgba(QUARTZ)
    b.inputs["Roughness"].default_value = 0.38
    b.inputs["Subsurface Weight"].default_value = 0.4
    b.inputs["Subsurface Radius"].default_value = (1.0, 1.0, 1.0)
    b.inputs["Subsurface Scale"].default_value = 0.01
    tc = N.new("ShaderNodeTexCoord")
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 60.0
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    bump.inputs["Distance"].default_value = 0.002
    L.new(nz.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def glow_material(strength=8.0):
    m = bpy.data.materials.new("crack_glow")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = kit.rgba(kit.LOOKS["a"]["fire"])
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    return m


def build(seed=SEED, glow=8.0):
    ob, vein, rnd = build_mesh(seed)
    for mat in (gold_material(), rock_material(), glow_material(glow)):
        ob.data.materials.append(mat)
    q = quartz(vein, rnd)
    q.data.materials.append(quartz_material())
    s = ORE_HEIGHT / 2.0
    for o in (ob, q):
        o.scale = (s, s, s)
        o.location = (0, 0, 0.9 * s)
    return ob, q


# --------------------------------------------------------------------------------------------
# Look-dev
# --------------------------------------------------------------------------------------------


def studio_world(hdr, strength=1.0):
    w = bpy.context.scene.world
    nt = w.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdr)
    nt.links.new(env.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = strength


VIEWS = {"front": 0, "left": 90, "back": 180, "right": 270}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--hdr", required=True)
    ap.add_argument("--views", default="front,left,back,right")
    ap.add_argument("--res", default="600x900")
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--glow", type=float, default=0.0, help="crack glow; 0 = the crack at rest, dark")
    ap.add_argument("--env", type=float, default=1.0, help="studio light strength")
    ap.add_argument("--gold", default="", help="r,g,b linear base colour to try instead of kit.GOLD")
    args = ap.parse_args(argv)
    w, h = (int(x) for x in args.res.split("x"))
    os.makedirs(args.out, exist_ok=True)
    kit.reset("a", res=(w, h), samples=args.samples)
    studio_world(os.path.abspath(args.hdr), args.env)
    if args.gold:
        global ORE_GOLD
        ORE_GOLD = tuple(float(x) for x in args.gold.split(","))
    build(args.seed, args.glow)
    centre = Vector((0, 0, ORE_HEIGHT / 2))
    for name in args.views.split(","):
        a = math.radians(VIEWS[name])
        # the camera goes round the ore, as in the reference's turnaround
        cam_pos = centre + Vector((-math.sin(a) * 3.0, -math.cos(a) * 3.0, 0.25))
        cam = kit.camera(tuple(cam_pos), tuple(centre), lens=85)
        bpy.context.scene.camera = cam
        path = os.path.join(args.out, f"ore_{name}.png")
        kit.render(path)
        print("[ore]", path, flush=True)


if __name__ == "__main__":
    main()
