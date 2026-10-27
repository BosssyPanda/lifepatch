"""Sculpting in code with signed distance fields on a voxel grid.

A signed distance field holds, for every voxel, how far that point is from the surface: negative
inside, positive outside. Shapes are combined by simple maths on the field (a smooth union melts a
lump into the body, a smooth subtraction presses a pit into it) and the finished surface is meshed
by marching cubes. Unlike pushing a mesh's vertices along their normals, this can make real
overhangs, folds and hollows, which a natural gold nugget is full of.

Needs numpy, scipy and PyMCubes in the Blender venv (see README.md in the folder above).
"""
import numpy as np
from scipy import ndimage, sparse

import mcubes


class Grid:
    """A box of voxels `h` apart, from `lo` to at least `hi`."""

    def __init__(self, lo, hi, h):
        self.lo = np.asarray(lo, dtype=np.float64)
        self.h = float(h)
        self.shape = tuple(int(np.ceil((hi[i] - lo[i]) / h)) + 1 for i in range(3))
        self.hi = self.lo + (np.array(self.shape) - 1) * h
        self.axes = [(self.lo[i] + np.arange(self.shape[i]) * h).astype(np.float32) for i in range(3)]

    def coords(self, sl=None):
        """Broadcastable X, Y, Z for the whole grid or a block of it."""
        sl = sl or (slice(None),) * 3
        return (self.axes[0][sl[0]][:, None, None], self.axes[1][sl[1]][None, :, None],
                self.axes[2][sl[2]][None, None, :])

    def block(self, centre, reach):
        """The slices of the voxels within a box `reach` round `centre`, or None if it misses."""
        sl = []
        for i in range(3):
            a = max(0, int(np.floor((centre[i] - reach - self.lo[i]) / self.h)))
            b = min(self.shape[i], int(np.ceil((centre[i] + reach - self.lo[i]) / self.h)) + 1)
            if a >= b:
                return None
            sl.append(slice(a, b))
        return tuple(sl)

    def sample(self, field, pts, order=1):
        """The field at world points (N, 3), interpolated."""
        c = ((np.asarray(pts, dtype=np.float64) - self.lo) / self.h).T
        return ndimage.map_coordinates(field, c, order=order, mode="nearest")

    def normals(self, field, pts):
        """Unit gradient of the field at world points: the outward surface direction."""
        e = self.h
        g = np.stack([self.sample(field, pts + d) - self.sample(field, pts - d)
                      for d in np.eye(3) * e], axis=1)
        return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)

    def surface_points(self, field, rng, count, spacing):
        """About `count` points spread over the surface at least `spacing` apart, with normals."""
        near = np.argwhere(np.abs(field) < self.h * 0.5)
        rng.shuffle(near)
        pts = (self.lo + near.astype(np.float64) * self.h).tolist()
        cells, picked, s2 = {}, [], spacing * spacing
        for p in pts:                       # dart throwing, with a hash of cells `spacing` wide
            key = (int(p[0] // spacing), int(p[1] // spacing), int(p[2] // spacing))
            clear = True
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for q in cells.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                            if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < s2:
                                clear = False
                                break
                        if not clear:
                            break
                    if not clear:
                        break
                if not clear:
                    break
            if clear:
                cells.setdefault(key, []).append(p)
                picked.append(p)
                if len(picked) >= count:
                    break
        p = np.array(picked)
        # pull each point onto the surface proper
        n = self.normals(field, p)
        p = p - n * self.sample(field, p)[:, None]
        return p, self.normals(field, p)


class Noise:
    """A smooth random field, standard deviation 1, with features about `cell` across: white noise
    on a lattice `cell` apart, smoothed by a cubic B-spline. Sampled anywhere in the grid's box."""

    def __init__(self, grid, rng, cell, over=4):
        m = [int(np.ceil((grid.hi[i] - grid.lo[i]) / cell)) + 5 for i in range(3)]
        lattice = rng.standard_normal(m).astype(np.float32)
        out = [(k - 1) * over + 1 for k in m]
        self.field = ndimage.zoom(lattice, [o / k for o, k in zip(out, m)], order=3, prefilter=False)
        self.field /= self.field.std()
        self.lo = grid.lo - 2.0 * cell
        self.step = cell / over

    def at(self, X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        c = np.stack([(X - self.lo[0]) / self.step, (Y - self.lo[1]) / self.step, (Z - self.lo[2]) / self.step])
        return ndimage.map_coordinates(self.field, c.reshape(3, -1), order=1, mode="nearest").reshape(X.shape)


# ---- shapes ---------------------------------------------------------------------------------


def ellipsoid(X, Y, Z, centre, radii, rot=None):
    """Distance (close to exact near the surface) to an ellipsoid, optionally turned by `rot`
    (a 3x3 matrix whose columns are the ellipsoid's axes)."""
    px, py, pz = X - centre[0], Y - centre[1], Z - centre[2]
    if rot is not None:
        px, py, pz = (px * rot[0, 0] + py * rot[1, 0] + pz * rot[2, 0],
                      px * rot[0, 1] + py * rot[1, 1] + pz * rot[2, 1],
                      px * rot[0, 2] + py * rot[1, 2] + pz * rot[2, 2])
    a, b, c = radii
    k0 = np.sqrt((px / a) ** 2 + (py / b) ** 2 + (pz / c) ** 2)
    k1 = np.sqrt((px / (a * a)) ** 2 + (py / (b * b)) ** 2 + (pz / (c * c)) ** 2)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def polytope(X, Y, Z, centre, normals, offsets):
    """Distance bound to a convex solid cut by planes: n . (p - centre) <= offset for each plane."""
    px, py, pz = X - centre[0], Y - centre[1], Z - centre[2]
    d = None
    for n, o in zip(normals, offsets):
        s = px * n[0] + py * n[1] + pz * n[2] - o
        d = s if d is None else np.maximum(d, s)
    return d


def smin(a, b, k):
    """Smooth union: the two surfaces melt together over about `k`."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    """Smooth intersection (subtract a shape with smax(d, -shape, k))."""
    return -smin(-a, -b, k)


def random_rotation(rng):
    q = rng.standard_normal(4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def paint(grid, field, centre, reach, fn, op):
    """Apply `op(field_block, fn(X, Y, Z))` only in the block of voxels the shape can touch."""
    sl = grid.block(centre, reach)
    if sl is None:
        return
    X, Y, Z = grid.coords(sl)
    field[sl] = op(field[sl], fn(X, Y, Z))


# ---- meshing --------------------------------------------------------------------------------


def mesh(grid, field):
    """Marching cubes at the zero level. Returns world-space vertices (N, 3) and triangles (M, 3),
    wound so their normals point out of the solid."""
    v, f = mcubes.marching_cubes(np.ascontiguousarray(field, dtype=np.float64), 0.0)
    v = grid.lo + v * grid.h
    f = f.astype(np.int64)
    # wind outwards: the signed volume of a closed outward mesh is positive
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    if np.einsum("ij,ij->i", a, np.cross(b, c)).sum() < 0:
        f = f[:, ::-1].copy()
    return v, f


def vertex_normals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def smoother(v, f):
    """The averaging operator of the mesh: each vertex to the mean of its neighbours."""
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    a = sparse.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(v), len(v))).tocsr()
    a.data[:] = 1.0
    deg = np.asarray(a.sum(axis=1)).ravel()
    return sparse.diags(1.0 / np.maximum(deg, 1)) @ a


def relief(v, f, n, avg, iterations):
    """How far each vertex stands out from (positive) or sinks below (negative) the mesh smoothed
    `iterations` times: a measure of convex highs and concave hollows at that scale."""
    s = v.copy()
    for _ in range(iterations):
        s = avg @ s
    return np.einsum("ij,ij->i", v - s, n)
