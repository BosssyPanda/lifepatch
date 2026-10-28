"""Tailored clothes simulated on a posed MakeHuman body: rung 1 of the figure ladder for the eras after 1600.

Trousers and a jacket are cut from MakeHuman's own body-fitting helper (helper-tights: torso, arms and legs,
about 8 mm off the skin, weighted to the skeleton like the body). The helper is subdivided once and cut with
planes, so hems, cuffs and the neckline are straight clean edges rather than the staircase of whole faces
that made the earlier threshold cut look torn. The pieces are eased off the body (trouser legs pushed out
to a straight flared tube, a skirt added to the jacket below the hips, a V opening cut in its front), pinned
at the waistband, collar, shoulders and cuffs, and simulated from the rest pose into the target pose with
cloth.py, like the tunic.

Expects the body already in its arms-out rest (cloth.tpose_rest). All heights come from the body's bones.
"""
import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import mh_figure as mh

NECK, CUFF, WAIST, KNEE = 1, 2, 3, 4  # pin roles, stored on the vertices


def _tights(ob):
    """MakeHuman's tights helper as a bmesh, at the body's current rest positions, subdivided once."""
    _raw, groups = mh.load_obj()
    faces = groups["helper-tights"]
    me = bpy.data.meshes.new("_tights")
    ids = sorted({i for f in faces for i in f})
    remap = {i: n for n, i in enumerate(ids)}
    me.from_pydata([tuple(ob.matrix_world @ ob.data.vertices[i].co) for i in ids], [],
                   [[remap[i] for i in f] for f in faces])
    tmp = bpy.data.objects.new("_tights", me)
    bpy.context.scene.collection.objects.link(tmp)
    sub = tmp.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    bm.from_object(tmp, dg)
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.meshes.remove(me)
    return bm


def _geom(bm, keep=lambda c: True):
    faces = [f for f in bm.faces if keep(f.calc_center_median())]
    edges = list({e for f in faces for e in f.edges})
    verts = list({v for f in faces for v in f.verts})
    return verts + edges + faces


def _cut(bm, co, no, keep=lambda c: True, clear=True):
    """Cut along the plane through co with normal no; with clear, remove what lies on the side no points
    to. Only faces whose centre passes keep() are touched (the plane is infinite)."""
    bmesh.ops.bisect_plane(bm, geom=_geom(bm, keep), dist=1e-5, plane_co=Vector(co), plane_no=Vector(no),
                           clear_outer=clear)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # a cut passing right by a vertex leaves a sliver edge; merged, or a grown hem folds over there
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0015)


def _tag(bm, layer, role, co, no, tol=2e-4):
    """Mark the boundary vertices that lie on a cut plane."""
    co, no = Vector(co), Vector(no).normalized()
    for v in bm.verts:
        if v.is_boundary and abs((v.co - co).dot(no)) < tol:
            v[layer] = role


def _ease(bm, amount, body_tree=None, clear=None, iters=8):
    """Move the surface out by amount, then smooth it (a plain offset folds over itself in tight concave
    spots like the spine groove and the seat's cleft, which shows as a dark slit) and keep it at least
    `clear` off the skin."""
    bm.normal_update()
    moves = [(v, v.normal * amount) for v in bm.verts]
    for v, d in moves:
        v.co += d
    inner = [v for v in bm.verts if not v.is_boundary]
    _smooth(bm, inner, iters=iters)
    if body_tree is not None:
        clear = amount + 0.006 if clear is None else clear
        for _ in range(2):
            for v in bm.verts:
                hit, _n, _i, dist = body_tree.find_nearest(v.co)
                if hit is not None and dist < clear:
                    d = v.co - hit
                    if d.length > 1e-6:
                        v.co = hit + d.normalized() * clear
            _smooth(bm, inner, iters=1, factor=0.3)


def _loops(bm):
    """Boundary loops as ordered vertex lists."""
    nxt = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts
            nxt.setdefault(a, []).append(b)
            nxt.setdefault(b, []).append(a)
    seen, loops = set(), []
    for start in nxt:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            cand = [w for w in nxt[cur] if w is not prev and w not in seen]
            if not cand:
                break
            prev, cur = cur, cand[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    return loops


def _extrude_down(bm, loop, rows, step, shape):
    """Grow a boundary loop downward by rows of step; shape(k, v, base) gives each new vertex's position."""
    prev = loop
    for k in range(1, rows + 1):
        new = [bm.verts.new(shape(k, v, v.co - Vector((0, 0, k * step)))) for v in loop]
        n = len(loop)
        for i in range(n):
            j = (i + 1) % n
            if prev[i] is prev[j]:
                continue
            try:
                bm.faces.new((prev[i], prev[j], new[j], new[i]))
            except ValueError:
                pass
        prev = new
    return prev


def _smooth(bm, verts, iters=4, factor=0.5):
    for _ in range(iters):
        bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True,
                              use_axis_z=True)


def _hull(pts):
    """2D convex hull (monotone chain) of (x, y) tuples, counter-clockwise."""
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def _hull_radius(hull, c, a):
    """Distance from c to the hull boundary along angle a (c inside the hull)."""
    d = (math.cos(a), math.sin(a))
    best = 0.0
    for (x0, y0), (x1, y1) in zip(hull, hull[1:] + hull[:1]):
        ex, ey = x1 - x0, y1 - y0
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        wx, wy = x0 - c[0], y0 - c[1]
        t = (wx * ey - wy * ex) / den
        u = (wx * d[1] - wy * d[0]) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            best = max(best, t)
    return best


def landmarks(ob, rig):
    b = rig.data.bones
    floor = min(ob.data.vertices[i].co.z for p in ob.data.polygons for i in p.vertices)
    sh = b["upperarm_l"].head_local
    import cloth
    tree, bm = cloth._bvh(ob)
    bm.free()
    return dict(
        tree=tree,
        floor=floor,
        waist=b["spine_01"].head_local.z,                      # trouser waistband
        button=b["spine_01"].head_local.z + 0.005,             # jacket's waist button
        crotch=b["thigh_l"].head_local.z - 0.10,
        knee=b["calf_l"].head_local.z,
        ankle=b["foot_l"].head_local.z,
        neck=b["neck_01"].head_local.z,
        sh=sh,
        sh_y=(b["clavicle_l"].tail_local.y + sh.y) / 2,
        cy=(b["spine_01"].head_local.y + b["spine_02"].head_local.y) / 2,
        knee_c=b["calf_l"].head_local.copy(),
        wrist={s: (b[f"hand_{s}"].head_local, (b[f"hand_{s}"].head_local - b[f"lowerarm_{s}"].head_local).normalized())
               for s in "lr"},
    )


def trousers(ob, rig, L, ease=0.005, knee_r=0.066, hem_r=0.090, hem_rows=3, breeches=False, puff_r=0.12):
    """Waist to ankle, legs pushed out to a straight tube that flares to the hem (1970s cut). With breeches:
    waist to just below the knee, the legs pushed out wide to be gathered in at the knee band (c. 1600)."""
    bm = _tights(ob)
    role = bm.verts.layers.int.new("role")
    _cut(bm, (0, 0, L["waist"]), (0, 0, 1))
    hem0 = L["knee"] - 0.07 if breeches else L["ankle"] + 0.012
    _cut(bm, (0, 0, hem0), (0, 0, -1))
    _tag(bm, role, WAIST, (0, 0, L["waist"]), (0, 0, 1))
    if breeches:
        _tag(bm, role, KNEE, (0, 0, hem0), (0, 0, -1))
    _ease(bm, ease, L["tree"], clear=0.011)
    if not breeches:
        # flare: grow each leg's hem loop down to just above the floor
        step = (hem0 - (L["floor"] + 0.035)) / hem_rows
        for loop in _loops(bm):
            if max(v.co.z for v in loop) < L["crotch"]:
                _extrude_down(bm, loop, hem_rows, step, lambda k, v, p: p)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # each leg's centre line, slice by slice
    legs = {}
    for sx in (1, -1):
        cen = []
        z = L["crotch"] - 0.04
        while z > L["floor"]:
            pts = [v.co for v in bm.verts if v.co.x * sx > 0.02 and abs(v.co.z - z) < 0.012]
            if pts:
                c = sum(pts, Vector()) / len(pts)
                cen.append((z, c.x, c.y))
            z -= 0.02
        legs[sx] = cen

    def centre(sx, z):
        cen = legs[sx]
        if z >= cen[0][0]:
            return cen[0][1:]
        for (z0, x0, y0), (z1, x1, y1) in zip(cen, cen[1:]):
            if z1 <= z <= z0:
                t = (z0 - z) / (z0 - z1)
                return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        return cen[-1][1:]

    moved = []
    for v in bm.verts:
        if v.co.z > L["crotch"] - (0.0 if breeches else 0.06):
            continue
        sx = 1 if v.co.x > 0 else -1
        cx, cy = centre(sx, v.co.z)
        if breeches:
            # full from the hip, widest above the knee, back in to the knee band
            t = min(max((L["crotch"] - v.co.z) / (L["crotch"] - hem0), 0.0), 1.0)
            rmin = puff_r * (0.75 + 0.25 * math.sin(math.pi * min(1.0, t * 1.15)))
        else:
            t = min(max((L["knee"] - v.co.z) / (L["knee"] - L["floor"]), 0.0), 1.0)
            rmin = knee_r + (hem_r - knee_r) * t
        d = Vector((v.co.x - cx, v.co.y - cy, 0))
        if d.length < rmin:
            d.normalize()
            v.co.x, v.co.y = cx + d.x * rmin, cy + d.y * rmin
        if breeches and v.co.x * sx < 0.014:
            v.co.x = sx * 0.014  # each leg stays on its own side of the midline
        moved.append(v)
    _smooth(bm, [v for v in moved if not v.is_boundary], iters=6)
    # fly front: smooth out the body's shape at the crotch, keeping clear of the skin
    fly = [v for v in bm.verts if abs(v.co.x) < 0.09 and v.co.y < L["cy"] + 0.02
           and L["crotch"] - 0.08 < v.co.z < L["waist"] - 0.04 and not v.is_boundary]
    for _ in range(6):
        _smooth(bm, fly, iters=4)
        for v in fly:
            hit, _n, _i, dist = L["tree"].find_nearest(v.co)
            if hit is not None and dist < 0.011:
                v.co = hit + (v.co - hit).normalized() * 0.011
    return bm, role


def jacket(ob, rig, L, ease=0.014, skirt=0.16, gorge=0.075, gorge_z=None, cut_away=0.12, trousers_bm=None,
           vopen=True, top_cut=None, neck_up=-0.02, point=0.0):
    """Torso and sleeves to the wrist, a skirt below the hips, a V opening above the waist button and the
    fronts curving apart below it. vopen=False: closed to the neck (a doublet)."""
    bm = _tights(ob)
    role = bm.verts.layers.int.new("role")
    top_cut = L["crotch"] + 0.11 if top_cut is None else top_cut
    _cut(bm, (0, 0, top_cut), (0, 0, -1))
    neck_co, neck_no = (0, L["cy"], L["neck"] + neck_up), (0, -0.35, 1)
    _cut(bm, neck_co, neck_no, keep=lambda c: abs(c.x) < 0.10 and c.z > L["sh"].z)
    _tag(bm, role, NECK, neck_co, neck_no)
    for s, sx in (("l", 1), ("r", -1)):
        hand, d = L["wrist"][s]
        co = hand - d * 0.012
        _cut(bm, co, d, keep=lambda c, sx=sx: c.x * sx > 0.3)
        _tag(bm, role, CUFF, co, d)
    _ease(bm, ease, L["tree"], clear=0.02)

    # skirt: the bottom loop grown down, rounding toward an ellipse, never tucking in, and clear of the
    # trousers row by row (their hull, so the seat's cleft doesn't crease the jacket)
    loop = min(_loops(bm), key=lambda lp: sum(v.co.z for v in lp) / len(lp))
    c = sum((v.co for v in loop), Vector()) / len(loop)
    # even out the cut edge first (where the cut grazed a vertex it zig-zags, and a zig-zag grown
    # downward makes a column of inside-out faces: a slit)
    n = len(loop)
    for _ in range(6):
        xy = [(v.co.x, v.co.y) for v in loop]
        for i, v in enumerate(loop):
            a, b = xy[i - 1], xy[(i + 1) % n]
            v.co.x = 0.5 * xy[i][0] + 0.25 * (a[0] + b[0])
            v.co.y = 0.5 * xy[i][1] + 0.25 * (a[1] + b[1])
    # one angle per column, strictly increasing around the loop
    raw = [math.atan2(v.co.y - c.y, v.co.x - c.x) for v in loop]
    if sum(((raw[(i + 1) % n] - raw[i] + math.pi) % math.tau) - math.pi for i in range(n)) < 0:
        loop.reverse()
        raw.reverse()
    unwrapped = [raw[0]]
    for i in range(1, n):
        d = ((raw[i] - raw[i - 1] + math.pi) % math.tau) - math.pi
        unwrapped.append(max(unwrapped[-1] + 1e-4, unwrapped[-1] + d))
    col_angle = {v: unwrapped[i] for i, v in enumerate(loop)}
    rows = max(2, int(round(skirt / 0.015)))
    step = skirt / rows

    def ang(p):
        return math.atan2(p.y - c.y, p.x - c.x)

    hulls = [None] * (rows + 1)
    if trousers_bm is not None:
        for k in range(1, rows + 1):
            z = top_cut - k * step
            pts = [(v.co.x, v.co.y) for v in trousers_bm.verts if abs(v.co.z - z) < 0.02]
            hulls[k] = _hull(pts) if len(pts) >= 3 else None
    rx = max(abs(v.co.x - c.x) for v in loop) + 0.01
    ry = max(abs(v.co.y - c.y) for v in loop) + 0.01
    last = {}

    def shape(k, v, p):
        a = col_angle[v]
        r0 = last.get(v, Vector((v.co.x - c.x, v.co.y - c.y)).length)
        re = 1.0 / math.sqrt((math.cos(a) / rx) ** 2 + (math.sin(a) / ry) ** 2) + 0.004 * k
        r = r0 + (re - r0) * 0.25
        hr = _hull_radius(hulls[k], (c.x, c.y), a) + 0.012 if hulls[k] else 0.0
        r = max(r, r0, hr)
        last[v] = r
        return Vector((c.x + math.cos(a) * r, c.y + math.sin(a) * r, p.z))

    _extrude_down(bm, loop, rows, skirt / rows, shape)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    if not vopen:
        if point:
            # a doublet's waist dips to a point at the front
            lo = top_cut - skirt
            for sx in (1, -1):
                _cut(bm, (0, 0, lo), Vector((sx * point, 0, -1.0)), keep=lambda p, sx=sx: p.z < top_cut and p.x * sx >= -0.01)
        return bm, role
    # front opening: a V from the waist button up to the collar, and the fronts curving apart below
    bz = L["button"]
    gz = gorge_z if gorge_z is not None else L["sh"].z - 0.0
    front = L["cy"] - 0.02
    lo = top_cut - skirt - 0.01

    def half_width(z):
        return gorge * (z - bz) / (gz - bz) if z >= bz else cut_away * (bz - z)

    for sx in (1, -1):
        up = Vector((sx * gorge, 0, gz - bz))
        _cut(bm, (0, 0, bz), Vector((up.z, 0, -up.x)), clear=False,
             keep=lambda p: p.y < front and p.z > bz - 0.02 and abs(p.x) < 0.2)
        dn = Vector((sx * cut_away * (bz - lo), 0, lo - bz))
        _cut(bm, (0, 0, bz), Vector((dn.z, 0, -dn.x)), clear=False,
             keep=lambda p: p.y < front and p.z < bz + 0.02 and abs(p.x) < 0.2)
    gone = [f for f in bm.faces
            if (lambda p: p.y < front and abs(p.x) < half_width(p.z) - 1e-4)(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    return bm, role


def shirt(ob, L, material, ease=0.002):
    """The shirt front and collar: the tights from just above the waistband to the neck, 2 mm out, skinned
    like the body (it only shows inside the jacket's V and at the collar)."""
    bm = _tights(ob)
    _cut(bm, (0, 0, L["waist"] + 0.01), (0, 0, -1))
    _cut(bm, (0, L["cy"], L["neck"] + 0.025), (0, -0.35, 1), keep=lambda c: abs(c.x) < 0.10 and c.z > L["sh"].z)
    _cut(bm, (0, 0, 0), (1, 0, 0), keep=lambda c: c.x > L["sh"].x + 0.02)
    _cut(bm, (0, 0, 0), (-1, 0, 0), keep=lambda c: c.x < -L["sh"].x - 0.02)
    _ease(bm, ease, L["tree"], clear=0.008, iters=4)
    me = bpy.data.meshes.new("shirt")
    bm.to_mesh(me)
    bm.free()
    sob = bpy.data.objects.new("shirt", me)
    bpy.context.scene.collection.objects.link(sob)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    return sob


def _outer_hit(tree, origin, d, max_dist):
    far, o, travelled = None, origin.copy(), 0.0
    for _ in range(12):
        hit, _n, _i, dist = tree.ray_cast(o, d, max_dist - travelled)
        if hit is None:
            break
        travelled += dist + 1e-4
        far = travelled
        o = hit + d * 1e-4
    return far


KINDS = {
    # 1970s two-piece: flared trousers, single-breasted jacket with a V and lapels
    "suit": (dict(hem_r=0.078), dict()),
    # c. 1600 Dutch: knee breeches gathered at the knee, closed doublet with a short skirt and high neck
    "voc": (dict(breeches=True, puff_r=0.14), dict(vopen=False, ease=0.010, skirt=0.13, top_cut="waist", neck_up=0.005, point=0.45)),
}


def suit(ob, rig, name, material, cinch=(2, 14), kind="suit"):
    """Jacket and trousers (or doublet and breeches) as one cloth object, so they collide with each other,
    pinned and skinned, unsimulated. Returns (cloth object, landmarks)."""
    import cloth
    L = landmarks(ob, rig)
    tk, jk = KINDS[kind]
    jk = dict(jk)
    if jk.get("top_cut") == "waist":
        jk["top_cut"] = L["waist"] - 0.0
    tbm, trole = trousers(ob, rig, L, **tk)
    jbm, jrole = jacket(ob, rig, L, trousers_bm=tbm, **jk)
    roles = [v[trole] for v in tbm.verts] + [v[jrole] for v in jbm.verts]
    nt = len(tbm.verts)
    me = bpy.data.meshes.new(name)
    jme = bpy.data.meshes.new("_jacket")
    tbm.to_mesh(me)
    jbm.to_mesh(jme)
    tbm.free()
    jbm.free()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.from_mesh(jme)  # appended: trousers' vertices first, then the jacket's
    bpy.data.meshes.remove(jme)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        v.co += Vector((math.sin(v.index * 12.9898), math.sin(v.index * 78.233), math.sin(v.index * 37.719))) * 0.0006
    bm.to_mesh(me)
    rest = [v.co.copy() for v in bm.verts]
    boundary = {v.index for v in bm.verts if v.is_boundary}
    jtree = BVHTree.FromBMesh(bm)
    bm.free()
    tree, _bm = cloth._bvh(ob)
    _bm.free()

    # pin targets: waistband cinched onto the waist, collar and cuffs held where they lie (cuffs pulled
    # in to the wrist a little), and the jacket's shoulder seam from collar to shoulder point
    tgt = {}
    lapel_pins = set()
    cy, sh, sh_y = L["cy"], L["sh"], L["sh_y"]
    for i, r in enumerate(roles):
        p = rest[i]
        if r == WAIST:
            d = Vector((p.x, p.y - cy, 0)).normalized()
            hit = _outer_hit(tree, Vector((0, cy, p.z)), d, 0.4)
            tgt[i] = Vector((0, cy, p.z)) + d * ((hit or 0.0) + 0.009)
        elif r == KNEE:
            # the knee band: gathered in onto the leg just below the knee
            sx = 1 if p.x > 0 else -1
            kc = Vector((sx * abs(L["knee_c"].x), L["knee_c"].y, p.z))
            d = Vector((p.x - kc.x, p.y - kc.y, 0)).normalized()
            # first crossing only: from inside the leg that is its own skin (a farther one is the other leg)
            hit, _n, _fi, dist = tree.ray_cast(kc, d, 0.15)
            tgt[i] = kc + d * ((dist if hit is not None else 0.06) + 0.008)
        elif r == NECK and i >= nt:
            tgt[i] = p.copy()
        elif r == CUFF and i >= nt:
            hand, d = L["wrist"]["l" if p.x > 0 else "r"]
            a = hand - d * 0.012
            off = (p - a) - d * (p - a).dot(d)
            tgt[i] = a + d * (p - a).dot(d) + off.normalized() * min(off.length, 0.05)
    # the waist button: where the two fronts meet, held to the body so the jacket stays closed there
    if jk.get("vopen", True):
        apex = min((i for i in range(nt, len(rest)) if rest[i].y < cy),
                   key=lambda i: abs(rest[i].x) * 3 + abs(rest[i].z - L["button"]))
        for i in range(nt, len(rest)):
            if (rest[i] - rest[apex]).length < 0.018:
                tgt.setdefault(i, rest[i].copy())
        # the lapels' roll line held to the chest over its upper half (the canvas in a real jacket front
        # keeps the fronts from falling open)
        bz, gz = L["button"], L["sh"].z
        for i in boundary:
            p = rest[i]
            if i >= nt and p.y < cy - 0.02 and bz + 0.45 * (gz - bz) < p.z < gz + 0.03 and abs(p.x) < 0.11:
                tgt.setdefault(i, p.copy())
                lapel_pins.add(i)
    kd = KDTree(len(rest) - nt)
    for i in range(nt, len(rest)):
        kd.insert(rest[i], i)
    kd.balance()
    seam = set()
    for sx in (1, -1):
        x = 0.07
        while x < sh.x - 0.005:
            for dy in (-0.012, 0.0, 0.012):
                hit, _n, _fi, _d = jtree.ray_cast(Vector((sx * x, sh_y + dy, sh.z + 0.3)), Vector((0, 0, -1)), 1.0)
                if hit is not None:
                    _co, k, _dd = kd.find(hit)
                    tgt.setdefault(k, rest[k].copy())
                    seam.add(k)
            x += 0.01

    cob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(cob)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    cob.shape_key_add(name="Basis")
    sk = cob.shape_key_add(name="cinch")
    for i, c in tgt.items():
        sk.data[i].co = c
    sk.value = 0.0
    sk.keyframe_insert("value", frame=cinch[0])
    sk.value = 1.0
    sk.keyframe_insert("value", frame=cinch[1])

    # skin weights from the nearest rest body vertex (pins: from where they end up)
    bme = ob.data
    used = sorted({i for p in bme.polygons for i in p.vertices})
    bkd = KDTree(len(used))
    for i in used:
        bkd.insert(ob.matrix_world @ bme.vertices[i].co, i)
    bkd.balance()
    gnames = {g.index: g.name for g in ob.vertex_groups}
    groups = {}
    for i, c in enumerate(rest):
        _co, bi, _d = bkd.find(tgt.get(i, c))
        for g in bme.vertices[bi].groups:
            groups.setdefault(gnames[g.group], []).append((i, g.weight))
    for gname, pairs in groups.items():
        vg = cob.vertex_groups.new(name=gname)
        for i, w in pairs:
            vg.add([i], w, "REPLACE")
    for gname in ("clavicle_l", "clavicle_r", "spine_03", "lowerarm_l", "lowerarm_r", "neck_01", "calf_l", "calf_r"):
        if gname not in cob.vertex_groups:
            cob.vertex_groups.new(name=gname)

    def only(i, pairs):
        for g in cob.vertex_groups:
            g.remove([i])
        for gname, w in pairs:
            cob.vertex_groups[gname].add([i], w, "REPLACE")

    for i, c in tgt.items():
        side = "l" if c.x > 0 else "r"
        if roles[i] == CUFF:
            only(i, [(f"lowerarm_{side}", 1.0)])
        elif roles[i] == KNEE:
            only(i, [(f"calf_{side}", 1.0)])
        elif roles[i] == NECK:
            only(i, [("spine_03", 0.5), ("neck_01", 0.2), (f"clavicle_{side}", 0.3)] if abs(c.x) > 0.03
                 else [("spine_03", 0.7), ("neck_01", 0.3)])
        elif i in seam:
            only(i, [(f"clavicle_{side}", 0.6), ("spine_03", 0.4)])
        elif i in lapel_pins:
            only(i, [("spine_03", 0.75), (f"clavicle_{side}", 0.25)])
    # bending stiffness map: the jacket is canvas-stiff, its sleeves less so; trousers use the base value
    st = cob.vertex_groups.new(name="stiff")
    for i in range(nt, len(rest)):
        st.add([i], 0.5 if abs(rest[i].x) > sh.x + 0.03 else 1.0, "REPLACE")
    pg = cob.vertex_groups.new(name="pin")
    for i in tgt:
        pg.add([i], 1.0, "REPLACE")
    arm = cob.modifiers.new("rig", "ARMATURE")
    arm.object = rig
    cob["n_trousers"] = nt
    # the collar's neck edge, ordered from the right gorge round the back to the left gorge
    neck = [i for i, r in enumerate(roles) if r == NECK and i >= nt]
    neck.sort(key=lambda i: math.atan2(rest[i].x, rest[i].y - cy))
    cob["neck_idx"] = neck
    for s_ in "lr":
        hand, d = L["wrist"][s_]
        ref = Vector((0, 0, 1)) - d * d.z
        ref.normalize()
        side = [i for i, r in enumerate(roles) if r == CUFF and i >= nt and (rest[i].x > 0) == (s_ == "l")]
        side.sort(key=lambda i: math.atan2(ref.cross(d).dot(rest[i] - hand), ref.dot(rest[i] - hand)))
        cob[f"cuff_{s_}"] = side
    print(f"[suit] trousers {nt} verts, jacket {len(rest) - nt} verts, pins {len(tgt)} "
          f"(waist {sum(1 for i in tgt if roles[i] == WAIST)}, neck {sum(1 for i in tgt if roles[i] == NECK)}, "
          f"cuffs {sum(1 for i in tgt if roles[i] == CUFF)}, seam {len(seam)}, lapel {len(lapel_pins)})", flush=True)
    return cob, L


def skin(target, ob, rig):
    """Give target the weights of the nearest rest-pose body vertex, and an Armature modifier."""
    bme = ob.data
    used = sorted({i for p in bme.polygons for i in p.vertices})
    kd = KDTree(len(used))
    for i in used:
        kd.insert(ob.matrix_world @ bme.vertices[i].co, i)
    kd.balance()
    gnames = {g.index: g.name for g in ob.vertex_groups}
    vgs = {}
    for v in target.data.vertices:
        _co, bi, _d = kd.find(target.matrix_world @ v.co)
        for g in bme.vertices[bi].groups:
            n = gnames[g.group]
            if n not in vgs:
                vgs[n] = target.vertex_groups.new(name=n)
            vgs[n].add([v.index], g.weight, "REPLACE")
    m = target.modifiers.new("rig", "ARMATURE")
    m.object = rig
