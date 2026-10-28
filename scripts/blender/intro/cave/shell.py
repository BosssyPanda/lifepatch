"""The cave itself: one shell of limestone sculpted as a signed distance field (like the ore, see
../ore/sdf.py) and meshed by marching cubes, plus the fallen block in the foreground that the gold
nugget lies on.

The air of the cave is a few melted ellipsoids: the chamber round the fire, its front where the camera
stands, and the narrow way in behind it. The rock is everything else. Its surface is limestone: broad
rounded folds, smaller swellings, no sharp breaks; it is smoothest on the back wall where the paintings
are, and the floor is a flat bed of silt that rises into the walls.

`build()` returns world-space vertices, triangles and per-vertex attributes:
  panel   0..1, the pale smooth stretch of the back wall that carries the paintings
  floor   0..1, how much of a point is floor (silt) rather than wall
  relief_mid, relief_broad   how far it stands out of the smoothed surface (cavities < 0)
  paint_uv   where it lands on the painting (0..1 across the panel), for the pigment map
The result is cached in an .npz, since meshing takes a minute.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(HERE), "ore")]

import sdf  # noqa: E402

# Layout (metres, Z up). The camera looks toward +Y from the front of the chamber.
FIRE = (0.25, 1.35)
PANEL_CENTRE = np.array([-0.45, 4.15, 1.75])   # middle of the painted stretch of the back wall
PANEL_SIZE = (3.4, 1.7)                        # its width and height, the painting's frame
PROJECTOR = np.array([-0.3, 0.6, 1.4])         # where the painting is projected onto the wall from

H = 0.03  # voxel size of the shell


def _void(X, Y, Z):
    """Distance to the cave's air (negative inside it)."""
    d = sdf.ellipsoid(X, Y, Z, (0.25, 1.45, 0.95), (3.5, 3.0, 2.6))            # the chamber
    d = sdf.smin(d, sdf.ellipsoid(X, Y, Z, (-0.1, -1.6, 1.0), (2.7, 2.6, 2.1)), 0.8)  # its front
    d = sdf.smin(d, sdf.ellipsoid(X, Y, Z, (-0.4, -4.4, 1.05), (0.75, 1.7, 1.25)), 0.6)  # the way in
    d = sdf.smin(d, sdf.ellipsoid(X, Y, Z, (2.6, 2.7, 0.9), (1.4, 1.2, 1.3)), 0.7)   # an alcove, right
    # the back wall flattens where it was painted
    d = sdf.smax(d, Y - 4.25, 0.9)
    # the floor: a silt bed at z = 0 that rises into the walls (the floor plane is cut by the air
    # only above it)
    d = sdf.smax(d, -Z, 0.35)
    return d


def build(seed=4, h=H, cache=None):
    if cache and os.path.exists(cache):
        z = np.load(cache)
        return {k: z[k] for k in z.files}
    rng = np.random.default_rng(seed)
    g = sdf.Grid((-3.7, -6.4, -0.45), (4.3, 4.95, 3.75), h)
    X, Y, Z = g.coords()
    rock = -_void(X, Y, Z)

    # how much of the wall is the painted panel: a soft rectangle on the back wall
    px = (X - PANEL_CENTRE[0]) / (PANEL_SIZE[0] * 0.5 + 0.3)
    pz = (Z - PANEL_CENTRE[2]) / (PANEL_SIZE[1] * 0.5 + 0.3)
    n_edge = sdf.Noise(g, np.random.default_rng(seed + 1), 0.5)
    rr = np.sqrt(px ** 2 + pz ** 2) + 0.35 * n_edge.at(X, Y, Z)   # a calcite patch with a ragged edge
    panel = np.clip((1.0 - rr) / 0.25, 0, 1) * np.clip((Y - 3.6) / 0.4, 0, 1)
    floor = np.clip(1 - Z / 0.35, 0, 1)

    # limestone: broad folds, smaller swellings, a little grit; calmer on the panel and the floor
    calm = 1 - 0.75 * np.maximum(panel, floor)
    n_broad = sdf.Noise(g, rng, 1.1)
    n_mid = sdf.Noise(g, rng, 0.38)
    n_fine = sdf.Noise(g, rng, 0.13)
    # domain warp, so the folds flow instead of looking like blobs
    w = 0.25 * n_broad.at(X * 0.7 + 3.1, Y * 0.7, Z * 0.7)
    disp = (0.22 * n_broad.at(X + w, Y, Z - w) + 0.07 * n_mid.at(X, Y + w, Z) + 0.015 * n_fine.at(X, Y, Z))
    rock = rock - disp * calm
    # flowstone drapes hang from the ceiling at the right: long vertical ridges
    drape = np.sin(X * 9.0 + 2.0 * n_mid.at(X, Y, Z * 0.2)) * 0.03 * np.clip((Z - 2.0) / 0.8, 0, 1)
    rock = rock - drape * np.clip((X - 0.8) / 1.0, 0, 1)
    # the floor's silt: very low swells, and the hearth's shallow scoop round the fire
    hearth = np.sqrt((X - FIRE[0]) ** 2 + (Y - FIRE[1]) ** 2)
    rock = rock + 0.04 * np.exp(-(hearth / 0.6) ** 2) * floor

    v, f = sdf.mesh(g, rock.astype(np.float32))
    # keep only the inner surface the camera can see (drop the box walls of the grid)
    lo, hi = g.lo + h * 1.5, g.hi - h * 1.5
    keep_v = np.all((v > lo) & (v < hi), axis=1)
    keep_f = keep_v[f].all(axis=1)
    f = f[keep_f]
    used = np.unique(f)
    remap = -np.ones(len(v), np.int64)
    remap[used] = np.arange(len(used))
    v, f = v[used], remap[f]
    n = sdf.vertex_normals(v, f)
    avg = sdf.smoother(v, f)
    attrs = dict(
        v=v.astype(np.float32), f=f.astype(np.int32),
        panel=g.sample(panel.astype(np.float32), v).astype(np.float32),
        floor=np.clip(1 - v[:, 2] / 0.3, 0, 1).astype(np.float32),
        relief_mid=sdf.relief(v, f, n, avg, 12).astype(np.float32),
        relief_broad=sdf.relief(v, f, n, avg, 60).astype(np.float32),
    )
    attrs["paint_uv"] = paint_uv(v).astype(np.float32)
    if cache:
        np.savez(cache, **attrs)
    return attrs


def paint_uv(p):
    """Project points from the projector onto the panel's plane (y = PANEL_CENTRE.y): where each
    lands across the painting, 0..1 left to right and bottom to top."""
    d = p - PROJECTOR
    t = (PANEL_CENTRE[1] - PROJECTOR[1]) / np.where(np.abs(d[:, 1]) < 1e-6, 1e-6, d[:, 1])
    hit = PROJECTOR + d * t[:, None]
    u = (hit[:, 0] - (PANEL_CENTRE[0] - PANEL_SIZE[0] / 2)) / PANEL_SIZE[0]
    w = (hit[:, 2] - (PANEL_CENTRE[2] - PANEL_SIZE[1] / 2)) / PANEL_SIZE[1]
    return np.stack([u, w], axis=1)


def block(seed=8, h=0.008):
    """The fallen limestone block in the foreground: a slab with a flat bedding-plane top, worn round
    at its edges, sunk into the floor. Top at about z = 0.80, centred under the money spot."""
    rng = np.random.default_rng(seed)
    g = sdf.Grid((-0.55, -0.45, -0.15), (0.55, 0.45, 0.95), h)
    X, Y, Z = g.coords()
    # a slab: a box with rounded edges, a little out of square, its top cut on a slant
    a = 0.18
    px = (X * np.cos(a) + Y * np.sin(a)) * (1 - 0.15 * Z)   # narrower toward the top
    py = (-X * np.sin(a) + Y * np.cos(a))
    q = [np.abs(px) - 0.36, np.abs(py) - 0.26, np.abs(Z - 0.35) - 0.42]
    r = 0.07
    out = np.sqrt(sum(np.maximum(c + r, 0) ** 2 for c in q))
    d = out + np.minimum(np.maximum(np.maximum(q[0], q[1]), q[2]) + r, 0) - r
    d = sdf.smax(d, 0.18 * X - 0.12 * Y + Z - 0.79, 0.06)
    nb, nm, nf = sdf.Noise(g, rng, 0.35), sdf.Noise(g, rng, 0.11), sdf.Noise(g, rng, 0.035)
    d = d - 0.03 * nb.at(X, Y, Z) - 0.01 * nm.at(X, Y, Z) - 0.0025 * nf.at(X, Y, Z)
    # a bedding plane: the top is flat-ish, a step runs along it
    step = 0.012 * np.tanh((X + 0.1 * Y - 0.12) / 0.01)
    top = np.clip((Z - 0.55) / 0.2, 0, 1)
    d = d - step * top
    v, f = sdf.mesh(g, d.astype(np.float32))
    n = sdf.vertex_normals(v, f)
    avg = sdf.smoother(v, f)
    return dict(v=v.astype(np.float32), f=f.astype(np.int32),
                relief_mid=sdf.relief(v, f, n, avg, 12).astype(np.float32),
                relief_broad=sdf.relief(v, f, n, avg, 50).astype(np.float32))


def stalagmite(seed=11, h=0.005):
    """A stalagmite broken off at about 0.8 m: a stout cone of flowstone, ringed where the drip ran
    faster and fluted where it ran down, its foot spread over the floor, its stump snapped on a slant
    round a flatter middle. Foot at z = 0; returns `top`, the height of the stump's middle."""
    rng = np.random.default_rng(seed)
    g = sdf.Grid((-0.4, -0.4, -0.08), (0.4, 0.4, 0.9), h)
    X, Y, Z = g.coords()
    nb, nm, nf = sdf.Noise(g, rng, 0.25), sdf.Noise(g, rng, 0.07), sdf.Noise(g, rng, 0.022)
    zz = np.clip(Z, 0, None)
    top = 0.80
    up = np.clip(1 - zz / top, 0, 1)
    # leaning a little, its axis wandering
    cx = 0.03 * Z + 0.02 * nb.at(0 * X, 0 * Y, Z)
    cy = -0.02 * Z + 0.015 * nb.at(0 * X + 1.7, 0 * Y, Z)
    rho = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    ang = np.arctan2(Y - cy, X - cx)
    # radius: a cone that is still thick where it broke, a foot spread over the floor
    r = 0.088 + 0.10 * up ** 1.5 + 0.13 * np.exp(-zz / 0.07)
    rings = 0.009 * np.sin(Z * 21.0 + 3.0 * nb.at(X, Y, Z)) ** 2 * (0.6 + nm.at(X, Y, Z * 0.2)) * (0.35 + 0.65 * up)
    flutes = 0.014 * np.abs(np.sin(ang * 3.5 + 1.2 * nb.at(X, Y, Z * 0.3))) * up
    d = rho - r - rings - flutes - 0.016 * nb.at(X, Y, Z) - 0.005 * nm.at(X, Y, Z) - 0.0012 * nf.at(X, Y, Z)
    # the break: a slant across the stump, jagged at the rim, flatter in the middle where the gold rests
    rim = np.clip((rho - 0.03) / 0.07, 0, 1)
    slant = 0.05 * ((X - cx) * 0.5 + (Y - cy) * 0.85) / 0.1   # low towards the camera, -x -y
    brk = top + slant * rim - 0.035 * rim ** 2 * (0.5 + nm.at(X * 1.5, Y * 1.5, 0 * Z)) - 0.004 * nf.at(X, Y, 0 * Z)
    d = sdf.smax(d, Z - brk, 0.008)
    d = sdf.smax(d, -(Z + 0.06), 0.02)
    v, f = sdf.mesh(g, d.astype(np.float32))
    n = sdf.vertex_normals(v, f)
    avg = sdf.smoother(v, f)
    near = np.sqrt((v[:, 0] - 0.024) ** 2 + (v[:, 1] + 0.016) ** 2) < 0.025
    return dict(v=v.astype(np.float32), f=f.astype(np.int32), top=np.float32(v[near, 2].max()),
                relief_mid=sdf.relief(v, f, n, avg, 12).astype(np.float32),
                relief_broad=sdf.relief(v, f, n, avg, 50).astype(np.float32))


def mound(seed=31, h=0.008):
    """The foreground rock the gold rests on: a waist-high hump of fallen roof, about 1.6 x 1 m, its
    worn top flat enough to hold a nugget at its right shoulder, little of it right of that. Local +y points away from the
    camera and +x to its right; the resting place is the origin. Returns `top`, its height there."""
    rng = np.random.default_rng(seed)
    g = sdf.Grid((-1.15, -0.7, -0.08), (0.55, 0.6, 0.72), h)
    X, Y, Z = g.coords()
    nb, nm, nf = sdf.Noise(g, rng, 0.3), sdf.Noise(g, rng, 0.09), sdf.Noise(g, rng, 0.025)
    d = sdf.ellipsoid(X, Y, Z, (-0.4, -0.04, 0.0), (0.72, 0.45, 0.66))
    d = sdf.smin(d, sdf.ellipsoid(X, Y, Z, (-0.85, 0.05, 0.0), (0.38, 0.4, 0.48)), 0.15)   # a lower lobe to the left
    d = sdf.smax(d, Z - 0.56, 0.12)               # the worn top, the gold at its right shoulder
    d = sdf.smax(d, -(Z + 0.05), 0.02)
    calm = np.clip(np.sqrt(X ** 2 + Y ** 2) / 0.25, 0.3, 1)   # quieter where the gold sits
    d = d - calm * (0.03 * nb.at(X, Y, Z) + 0.009 * nm.at(X, Y, Z)) - 0.0025 * nf.at(X, Y, Z)
    v, f = sdf.mesh(g, d.astype(np.float32))
    n = sdf.vertex_normals(v, f)
    avg = sdf.smoother(v, f)
    near = np.sqrt(v[:, 0] ** 2 + v[:, 1] ** 2) < 0.03
    return dict(v=v.astype(np.float32), f=f.astype(np.int32), top=np.float32(v[near, 2].max()),
                relief_mid=sdf.relief(v, f, n, avg, 12).astype(np.float32),
                relief_broad=sdf.relief(v, f, n, avg, 50).astype(np.float32))


def boulder(seed=21, h=0.007):
    """A rounded boulder to sit on: wider than tall, a flattish top worn smooth, sunk into the silt.
    About 0.6 x 0.48 m and 0.42 m high before scaling; returns `top`, the height of its seat."""
    rng = np.random.default_rng(seed)
    g = sdf.Grid((-0.4, -0.34, -0.08), (0.4, 0.34, 0.55), h)
    X, Y, Z = g.coords()
    d = sdf.ellipsoid(X, Y, Z, (0, 0, 0.12), (0.31, 0.25, 0.34))
    d = sdf.smax(d, Z - 0.42, 0.08)               # the worn top
    d = sdf.smax(d, -(Z + 0.05), 0.02)
    nb, nm, nf = sdf.Noise(g, rng, 0.25), sdf.Noise(g, rng, 0.08), sdf.Noise(g, rng, 0.025)
    d = d - 0.025 * nb.at(X, Y, Z) - 0.007 * nm.at(X, Y, Z) - 0.002 * nf.at(X, Y, Z)
    v, f = sdf.mesh(g, d.astype(np.float32))
    n = sdf.vertex_normals(v, f)
    avg = sdf.smoother(v, f)
    near = np.sqrt(v[:, 0] ** 2 + v[:, 1] ** 2) < 0.08
    return dict(v=v.astype(np.float32), f=f.astype(np.int32), top=np.float32(v[near, 2].max()),
                relief_mid=sdf.relief(v, f, n, avg, 12).astype(np.float32),
                relief_broad=sdf.relief(v, f, n, avg, 50).astype(np.float32))
