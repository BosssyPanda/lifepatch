"""The intro's dioramas, one function per scene, for the overview frames.

Each scene builds its plateau composition: the diorama on its island, the era's money in the
foreground, the lights and the camera. Builders for the money objects live here too, because the
same object reappears in the transition frames.

Chapter list = the feasibility report's re-cut (its question 2), with storyboard cards noted.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import kit
from kit import mat

# --------------------------------------------------------------------------------------------
# Money objects
# --------------------------------------------------------------------------------------------


def _ore_material(name, glow):
    """One material for the ore: gold, quartz, host rock and the glowing crack, chosen per point by the
    mesh's float attributes (quartz, rock, glow; positive = that material), so the edges between them
    are crisp curves instead of the mesh's stair-stepped faces."""
    lk = kit.look()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 60.0
    nz.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.002
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])

    def bsdf(base, metallic, rough, sss=0.0):
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = base
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = rough
        if sss:
            b.inputs["Subsurface Weight"].default_value = sss
            b.inputs["Subsurface Radius"].default_value = (1.0, 1.0, 1.0)
            b.inputs["Subsurface Scale"].default_value = 0.01
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
        return b.outputs[0]

    def mask(attr):
        a = nt.nodes.new("ShaderNodeAttribute")
        a.attribute_name = attr
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.interpolation_type = "SMOOTHSTEP"
        mr.inputs["From Min"].default_value = -0.004
        mr.inputs["From Max"].default_value = 0.004
        nt.links.new(a.outputs["Fac"], mr.inputs["Value"])
        return mr.outputs["Result"]

    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = kit.rgba(lk["fire"])
    em.inputs["Strength"].default_value = glow
    shader = bsdf((*kit.GOLD, 1.0), 1.0, 0.22)
    rock = bsdf(kit.rgba("#1c1a18"), 0.0, 0.95)
    rock.node.inputs["Specular IOR Level"].default_value = 0.25
    for attr, other in (("rock", rock),
                        ("quartz", bsdf(kit.rgba("#cfc9bd"), 0.0, 0.45, 0.5)),
                        ("glow", em.outputs[0])):
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(mask(attr), mix.inputs[0])
        nt.links.new(shader, mix.inputs[1])
        nt.links.new(other, mix.inputs[2])
        shader = mix.outputs[0]
    nt.links.new(shader, out.inputs["Surface"])
    return m


def gold_ore(name="ore", loc=(0, 0, 0), scale=1.0, subdiv=6, glow=8.0, seed=7):
    """The storyboard's ore: a tall gold lump with milky quartz in its creases, patches of dark host
    rock, and a fissure down the front (-Y) lit from inside: the way in. Built from noise, so it is a
    stand-in for the hand sculpt with the same silhouette and materials. Returns (object, crack path)."""
    off = Vector((seed * 1.31, seed * 2.07, seed * 0.73))
    crack = [(-0.14, 0.62), (-0.03, 0.34), (-0.1, 0.08), (0.04, -0.2), (-0.02, -0.46), (0.03, -0.62)]

    def crack_d(x, z):
        best = 9.0
        for (ax, az), (bx, bz) in zip(crack, crack[1:]):
            dx, dz = bx - ax, bz - az
            t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
            best = min(best, math.hypot(x - ax - dx * t, z - az - dz * t))
        return best

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    lay = {k: bm.verts.layers.float.new(k) for k in ("quartz", "rock", "glow")}
    for v in bm.verts:
        p = v.co.copy()
        n = p.normalized()
        taper = 1.0 - 0.22 * max(0.0, p.z)
        co = Vector((p.x * 0.6 * taper, p.y * 0.52 * taper, p.z))
        if co.z < -0.7:
            co.z = -0.7 - (co.z + 0.7) * 0.4        # a flatter foot to stand on
        lump = noise.noise(p * 0.9 + off) * 0.22 + noise.noise(p * 3.5 + off * 2.0) * 0.05
        crease = -(abs(noise.noise(p * 2.6 + off * 3.0)) ** 0.7) * 0.05    # ridged noise: thin creases
        cell = noise.cell(p * 3.6 + off) * 0.02
        crink = noise.noise(p * 22.0 + off) * 0.003
        d = lump + crease + cell + crink
        co += n * d
        c = 9.0
        if co.y < -0.1:
            c = crack_d(co.x, co.z)
            if c < 0.075:
                co.y += 0.22 * (1.0 - (c / 0.075) ** 2)
        v.co = co
        v[lay["glow"]] = 0.03 - c
        # dark host rock fills the hollows and lines the crack; quartz shows as small flecks
        v[lay["rock"]] = max(0.075 - c, -0.03 - crease - lump * 0.5 + 0.04 * noise.noise(p * 5.0 + off))
        v[lay["quartz"]] = min(0.075 - c < 0 and 1.0 or -1.0, noise.noise(p * 9.0 + off * 4.0) - 0.5)
    bm.normal_update()
    ob = kit.from_bmesh(name, bm, _ore_material(name + "_mat", glow))
    kit.place(ob, loc, (0, 0, 0), scale)
    return ob, crack


def nugget(name, loc, scale=0.06, seed=3):
    ob = kit.lumpy(name, 1.0, loc=loc, scale=(scale, scale * 0.8, scale * 0.6), material=mat("gold"),
                   amp=0.35, freq=1.4, subdiv=4, seed=seed)
    return ob


def lion_coin(name, loc, size=0.16, rot=(0, 0, 0), material="electrum", seed=5, flat=0.38):
    """A Lydian lion trite: a thick bean-shaped lump of electrum, the lion's head on its face and
    rough square punch marks on the back. size = its long axis in metres (hero scale, not real)."""
    s = size / 2
    body = kit.bake_scale(kit.lumpy(name, 1.0, scale=(s, s * 0.86, s * flat), material=mat(material),
                                    amp=0.08, freq=1.2, subdiv=5, seed=seed))
    parts = [body]
    # lion head in relief on the obverse (+Z): mane, head, open jaws, the knob on the forehead
    top = s * flat * 0.8
    for i, (x, y, r) in enumerate(((-0.25, 0.05, 0.42), (0.05, 0.12, 0.36), (0.32, 0.2, 0.22), (0.38, -0.12, 0.2),
                                   (0.12, 0.42, 0.14), (-0.45, 0.35, 0.2), (-0.5, -0.2, 0.22))):
        parts.append(kit.bake_scale(kit.sphere(f"{name}_r{i}", 1.0, loc=(x * s, y * s * 0.86, top),
                                               scale=(r * s, r * s * 0.9, r * s * 0.35), material=mat(material), subdiv=3)))
    # two rough square punches sunk into the reverse (-Z)
    for i, x in enumerate((-0.3, 0.3)):
        parts.append(kit.box(f"{name}_p{i}", (s * 0.42, s * 0.42, s * 0.12), loc=(x * s, 0, -s * flat * 0.95), rot=(0, 0, 0.2 * i),
                             material=mat(material), bevel=s * 0.03))
    ob = kit.join([p for p in parts], name)
    for p in ob.data.polygons:
        p.use_smooth = True
    return kit.place(ob, loc, rot)


def plain_coin(name, loc, r=0.06, thick=0.012, rot=(0, 0, 0), material="gold", motif=True):
    """A struck coin turned on a lathe: raised rim, sunken field, low relief in the middle. Its own
    roughness of 0.3: under a hero light, glossier coins mirror the dark room and read as bowls,
    rougher ones blow out to white. Lean it back about 35 degrees, not straight at the lens."""
    t, segs = thick / 2, 64
    prof = [(0.8 * r, t * 0.6), (0.88 * r, t), (0.97 * r, t), (r, t * 0.75),
            (r, -t * 0.75), (0.97 * r, -t), (0.88 * r, -t), (0.8 * r, -t * 0.6)]
    bm = bmesh.new()
    rings = [[bm.verts.new((pr * math.cos(i / segs * math.tau), pr * math.sin(i / segs * math.tau), pz)) for i in range(segs)]
             for pr, pz in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    metal = mat(material).copy()
    metal.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
    c = kit.from_bmesh(name, bm, metal)
    c.data.set_sharp_from_angle(angle=math.radians(35))
    if motif:
        m = kit.lumpy(name + "_motif", r * 0.6, loc=(0, 0, t * 0.45), scale=(1, 1, 0.08), material=metal,
                      amp=0.3, freq=1.5, subdiv=3, seed=2)
        m.parent = c
    kit.place(c, loc, rot)
    return c


def coin_rest(top, r, thick, tilt):
    """Height (relative to the same origin as top) of a tilted coin's centre when its lowest edge
    sits on a surface at top, so a coin leaning toward the lens touches its stand."""
    return top + r * math.sin(tilt) + thick / 2 * math.cos(tilt) - 0.0008


def hacksilver(name, loc, n=9, spread=0.06, seed=4):
    rnd = random.Random(seed)
    obs = []
    for i in range(n):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * spread
        sz = rnd.uniform(0.01, 0.022)
        ob = kit.lumpy(f"{name}{i}", 1.0, loc=Vector(loc) + d + Vector((0, 0, sz * 0.5)),
                       scale=(sz * rnd.uniform(1.0, 2.2), sz, sz * 0.45), material=mat("silver"),
                       amp=0.25, freq=2.0, subdiv=3, seed=seed + i)
        ob.rotation_euler = (0, 0, rnd.uniform(0, math.pi))
        obs.append(ob)
    return obs


def _print_image(name, w, h, kind, ink, paper, seed=1):
    """A printed paper texture made in code (no fonts, no invented script): borders, panels, marks."""
    import numpy as np

    rnd = np.random.default_rng(seed)
    img = np.ones((h, w, 4), dtype=np.float32)
    pc = np.array(kit._srgb01(paper), dtype=np.float32)
    ic = np.array(kit._srgb01(ink), dtype=np.float32)
    img[..., :3] = pc
    m = np.zeros((h, w), dtype=np.float32)
    b = max(2, w // 40)
    m[b:2 * b, b:w - b] = m[h - 2 * b:h - b, b:w - b] = 1
    m[b:h - b, b:2 * b] = m[b:h - b, w - 2 * b:w - b] = 1
    if kind == "jiaozi":
        # panels of block-print marks: a top band, a picture panel, columns of marks
        m[4 * b:5 * b, 3 * b:w - 3 * b] = 1
        for c in range(6):
            x0 = 4 * b + c * (w - 8 * b) // 6
            for r in range(5):
                y0 = 7 * b + r * (h // 2 - 8 * b) // 5
                blk = rnd.random((b * 2, b * 2)) > 0.45
                m[y0:y0 + 2 * b, x0:x0 + 2 * b] = np.maximum(m[y0:y0 + 2 * b, x0:x0 + 2 * b], blk)
        m[h // 2 + 2 * b:h - 4 * b, 4 * b:w - 4 * b] = 0.0
        yy, xx = np.mgrid[h // 2 + 2 * b:h - 4 * b, 4 * b:w - 4 * b]
        m[h // 2 + 2 * b:h - 4 * b, 4 * b:w - 4 * b] = ((np.sin(xx * 0.09) * np.sin(yy * 0.07)) > 0.6).astype(np.float32)
    elif kind == "share":
        # a hand-written contract: ruled lines of irregular strokes
        for r in range(14):
            y = 6 * b + r * (h - 10 * b) // 14
            x = 4 * b
            while x < w - 5 * b:
                L = int(rnd.integers(b, 4 * b))
                m[y:y + max(1, b // 3), x:x + L] = 1
                x += L + int(rnd.integers(b // 2, b))
    elif kind == "bond":
        m[5 * b:h - 5 * b, 5 * b:7 * b] = 1
        m[5 * b:7 * b, 5 * b:w - 5 * b] = 1
        for r in range(6):
            y = h // 2 + r * 2 * b
            m[y:y + b // 2 + 1, 9 * b:w - 6 * b] = 1
    img[..., :3] = pc * (1 - m[..., None]) + ic * m[..., None]
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.pixels[:] = img[::-1].ravel()
    im.pack()
    return im


def paper_sheet(name, size, loc=(0, 0, 0), rot=(0, 0, 0), kind="jiaozi", curl=0.0, seed=1):
    lk = kit.look()
    w, h = size
    bm = bmesh.new()
    nx, ny = 24, 32
    verts = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = (i / nx - 0.5) * w
            y = (j / ny - 0.5) * h
            z = curl * (2 * (i / nx) - 1) ** 2 * w
            verts[i, j] = bm.verts.new((x, y, z))
    uv = bm.loops.layers.uv.new()
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
            for lp, (a, c) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uv].uv = (a / nx, c / ny)
    ob = kit.from_bmesh(name, bm)
    m = bpy.data.materials.new(name + "_mat")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.8
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = _print_image(name + "_img", 512, int(512 * h / w), kind, lk["print"], lk["paper"], seed)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ob.data.materials.append(m)
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.0015
    return kit.place(ob, loc, rot)


# --------------------------------------------------------------------------------------------
# Props
# --------------------------------------------------------------------------------------------


def table(name, loc, size=(1.2, 0.7, 0.75), rot_z=0.0, material=None):
    m = material or mat("wood")
    w, d, h = size
    root = kit.link(bpy.data.objects.new(name + "_root", None))
    top = kit.box(name, (w, d, 0.05), loc=(0, 0, h - 0.025), material=m, bevel=0.01)
    top.parent = root
    for i, (x, y) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        leg = kit.box(f"{name}_leg{i}", (0.06, 0.06, h - 0.05), loc=(x * (w / 2 - 0.06), y * (d / 2 - 0.06), (h - 0.05) / 2),
                      material=m, bevel=0.005)
        leg.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def fire(name, loc, scale=1.0, light=600.0):
    root = kit.link(bpy.data.objects.new(name, None))
    rnd = random.Random(9)
    for i in range(7):
        a = i / 7 * math.tau
        st = kit.lumpy(f"{name}_stone{i}", 0.09, loc=(math.cos(a) * 0.38, math.sin(a) * 0.38, 0.04),
                       material=mat("rock"), amp=0.3, seed=i)
        st.parent = root
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        lg = kit.cyl(f"{name}_log{i}", 0.035, 0.6, loc=(0, 0, 0.08), rot=(math.pi / 2 - 0.35, 0, a),
                     material=mat("wood"), segs=12)
        lg.parent = root
    for i in range(5):
        h = rnd.uniform(0.3, 0.55)
        fl = kit.cyl(f"{name}_flame{i}", rnd.uniform(0.06, 0.1), h, loc=(rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08), 0.12 + h / 2),
                     material=mat("fire", 10.0), segs=16, r2=0.0)
        fl.rotation_euler = (rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 0)
        fl.parent = root
    lk = kit.look()
    glow = "#ffb070" if lk["key_name"] == "b" else lk["fire"]   # the light is paler than the flames
    kit.point_light(name + "_light", (0, 0, 0.45), light, color=glow, radius=0.25).parent = root
    root.location = loc
    root.scale = (scale, scale, scale)
    return root


def balance(name, loc, rot_z=0.0, scale=1.0):
    """An equal-arm balance with two pans."""
    root = kit.link(bpy.data.objects.new(name, None))
    m = mat("wood")
    met = mat("bronze") if kit.look()["key_name"] == "b" else mat("clay_dim")
    post = kit.cyl(name + "_post", 0.02, 0.5, loc=(0, 0, 0.25), material=m)
    base = kit.cyl(name + "_base", 0.12, 0.04, loc=(0, 0, 0.02), material=m, bevel=0.01)
    beam = kit.box(name + "_beam", (0.7, 0.025, 0.025), loc=(0, 0, 0.5), material=met, bevel=0.005)
    pans = []
    for side in (-1, 1):
        x = side * 0.33
        pan = kit.cyl(f"{name}_pan{side}", 0.11, 0.02, loc=(x, 0, 0.25), material=met, r2=0.13, bevel=0.005)
        for k in range(3):
            a = k / 3 * math.tau
            kit.curve_tube(f"{name}_cord{side}{k}", [(x + math.cos(a) * 0.1, math.sin(a) * 0.1, 0.26), (x, 0, 0.5)], 0.002,
                           material=met).parent = root
        pans.append(pan)
    for ob in [post, base, beam] + pans:
        ob.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    return root, [Vector((p.location.x, 0, 0.26)) for p in pans]


def tablet(name, loc, rot=(0, 0, 0), size=(0.09, 0.065, 0.022), seed=1):
    """A clay loan tablet: lines of small wedge marks pressed into the face, read as script, not
    as a grid of keys."""
    ob = kit.box(name, size, material=mat("clay_dim"), bevel=0.008)
    rnd = random.Random(seed)
    ink = mat("clay_dim", "#6f6a62" if kit.look()["key_name"] == "a" else "#6d5a48")
    k = 0
    for r in range(7):
        x = -0.036
        while x < 0.032:
            w = rnd.uniform(0.002, 0.007)
            up = rnd.random() < 0.2
            m = kit.box(f"{name}_w{k}", (0.0014, 0.004, 0.002) if up else (w, 0.0014, 0.002), material=ink,
                        loc=(x + (0.0007 if up else w / 2), 0.024 - r * 0.008, size[2] / 2 - 0.0006))
            m.parent = ob
            x += (0.0014 if up else w) + rnd.uniform(0.0015, 0.004)
            k += 1
    return kit.place(ob, loc, rot)


def jar(name, loc, h=0.45, r=0.16, material=None):
    bm = bmesh.new()
    prof = [(0.0, 0.0), (r * 0.55, 0.0), (r, h * 0.35), (r * 0.95, h * 0.6), (r * 0.5, h * 0.88), (r * 0.42, h), (r * 0.5, h * 1.04)]
    segs = 32
    rings = []
    for (pr, pz) in prof:
        rings.append([bm.verts.new((pr * math.cos(i / segs * math.tau), pr * math.sin(i / segs * math.tau), pz)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.from_bmesh(name, bm, material or mat("clay_dim"))
    return kit.place(ob, loc)


def sack(name, loc, size=0.35, seed=1):
    return kit.lumpy(name, size / 2, loc=(loc[0], loc[1], loc[2] + size * 0.35), scale=(1, 0.85, 0.75),
                     material=mat("clay_dim"), amp=0.12, freq=1.2, seed=seed)


def wall(name, loc, size, rot_z=0.0, material=None, bricks=False):
    ob = kit.box(name, size, loc=loc, rot=(0, 0, rot_z), material=material or mat("rock"), bevel=0.02)
    return ob


def chinese_roof(name, loc, w=3.0, d=1.6, h=0.7, rot_z=0.0):
    """A tiled roof: a ridge, two concave slopes, eaves that sweep up toward the corners."""
    bm = bmesh.new()
    nx, ny = 32, 16
    verts = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            u = i / nx - 0.5
            v = j / ny - 0.5
            slope = abs(v) * 2
            z = h * (1 - slope) ** 1.6 + 0.12 * slope ** 4 + 0.32 * slope ** 3 * (abs(u) * 2) ** 4
            verts[i, j] = bm.verts.new((u * w * (1 + 0.04 * slope), v * d, z))
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
    roof = kit.from_bmesh(name, bm, mat("rock"))
    roof.modifiers.new("thick", "SOLIDIFY").thickness = 0.07
    ridge = kit.box(name + "_ridge", (w * 0.86, 0.1, 0.12), loc=(0, 0, h + 0.04), material=mat("rock"), bevel=0.02)
    ridge.parent = roof
    return kit.place(roof, loc, (0, 0, rot_z))


def sail(name, w, h, bulge, material):
    """A square sail: a sheet bulging forward (+Y) in the middle, flat at the yards."""
    bm = bmesh.new()
    nx, ny = 12, 10
    verts = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x = (u - 0.5) * w * (1.0 + 0.12 * (1 - v))   # a square sail is wider at its foot
            z = (v - 0.5) * h
            y = bulge * math.sin(math.pi * u) * math.sin(math.pi * (0.1 + 0.8 * v))
            verts[i, j] = bm.verts.new((x, y, z))
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
    ob = kit.from_bmesh(name, bm, material)
    ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.015
    return ob


def ship(name, loc, rot_z=0.0, scale=1.0):
    """A three-masted merchantman (a Dutch fluyt in outline): round hull, high narrow stern, set sails.
    Bow toward +X in its own frame."""
    root = kit.link(bpy.data.objects.new(name, None))
    wood = mat("wood")
    bm = bmesh.new()
    L, B, H = 6.0, 1.5, 1.1
    sections = 18
    rings = []
    for k in range(sections + 1):
        t = k / sections                       # 0 = stern, 1 = bow
        x = (t - 0.5) * L
        full = math.sin(math.pi * (0.06 + 0.94 * t)) ** 0.55
        half = B / 2 * max(0.1, full) * (0.86 if t < 0.15 else 1.0)
        sheer = 0.45 * (1 - t) ** 3 + 0.3 * t ** 4  # high stern, lifted bow
        ring = []
        for a in range(11):
            ang = math.pi * a / 10
            tumble = 0.88 + 0.12 * math.sin(ang)   # the sides lean in above the waterline
            ring.append(bm.verts.new((x, -half * math.cos(ang) * tumble, -H * math.sin(ang) * (0.55 + 0.45 * full) + sheer)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(10):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bm.faces.new(rings[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    hull = kit.from_bmesh(name + "_hull", bm, wood)
    hull.modifiers.new("thick", "SOLIDIFY").thickness = 0.06
    parts = [hull]
    parts.append(kit.box(name + "_deck", (L * 0.86, B * 0.8, 0.05), loc=(0.1, 0, 0.12), material=wood))
    parts.append(kit.box(name + "_castle", (1.1, B * 0.7, 0.7), loc=(-L / 2 + 0.75, 0, 0.55), material=wood, bevel=0.03))
    parts.append(kit.box(name + "_stern", (0.12, B * 0.62, 0.6), loc=(-L / 2 + 0.2, 0, 0.75), rot=(0, -0.25, 0), material=wood, bevel=0.02))
    parts.append(kit.cyl(name + "_bowsprit", 0.04, 2.0, loc=(L / 2 + 0.55, 0, 0.75), rot=(0, math.radians(68), 0), material=wood, segs=10))
    canvas = mat("paper")
    tops = []
    for i, (x, hgt) in enumerate(((-1.6, 4.0), (0.25, 5.0), (1.9, 3.8))):
        parts.append(kit.cyl(f"{name}_mast{i}", 0.06, hgt, loc=(x, 0, hgt / 2), material=wood, segs=12))
        tops.append(Vector((x, 0, hgt)))
        for j, (frac, sw) in enumerate(((0.42, 1.0), (0.74, 0.75))):
            if i == 0 and j == 1:
                continue
            yw = B * 1.7 * sw
            sh = hgt * 0.27
            parts.append(kit.cyl(f"{name}_yard{i}{j}", 0.03, yw, loc=(x, 0, hgt * frac + sh * 0.5), rot=(math.pi / 2, 0, 0),
                                 material=wood, segs=10))
            sl = sail(f"{name}_sail{i}{j}", yw * 0.92, sh, 0.22 * sw, canvas)
            sl.location = (x + 0.06, 0, hgt * frac)
            sl.rotation_euler = (0, 0, -math.pi / 2)   # sheet across the hull, bulging toward the bow
            parts.append(sl)
    # stays and shrouds
    rope = mat("wood")
    pts = [(tops[0], Vector((-L / 2 + 0.25, 0, 1.0))), (tops[0], tops[1]), (tops[1], tops[2]), (tops[2], Vector((L / 2 + 1.4, 0, 1.15)))]
    for k, (a, b) in enumerate(pts):
        parts.append(kit.curve_tube(f"{name}_stay{k}", [a, b], 0.008, material=rope))
    for i, t in enumerate(tops):
        for side in (-1, 1):
            parts.append(kit.curve_tube(f"{name}_shroud{i}{side}", [t * 0.92, Vector((t.x - 0.3, side * B * 0.5, 0.3))], 0.006, material=rope))
    for ob in parts:
        ob.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    return root


def crate(name, loc, s=0.45, rot_z=0.0):
    return kit.box(name, (s, s, s), loc=(loc[0], loc[1], loc[2] + s / 2), rot=(0, 0, rot_z), material=mat("wood"), bevel=0.02)


def barrel(name, loc, r=0.22, h=0.6):
    bm = bmesh.new()
    segs, rings_n = 24, 8
    rings = []
    for k in range(rings_n + 1):
        t = k / rings_n
        rr = r * (0.85 + 0.15 * math.sin(math.pi * t))
        rings.append([bm.verts.new((rr * math.cos(i / segs * math.tau), rr * math.sin(i / segs * math.tau), t * h)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bm.faces.new(rings[-1])
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.place(kit.from_bmesh(name, bm, mat("wood")), loc)


def gold_bar(name, loc, rot_z=0.0, s=1.0):
    bm = bmesh.new()
    L, W, H, t = 0.25 * s, 0.09 * s, 0.045 * s, 0.75
    pts = [(-L / 2, -W / 2, 0), (L / 2, -W / 2, 0), (L / 2, W / 2, 0), (-L / 2, W / 2, 0),
           (-L / 2 * t, -W / 2 * t, H), (L / 2 * t, -W / 2 * t, H), (L / 2 * t, W / 2 * t, H), (-L / 2 * t, W / 2 * t, H)]
    v = [bm.verts.new(p) for p in pts]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    ob = kit.from_bmesh(name, bm, mat("gold"), smooth=False)
    b = ob.modifiers.new("bevel", "BEVEL")
    b.width = 0.006 * s
    b.segments = 2
    return kit.place(ob, loc, (0, 0, rot_z))


def screen(name, loc, size=(0.6, 0.38), rot=(0, 0, 0), chart=True, seed=3):
    lk = kit.look()
    w, h = size
    root = kit.link(bpy.data.objects.new(name, None))
    frame = kit.box(name + "_frame", (w + 0.03, 0.03, h + 0.03), material=mat("clay_dim"), bevel=0.005)
    frame.parent = root
    panel = kit.box(name + "_panel", (w, 0.005, h), loc=(0, -0.016, 0), material=mat("glass_screen", lk["bg"] if lk["key_name"] == "a" else "#1d2a38"))
    panel.parent = root
    if chart:
        rnd = random.Random(seed)
        pts, yv = [], 0.0
        for i in range(24):
            yv += rnd.uniform(-0.06, 0.08)
            pts.append((-w * 0.42 + i * w * 0.84 / 23, -0.022, max(-h * 0.35, min(h * 0.35, yv * h * 0.6))))
        ln = kit.curve_tube(name + "_line", pts, 0.004, material=mat("glass_screen", "#f4f0e6" if lk["key_name"] == "a" else "#9fe0b0"))
        ln.parent = root
    root.location = loc
    root.rotation_euler = rot
    return root


# --------------------------------------------------------------------------------------------
# Scenes
# --------------------------------------------------------------------------------------------


# Every era frames its money at the same spot: lower left third, 0.85 m from the lens. Between eras
# the camera travels through the dark, that money stays lit in this spot and turns into the next
# era's money, and the next diorama lights up behind it.
HERO = (-0.17, -0.2, 0.85)


def _cam_axes(cam):
    r = cam.rotation_euler.to_matrix()
    f = r @ Vector((0, 0, -1))
    fwd = Vector((f.x, f.y, 0)).normalized()
    right = Vector((fwd.y, -fwd.x, 0))
    return fwd, right, math.atan2(fwd.y, fwd.x) - math.pi / 2


def facing(frm, to):
    """rot_z that turns a figure at frm to look at to (figures face +Y before rotation)."""
    return math.atan2(-(to[0] - frm[0]), to[1] - frm[1])


def hero_point(cam):
    return kit.screen_point(cam, *HERO)


def hero_light(cam, target, energy=14.0):
    """A tight spot from above, on the money only; it is the light that stays on in the dark."""
    fwd, right, _yaw = _cam_axes(cam)
    pos = Vector(target) - fwd * 0.25 - right * 0.15 + Vector((0, 0, 0.6))
    li = kit.spot_light("hero_key", pos, target, energy * 1.6, angle=math.radians(24), blend=0.5, radius=0.12)
    li["hero"] = True
    return li


def face_cam(cam, tilt):
    """Rotation for a flat object (face = +Z) lying toward the camera, propped up by tilt radians."""
    _fwd, right, yaw = _cam_axes(cam)
    return (Matrix.Rotation(tilt, 3, right) @ Matrix.Rotation(yaw, 3, "Z")).to_euler()


def stand(name, cam, hp, top_z, material=None, size=(0.34, 0.3), floor=0.0, back=0.1, bevel=0.015):
    """The pedestal the money lies on: top at top_z under hp, square to the camera. Dark, so the
    money is the brightest thing on it."""
    fwd, right, yaw = _cam_axes(cam)
    w, d = size
    c = hp - fwd * (d / 2 - back)
    h = top_z - floor
    return kit.box(name, (w, d, h), loc=(c.x, c.y, floor + h / 2), rot=(0, 0, yaw),
                   material=material or mat("ground"), bevel=bevel)


def mark_hero(*obs):
    for ob in obs:
        ob["hero"] = True
        for ch in ob.children_recursive:
            ch["hero"] = True


def _lights_studio(target=(0, 0, 0.8), key=800, fill=200, rim=450, spread=1.0):
    t = Vector(target)
    kit.area_light("key", t + Vector((3.2, -4.0, 4.5)) * spread, t, key, size=3)
    kit.area_light("fill", t + Vector((-5.0, -3.0, 2.0)) * spread, t, fill, size=5, kind="fill")
    kit.area_light("rim", t + Vector((-1.5, 5.0, 3.5)) * spread, t, rim, size=2.5)


def ore():
    """00 The gold ore: the hook. Dark in both looks; gold is allowed here in both."""
    kit.backdrop("dark")
    gold_ore(loc=(0, 0, 0.86), scale=0.55)
    _ore_base()
    _ore_lights(1.0)
    kit.camera((0.5, -3.9, 1.0), (0, 0, 0.84), lens=60)


def _ore_base():
    """The ore stands on its own small island of ground, like every era's diorama after it."""
    isl = kit.island("ore_island", radius=0.62, depth=0.32, material=mat("rock", "#1f1c19"), wobble=0.22, seed=21,
                     top_noise=0.03)
    isl.location = (0, 0, 0.42)


def _ore_lights(k):
    kit.spot_light("pool", (0.5, -1.0, 4.0), (0, 0, 0.95), 1300 * k, angle=0.5, blend=0.85, radius=0.5)
    kit.area_light("rimL", (-2.0, 1.8, 1.8), (0, 0, 1.0), 300 * k, size=1.2)
    kit.area_light("rimR", (2.2, 1.5, 1.4), (0, 0, 1.0), 220 * k, size=1.2)
    # two big soft panels the gold can mirror; without them metal goes black in the dark
    kit.area_light("softL", (-2.6, -1.6, 1.4), (0, 0, 0.95), 160 * k, size=2.5)
    kit.area_light("softR", (2.4, -2.2, 2.2), (0, 0, 0.95), 110 * k, size=2.5)


def crevice():
    """Inside the rock: two walls closing overhead and a slit of the cave's firelight at the far end."""
    for side in (-1, 1):
        bm = bmesh.new()
        ny, nz = 120, 60
        verts = {}
        for j in range(ny + 1):
            for k in range(nz + 1):
                y = -0.6 + 6.0 * j / ny
                z = -1.2 + 3.0 * k / nz
                gap = 0.24 + 0.06 * math.sin(y * 1.1 + side) - 0.08 * max(0.0, z - 0.3)
                q = Vector((y, z, side * 3.0))
                x = side * (gap + 0.08 * noise.noise(q * 1.4)
                            + 0.05 * noise.cell(q * 2.6)                  # broken rock: flat steps
                            + 0.02 * noise.cell(q * 7.0)
                            + 0.006 * noise.noise(q * 20.0))
                verts[j, k] = bm.verts.new((x, y, z))
        for j in range(ny):
            for k in range(nz):
                q = (verts[j, k], verts[j + 1, k], verts[j + 1, k + 1], verts[j, k + 1])
                bm.faces.new(q if side < 0 else q[::-1])
        kit.from_bmesh(f"crevice{side}", bm, mat("rock", "#4a443e"), smooth=False)
    # the far end opens onto the cave: a glowing sheet behind the walls, so the opening's shape is
    # whatever gap the rock leaves
    kit.box("slit", (2.0, 0.02, 4.0), loc=(0, 5.7, 0.2), material=mat("fire", 4.0))
    kit.area_light("slit_light", (0, 5.3, 0.2), (0, 0, 0.2), 60, size=0.3, color=kit.look()["fire"])


def dive(stage):
    """00→01: into the crack (a: the crack fills the frame, b: inside the rock, c: out through the cave mouth)."""
    kit.backdrop("dark")
    if stage == "a":
        gold_ore(loc=(0, 0, 0.86), scale=0.55, glow=10.0)
        _ore_base()
        _ore_lights(0.8)
        kit.camera((0.07, -0.9, 0.9), (-0.03, -0.1, 0.85), lens=40)
    elif stage == "b":
        crevice()
        kit.camera((0.0, 0.3, 0.12), (0.0, 5.3, 0.2), lens=26)
    else:
        cave(cam="mouth")


def _paintings(center=(0.4, 1.9), origin=(0.2, 1.0, 1.0)):
    """Running deer and a bison painted on the back wall: each stroke is projected from the middle of
    the cave onto the rock, so the paint follows the wall."""
    m = mat("paint")
    o = Vector(origin)
    cx, cz = center

    def stroke(pts, r=0.03, n=6):
        dense = []
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            for i in range(n):
                t = i / n
                dense.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
        dense.append(pts[-1])
        out = []
        for x, z in dense:
            tgt = Vector((cx + x, 7.0, cz + z))
            hit, _n = kit.ray_hit(o, tgt - o)
            if hit is not None:
                out.append(hit + (tgt - o).normalized() * 0.012)
        if len(out) > 1:
            kit.curve_tube("paint", out, r, material=m)

    for dx, dz, sc in ((-1.3, 0.25, 1.15), (0.2, 0.05, 1.3), (1.6, 0.3, 1.05)):
        def S(pts):
            return [(dx + x * sc, dz + z * sc) for x, z in pts]
        stroke(S([(-0.45, 0.0), (-0.2, 0.12), (0.2, 0.12), (0.42, 0.02)]))
        stroke(S([(-0.45, 0.0), (-0.2, -0.1), (0.2, -0.1), (0.42, 0.02)]))
        stroke(S([(0.38, 0.05), (0.55, 0.32), (0.7, 0.3)]))
        stroke(S([(0.55, 0.34), (0.5, 0.6), (0.4, 0.75)]), 0.018)
        stroke(S([(0.58, 0.36), (0.68, 0.62), (0.8, 0.7)]), 0.018)
        for lx, rx in ((-0.32, -0.45), (-0.22, -0.1), (0.22, 0.35), (0.3, 0.42)):
            stroke(S([(lx, -0.08), (rx, -0.42)]), 0.02)
    # bison below the herd
    B = [(-0.55, 0.0), (-0.25, 0.25), (0.15, 0.22), (0.4, -0.02), (0.15, -0.25), (-0.4, -0.25), (-0.55, 0.0)]
    stroke([(x * 1.4 - 0.4, z * 1.4 - 0.95) for x, z in B], 0.035)
    for x in (-0.5, -0.25, 0.1, 0.3):
        stroke([(x * 1.4 - 0.4, -0.25 * 1.4 - 0.95), (x * 1.4 - 0.45, -0.62 * 1.4 - 0.95)], 0.022)


def cave(cam="plateau"):
    """01 Stone Age, c. 30,000 BCE: 'Debts before money'. Sharing and remembered debts, no haggling."""
    kit.backdrop("dark")
    lk = kit.look()
    kit.island(radius=5.0, depth=0.7, material=mat("ground"), seed=11)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.08 or (v.co.y < -0.35 and v.co.z < 0.75)], context="VERTS")
    for v in bm.verts:
        n = v.co.normalized()
        v.co = Vector((v.co.x * 4.6, v.co.y * 4.0, v.co.z * 3.1))
        v.co += n * (noise.noise(v.co * 0.7) * 0.45 + noise.noise(v.co * 2.4) * 0.12)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    shell = kit.from_bmesh("cave", bm, mat("rock"))
    shell.modifiers.new("thick", "SOLIDIFY").thickness = 0.3
    shell.location = (0, 1.0, 0)
    _paintings()
    fire("fire", (0.2, 1.2, 0.02), scale=0.9, light=380 if lk["key_name"] == "a" else 480)
    kit.figure("hunter", "sit_work", loc=(-1.0, 1.7, 0.0), rot_z=facing((-1.0, 1.7), (0.2, 1.2)), hat="hair")
    kit.curve_tube("bow", [(-0.62, 1.95, 0.48), (-0.55, 2.05, 0.75), (-0.6, 2.1, 1.02)], 0.012, material=mat("wood"))
    g, t = (1.1, 2.0), (0.35, 2.55)
    kit.figure("giver", "give", loc=(*g, 0.0), rot_z=facing(g, t), hat="hair")
    kit.figure("taker", "receive", loc=(*t, 0.0), rot_z=facing(t, g), hat="band")
    kit.lumpy("food", 0.06, loc=kit.hand_pos("give", 1, (*g, 0.0), facing(g, t)) + Vector((0, 0, 0.02)),
              scale=(1.4, 1, 0.7), material=mat("clay_dim"), seed=2)
    kit.figure("elder", "sit", loc=(1.55, 0.7, 0.0), rot_z=facing((1.55, 0.7), (0.2, 1.2)), hat="hair")
    kit.figure("child", "crouch", loc=(-0.45, 0.55, 0.0), rot_z=facing((-0.45, 0.55), (0.2, 1.2)), scale=0.62, hat="hair")
    kit.area_light("cavefill", (0, -5, 3.5), (0, 1.5, 1.0), 70, size=6, kind="fill")
    kit.area_light("rim", (2.5, 4.0, 3.0), (0, 1.5, 1.0), 90, size=2)
    if cam == "plateau":
        c = kit.camera((-1.3, -2.6, 1.0), (0.25, 1.8, 0.85), lens=32)
        hp = hero_point(c)
        # the gold from the ore, now a nugget on a ledge: valued, admired, not money
        ledge = kit.lumpy("ledge", 1.0, loc=(hp.x - 0.12, hp.y + 0.05, hp.z - 0.3), scale=(0.42, 0.3, 0.28),
                          material=mat("rock"), amp=0.12, freq=1.0, seed=8)
        mark_hero(nugget("nugget", hp, scale=0.045))
        hero_light(c, hp, 10.0)
    else:
        # from inside the crevice, looking out through the cave mouth at the fire
        kit.camera((0.3, -4.2, 1.2), (0.2, 1.4, 0.8), lens=28)
        for i in range(10):
            a = i / 10 * math.tau
            kit.lumpy(f"mouth{i}", 0.9, loc=(math.cos(a) * 1.6 + 0.3, -3.3, 1.2 + math.sin(a) * 1.4),
                      scale=(1, 0.6, 1), material=mat("rock"), amp=0.3, seed=20 + i)


def silver():
    """02 Gold as status, silver by weight: Kanesh, 20th to 18th c. BCE. Merchants weigh silver and
    record loans on clay tablets (Bronze Age, with the Copper Age folded in)."""
    kit.island(radius=5.0, depth=0.7, seed=12)
    wall("wallL", (-2.4, 2.2, 1.3), (0.4, 3.6, 2.6), rot_z=0.25)
    wall("wallB", (0.3, 3.4, 1.3), (5.2, 0.4, 2.6))
    kit.box("door", (1.0, 0.45, 2.0), loc=(1.2, 3.4, 1.0), material=mat("void"))
    for i, x in enumerate((-1.8, -1.35, -0.9)):
        jar(f"jar{i}", (x, 3.0, 0.0), h=0.6 - i * 0.08)
    for i in range(3):
        sack(f"sack{i}", (2.0 + i * 0.35, 2.6 - i * 0.2, 0.0), size=0.5, seed=i)
    table("table", (0.2, 1.0, 0), size=(1.6, 0.8, 0.78))
    balance("balance", (0.35, 0.95, 0.78), scale=0.9)
    hacksilver("hs", (0.35 - 0.3, 0.95, 0.78 + 0.25 * 0.9 + 0.012), n=10, spread=0.05)
    for i in range(3):
        kit.lumpy(f"weight{i}", 0.03, loc=(0.35 + 0.3 + (i - 1) * 0.04, 0.95, 0.78 + 0.25 * 0.9 + 0.03),
                  scale=(1.2, 1, 0.8), material=mat("rock"), seed=30 + i)
    for i in range(3):
        tablet(f"tab{i}", (-0.35 + i * 0.12, 0.75, 0.8 + 0.011), rot=(0, 0, 0.2 * i - 0.2), seed=i)
    kit.figure("merchant", "receive", loc=(0.35, 1.75, 0), rot_z=math.radians(180), hat="cap")
    kit.figure("scribe", "stool", loc=(-1.1, 1.3, 0), rot_z=facing((-1.1, 1.3), (0.0, 0.9)), hat="band")
    kit.box("stool", (0.4, 0.4, 0.45), loc=(-1.1, 1.35, 0.22), material=mat("wood"), bevel=0.02)
    by, by_rz = (1.2, 0.45, 0), facing((1.2, 0.45), (0.35, 1.1))
    kit.figure("buyer", "carry", loc=by, rot_z=by_rz, hat="cap")
    held = (kit.hand_pos("carry", -1, by, by_rz) + kit.hand_pos("carry", 1, by, by_rz)) / 2
    sack("bundle", held - Vector((0, 0, 0.3 * 0.35 + 0.04)), size=0.3, seed=9)
    _lights_studio(target=(0, 1.2, 0.9), key=900, fill=260, rim=420)
    c = kit.camera((-1.0, -2.5, 1.1), (0.3, 1.4, 0.8), lens=34)
    hp = hero_point(c)
    stand("bench", c, hp, hp.z - 0.02)
    obs = hacksilver("hero_hs", (hp.x + 0.04, hp.y + 0.02, hp.z - 0.02), n=7, spread=0.03, seed=8)
    obs.append(tablet("hero_tablet", (hp.x - 0.06, hp.y - 0.01, hp.z - 0.02 + 0.011), rot=(0, 0, 0.3), seed=7))
    mark_hero(*obs)
    hero_light(c, hp, 12.0)


def coins():
    """03 First coins, then debasement: Lydia, c. 610 to 560 BCE. Lumps of electrum struck between a
    lion die and a punch. (Iron Age card replaced; Rome folded in as a coin that thins over time.)"""
    lk = kit.look()
    kit.island(radius=5.0, depth=0.7, seed=13)
    wall("wallB", (0, 3.4, 1.3), (5.5, 0.4, 2.6))
    wall("wallR", (2.6, 1.9, 1.3), (0.4, 3.2, 2.6), rot_z=-0.2)
    kit.cyl("furnace", 0.42, 0.75, loc=(-1.7, 2.9, 0.37), material=mat("rock"), segs=32, r2=0.3, bevel=0.06)
    kit.sphere("furnace_glow", 0.09, loc=(-1.62, 2.43, 0.4), scale=(1, 0.3, 0.7), material=mat("fire", 3.0))
    kit.point_light("furnace_l", (-1.55, 2.25, 0.45), 40)
    kit.cyl("stump", 0.3, 0.6, loc=(0.1, 1.7, 0.3), material=mat("wood"), segs=24, bevel=0.03)
    kit.cyl("die", 0.08, 0.06, loc=(0.1, 1.7, 0.63), material=mat("bronze") if lk["key_name"] == "b" else mat("clay_dim"), segs=24)
    st = (0.7, 2.05)
    kit.figure("striker", "hammer", loc=(*st, 0), rot_z=facing(st, (0.1, 1.7)), hat="cap")
    hp_h = kit.hand_pos("hammer", 1, (*st, 0), facing(st, (0.1, 1.7)))
    kit.cyl("hammer_h", 0.02, 0.45, loc=hp_h + Vector((0, 0, -0.05)), rot=(0.4, 0.2, 0), material=mat("wood"))
    kit.box("hammer_head", (0.16, 0.08, 0.08), loc=hp_h + Vector((0.05, 0.05, 0.16)), material=mat("rock"), bevel=0.01)
    kit.figure("holder", "crouch", loc=(-0.42, 1.85, 0), rot_z=facing((-0.42, 1.85), (0.1, 1.7)), hat="cap")
    kit.cyl("punch", 0.022, 0.22, loc=(0.08, 1.7, 0.76), material=mat("rock"), segs=12)
    kit.figure("clerk", "read", loc=(1.7, 2.8, 0), rot_z=math.radians(200), hat="band")
    kit.box("bench", (1.0, 0.6, 0.4), loc=(-0.9, 0.9, 0.2), rot=(0, 0, 0.15), material=mat("wood"), bevel=0.02)
    kit.box("cloth", (0.8, 0.5, 0.01), loc=(-0.9, 0.9, 0.405), rot=(0, 0, 0.15), material=mat("paper"), bevel=0.004)
    for i in range(6):
        lion_coin(f"small{i}", (-1.15 + i * 0.09, 0.95 + (i % 2) * 0.08, 0.425), size=0.05, rot=(0, 0, i), seed=40 + i)
    _lights_studio(target=(0, 1.6, 0.8), key=850, fill=240, rim=420)
    c = kit.camera((-0.5, -2.5, 1.05), (0.15, 1.6, 0.72), lens=34)
    hp = hero_point(c)
    stand("ledge", c, hp, hp.z - 0.035)
    mark_hero(lion_coin("hero", hp + Vector((0, 0, 0.012)), size=0.1, rot=face_cam(c, math.radians(58)), seed=5, flat=0.28))
    hero_light(c, hp, 12.0)


def paper():
    """04 Paper promises: Song China, where the state took over the jiaozi notes in 1023."""
    lk = kit.look()
    kit.island(radius=5.0, depth=0.7, seed=14)
    for i, x in enumerate((-1.9, 1.9)):
        kit.cyl(f"pillar{i}", 0.12, 2.0, loc=(x, 1.3, 1.0), material=mat("wood"), segs=16)
    chinese_roof("roof", (0, 2.2, 2.0), w=4.8, d=2.8, h=0.8)
    wall("wallB", (0, 3.3, 1.05), (4.2, 0.3, 2.1))
    table("counter", (0.2, 2.0, 0), size=(2.6, 0.7, 0.9))
    cash = "bronze" if lk["key_name"] == "b" else "clay_dim"
    for i in range(4):
        for j in range(10):
            plain_coin(f"cash{i}_{j}", (-0.85 + i * 0.12, 1.95, 0.93 + j * 0.008), r=0.025, thick=0.006, material=cash, motif=False)
    for k in range(5):
        paper_sheet(f"stack{k}", (0.32, 0.5), loc=(0.8 + k * 0.004, 1.95, 0.93 + k * 0.004), rot=(0, 0, 0.05 * k), seed=k)
    kit.figure("official", "give", loc=(0.4, 2.55, 0), rot_z=math.radians(180), hat="brim")
    kit.figure("trader", "receive", loc=(1.0, 1.4, 0), rot_z=facing((1.0, 1.4), (0.5, 2.2)), hat="band")
    # a porter under a carrying pole with strings of coin: the deposits jiaozi were first issued against
    po = (-1.45, 1.1)
    rz = facing(po, (0.0, 1.1))                    # walking right, toward the counter
    kit.figure("porter", "stand", loc=(*po, 0), rot_z=rz, hat="brim")
    fwd = Vector((-math.sin(rz), math.cos(rz), 0))
    side = Vector((math.cos(rz), math.sin(rz), 0))
    sho = Vector((*po, 1.5)) + side * 0.17         # the pole rests on one shoulder, loads fore and aft
    kit.cyl("pole", 0.018, 1.3, loc=sho, rot=(0, math.pi / 2, rz + math.pi / 2), material=mat("wood"), segs=10)
    for k, sgn in enumerate((-1, 1)):
        end = sho + fwd * 0.6 * sgn
        kit.curve_tube(f"cord{k}", [end, end - Vector((0, 0, 0.22))], 0.004, material=mat("wood"))
        for j in range(3):
            kit.cyl(f"string{k}{j}", 0.035, 0.42, loc=end - Vector((0, 0, 0.43)) + side * 0.045 * (j - 1),
                    material=mat(cash), segs=16, bevel=0.01)
    _lights_studio(target=(0, 1.8, 1.1), key=900, fill=250, rim=420)
    c = kit.camera((-0.3, -2.7, 1.05), (0.1, 1.8, 1.4), lens=32)
    hp = hero_point(c)
    stand("front_counter", c, hp, hp.z - 0.05)
    mark_hero(paper_sheet("hero", (0.15, 0.24), loc=hp, rot=face_cam(c, math.radians(42)), kind="jiaozi", curl=0.02, seed=9))
    hero_light(c, hp, 10.0)


def shares():
    """05 Global silver, company shares: c. 1600. Potosí silver crosses the oceans; the oldest known
    share (VOC, 1606) is bought on a quay. (Maritime card, re-dated from 1400.)"""
    lk = kit.look()
    kit.island(radius=4.2, depth=0.7, seed=15)
    wm = bpy.data.materials.new("water")
    wm.use_nodes = True
    b = wm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = kit.rgba("#24221f" if lk["key_name"] == "a" else "#2c4558")
    b.inputs["Roughness"].default_value = 0.12
    kit._bump(wm.node_tree, b, scale=6.0, strength=0.15, distance=0.02)
    kit.box("water", (40, 30, 0.05), loc=(0, 16, -0.3), material=wm)
    ship("ship", (1.6, 7.2, -0.1), rot_z=math.radians(10), scale=1.1)
    for i in range(6):
        kit.box(f"plank{i}", (5.0, 0.3, 0.06), loc=(0, 2.3 + i * 0.32, 0.03), material=mat("wood"))
    for i, (x, y) in enumerate(((-1.9, 2.4), (-1.5, 2.7), (-1.75, 2.85))):
        crate(f"crate{i}", (x, y, 0.0), s=0.5, rot_z=i * 0.4)
    for i, x in enumerate((1.9, 2.3)):
        barrel(f"barrel{i}", (x, 2.6, 0.0))
    kit.figure("investor", "read", loc=(-0.2, 1.4, 0), rot_z=math.radians(-160), hat="brim")
    paper_sheet("share_held", (0.22, 0.3), loc=kit.hand_pos("read", 1, (-0.2, 1.4, 0), math.radians(-160)) + Vector((0.05, 0.05, 0.05)),
                rot=(1.2, 0, math.radians(20)), kind="share", seed=3)
    kit.figure("sailor", "carry", loc=(-1.2, 2.1, 0), rot_z=math.radians(-30), hat="cap")
    crate("carried", kit.hand_pos("carry", 1, (-1.2, 2.1, 0), math.radians(-30)) + Vector((-0.1, 0.05, -0.12)), s=0.32)
    kit.figure("clerk", "stool", loc=(1.35, 0.95, 0), rot_z=math.radians(150), hat="brim")
    table("desk", (1.1, 0.55, 0), size=(0.8, 0.5, 0.72), rot_z=0.3)
    _lights_studio(target=(0, 2.4, 1.2), key=950, fill=260, rim=450, spread=1.4)
    c = kit.camera((-0.6, -2.6, 1.1), (0.7, 3.5, 1.5), lens=30)
    hp = hero_point(c)
    stand("crate_front", c, hp, hp.z - 0.03)
    share = paper_sheet("hero_share", (0.15, 0.21), loc=hp + Vector((0.04, 0.03, 0.0)), rot=face_cam(c, math.radians(25)), kind="share", seed=6)
    peso = plain_coin("piece_of_eight", hp + Vector((-0.07, -0.02, coin_rest(-0.03, 0.035, 0.006, math.radians(35)))),
                      r=0.035, thick=0.006, rot=face_cam(c, math.radians(35)), material="silver")
    mark_hero(share, peso)
    hero_light(c, hp, 12.0)


def goldwars():
    """06 Gold standard, wars, Bretton Woods: 1816 Act, 1914 Britain stops paying out gold, 1923 a
    dollar costs 4.2 trillion marks, 1944 Bretton Woods. (Industrial Revolution, WWI and WWII merged.)"""
    kit.island(radius=5.5, depth=0.7, seed=16)
    wall("wallB", (0, 3.4, 1.4), (6.0, 0.4, 2.8))
    kit.cyl("vault_door", 1.0, 0.25, loc=(-1.5, 3.15, 1.25), rot=(math.pi / 2, 0, 0), material=mat("clay_dim"), segs=64, bevel=0.03)
    kit.cyl("vault_wheel", 0.3, 0.08, loc=(-1.5, 2.95, 1.25), rot=(math.pi / 2, 0, 0), material=mat("rock"), segs=32)
    table("gold_table", (0.6, 2.55, 0), size=(1.1, 0.6, 0.75))
    for layer in range(4):
        for i in range(4 - layer):
            for j in range(2):
                gold_bar(f"bar{layer}{i}{j}", (0.25 + i * 0.24 + layer * 0.12, 2.47 + j * 0.15, 0.75 + layer * 0.045), s=0.9)
    kit.box("barrow", (0.9, 0.6, 0.35), loc=(1.5, 1.6, 0.45), rot=(0, 0.12, -0.3), material=mat("wood"), bevel=0.03)
    kit.cyl("wheel", 0.2, 0.06, loc=(1.95, 1.4, 0.2), rot=(0, math.pi / 2, -0.3), material=mat("wood"))
    rnd = random.Random(16)
    for k in range(14):
        paper_sheet(f"marks{k}", (0.24, 0.12), loc=(1.3 + (k % 4) * 0.12, 1.5 + (k // 4) * 0.08, 0.66 + (k % 3) * 0.03),
                    rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, 3)), kind="bond", seed=k)
    kit.figure("banker", "stand", loc=(-0.15, 2.85, 0), rot_z=math.radians(200), hat="brim")
    kit.figure("pusher", "carry", loc=(2.05, 2.05, 0), rot_z=facing((2.05, 2.05), (1.5, 1.6)), hat="cap")
    kit.figure("saver", "read", loc=(-0.85, 1.45, 0), rot_z=math.radians(-200), hat="cap")
    paper_sheet("bond", (0.2, 0.28), loc=kit.hand_pos("read", 1, (-0.85, 1.45, 0), math.radians(-200)) + Vector((0, -0.05, 0.05)),
                rot=(1.2, 0, 0.2), kind="bond", seed=21)
    _lights_studio(target=(0, 1.8, 1.0), key=950, fill=260, rim=450, spread=1.2)
    c = kit.camera((-0.3, -2.5, 1.05), (0.1, 1.9, 0.95), lens=34)
    hp = hero_point(c)
    stand("ledger_desk", c, hp, hp.z - 0.03)
    bond = paper_sheet("hero_bond", (0.15, 0.21), loc=hp + Vector((0.05, 0.04, -0.01)), rot=face_cam(c, math.radians(20)), kind="bond", seed=22)
    sov = plain_coin("sovereign", hp + Vector((-0.06, -0.02, coin_rest(-0.03, 0.035, 0.007, math.radians(35)))),
                     r=0.035, thick=0.007, rot=face_cam(c, math.radians(35)), material="gold")
    mark_hero(bond, sov)
    hero_light(c, hp, 12.0)


def digital():
    """07 Money becomes a number: on 15 Aug 1971 the dollar stops being swapped for gold; today most
    money is a number in a bank's books. Ends on the markets the game plays."""
    lk = kit.look()
    kit.island(radius=5.0, depth=0.7, seed=17)
    for r in range(2):
        for cc in range(3):
            x, y = -1.4 + cc * 1.4, 1.4 + r * 1.3
            table(f"desk{r}{cc}", (x, y, 0), size=(1.1, 0.6, 0.74))
            screen(f"scr{r}{cc}", (x, y + 0.1, 0.74 + 0.28), size=(0.62, 0.36), seed=r * 3 + cc)
            if (r, cc) in ((0, 0), (0, 2), (1, 1)):
                kit.figure(f"trader{r}{cc}", "stool", loc=(x, y - 0.55, 0), rot_z=0.0)
                kit.box(f"chair{r}{cc}", (0.42, 0.42, 0.46), loc=(x, y - 0.6, 0.23), material=mat("clay_dim"), bevel=0.03)
    kit.figure("walker", "read", loc=(1.9, 0.5, 0), rot_z=math.radians(150))
    screen("wall_screen", (0, 3.5, 1.6), size=(3.4, 1.4), seed=11)
    _lights_studio(target=(0, 1.9, 1.0), key=900, fill=250, rim=420, spread=1.2)
    c = kit.camera((-0.4, -2.4, 1.05), (0.15, 2.0, 1.0), lens=34)
    hp = hero_point(c)
    stand("front_desk", c, hp, hp.z - 0.06)
    rot = face_cam(c, math.radians(48))
    phone = kit.box("phone", (0.075, 0.15, 0.01), loc=hp, rot=rot, material=mat("clay_dim"), bevel=0.006)
    scr_m = mat("glass_screen", lk["bg"] if lk["key_name"] == "a" else "#1d2a38")
    m = Matrix.Translation(hp) @ rot.to_matrix().to_4x4()
    scr = kit.box("phone_screen", (0.066, 0.135, 0.002), loc=m @ Vector((0, 0, 0.0055)), rot=rot, material=scr_m)
    num = kit.text("balance", "1,971.08", size=0.012, loc=m @ Vector((0, 0.01, 0.0072)), rot=rot,
                   material=mat("glass_screen", "#f4f0e6"))
    mark_hero(phone, scr, num)
    hero_light(c, hp, 10.0)


def atlas():
    """Finale, the load we share: Atlas kneels under the sky (a celestial sphere) and a ring of people
    reach up and carry it with him."""
    lk = kit.look()
    kit.island(radius=5.0, depth=0.8, seed=18)
    R = 1.35
    C = Vector((0, 1.4, 2.75))
    kit.sphere("sky", R, loc=C, material=mat("clay"), subdiv=5)
    line = mat("ink") if lk["key_name"] == "a" else mat("gold")
    for i, (rx, ry) in enumerate(((0, 0), (math.pi / 2, 0), (0.41, 0.0), (math.pi / 2, math.pi / 2))):
        pts = [(R * 1.01 * math.cos(a), R * 1.01 * math.sin(a), 0) for a in (k / 128 * math.tau for k in range(129))]
        rot = Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(ry, 3, "Y")
        kit.curve_tube(f"ring{i}", [C + rot @ Vector(p) for p in pts], 0.012, material=line)
    rnd = random.Random(3)
    for i in range(60):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized()
        kit.sphere(f"star{i}", 0.02, loc=C + d * R * 1.005, material=line, subdiv=2)

    def reach(pose, a, scale, r0, r1):
        """Distance from the sphere's axis at which this figure's hands touch the sphere."""
        for _ in range(30):
            r = (r0 + r1) / 2
            loc = (C.x + math.sin(a) * r, C.y - math.cos(a) * r, 0)
            h = kit.hand_pos(pose, 1, loc, a, scale)
            if (h - C).length < R:
                r0 = r
            else:
                r1 = r
        return (r0 + r1) / 2

    # Atlas kneels under the sphere, facing us
    ascale = 1.6
    lo, hi = -1.0, 1.0
    for _ in range(30):
        mid = (lo + hi) / 2
        h = kit.hand_pos("kneel_lift", 1, (0, C.y + mid, 0), math.pi, ascale)
        if (h - C).length < R:
            hi = mid
        else:
            lo = mid
    kit.figure("atlas", "kneel_lift", loc=(0, C.y + hi, 0), rot_z=math.pi, scale=ascale, hat=None)
    hats = ["cap", "brim", "band", None, "hair", None, "cap", "band"]
    for i, deg in enumerate((-125, -95, -62, 62, 95, 125, -155, 155)):
        a = math.radians(deg)
        # facing the axis: a figure at angle a around the sphere looks back toward its centre
        r = reach("hold_up", a, 1.0, 0.3, 3.0)
        loc = (C.x + math.sin(a) * r, C.y - math.cos(a) * r, 0)
        kit.figure(f"helper{i}", "hold_up", loc=loc, rot_z=a, scale=1.0, hat=hats[i])
    _lights_studio(target=(0, 1.4, 1.8), key=1100, fill=300, rim=650, spread=1.5)
    kit.camera((0.0, -5.6, 1.3), (0, 1.3, 2.0), lens=32)


SCENES = {
    "ore": ore,
    "dive_a": lambda: dive("a"),
    "dive_b": lambda: dive("b"),
    "dive_c": lambda: dive("c"),
    "cave": cave,
    "silver": silver,
    "coins": coins,
    "paper": paper,
    "shares": shares,
    "goldwars": goldwars,
    "digital": digital,
    "atlas": atlas,
}
