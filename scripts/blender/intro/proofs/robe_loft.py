"""Rung 3 of the figure ladder: a plain robe lofted from slices of the posed body (convex hull per slice,
flaring toward the hem), as in proof_robe.py. Standing poses only."""
import math

import bpy
import bmesh  # noqa: E402  (after bpy)
import numpy as np

import kit

ROBE_BONES = {"pelvis", "spine_01", "spine_02", "spine_03", "thigh_l", "thigh_r", "calf_l", "calf_r",
              "clavicle_l", "clavicle_r", "neck_01"}


def hull(pts):
    pts = sorted(set(map(tuple, pts)))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def ring(poly, c, n, margin):
    """Sample a convex polygon at n angles around c (ray to the farthest edge), pushed out by margin."""
    P = np.array(poly)
    out_pts = []
    for k in range(n):
        a = k / n * math.tau
        d = np.array([math.cos(a), math.sin(a)])
        best = 0.0
        for i in range(len(P)):
            p, q = P[i] - c, P[(i + 1) % len(P)] - c
            e = q - p
            den = d[0] * e[1] - d[1] * e[0]
            if abs(den) < 1e-9:
                continue
            t = (p[0] * e[1] - p[1] * e[0]) / den
            u = (p[0] * d[1] - p[1] * d[0]) / den
            if t > 0 and -1e-6 <= u <= 1 + 1e-6:
                best = max(best, t)
        out_pts.append(c + d * (best + margin))
    return out_pts


def robe_for(ob, name, material, hem_flare=0.07):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    names = {g.index: g.name for g in ob.vertex_groups}
    used = {i for p in me.polygons for i in p.vertices}
    pts = []
    for i in used:
        v = me.vertices[i]
        w = sum(g.weight for g in v.groups if names.get(g.group) in ROBE_BONES)
        if w > 0.6:
            pts.append(mw @ v.co)
    ev.to_mesh_clear()
    P = np.array([tuple(p) for p in pts])
    z0 = P[:, 2].min() + 0.06           # hem: just above the ankles
    z1 = np.percentile(P[:, 2], 99.0) - 0.06  # neckline
    n, rings_ = 48, []
    zs = np.linspace(z0, z1, 40)
    for j, z in enumerate(zs):
        sl = P[np.abs(P[:, 2] - z) < 0.025][:, :2]
        if len(sl) < 6:
            continue
        hpoly = hull(sl)
        c = np.array(hpoly).mean(axis=0)
        t = (z1 - z) / (z1 - z0)                     # 0 at the neck, 1 at the hem
        margin = 0.012 + hem_flare * t ** 1.6
        rings_.append((z, ring(hpoly, c, n, margin)))
    bm = bmesh.new()
    vr = [[bm.verts.new((x, y, z)) for x, y in r] for z, r in rings_]
    for a, b in zip(vr, vr[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rob_ob = kit.from_bmesh(name, bm, material)
    sm = rob_ob.modifiers.new("smooth", "SMOOTH")
    sm.factor, sm.iterations = 0.8, 6
    rob_ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.008
    sd = rob_ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    return rob_ob
