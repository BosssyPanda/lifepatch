"""Suit details built in the rest pose and carried onto the simulated garment: lapels, collar, pockets,
button, tie, shirt collar points, shoes.

Each detail is a small strip of points laid on the rest-pose surface (where the figure stands arms-out and
nothing is in the way). Every point is bound to the triangle it lies on (barycentric position plus height
above the surface), so after the cloth has been simulated into the pose the strip is rebuilt on the same
triangles: the details ride the folds instead of floating or cutting into them.
"""
import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class Surface:
    """A rest-pose surface (vertex positions + triangles) that points can be bound to."""

    def __init__(self, verts, polys):
        self.rest = [Vector(v) for v in verts]
        self.tris = []
        for p in polys:
            for k in range(1, len(p) - 1):
                self.tris.append((p[0], p[k], p[k + 1]))
        self.tree = BVHTree.FromPolygons(self.rest, self.tris)

    def ray(self, origin, direction, dist=2.0):
        hit, _n, _i, _d = self.tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
        return hit

    def normal_at(self, p):
        _loc, n, _i, _d = self.tree.find_nearest(Vector(p))
        return n

    def bind(self, p):
        loc, _n, ti, _d = self.tree.find_nearest(Vector(p))
        a, b, c = (self.rest[i] for i in self.tris[ti])
        n = (b - a).cross(c - a).normalized()
        u, v, w = _bary(loc, a, b, c)
        return ti, u, v, w, (Vector(p) - loc).dot(n)

    def place(self, binds, posed, normals):
        out = []
        for ti, u, v, w, d in binds:
            i, j, k = self.tris[ti]
            p = posed[i] * u + posed[j] * v + posed[k] * w
            n = normals[i] * u + normals[j] * v + normals[k] * w
            face_n = (posed[j] - posed[i]).cross(posed[k] - posed[i])
            if n.dot(face_n) < 0:
                n = -n
            out.append(p + n.normalized() * d)
        return out


def _bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-14:
        return 1.0, 0.0, 0.0
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return 1.0 - v - w, v, w


def surface_of(ob, rest_from_basis=False):
    me = ob.data
    if rest_from_basis and me.shape_keys:
        verts = [d.co.copy() for d in me.shape_keys.key_blocks["Basis"].data]
    else:
        verts = [v.co.copy() for v in me.vertices]
    verts = [ob.matrix_world @ v for v in verts]
    return Surface(verts, [list(p.vertices) for p in me.polygons])


def posed_of(baked):
    me = baked.data
    me.update()
    return [baked.matrix_world @ v.co for v in me.vertices], [v.normal.copy() for v in me.vertices]


class Strip:
    """A grid of rest-pose points (rows x cols) on one surface, to be rebuilt after posing."""

    def __init__(self, name, surf, grid, closed=False, thick=0.003):
        self.name, self.surf, self.closed, self.thick = name, surf, closed, thick
        self.rows, self.cols = len(grid), len(grid[0])
        self.binds = [surf.bind(p) for row in grid for p in row]
        self.rest = [p for row in grid for p in row]

    def build(self, posed, normals, material, sub=1, rest=False):
        pts = self.rest if rest else self.surf.place(self.binds, posed, normals)
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in pts]
        R, C = self.rows, self.cols
        for r in range(R - 1 + (1 if self.closed else 0)):
            r2 = (r + 1) % R
            for c in range(C - 1):
                try:
                    bm.faces.new((vs[r * C + c], vs[r * C + c + 1], vs[r2 * C + c + 1], vs[r2 * C + c]))
                except ValueError:
                    pass
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(material)
        if self.thick:
            s = ob.modifiers.new("thick", "SOLIDIFY")
            s.thickness, s.offset = self.thick, -1.0
        if sub:
            d = ob.modifiers.new("sub", "SUBSURF")
            d.levels = d.render_levels = sub
        return ob


def _front_point(surf, x, z, y0=-1.0, back=-0.02):
    """Where a ray from the front at (x, z) meets the surface. A ray that slips through an opening (the
    jacket's V) and lands on the back takes the nearest front point instead."""
    hit = surf.ray((x, y0, z), (0, 1, 0))
    if hit is None or hit.y > back:
        hit, _n, _i, _d = surf.tree.find_nearest(Vector((x, -0.25, z)))
    return hit


def _lay(surf, p, lift):
    """p moved onto the surface (nearest point) and lifted along its normal."""
    loc, n, _i, _d = surf.tree.find_nearest(Vector(p))
    if n.y > 0.6:  # facing backward: make it face out of the body
        pass
    return loc + n * lift


def lapels(jsurf, L, gorge=0.075, gorge_z=None, wmax=0.095, rows=18, cols=6, roll=0.006, lift=0.003):
    """Two lapels: the jacket front folded back along the V from the waist button to the collar,
    widening to wmax (1970s width) and cut back at the top into a notch."""
    bz = L["button"]
    gz = gorge_z if gorge_z is not None else L["sh"].z
    out = []
    for sx in (1, -1):
        e = Vector((sx * gorge, 0, gz - bz)).normalized()
        lat = Vector((sx * (gz - bz), 0, -gorge)).normalized()
        grid = []
        for r in range(rows):
            t = r / (rows - 1)
            ex, ez = sx * gorge * t, bz + (gz - bz) * t
            if t < 0.8:
                w = wmax * (t / 0.8) ** 0.75
            else:
                w = wmax * (1.0 - 0.62 * (t - 0.8) / 0.2)
            w = max(w, 0.004)
            row = []
            for c in range(-1, cols):
                if c < 0:
                    # the fold: tucks down to the jacket's own edge
                    base = Vector((ex + sx * 0.002, 0, ez))
                    h = 0.0
                else:
                    f = c / (cols - 1)
                    base = Vector((ex, 0, ez)) + lat * (w * f + 0.003)
                    h = lift + roll * (1.0 - f) ** 2
                hit = _front_point(jsurf, base.x, base.z)
                if hit is None:
                    hit = Vector((base.x, -0.2, base.z))
                row.append(_lay(jsurf, hit, h))
            grid.append(row)
        out.append(grid)
    return out


def collar(jsurf, L, neck_pts, width=0.04, cols=5, roll=0.010, lift=0.003):
    """The jacket collar: a band from one gorge around the back of the neck to the other, rolled at
    the neck and lying on the shoulders. neck_pts: the jacket's neck edge, ordered gorge to gorge."""
    cy = L["cy"]
    grid = []
    n = len(neck_pts)
    for i, p in enumerate(neck_pts):
        t = i / (n - 1)
        end = min(t, 1 - t)
        w = width * (0.7 + 0.3 * min(1.0, end / 0.15))
        out = Vector((p.x, p.y - cy, 0)).normalized()
        row = []
        for c in range(-1, cols):
            if c < 0:
                row.append(_lay(jsurf, p + Vector((0, 0, 0.004)), 0.0))
                continue
            f = c / (cols - 1)
            base = p + out * (w * f) * 0.75 + Vector((0, 0, -w * f * 0.65)) + Vector((0, 0, 0.012 * (1 - f)))
            row.append(_lay(jsurf, base, lift + roll * (1 - f) ** 2))
        grid.append(row)
    return grid


def patch(surf, cx, cz, w, h, lift=0.003, rows=4, cols=8, tilt=0.0, y0=-1.0):
    """A flat rectangle on the surface seen from the front (pocket flap, welt)."""
    grid = []
    for r in range(rows):
        row = []
        for c in range(cols):
            x = cx + (c / (cols - 1) - 0.5) * w
            z = cz + (r / (rows - 1) - 0.5) * h + tilt * (c / (cols - 1) - 0.5) * w
            hit = _front_point(surf, x, z, y0)
            row.append(_lay(surf, hit if hit is not None else Vector((x, -0.2, z)), lift))
        grid.append(row)
    return grid


def disc(surf, cx, cz, r, lift=0.004, segs=12, rings=3):
    grid = []
    for k in range(rings):
        rr = r * (k + 1) / rings
        row = []
        for s in range(segs):
            a = s / segs * math.tau
            hit = _front_point(surf, cx + math.cos(a) * rr, cz + math.sin(a) * rr)
            row.append(_lay(surf, hit, lift + 0.002 * (1 - (k / rings) ** 2)))
        grid.append(row)
    return grid


def tie(ssurf, L, top, bottom, knot_w=0.048, blade_w=0.10, rows=16, cols=7):
    """A 1970s wide tie down the shirt front: a knot under the collar, the blade widening to a point."""
    grid = []
    for r in range(rows):
        t = r / (rows - 1)
        z = top + (bottom - top) * t
        if t < 0.12:
            w, h = knot_w * (1 - 0.25 * t / 0.12), 0.011
        else:
            u = (t - 0.12) / 0.88
            w, h = knot_w * 0.75 + (blade_w - knot_w * 0.75) * u, 0.004
        row = []
        for c in range(cols):
            f = c / (cols - 1) - 0.5
            zz = z - (abs(f) * 2) * 0.0 if t < 0.97 else z + abs(f) * 0.06  # pointed tip
            x = f * w
            hit = _front_point(ssurf, x, zz)
            row.append(_lay(ssurf, hit if hit is not None else Vector((x, -0.2, zz)), h * (1 - 0.5 * (2 * f) ** 2)))
        grid.append(row)
    return grid


def collar_points(ssurf, L, z_top, rows=6, cols=5, tip=(0.052, 0.062)):
    """The shirt's collar points either side of the knot: triangles from the neckline down to a tip."""
    out = []
    for sx in (1, -1):
        grid = []
        tx, tz = sx * tip[0], z_top - tip[1]
        for r in range(rows):
            t = r / (rows - 1)
            row = []
            for c in range(cols):
                f = c / (cols - 1)
                x0, z0 = sx * (0.02 + 0.055 * f), z_top - 0.004 - 0.012 * f
                x, z = x0 + (tx - x0) * t, z0 + (tz - z0) * t
                hit = _front_point(ssurf, x, z)
                row.append(_lay(ssurf, hit, 0.004 + 0.002 * (1 - t)))
            grid.append(row)
        out.append(grid)
    return out


def shoes(ob, L, material, margin=0.006, step=0.012, n=28):
    """Shoes lofted round the feet: the foot below the ankle line sliced from toe to heel, each slice's
    convex hull (which closes the gaps between the toes into one toe cap) pushed out by margin, the sole
    flat. Skinned to the body afterwards, so the pose carries them."""
    import robe_loft
    import numpy as np
    me = ob.data
    top = L["ankle"] + 0.025
    used = {i for p in me.polygons for i in p.vertices}
    floor = L["floor"]
    verts, faces = [], []
    for sx in (1, -1):
        pts = [me.vertices[i].co for i in used if me.vertices[i].co.z < top and me.vertices[i].co.x * sx > 0.04]
        y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
        rings = []
        y = y0 + 0.004
        while y < y1 - 0.002:
            sl = [(p.x, p.z) for p in pts if abs(p.y - y) < step * 0.75]
            if len(sl) >= 3:
                h = robe_loft.hull(sl)
                c = np.mean(np.array(h), axis=0)
                rings.append((y, robe_loft.ring(h, c, n, margin)))
            y += step
        base = len(verts)
        for y, rg in rings:
            for x, z in rg:
                verts.append((x, y, max(z, floor + 0.001)))
        R = len(rings)
        for r in range(R - 1):
            for k in range(n):
                k2 = (k + 1) % n
                faces.append((base + r * n + k, base + r * n + k2, base + (r + 1) * n + k2, base + (r + 1) * n + k))
        for r, cap_y in ((0, rings[0][0] - 0.006), (R - 1, rings[-1][0] + 0.006)):
            ring_pts = [verts[base + r * n + k] for k in range(n)]
            cx = sum(p[0] for p in ring_pts) / n
            cz = sum(p[2] for p in ring_pts) / n
            ci = len(verts)
            verts.append((cx, cap_y, cz))
            for k in range(n):
                faces.append((base + r * n + k, base + r * n + (k + 1) % n, ci))
    sob = _mesh_object("shoes", verts, faces, material)
    bm = bmesh.new()
    bm.from_mesh(sob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(sob.data)
    bm.free()
    d = sob.modifiers.new("sub", "SUBSURF")
    d.levels = d.render_levels = 1
    return sob


def _mesh_object(name, verts, faces, material, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(material)
    return ob


def _rigid(ob, rig, bone):
    """Ride one bone of the rig."""
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    m = ob.modifiers.new("rig", "ARMATURE")
    m.object = rig


def ruff(body, L, material, rig, pleats=30, r_in=0.068, r_out=0.16, depth=0.07, z=None, segs_per=8, ring=14,
         centre=None, axis=None, bone="neck_01", squash=1.06):
    """A millstone ruff (c. 1600): a thick ring round the neck whose rim is a row of rounded pleats; the
    pleats bulge alternately at the top and the bottom, which reads as the figure-eight set of the linen.
    Rounded by subdivision. With centre and axis (and a bone to ride) it is built elsewhere, e.g. a small
    one round each wrist."""
    if centre is None:
        neck = rig.data.bones["neck_01"].head_local
        z = neck.z - 0.004 if z is None else z
        centre = Vector((0, neck.y + 0.012, z))
    axis = Vector((0, 0, 1)) if axis is None else Vector(axis).normalized()
    u = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
    u = (u - axis * u.dot(axis)).normalized()
    v_ = axis.cross(u)
    scallop = 0.022 * (r_out - r_in) / (0.16 - 0.068)
    n = pleats * segs_per
    # cross-section round a rounded box: inner face, bottom, rim, top
    prof = []
    for k in range(ring):
        t = k / ring * math.tau
        prof.append((0.5 + 0.5 * math.copysign(abs(math.cos(t)) ** 0.5, math.cos(t)),
                     math.copysign(abs(math.sin(t)) ** 0.5, math.sin(t))))
    verts, faces = [], []
    m = len(prof)
    for i in range(n):
        a = i / n * math.tau
        ph = math.cos(pleats * a)
        crest = abs(math.cos(pleats * a / 2))  # 1 at each pleat's crest, 0 between pleats
        R = r_out - scallop * (1 - crest ** 0.5)
        for s_, h in prof:
            r = r_in + (R - r_in) * s_
            # top bulges on even pleats, bottom on odd ones, strongest toward the rim
            bulge = 0.25 * s_ * (ph if h > 0 else -ph)
            hh = h * depth * 0.5 * (0.8 + bulge)
            verts.append(tuple(centre + u * (math.cos(a) * r) + v_ * (math.sin(a) * r * squash) + axis * hh))
    for i in range(n):
        i2 = (i + 1) % n
        for k in range(m):
            k2 = (k + 1) % m
            faces.append((i * m + k, i * m + k2, i2 * m + k2, i2 * m + k))
    ob = _mesh_object("ruff", verts, faces, material)
    d = ob.modifiers.new("sub", "SUBSURF")
    d.levels = d.render_levels = 1
    _rigid(ob, rig, bone)
    return ob


def hat(body, L, material, rig, brim_r=0.135, crown_h=0.20, brim_z=None, segs=64):
    """A capotain (c. 1590s to 1640s: a tall, slightly conical crown rounded at the top, a narrow brim,
    a hatband) sized to this head, riding the head bone."""
    vg = {g.name: g.index for g in body.vertex_groups}
    hi = vg["head"]
    me = body.data
    pts = [me.vertices[i].co for i in range(len(me.vertices))
           if any(g.group == hi and g.weight > 0.6 for g in me.vertices[i].groups)]
    top = max(p.z for p in pts)
    bz = top - 0.09 if brim_z is None else brim_z  # worn down to the brow
    ring = [p for p in pts if abs(p.z - bz) < 0.012]
    cx = (max(p.x for p in ring) + min(p.x for p in ring)) / 2
    cy = (max(p.y for p in ring) + min(p.y for p in ring)) / 2
    rx = (max(p.x for p in ring) - min(p.x for p in ring)) / 2 + 0.012
    ry = (max(p.y for p in ring) - min(p.y for p in ring)) / 2 + 0.012
    h = crown_h
    # profile: (r as a fraction of the head, height); None marks the brim (a circle, not the head's oval)
    prof = [(None, -0.004), (None, 0.005), (1.035, 0.008), (1.035, 0.034), (1.0, 0.038),  # brim, hatband
            (0.95, h * 0.3), (0.86, h * 0.55), (0.76, h * 0.74), (0.67, h * 0.84), (0.58, h * 0.92),
            (0.45, h * 0.97), (0.25, h * 1.0), (0.0, h * 1.01)]  # conical, domed over the top
    verts, faces = [], []
    for i in range(segs):
        a = i / segs * math.tau
        for k, (f, z) in enumerate(prof):
            if f is None:
                r = brim_r * (1.0 if k == 0 else 0.98)
                verts.append((cx + math.cos(a) * r, cy + math.sin(a) * r, bz + z))
            else:
                verts.append((cx + math.cos(a) * rx * f, cy + math.sin(a) * ry * f, bz + z))
    m = len(prof)
    for i in range(segs):
        i2 = (i + 1) % segs
        for k in range(m - 1):
            faces.append((i * m + k, i * m + k + 1, i2 * m + k + 1, i2 * m + k))
    ob = _mesh_object("hat", verts, faces, material)
    s = ob.modifiers.new("thick", "SOLIDIFY")
    s.thickness, s.offset = 0.004, 1.0
    d = ob.modifiers.new("sub", "SUBSURF")
    d.levels = d.render_levels = 1
    _rigid(ob, rig, "head")
    return ob


def band(surf, loop_pts, up, width=0.04, cols=4, lift=0.004, roll=0.003, flare=0.0, scallops=0):
    """A turned-back cuff: a closed band on the sleeve from its edge up the arm by width. flare stands the
    free edge off the sleeve (a deep cuff opening toward the elbow, which reads as part of the sleeve; a
    narrow flat band read as a bracelet); scallops cuts that edge into lobes, like lace."""
    grid = []
    n = len(loop_pts)
    for i, p in enumerate(loop_pts):
        edge = 1.0 - (0.12 * (0.5 + 0.5 * math.cos(math.tau * scallops * i / n)) if scallops else 0.0)
        row = []
        for c in range(-1, cols):
            if c < 0:
                row.append(_lay(surf, p, 0.0))
                continue
            f = c / (cols - 1)
            row.append(_lay(surf, p + up * (0.002 + width * f * edge), lift + roll * (1 - f) + flare * f ** 1.5))
        grid.append(row)
    return grid
