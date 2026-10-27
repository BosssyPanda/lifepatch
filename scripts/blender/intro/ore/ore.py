"""Scene one's hero, the gold ore, built from scratch in code (no downloads, no generated models).

It is a natural gold nugget, sculpted as a signed distance field (sdf.py) and meshed by marching
cubes, because a nugget is full of overhangs, folds and hollows that pushing a mesh's vertices
outwards cannot make. Built up the way a nugget looks, from the large forms down:

- an egg-shaped body, its top drawn to a blunt point (the approved overview's silhouette);
- lumps melted onto it and broad dents pressed into it, some soft, some with a sharp seam;
- here and there a high point worn flat, as stream gravel grinds a nugget;
- the surface broken into rounded knobs by grooves, large knobs in some places, small in others,
  the grooves deep in some places and fused shut in others; and long wandering folds;
- clusters of small pits, none in some places;
- hollows along a vein that winds round it, holding the dark host rock, some with broken
  milky quartz wedged in;
- the crack down the front that the camera dives into, cut into smooth gold, its floor a
  separate glowing material.

The surface finish is in the materials: the worn highs polished, the hollows duller and grimy,
grey dirt packed into the deepest grooves and pits, a hammered dimpling everywhere but the
polished highs. The materials read how high or sunken each point is from vertex attributes
(`relief_*`) measured on the mesh, so they bake to textures exactly as they render here.

    python scripts/blender/intro/ore/ore.py --out DIR --hdr studio.hdr [--views front,back,close]

renders look-dev views lit by the studio HDR (studio.py).
Units are metres; the finished ore stands ORE_HEIGHT tall with its foot at z=0, front facing -Y.
The shape is made in the unit ore's space (height 2, z from -1 to 1) and scaled down at the end.
"""
import argparse
import math
import os
import sys
import time

import bpy
import bmesh
import numpy as np
from mathutils import Vector, noise
from scipy import ndimage
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import kit  # noqa: E402
import sdf  # noqa: E402

ORE_HEIGHT = 1.1
SEED = 5

# The crack the camera dives into, as (x, z) points on the front face in the unit ore's space
# (height 2, z from -1 to 1), top to bottom.
CRACK = [(-0.10, 0.62), (0.02, 0.38), (-0.06, 0.14), (0.07, -0.12), (0.0, -0.36), (0.05, -0.56)]
CRACK_W = 0.08       # largest half-width of the slit at the surface (its glowing floor is half that)
CRACK_D = 0.16       # how deep it is cut

ROCK = "#262422"     # neutral dark grey (DESIGN.md: no warm browns)
ROCK_LIGHT = "#55524e"
DIRT = "#1b1815"     # as faintly warm as ROCK, so beside the gold it does not read blue     # the grime packed into the gold's grooves: grey, not brown (no colour casts)
QUARTZ = "#d3cfc6"   # milky quartz, below white so lit faces keep their shading
QUARTZ_GLASS = "#8f8c87"  # the clearer, glassy patches in it
ORE_GOLD = (1.0, 0.65, 0.19)     # linear; rendered hue ~38° (amendment G: 37-41°)
WORN_GOLD = (1.0, 0.70, 0.25)    # linear; the polished highs, a touch paler and yellower
DEEP_GOLD = (0.80, 0.45, 0.11)   # linear; the hollows

GOLD_K, ROCK_K, CRACK_K = 0, 1, 2
MATERIAL_OF = np.array([0, 1, 2])

VOXEL = 0.006        # the sculpt's resolution, in the unit ore's space (3.3 mm on the finished ore)
GRID_LO, GRID_HI = (-0.8, -0.72, -0.95), (0.82, 0.72, 1.12)
FOOT = -0.9          # the flat foot it stands on

_T0 = time.time()


def _log(*a):
    print(f"[ore {time.time() - _T0:5.0f}s]", *a, flush=True)


# --------------------------------------------------------------------------------------------
# The crack
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


def crack_np(x, z):
    """crack_at for whole arrays at once (its noise depends on z alone, so it is looked up once
    per distinct z)."""
    x, z = np.broadcast_arrays(np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64))
    zs, inv = np.unique(z, return_inverse=True)
    shift = np.array([0.012 * noise.noise(Vector((0.0, 3.7, q * 16.0))) + 0.006 * noise.noise(Vector((1.3, 0.0, q * 40.0)))
                      for q in zs])[inv].reshape(z.shape)
    vary = np.array([0.8 + 0.4 * noise.noise(Vector((q * 9.0, 2.0, 0.0))) for q in zs])[inv].reshape(z.shape)
    x = x + shift
    best = np.full(x.shape, 9.0)
    along = np.zeros(x.shape)
    n = len(CRACK) - 1
    for k, (a, b) in enumerate(zip(CRACK, CRACK[1:])):
        dx, dz = b[0] - a[0], b[1] - a[1]
        t = np.clip(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0.0, 1.0)
        dist = np.hypot(x - a[0] - t * dx, z - a[1] - t * dz)
        closer = dist < best
        best = np.where(closer, dist, best)
        along = np.where(closer, (k + t) / n, along)
    return best, CRACK_W * (0.25 + 0.75 * np.sin(np.pi * along) ** 0.7) * vary


def _front(g, d):
    """For each (x, z) column of the grid, the y where the solid begins seen from the front."""
    inside = d < 0
    j = inside.argmax(axis=1)
    ii, kk = np.meshgrid(np.arange(g.shape[0]), np.arange(g.shape[2]), indexing="ij")
    a = d[ii, np.maximum(j - 1, 0), kk]
    b = d[ii, j, kk]
    y = g.axes[1][j] - g.h * np.clip(b / np.minimum(b - a, -1e-9), 0, 1)
    return np.where(inside.any(axis=1), y, 9.0)


def _cut_crack(g, d):
    """Cut the crack into the front: a slit whose sides close in a parabola down to its floor, as
    deep as CRACK_D everywhere, ragged edged. Returns the front surface it was cut from."""
    front = _front(g, d)
    xs = slice(int((-0.4 - g.lo[0]) / g.h), int((0.4 - g.lo[0]) / g.h) + 1)
    zs = slice(int((-0.8 - g.lo[2]) / g.h), int((0.8 - g.lo[2]) / g.h) + 1)
    X, _, Z = g.coords((xs, slice(None), zs))
    c, w = crack_np(X[:, :, 0], Z[0, :, :])                # (x, z)
    Y = g.axes[1][None, :, None]
    t = (Y - front[xs, None, zs]) / CRACK_D
    slit = np.maximum(c[:, None, :] - w[:, None, :] * np.sqrt(np.clip(1.0 - t, 0.0, None)), (t - 1.0) * CRACK_D)
    d[xs, :, zs] = sdf.smax(d[xs, :, zs], -slit.astype(np.float32), 0.006)
    return front


def _crack_line():
    """The crack as a dense run of (x, z) points, for distances to whole arrays at once."""
    pts = []
    for a, b in zip(CRACK, CRACK[1:]):
        for t in np.linspace(0, 1, 12, endpoint=False):
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    pts.append(CRACK[-1])
    return np.array(pts)


def _calm(X, Y, Z):
    """1 in most places, falling to 0 on the front within reach of the crack: the crack is cut
    into smooth gold, so the knobs and folds fade out round it."""
    line = _crack_line()
    near = np.full(np.broadcast(X, Y, Z).shape, 9.0)
    for cx, cz in line:
        near = np.minimum(near, np.sqrt((X - cx) ** 2 + (Z - cz) ** 2))
    return np.where(np.broadcast_to(Y < 0.1, near.shape), np.clip((near - 0.1) / 0.15, 0, 1), 1.0)


def _near_crack(p, margin):
    return p[1] < 0.1 and -0.8 < p[2] < 0.8 and crack_dist(p[0], p[2]) < margin


def _vein(p, off):
    """Signed distance-like value to the vein: a wavy plane cutting diagonally round the ore."""
    vn = Vector((0.80, 0.22, 0.56)).normalized()
    return p.dot(vn) - 0.04 + 0.12 * noise.noise(p * 1.8 + off) + 0.04 * noise.noise(p * 5.0 + off)


# --------------------------------------------------------------------------------------------
# The form
# --------------------------------------------------------------------------------------------


def _turn(rng, deg):
    """A rotation by up to `deg` degrees about a random axis."""
    ax = rng.standard_normal(3)
    ax /= np.linalg.norm(ax)
    a = math.radians(deg) * rng.uniform(-1, 1)
    k = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    return np.eye(3) + math.sin(a) * k + (1 - math.cos(a)) * k @ k


def _facing(n, rng):
    """A rotation whose third axis is n: an ellipsoid's short axis along the surface normal."""
    n = n / np.linalg.norm(n)
    t = rng.standard_normal(3)
    t -= n * t.dot(n)
    t /= np.linalg.norm(t)
    return np.stack([t, np.cross(n, t), n], axis=1)


def _ellipsoids(g, d, sites, rng, size, shape, sink, melt, op):
    """Press an ellipsoid into the field at each (point, normal) site: radius log-uniform in
    `size`, axes scaled by `shape`, its centre `sink` radii in along the normal (out if negative),
    blended over `melt` radii."""
    for p, n in sites:
        r = math.exp(rng.uniform(math.log(size[0]), math.log(size[1])))
        r *= min(1.0, max(0.4, 1.4 - p[2]))          # nothing big on the narrowing top
        radii = (r, r * rng.uniform(*shape[0]), r * rng.uniform(*shape[1]))
        rot = _facing(n + rng.standard_normal(3) * 0.4, rng)
        c = p - n * r * rng.uniform(*sink)
        k = r * rng.uniform(*melt)
        sdf.paint(g, d, c, r + k + 0.02, lambda X, Y, Z: sdf.ellipsoid(X, Y, Z, c, radii, rot),
                  lambda a, b: op(a, b, k))


def _wear(g, d, sites, rng):
    """A high point ground flat: a plane just under the surface, its edge rounded, fading out
    over a patch so it does not slice the whole ore."""
    for p, n in sites:
        q = p - n * rng.uniform(0.015, 0.045)
        m = n + rng.standard_normal(3) * 0.15
        m /= np.linalg.norm(m)
        reach = rng.uniform(0.12, 0.22)
        sl = g.block(q, reach)
        if sl is None:
            continue
        X, Y, Z = g.coords(sl)
        plane = (X - q[0]) * m[0] + (Y - q[1]) * m[1] + (Z - q[2]) * m[2]
        w = np.clip(1.5 - np.sqrt((X - q[0]) ** 2 + (Y - q[1]) ** 2 + (Z - q[2]) ** 2) / reach * 1.5, 0, 1)
        w = w * w * (3 - 2 * w)
        a = d[sl]
        d[sl] = a + (sdf.smax(a, plane, 0.03) - a) * w


def _surface_relief(g, d, rng, knob, fold):
    """Knobs and folds, worked only on the voxels near the surface (they move it by less than the
    band is deep). Knobs: Voronoi cells, each a rounded knob, the grooves between them round at
    the bottom and the rim; large cells in some places, small in others, the grooves deep in some
    places and shut in others. Folds: long creases that wander (domain-warped noise)."""
    band = knob + fold * 1.4 + 3 * g.h
    idx = np.nonzero(np.abs(d) < band)
    P = np.stack([g.axes[i][idx[i]] for i in range(3)], 1).astype(np.float64)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    calm = _calm(x, y, z)

    wiggle = [sdf.Noise(g, rng, 0.3) for _ in range(3)]
    Pw = P + 0.05 * np.stack([w.at(x, y, z) for w in wiggle], 1)
    sizes = sdf.Noise(g, rng, 0.5)
    cand = rng.uniform(g.lo, g.hi, size=(200000, 3))
    dense = np.clip(0.06 + 0.5 * (sizes.at(cand[:, 0], cand[:, 1], cand[:, 2]) + 0.4), 0.03, 0.5) ** 2
    seeds = cand[rng.uniform(0, 1, len(cand)) < dense]
    dd, _ = cKDTree(seeds).query(Pw, k=2)
    edge = dd[:, 1] - dd[:, 0]
    cell = np.maximum(dd[:, 1], 1e-3)
    deep = sdf.Noise(g, rng, 0.25).at(x, y, z)
    runs = sdf.Noise(g, rng, 0.07).at(x, y, z)           # breaks the grooves into separate runs
    depth = (knob * np.clip(0.45 + 0.6 * deep, 0, 1) * np.clip(0.2 + 0.8 * runs, 0, 1)
             * np.clip(cell / 0.12, 0.25, 1.0))
    t = np.clip(edge / np.clip(0.25 * cell, 0.02, 0.05), 0, 1)
    change = depth * (1 - t * t * (3 - 2 * t))
    _log("knobs:", len(seeds), "cells")

    warp = [sdf.Noise(g, rng, 0.45) for _ in range(3)]
    Pw = P + 0.09 * np.stack([w.at(x, y, z) for w in warp], 1)
    amount = np.clip(0.55 + 0.6 * sdf.Noise(g, rng, 0.7).at(x, y, z), 0.0, 1.0)
    for size, amp in ((0.24, fold), (0.1, fold * 0.4)):
        n = sdf.Noise(g, rng, size).at(Pw[:, 0], Pw[:, 1], Pw[:, 2])
        t = np.clip(np.abs(n) / 0.4, 0, 1)
        change += amp * amount * (1 - t * t * (3 - 2 * t))
    d[idx] += (change * calm).astype(np.float32)


def _pits(g, d, rng, count):
    """Clusters of small hollows, elongated and turned every way, thick in places, none in others."""
    pts, nrm = g.surface_points(d, rng, count, 0.03)
    dens = sdf.Noise(g, rng, 0.35)
    made = 0
    for p, n in zip(pts, nrm):
        if _near_crack(p, 0.16) or dens.at(p[0], p[1], p[2]) < rng.uniform(0.3, 2.2):
            continue
        for _ in range(rng.integers(1, 4)):
            r = math.exp(rng.uniform(math.log(0.012), math.log(0.032)))
            radii = (r, r * rng.uniform(0.4, 0.75), r * rng.uniform(0.35, 0.6))
            rot = _facing(n, rng) @ _turn(rng, 50)
            c = p + n * r * rng.uniform(0.0, 0.5) + rng.standard_normal(3) * r * 0.7
            k = r * 0.3
            sdf.paint(g, d, c, r + k + 0.01, lambda X, Y, Z: sdf.ellipsoid(X, Y, Z, c, radii, rot),
                      lambda a, b: sdf.smax(a, -b, k))
            made += 1
    return made


def _vugs(g, d, rng, count):
    """Hollows along the vein, each holding host rock that fills it to below the gold rim.
    Returns the rock's field and the hollows as (point, normal, radius)."""
    pts, nrm = g.surface_points(d, rng, 4000, 0.05)
    off = Vector((3.0, -7.0, 11.0))
    vein = np.array([abs(_vein(Vector(p), off)) for p in pts])
    vugs = []
    for i in np.argsort(vein):
        p, n = pts[i], nrm[i]
        if vein[i] > 0.1 or len(vugs) >= count:
            break
        if _near_crack(p, 0.3) or abs(p[2]) > 0.75 or any(np.linalg.norm(p - q) < 0.2 for q, _, _ in vugs):
            continue
        vugs.append((p, n, rng.uniform(0.07, 0.13)))
    rock = np.full(g.shape, 10.0, np.float32)
    for p, n, r in vugs:
        # an irregular hollow: a main pocket and two or three smaller ones run into it
        parts = [(p, r)]
        for _ in range(rng.integers(2, 4)):
            t = rng.standard_normal(3)
            t -= n * t.dot(n)
            q = p + t / np.linalg.norm(t) * r * rng.uniform(0.5, 0.85)
            q = q - g.normals(d, q[None])[0] * g.sample(d, q[None])[0]   # back onto the curved surface
            parts.append((q, r * rng.uniform(0.45, 0.7)))
        for q, rq in parts:
            radii = (rq, rq * rng.uniform(0.6, 0.9), rq * 0.55)
            rot = _facing(n, rng)
            c = q + n * rq * 0.1
            sdf.paint(g, d, c, rq + 0.05, lambda X, Y, Z: sdf.ellipsoid(X, Y, Z, c, radii, rot),
                      lambda a, b: sdf.smax(a, -b, 0.012))
            fill = tuple(x * 0.9 for x in radii)
            cf = c - n * rq * rng.uniform(0.9, 1.05)
            sdf.paint(g, rock, cf, rq + 0.05, lambda X, Y, Z: sdf.ellipsoid(X, Y, Z, cf, fill, rot),
                      np.minimum)
    # the rock's blocky granules: Voronoi chunks, each raised its own amount
    seeds = rng.uniform(g.lo, g.hi, size=(int(np.prod(g.hi - g.lo) / 0.025 ** 3 * 0.6), 3))
    tree = cKDTree(seeds)
    lift = rng.uniform(0, 1, len(seeds))
    for p, n, r in vugs:
        sl = g.block(p, r + 0.06)
        X, Y, Z = (np.broadcast_to(a, rock[sl].shape) for a in g.coords(sl))
        dd, ii = tree.query(np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1), k=2)
        edge = (dd[:, 1] - dd[:, 0]).reshape(X.shape)
        rock[sl] -= (lift[ii[:, 0]].reshape(X.shape) * 0.011 + np.minimum(edge, 0.006) * 0.8).astype(np.float32)
    return rock, vugs


def nugget(seed=SEED, h=VOXEL):
    """The nugget's gold and rock as signed distance fields on one grid, and its rock hollows."""
    rng = np.random.default_rng(seed)
    g = sdf.Grid(GRID_LO, GRID_HI, h)
    X, Y, Z = g.coords()
    d = np.full(g.shape, 10.0, np.float32)
    for c, r in (((0.0, 0.0, -0.36), (0.56, 0.45, 0.60)), ((0.015, 0.0, 0.12), (0.48, 0.39, 0.55)),
                 ((0.045, -0.01, 0.48), (0.38, 0.31, 0.46)), ((0.07, 0.0, 0.76), (0.22, 0.18, 0.25))):
        d = sdf.smin(d, sdf.ellipsoid(X, Y, Z, c, r, _turn(rng, 8)), 0.3)
    d += (0.05 * sdf.Noise(g, rng, 0.5).at(X, Y, Z)).astype(np.float32)
    _log("body", g.shape)
    pts, nrm = g.surface_points(d, rng, 55, 0.16)
    _ellipsoids(g, d, zip(pts, nrm), rng, (0.07, 0.22), ((0.6, 1.0), (0.4, 0.75)), (0.25, 0.6), (0.12, 0.6), sdf.smin)
    pts, nrm = g.surface_points(d, rng, 22, 0.2)
    keep = [(p, n) for p, n in zip(pts, nrm) if not _near_crack(p, 0.2) and abs(p[2]) < 0.6]
    _ellipsoids(g, d, keep, rng, (0.08, 0.2), ((0.5, 0.9), (0.35, 0.6)), (-0.6, -0.35), (0.5, 0.5),
                lambda a, b, k: sdf.smax(a, -b, k))
    pts, nrm = g.surface_points(d, rng, 14, 0.3)
    _wear(g, d, [(p, n) for p, n in zip(pts, nrm) if not _near_crack(p, 0.25)], rng)
    _log("lumps, dents, worn faces")
    _surface_relief(g, d, rng, knob=0.024, fold=0.025)
    _log("knobs and folds")
    _log("pits:", _pits(g, d, rng, 700))
    rock, vugs = _vugs(g, d, rng, 7)
    _log("rock hollows:", len(vugs))
    front = _cut_crack(g, d)
    # nothing finer than the voxels can carry: soften by a voxel so no edge is a staircase
    d = ndimage.gaussian_filter(d, 0.8)
    rock = ndimage.gaussian_filter(rock, 0.5)
    d = sdf.smax(d, -(Z - FOOT), 0.03)
    rock = sdf.smax(rock, -(Z - FOOT), 0.03)
    return g, d, rock, front, vugs, rng


def _mesh_object(name, v, f, mat_index):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v))
    me.vertices.foreach_set("co", v.astype(np.float32).ravel())
    me.loops.add(f.size)
    me.loops.foreach_set("vertex_index", f.astype(np.int32).ravel())
    me.polygons.add(len(f))
    me.polygons.foreach_set("loop_start", (np.arange(len(f)) * 3).astype(np.int32))
    me.polygons.foreach_set("material_index", mat_index.astype(np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(len(f), bool))
    me.update()
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _attributes(ob, v, f):
    """What the materials read, stored on the vertices so they survive scaling and baking:
    `unit_co`, the point in the unit ore's space (the textures' coordinates); and `relief_fine`,
    `relief_mid`, `relief_broad`, how far the point stands out from (positive) or sinks into
    (negative) its surroundings at three sizes, in standard deviations."""
    me = ob.data
    a = me.attributes.new("unit_co", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", v.astype(np.float32).ravel())
    n = sdf.vertex_normals(v, f)
    avg = sdf.smoother(v, f)
    for name, it in (("relief_fine", 6), ("relief_mid", 40), ("relief_broad", 200)):
        r = sdf.relief(v, f, n, avg, it)
        r /= max(r.std(), 1e-9)
        a = me.attributes.new(name, "FLOAT", "POINT")
        a.data.foreach_set("value", r.astype(np.float32))


def build_mesh(seed=SEED, h=VOXEL):
    g, gold, rock, front, vugs, rng = nugget(seed, h)
    v, f = sdf.mesh(g, sdf.smin(gold, rock, 0.008))   # a hair of blend: no staircase where they meet
    apart = g.sample(gold, v) - g.sample(rock, v)          # > 0 where the rock is the surface
    kind = np.where(apart > 0, ROCK_K, GOLD_K)
    _log("mesh:", len(v), "vertices")
    # the crack's floor glows; its walls are duller than the open gold (`crack_wall`)
    c, w = crack_np(v[:, 0], v[:, 2])
    surface = ndimage.map_coordinates(front, [(v[:, 0] - g.lo[0]) / g.h, (v[:, 2] - g.lo[2]) / g.h], order=1, mode="nearest")
    down = v[:, 1] - surface
    slit = (np.abs(v[:, 2]) < 0.8) & (down < CRACK_D * 1.1)       # not the back, on the same line
    kind[slit & (c < w * 0.5) & (down > CRACK_D * 0.5)] = CRACK_K
    wall = np.where(slit & (c < w * 1.1), np.clip(down / 0.04, 0, 1), 0.0)
    fk = kind[f]
    face = np.where((fk[:, 0] == fk[:, 1]) | (fk[:, 0] == fk[:, 2]), fk[:, 0], fk[:, 1])
    ob = _mesh_object("ore_hi", v, f, MATERIAL_OF[face])
    _attributes(ob, v, f)
    a = ob.data.attributes.new("crack_wall", "FLOAT", "POINT")
    a.data.foreach_set("value", wall.astype(np.float32))
    a = ob.data.attributes.new("rock", "FLOAT", "POINT")
    a.data.foreach_set("value", np.clip(0.5 + apart / 0.006, 0, 1).astype(np.float32))
    _log("attributes")
    return ob, vugs, rng


def _fragment(bm, centre, r, rng, worn=None):
    """One piece of broken quartz: a lump knapped by flat fracture planes, crisp edged. `worn`,
    a (point, normal) plane, grinds off whatever stands above it, as the stream wore it down
    with the gold round it."""
    made = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)["verts"]
    rot = sdf.random_rotation(rng)
    radii = np.array([1.0, rng.uniform(0.6, 0.9), rng.uniform(0.45, 0.75)]) * r
    for v in made:
        v.co = Vector(rot @ (np.array(v.co) * radii))
    for _ in range(rng.integers(7, 11)):
        dvec = Vector(rng.standard_normal(3)).normalized()
        top = max(v.co.dot(dvec) for v in made)
        cut = top - rng.uniform(0.1, 0.35) * r
        for v in made:
            t = v.co.dot(dvec)
            if t > cut:
                v.co -= dvec * (t - cut)
    for v in made:
        v.co += Vector(centre)
        if worn is not None:
            over = (np.array(v.co) - worn[0]).dot(worn[1])
            if over > 0:
                v.co -= Vector(worn[1] * over)


def quartz(vugs, rng):
    """Broken milky quartz wedged into some of the rock hollows, a big piece and a few chips."""
    bm = bmesh.new()
    for p, n, r in vugs[::2]:
        worn = (p - n * r * 0.08, n)                  # a little under the gold rim
        _fragment(bm, p - n * r * 0.2, r * rng.uniform(0.5, 0.6), rng, worn)
        for _ in range(rng.integers(2, 5)):
            t = rng.standard_normal(3)
            t -= n * t.dot(n)
            _fragment(bm, p - n * r * 0.25 + t / np.linalg.norm(t) * r * rng.uniform(0.4, 0.7),
                      r * rng.uniform(0.15, 0.28), rng, worn)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bevel = [e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(25)]
    bmesh.ops.bevel(bm, geom=bevel, offset=0.0025, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    me = bpy.data.meshes.new("quartz")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    v = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", v)
    a = me.attributes.new("unit_co", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", v)
    ob = bpy.data.objects.new("quartz", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# --------------------------------------------------------------------------------------------
# Materials (written so that colour, roughness and metalness can each be baked)
# --------------------------------------------------------------------------------------------


def _nodes(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes["Principled BSDF"]


def _node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if isinstance(k, str) and k in n.inputs:
            if hasattr(v, "is_output") or hasattr(v, "links"):
                nt.links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        else:
            setattr(n, k, v)
    return n


def _math(nt, op, a, b=None, c=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, x in enumerate((a, b, c)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def _range(nt, x, lo, hi, out_lo=0.0, out_hi=1.0, smooth=True):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.inputs["From Min"].default_value = lo
    n.inputs["From Max"].default_value = hi
    n.inputs["To Min"].default_value = out_lo
    n.inputs["To Max"].default_value = out_hi
    if smooth:
        n.interpolation_type = "SMOOTHSTEP"
    nt.links.new(x, n.inputs["Value"])
    return n.outputs["Result"]


def _mix(nt, f, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    for sock, x in (("Factor", f), ("A", a), ("B", b)):
        if isinstance(x, tuple):
            n.inputs[sock].default_value = x if len(x) == 4 else (*x, 1.0)
        elif isinstance(x, (int, float)):
            n.inputs[sock].default_value = x if sock == "Factor" else (x, x, x, 1.0)
        else:
            nt.links.new(x, n.inputs[sock])
    return n.outputs["Result"]


def _attr(nt, name, vector=False):
    n = nt.nodes.new("ShaderNodeAttribute")
    n.attribute_name = name
    return n.outputs["Vector" if vector else "Fac"]


def _noise(nt, co, scale, detail=2.0, rough=0.5):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(co, n.inputs["Vector"])
    return n.outputs["Fac"]


def _voronoi(nt, co, scale, feature="F1"):
    n = nt.nodes.new("ShaderNodeTexVoronoi")
    n.voronoi_dimensions = "3D"
    n.feature = feature
    n.inputs["Scale"].default_value = scale
    nt.links.new(co, n.inputs["Vector"])
    return n


def _gold(nt, co):
    """Natural gold. The worn highs are polished smooth, bright and a touch paler; the hollows
    duller, deeper in colour and filmed with grime; the deepest grooves and pits packed with grey
    dirt. A hammered dimpling (gravel knocks) covers it, strong in some places, faint in others and
    ground away on the polished highs; a few tiny dirt-filled pits sit in the duller parts. The
    crack's walls are dull too, so the glow lights them softly instead of mirroring in them."""
    fine, mid, broad = (_attr(nt, k) for k in ("relief_fine", "relief_mid", "relief_broad"))
    sunk = _math(nt, "MULTIPLY_ADD", fine, 0.4, _math(nt, "MULTIPLY", mid, 0.6))
    hollow = _range(nt, sunk, -0.15, -1.2)
    high = _range(nt, _math(nt, "MULTIPLY_ADD", mid, 0.5, _math(nt, "MULTIPLY", broad, 0.5)), 0.2, 1.4)
    dull = _math(nt, "SUBTRACT", 1.0, high)
    # tiny pits: a few Voronoi cells keep a small dirt-filled dent at their centre
    pv = _voronoi(nt, co, 55.0)
    pick = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(pv.outputs["Color"], pick.inputs["Color"])
    pit = _math(nt, "MULTIPLY", _range(nt, pick.outputs["Red"], 0.9, 0.94),
                _range(nt, pv.outputs["Distance"], 0.1 + 0.0, 0.03 + 0.0))
    pit = _math(nt, "MULTIPLY", pit, _range(nt, _noise(nt, co, 3.0), 0.45, 0.6))
    pit = _math(nt, "MULTIPLY", pit, dull)
    # dirt: packed into the deepest grooves only (on open slopes it would catch the light and read
    # as a grey stain), in patches with crumbly edges, plus the tiny pits; none in the crack
    wall = _attr(nt, "crack_wall")
    deepest = _range(nt, sunk, -0.9, -2.2)
    patchy = _range(nt, _noise(nt, co, 5.0, detail=5.0), 0.4, 0.58)
    crumbs = _range(nt, _noise(nt, co, 30.0, detail=3.0), 0.3, 0.65)
    dirt = _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", deepest, patchy), _math(nt, "MULTIPLY_ADD", crumbs, 0.5, 0.6))
    dirt = _math(nt, "MAXIMUM", _range(nt, dirt, 0.1, 0.7), pit)
    dirt = _math(nt, "MULTIPLY", dirt, _math(nt, "SUBTRACT", 1.0, wall))
    grime = _math(nt, "MAXIMUM", _range(nt, hollow, 0.0, 0.5), _math(nt, "MULTIPLY", wall, 0.7))
    mottle = _range(nt, _noise(nt, co, 2.2, detail=3.0), 0.35, 0.65)
    col = _mix(nt, _math(nt, "MULTIPLY", high, 0.8), ORE_GOLD, WORN_GOLD)
    col = _mix(nt, _math(nt, "MULTIPLY_ADD", grime, 0.6, _math(nt, "MULTIPLY", mottle, 0.25), clamp=True), col, DEEP_GOLD)
    col = _mix(nt, _math(nt, "MULTIPLY", grime, 0.45), col, (0.0, 0.0, 0.0))
    grit = _range(nt, _noise(nt, co, 90.0), 0.3, 0.7)
    dirt_col = _mix(nt, _math(nt, "MULTIPLY", grit, 0.35), kit.rgba(DIRT), kit.rgba(ROCK_LIGHT))
    col = _mix(nt, dirt, col, dirt_col)
    # the hammering: dimples about 2.5 cm across on the finished ore, strong in some places
    hammer = _voronoi(nt, co, 40.0)
    hammer.feature = "SMOOTH_F1"
    knocked = _range(nt, _noise(nt, co, 1.6, detail=2.0), 0.3, 0.7, 0.15, 1.0)
    knocked = _math(nt, "MULTIPLY", knocked, _math(nt, "MULTIPLY_ADD", high, -0.85, 1.0))
    rough = _math(nt, "MULTIPLY_ADD", dull, 0.15, 0.15)
    rough = _math(nt, "MULTIPLY_ADD", grime, 0.2, rough)
    rough = _math(nt, "MULTIPLY_ADD", _math(nt, "MULTIPLY", hammer.outputs["Distance"], knocked), 0.06, rough)
    rough = _mix(nt, dirt, rough, 0.95)
    dimple = _math(nt, "MULTIPLY", _math(nt, "POWER", hammer.outputs["Distance"], 2.0), -1.0)
    height = _math(nt, "MULTIPLY", dimple, knocked)
    height = _math(nt, "MULTIPLY_ADD", _noise(nt, co, 260.0), 0.05, height)
    height = _math(nt, "MULTIPLY_ADD", pit, -0.25, height)
    height = _math(nt, "MULTIPLY_ADD", _math(nt, "MULTIPLY", dirt, grit), 0.6, height)   # the dirt is crumbly
    bump = _node(nt, "ShaderNodeBump", Strength=1.0, Distance=0.004, Height=height)
    return {"Base Color": col, "Roughness": rough, "Metallic": _math(nt, "SUBTRACT", 1.0, dirt),
            "Specular IOR Level": _math(nt, "MULTIPLY_ADD", dirt, -0.35, 0.5), "Normal": bump.outputs["Normal"]}


def _rock(nt, co):
    """Dark grey host rock: blocky granules, some faces lighter, with a fine grit."""
    cells = _voronoi(nt, co, 26.0)
    pick = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(cells.outputs["Color"], pick.inputs["Color"])
    light = _range(nt, pick.outputs["Red"], 0.55, 1.0, smooth=False)
    col = _mix(nt, light, kit.rgba(ROCK), kit.rgba(ROCK_LIGHT))
    rough = _range(nt, light, 0.0, 1.0, 0.85, 0.6, smooth=False)
    edge = _voronoi(nt, co, 26.0, "DISTANCE_TO_EDGE")
    height = _math(nt, "MULTIPLY_ADD", _noise(nt, co, 120.0), 0.3, edge.outputs["Distance"])
    bump = _node(nt, "ShaderNodeBump", Strength=0.8, Distance=0.004, Height=height)
    return {"Base Color": col, "Roughness": rough, "Metallic": 0.0, "Specular IOR Level": 0.5,
            "Normal": bump.outputs["Normal"]}


def ore_material():
    """The gold and the host rock in one material, switched by the `rock` vertex attribute where
    it crosses one half. Faces each take one material slot, so a boundary drawn by slot would
    follow the triangles in a saw-tooth; this one follows a smooth line through them."""
    m, nt, b = _nodes("ore")
    co = _attr(nt, "unit_co", vector=True)
    gold, rock = _gold(nt, co), _rock(nt, co)
    k = _range(nt, _attr(nt, "rock"), 0.45, 0.55)
    for name in ("Base Color", "Roughness", "Metallic", "Specular IOR Level"):
        a, c = gold[name], rock[name]
        n = nt.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA" if name == "Base Color" else "FLOAT"
        sock = {"RGBA": ("A", "B", "Result"), "FLOAT": ("A", "B", "Result")}[n.data_type]
        nt.links.new(k, n.inputs["Factor"])
        for inp, x in zip(sock[:2], (a, c)):
            if isinstance(x, (int, float)):
                n.inputs[inp].default_value = x
            else:
                nt.links.new(x, n.inputs[inp])
        nt.links.new(n.outputs[sock[2]], b.inputs[name])
    nm = nt.nodes.new("ShaderNodeMix")
    nm.data_type = "VECTOR"
    nt.links.new(k, nm.inputs["Factor"])
    nt.links.new(gold["Normal"], nm.inputs["A"])
    nt.links.new(rock["Normal"], nm.inputs["B"])
    unit = nt.nodes.new("ShaderNodeVectorMath")
    unit.operation = "NORMALIZE"
    nt.links.new(nm.outputs["Result"], unit.inputs[0])
    nt.links.new(unit.outputs[0], b.inputs["Normal"])
    return m


def quartz_material():
    """Milky vein quartz: opaque white with clearer grey patches, a greasy shine, and the faint
    shell-like ripples of a fresh break."""
    m, nt, b = _nodes("quartz")
    co = _attr(nt, "unit_co", vector=True)
    glass = _range(nt, _noise(nt, co, 9.0, detail=3.0), 0.45, 0.62)
    col = _mix(nt, _math(nt, "MULTIPLY", glass, 0.7), kit.rgba(QUARTZ), kit.rgba(QUARTZ_GLASS))
    nt.links.new(col, b.inputs["Base Color"])
    rough = _range(nt, glass, 0.0, 1.0, 0.24, 0.1, smooth=False)
    nt.links.new(rough, b.inputs["Roughness"])
    b.inputs["Subsurface Weight"].default_value = 0.3
    b.inputs["Subsurface Radius"].default_value = (1.0, 1.0, 1.0)
    b.inputs["Subsurface Scale"].default_value = 0.01
    ripple = _voronoi(nt, co, 30.0, "SMOOTH_F1")
    height = _math(nt, "MULTIPLY_ADD", _noise(nt, co, 140.0), 0.2, ripple.outputs["Distance"])
    bump = _node(nt, "ShaderNodeBump", Strength=0.25, Distance=0.003, Height=height)
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
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
    ob, vugs, rng = build_mesh(seed)
    shared = ore_material()                 # the gold and rock slots share it (see ore_material)
    for mat in (shared, shared, glow_material(glow)):
        ob.data.materials.append(mat)
    q = quartz(vugs, rng)
    q.data.materials.append(quartz_material())
    s = ORE_HEIGHT / 2.0
    for o in (ob, q):
        o.scale = (s, s, s)
        o.location = (0, 0, -FOOT * s)
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


# name: (turn in degrees, distance m, camera height above the aim m, aim height above the middle m,
# aim to the side m)
VIEWS = {"front": (0, 3.0, 0.25, 0.0, 0.0), "left": (90, 3.0, 0.25, 0.0, 0.0), "back": (180, 3.0, 0.25, 0.0, 0.0),
         "right": (270, 3.0, 0.25, 0.0, 0.0), "close": (25, 1.2, 0.1, 0.1, 0.0), "closeb": (200, 1.2, 0.2, 0.2, 0.0),
         "crack": (0, 1.1, 0.05, 0.05, 0.0), "vug": (150, 0.9, 0.1, 0.0, 0.0)}


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
    ap.add_argument("--gold", default="", help="r,g,b linear base colour to try instead of ORE_GOLD")
    ap.add_argument("--blend", default="", help="also save the scene as this .blend")
    args = ap.parse_args(argv)
    w, h = (int(x) for x in args.res.split("x"))
    os.makedirs(args.out, exist_ok=True)
    kit.reset("a", res=(w, h), samples=args.samples)
    studio_world(os.path.abspath(args.hdr), args.env)
    if args.gold:
        global ORE_GOLD
        ORE_GOLD = tuple(float(x) for x in args.gold.split(","))
    build(args.seed, args.glow)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    centre = Vector((0, 0, ORE_HEIGHT / 2))
    for name in args.views.split(","):
        turn, dist, up, lift, side = VIEWS[name]
        a = math.radians(turn)
        aim = centre + Vector((math.cos(a) * side, -math.sin(a) * side, lift))
        # the camera goes round the ore, as in a turnaround
        cam_pos = aim + Vector((-math.sin(a) * dist, -math.cos(a) * dist, up))
        kit.camera(tuple(cam_pos), tuple(aim), lens=85)
        path = os.path.join(args.out, f"ore_{name}.png")
        kit.render(path)
        _log(path)


if __name__ == "__main__":
    main()
