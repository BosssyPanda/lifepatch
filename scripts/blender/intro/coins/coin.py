"""The hero money of scene three: a Lydian electrum third-stater (trite), c. 610-560 BCE.

What it is (Sardis Expedition, Monograph 13 cat. 1.0002; Museums Victoria 67292): a bean-shaped lump
about 13 x 11 mm and 5 mm thick, 4.7 g. Obverse: a roaring lion's head facing right with a rayed knob on
its nose, struck from a die smaller than the lump, so part of the design runs off the edge. Reverse: an
oblong punch divided into two squares, sunk into the metal when the hammer drove the punch.

How it is built: the coin is a solid between two height fields, a domed top (plus the lion relief) and a
domed bottom (minus the two punch squares), cut by a slightly irregular oval outline with a rounded rim.
That solid is written as a signed distance field and meshed by marching cubes (PyMCubes), like the ore.
The lion relief is a height map sculpted in code (lion.py) and checked side by side against photographs
of real coins; drawn from memory with nothing to check against, it read as a cartoon crocodile
(proofs/lion_relief.py). The die is a little larger than the flan, as on the real coins, so the mane and
muzzle run off the edge, the relief fading over the last 0.9 mm so the rim stays rounded.

Units: millimetres while building, then scaled to metres (`size` = long axis in metres; the hero coin is
shown much larger than life, like every era's money). Its local +Z is the obverse.

  python coins/coin.py --out DIR [--relief lion.png] [--views obv,rev,edge,hero]
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO]

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402

# measured specimen sizes (mm)
LONG, SHORT, THICK = 13.0, 11.2, 5.0


def _smax(a, b, k):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0.0, 1.0)
    return a * h + b * (1 - h) + k * h * (1 - h)


def _noise2(x, y, seed, octaves=4, base=0.35):
    """Smooth value noise on a grid (numpy, no dependencies): sum of bicubic-interpolated random lattices."""
    rng = np.random.default_rng(seed)
    out = np.zeros_like(x)
    amp, f = 1.0, base
    for _ in range(octaves):
        # coordinates shifted positive, lattice big enough never to wrap (a wrap left seams at x, y = 0)
        u = x * f + 300.0
        v = y * f + 300.0
        n = int(max(u.max(), v.max())) + 3
        lat = rng.standard_normal((n + 2, n + 2))
        i, j = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = u - i, v - j
        su, sv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
        a = lat[i, j] * (1 - su) + lat[i + 1, j] * su
        b = lat[i, j + 1] * (1 - su) + lat[i + 1, j + 1] * su
        out += amp * (a * (1 - sv) + b * sv)
        amp *= 0.5
        f *= 2.0
    return out


class Coin:
    """The coin's shape as functions of (x, y) in mm: outline distance, top and bottom height fields."""

    def __init__(self, relief=None, seed=5, die=(0.0, 0.1, 12.2, -8.0), relief_h=1.7):
        self.seed = seed
        self.relief = relief            # 2D float array in [0, 1], row 0 = top of the image, or None
        self.die = die                  # die centre x, y (mm), die width (mm), rotation (deg)
        self.relief_h = relief_h        # height of the relief's highest point above the field (mm)

    def outline(self, x, y):
        """Signed distance (mm, negative inside) to a lumpy oval: a bean, flatter on one long side."""
        a, b = LONG / 2, SHORT / 2
        ang = np.arctan2(y, x)
        wob = 1.0 + 0.035 * np.sin(3 * ang + 0.7) + 0.025 * np.sin(5 * ang + 2.1) - 0.05 * np.clip(-np.sin(ang), 0, 1) ** 3
        r = np.hypot(x / a, y / b)
        return (r - wob) * min(a, b)

    def dome(self, d, height, width):
        """0 at the outline, rising to `height` inside, rounded like a struck pellet."""
        t = np.clip(-d / width, 0.0, 1.0)
        return height * np.sqrt(1 - (1 - t) ** 2)

    def relief_at(self, x, y):
        if self.relief is None:
            return np.zeros_like(x)
        cx, cy, w, rot = self.die
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        u = ((x - cx) * c + (y - cy) * s) / w + 0.5
        v = (-(x - cx) * s + (y - cy) * c) / w + 0.5
        hgt, wid = self.relief.shape
        px = np.clip(u * (wid - 1), 0, wid - 1)
        py = np.clip((1 - v) * (hgt - 1), 0, hgt - 1)
        i0, j0 = np.floor(py).astype(int), np.floor(px).astype(int)
        i1, j1 = np.minimum(i0 + 1, hgt - 1), np.minimum(j0 + 1, wid - 1)
        fy, fx = py - i0, px - j0
        R = self.relief
        val = (R[i0, j0] * (1 - fx) * (1 - fy) + R[i0, j1] * fx * (1 - fy) + R[i1, j0] * (1 - fx) * fy
               + R[i1, j1] * fx * fy)
        inside = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
        return np.where(inside, val, 0.0) * self.relief_h

    def punch(self, x, y):
        """Depth (mm) of the reverse's two incuse squares: an oblong punch divided by a low ridge, the
        squares a little unequal and tilted, their floors rough from the punch's face."""
        depth = np.zeros_like(x)
        for (cx, cy, sz, rot, dep) in ((-2.25, 0.25, 4.6, 6.0, 1.15), (2.2, -0.1, 4.2, 9.0, 1.0)):
            c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
            u = (x - cx) * c + (y - cy) * s
            v = -(x - cx) * s + (y - cy) * c
            box = np.maximum(np.abs(u), np.abs(v)) - sz / 2         # square distance, negative inside
            wall = np.clip(-box / 0.45, 0.0, 1.0)                     # sloped walls, 0.45 mm wide
            wall = wall * wall * (3 - 2 * wall)
            depth = np.maximum(depth, dep * wall)
        rough = 0.07 * _noise2(x, y, self.seed + 11, octaves=3, base=1.6)
        return depth * (1.0 + rough)

    def top(self, x, y, d):
        # the die flattened the top where it struck: a low dome with rounded shoulders
        field = self.dome(d, 1.8, 4.2) + 0.25 * _noise2(x, y, self.seed + 1, octaves=2, base=0.18)
        grain = 0.004 * _noise2(x, y, self.seed + 3, octaves=3, base=2.5)
        # the design runs off the flan, but the rim stays rounded: fade the relief over the last 0.9 mm
        return field + self.relief_at(x, y) * np.clip(-d / 0.9, 0.0, 1.0) + grain

    def bottom(self, x, y, d):
        field = -self.dome(d, 2.1, 2.2) + 0.2 * _noise2(x, y, self.seed + 2, octaves=2, base=0.2)
        grain = 0.006 * _noise2(x, y, self.seed + 5, octaves=3, base=2.5)
        return field + self.punch(x, y) + grain

    def sdf(self, voxel=0.05):
        pad = 0.6
        xs = np.arange(-LONG / 2 - pad, LONG / 2 + pad, voxel)
        ys = np.arange(-SHORT / 2 - pad, SHORT / 2 + pad, voxel)
        zs = np.arange(-THICK / 2 - 1.2, THICK / 2 + 2.6, voxel)
        X, Y = np.meshgrid(xs, ys, indexing="ij")
        d = self.outline(X, Y)
        top, bot = self.top(X, Y, d), self.bottom(X, Y, d)
        Z = zs[None, None, :]
        f = _smax(Z - top[..., None], bot[..., None] - Z, 0.12)
        f = _smax(f, d[..., None], 0.35)
        return f.astype(np.float32), (xs[0], ys[0], zs[0]), voxel


def coin_mesh(name, coin, size=0.1, material=None, voxel=0.05):
    """Mesh the coin (marching cubes) and scale it so its long axis is `size` metres."""
    import mcubes
    f, (x0, y0, z0), vx = coin.sdf(voxel)
    verts, faces = mcubes.marching_cubes(-f, 0.0)
    verts = verts * vx + np.array([x0, y0, z0])
    verts = _taubin(verts, faces, 16)
    k = size / LONG
    verts *= k
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces[:, ::-1].tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material or electrum())
    _cavity(ob)
    return ob


def _taubin(v, f, n, lam=0.5, mu=-0.53):
    """Taubin smoothing: takes the voxel steps off the marching-cubes surface without shrinking it."""
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    nv = len(v)
    cnt = np.bincount(e[:, 0], minlength=nv).astype(float)
    for _ in range(n):
        for w in (lam, mu):
            acc = np.zeros_like(v)
            np.add.at(acc, e[:, 0], v[e[:, 1]])
            v = v + w * (acc / np.maximum(cnt, 1)[:, None] - v)
    return v


def _cavity(ob, radius=4):
    """A `cavity` vertex attribute: how far each point sits below the average of its neighbourhood (worn
    highs polished, recesses dull and darker, as on a handled coin). Computed from vertex positions."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    nor = np.empty(n * 3)
    me.vertices.foreach_get("normal", nor)
    nor = nor.reshape(n, 3)
    edges = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    avg = co.copy()
    for _ in range(radius * 4):
        acc = np.zeros_like(avg)
        cnt = np.zeros(n)
        np.add.at(acc, edges[:, 0], avg[edges[:, 1]])
        np.add.at(acc, edges[:, 1], avg[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1)
        np.add.at(cnt, edges[:, 1], 1)
        avg = 0.5 * avg + 0.5 * acc / np.maximum(cnt, 1)[:, None]
    depth = np.einsum("ij,ij->i", avg - co, nor)  # positive where the point is sunk below its surroundings
    scale = np.percentile(np.abs(depth), 98) or 1.0
    cav = np.clip(depth / scale, -1.0, 1.0)
    at = me.attributes.new("cavity", "FLOAT", "POINT")
    at.data.foreach_set("value", cav.astype(np.float32))


def electrum():
    """Electrum: gold with a lot of silver in it, paler than the ore's gold. Polished on the highs, duller
    and a shade darker in the recesses (from the `cavity` attribute), roughness 0.3 on average: glossier
    coins mirror the dark room and read as bowls (blender-frame-pitfalls)."""
    if "electrum_coin" in bpy.data.materials:
        return bpy.data.materials["electrum_coin"]
    m = bpy.data.materials.new("electrum_coin")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = 1.0
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "cavity"
    ramp_c = nt.nodes.new("ShaderNodeValToRGB")  # colour: pale electrum on highs, dimmer in recesses
    ramp_c.color_ramp.elements[0].position = 0.45
    ramp_c.color_ramp.elements[0].color = (*kit.ELECTRUM, 1.0)
    ramp_c.color_ramp.elements[1].position = 1.0
    ramp_c.color_ramp.elements[1].color = (0.62, 0.5, 0.29, 1.0)
    ramp_r = nt.nodes.new("ShaderNodeMapRange")  # roughness: 0.24 on highs, 0.5 in recesses
    ramp_r.inputs["From Min"].default_value = -0.3
    ramp_r.inputs["From Max"].default_value = 1.0
    ramp_r.inputs["To Min"].default_value = 0.24
    ramp_r.inputs["To Max"].default_value = 0.5
    to01 = nt.nodes.new("ShaderNodeMapRange")
    to01.inputs["From Min"].default_value = -1.0
    to01.inputs["From Max"].default_value = 1.0
    nt.links.new(attr.outputs["Fac"], to01.inputs["Value"])
    nt.links.new(to01.outputs["Result"], ramp_c.inputs["Fac"])
    nt.links.new(ramp_c.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(attr.outputs["Fac"], ramp_r.inputs["Value"])
    nt.links.new(ramp_r.outputs["Result"], b.inputs["Roughness"])
    # fine scratches and pitting of a handled, buried coin
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 900.0
    nz.inputs["Detail"].default_value = 8.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.03
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def load_relief(path):
    from PIL import Image
    im = Image.open(path)
    a = np.asarray(im).astype(np.float64)
    if a.ndim == 3:
        a = a[..., 0]
    return a / (65535.0 if a.max() > 255 else 255.0)


if __name__ == "__main__":
    def arg(name, default=None):
        return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

    out = arg("--out")
    os.makedirs(out, exist_ok=True)
    views = arg("--views", "obv,rev,edge").split(",")
    res = tuple(int(x) for x in arg("--res", "900x900").split("x"))
    samples = int(arg("--samples", "48"))
    voxel = float(arg("--voxel", "0.05"))
    rel = arg("--relief")
    kit.reset("a", res=res, samples=samples)
    coin = Coin(relief=load_relief(rel) if rel else None)
    ob = coin_mesh("coin", coin, size=0.1, voxel=voxel)
    print(f"[coin] {len(ob.data.polygons)} faces", flush=True)
    # look-dev light: the scene's hero light (a tight spot from above-left) plus a soft fill
    ob.location = (0, 0, 0.05)
    kit.area_light("soft", (-0.4, -0.6, 0.9), (0, 0, 0.05), 40, size=0.6)
    kit.area_light("rim", (0.6, 0.5, 0.4), (0, 0, 0.05), 25, size=0.4)
    kit.spot_light("hero", (-0.25, -0.35, 0.6), (0, 0, 0.05), 22, angle=math.radians(24), blend=0.5, radius=0.12)
    kit.box("ledge", (0.3, 0.3, 0.02), loc=(0, 0, 0.0), material=kit.mat("ground"))
    for v in views:
        if v == "obv":
            ob.rotation_euler = (0, 0, 0)
            ob.location = (0, 0, 0.05)
            kit.camera((0, -0.02, 0.42), (0, 0, 0.05), lens=85)
        elif v == "rev":
            ob.rotation_euler = (math.pi, 0, 0)
            ob.location = (0, 0, 0.05)
            kit.camera((0, -0.02, 0.42), (0, 0, 0.05), lens=85)
        elif v == "edge":
            ob.rotation_euler = (0, 0, 0)
            ob.location = (0, 0, 0.05)
            kit.camera((0.05, -0.38, 0.12), (0, 0, 0.05), lens=85)
        elif v == "hero":
            ob.rotation_euler = (math.radians(58), 0, 0)
            ob.location = (0, 0, 0.06)
            kit.camera((0.0, -0.4, 0.2), (0, 0, 0.06), lens=85)
        kit.render(os.path.join(out, f"coin_{v}.png"))
