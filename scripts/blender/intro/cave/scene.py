"""Scene two of the intro, the cave (Stone Age, c. 30,000 BCE): "Debts before money".

A hunter is back. Round the fire he shares the meat out: kneeling, he holds a portion out to an elder,
who reaches for it; a mother sits with hers and turns to her child, already eating; a young man eats.
Nobody hands anything back. His bow leans against the wall, not traded for anything: Atlas's line is
that Adam Smith imagined a bow swapped for venison, and nobody has ever found an economy of swaps.
The paintings are on the wall behind them. In the foreground the gold from scene one lies on a fallen
block, at the money spot every era shares, and nobody looks at it: worked gold is 25,000 years away.

Built from:
  shell.py      the cave and the fallen block, sculpted as distance fields
  figures.py    the five statues, cloth simulated (run first; they are loaded from the cache)
  paintings.py  the charcoal on the back wall (a grey-scale map)
  ../ore        the ore itself, scaled down to a nugget (cached from ore.build())

    MPFB_DATA=... .venv-bpy/bin/python scene.py --cache DIR --out frame.png [--view plateau]
        [--res 1280x800] [--samples 64] [--dim 0.025] [--paint panel.png]
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402

import kit  # noqa: E402
import scenes  # noqa: E402
import shell  # noqa: E402

# the cave's stone, all neutral greys (DESIGN.md: rock and clay are neutral, no colour casts)
WALL = "#302d2a"
WALL_HIGH = "#4d4a45"
PANEL = "#4f4b46"       # the paler limestone the paintings are on
FLOOR = "#2c2926"
ASH = "#5e5b56"         # the hearth's ash, paler than the silt
CHARCOAL = "#191715"

FIRE = Vector((*shell.FIRE, 0.0))

# where everyone is (x, y) and whom they face
PEOPLE = {
    "hunter": ((1.02, 2.02), "elder"),
    "elder": ((1.62, 1.02), "hunter"),
    "mother": ((-0.62, 2.18), "fire"),
    "child": ((-1.06, 1.66), "fire"),
    "eater": ((0.08, 2.78), "fire"),
}
CAMERAS = {
    # the overview's plateau view: the fire in the middle, the paintings above, the money bottom left
    "plateau": ((-1.3, -2.6, 1.0), (0.25, 1.8, 0.85), 32),
    # low, as if sitting on the floor at the edge of the firelight: the people loom, the wall shows
    "low": ((-1.15, -2.1, 0.72), (0.2, 1.9, 0.95), 30),
    # closer on the hand-over
    "share": ((-0.2, -0.6, 1.25), (1.2, 1.6, 0.8), 40),
    # the wall
    "wall": ((-0.3, 0.4, 1.3), (-0.45, 4.1, 1.75), 32),
}


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


# --------------------------------------------------------------------------------------------
# Meshes from arrays
# --------------------------------------------------------------------------------------------


def mesh_object(name, v, f, attrs=None, material=None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v))
    me.vertices.foreach_set("co", np.asarray(v, np.float32).ravel())
    me.loops.add(len(f) * 3)
    me.loops.foreach_set("vertex_index", np.asarray(f, np.int32).ravel())
    me.polygons.add(len(f))
    me.polygons.foreach_set("loop_start", np.arange(0, len(f) * 3, 3, dtype=np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(len(f), bool))
    me.update(calc_edges=True)
    me.validate()
    for k, a in (attrs or {}).items():
        a = np.asarray(a, np.float32)
        if a.ndim == 1:
            at = me.attributes.new(k, "FLOAT", "POINT")
            at.data.foreach_set("value", a)
        else:
            at = me.attributes.new(k, "FLOAT2", "POINT")
            at.data.foreach_set("vector", a.ravel())
    ob = kit.link(bpy.data.objects.new(name, me))
    if material:
        me.materials.append(material)
    return ob


# --------------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------------


def _n(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        n.inputs[k].default_value = v
    return n


def _attr(nt, name):
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_name = name
    return a


def _math(nt, op, a, b=None, clamp=False):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    m.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            m.inputs[i].default_value = x
        else:
            nt.links.new(x, m.inputs[i])
    return m.outputs[0]


def _mix(nt, fac, a, b):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    for sock, x in ((m.inputs["Factor"], fac), (m.inputs["A"], a), (m.inputs["B"], b)):
        if isinstance(x, (tuple, list)):
            sock.default_value = x
        elif isinstance(x, (int, float)):
            sock.default_value = x
        else:
            nt.links.new(x, sock)
    return m.outputs["Result"]


def _ramp(nt, x, lo, hi):
    """0 below lo, 1 above hi, smooth between."""
    m = nt.nodes.new("ShaderNodeMapRange")
    m.interpolation_type = "SMOOTHSTEP"
    m.inputs["From Min"].default_value = lo
    m.inputs["From Max"].default_value = hi
    nt.links.new(x, m.inputs["Value"])
    return m.outputs["Result"]


def rock_material(paint_path=None):
    """The limestone: dark grey walls, a pale painted stretch, silt floor, ash round the fire. Every
    input is a vertex attribute or a position, so it bakes as it renders."""
    m = bpy.data.materials.new("cave_rock")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.92
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    panel = _ramp(nt, _attr(nt, "panel").outputs["Fac"], 0.35, 0.75)
    floor = _ramp(nt, _attr(nt, "floor").outputs["Fac"], 0.2, 0.8)
    mid = _attr(nt, "relief_mid").outputs["Fac"]
    broad = _attr(nt, "relief_broad").outputs["Fac"]
    # wall tone: highs a little paler, hollows darker (soot and shadow in the folds)
    high = _ramp(nt, _math(nt, "ADD", mid, _math(nt, "MULTIPLY", broad, 0.4)), -0.02, 0.05)
    col = _mix(nt, high, kit.rgba(WALL), kit.rgba(WALL_HIGH))
    col = _mix(nt, panel, col, kit.rgba(PANEL))
    col = _mix(nt, floor, col, kit.rgba(FLOOR))
    # ash: a pale grey disc round the hearth, broken at its edge
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    dx = _math(nt, "SUBTRACT", sep.outputs["X"], FIRE.x)
    dy = _math(nt, "SUBTRACT", sep.outputs["Y"], FIRE.y)
    dist = _math(nt, "SQRT", _math(nt, "ADD", _math(nt, "MULTIPLY", dx, dx), _math(nt, "MULTIPLY", dy, dy)))
    nz = _n(nt, "ShaderNodeTexNoise", Scale=3.0, Detail=4.0)
    nt.links.new(geo.outputs["Position"], nz.inputs["Vector"])
    dist = _math(nt, "ADD", dist, _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", nz.outputs["Fac"], 0.5), 0.35))
    ash = _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 1.0, _ramp(nt, dist, 0.35, 0.75)), floor)
    col = _mix(nt, ash, col, kit.rgba(ASH))
    # cavities: deep hollows darker still
    cav = _math(nt, "SUBTRACT", 1.0, _ramp(nt, mid, -0.03, 0.0))
    col = _mix(nt, _math(nt, "MULTIPLY", cav, 0.5), col, kit.rgba("#1c1a18"))
    if paint_path:
        img = bpy.data.images.load(paint_path)
        img.colorspace_settings.name = "Non-Color"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.extension = "CLIP"
        uv = _attr(nt, "paint_uv")
        nt.links.new(uv.outputs["Vector"], tex.inputs["Vector"])
        ink = _math(nt, "MULTIPLY", tex.outputs["Color"], panel)
        # charcoal sits on the rock's highs and misses its pores
        grain = _n(nt, "ShaderNodeTexNoise", Scale=180.0, Detail=2.0)
        nt.links.new(geo.outputs["Position"], grain.inputs["Vector"])
        ink = _math(nt, "MULTIPLY", ink, _ramp(nt, grain.outputs["Fac"], 0.3, 0.55))
        col = _mix(nt, _math(nt, "MULTIPLY", ink, 0.92), col, kit.rgba(CHARCOAL))
    nt.links.new(col, b.inputs["Base Color"])
    # surface: limestone's soft pitting and grit (in the shader; baked to a normal map for the web)
    pos = geo.outputs["Position"]
    n1 = _n(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=6.0, Roughness=0.55)
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 22.0
    for n in (n1, vor):
        nt.links.new(pos, n.inputs["Vector"])
    hgt = _math(nt, "ADD", n1.outputs["Fac"], _math(nt, "MULTIPLY", vor.outputs["Distance"], 0.35))
    bump = _n(nt, "ShaderNodeBump", Strength=0.35, Distance=0.01)
    nt.links.new(hgt, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def calcite_material():
    """Flowstone: a stalagmite's paler, waxier calcite, darker in its ripples' grooves."""
    m = bpy.data.materials.new("calcite")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.6
    mid = _attr(nt, "relief_mid").outputs["Fac"]
    col = _mix(nt, _ramp(nt, mid, -0.006, 0.006), kit.rgba("#3b3834"), kit.rgba("#6a665f"))
    nt.links.new(col, b.inputs["Base Color"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nz = _n(nt, "ShaderNodeTexNoise", Scale=60.0, Detail=4.0)
    nt.links.new(geo.outputs["Position"], nz.inputs["Vector"])
    bump = _n(nt, "ShaderNodeBump", Strength=0.2, Distance=0.002)
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def flame_material(strength=14.0):
    """Fire in the LEDGER look: the page's warm white glowing as a volume, so a tongue is brightest
    where it is thickest, soft at its edges and fading to nothing at its tip (a surface emitter read
    as a cut-out of white paper against the white statues)."""
    m = bpy.data.materials.new("flame")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    fade = _ramp(nt, sep.outputs["Z"], 1.0, 0.15)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 6.0
    tex.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], tex.inputs["Vector"])
    lick = _ramp(nt, tex.outputs["Fac"], 0.3, 0.7)
    amt = nt.nodes.new("ShaderNodeMath")
    amt.operation = "MULTIPLY"
    nt.links.new(fade, amt.inputs[0])
    nt.links.new(lick, amt.inputs[1])
    gain = nt.nodes.new("ShaderNodeMath")
    gain.operation = "MULTIPLY_ADD"
    nt.links.new(amt.outputs[0], gain.inputs[0])
    gain.inputs[1].default_value = strength
    gain.inputs[2].default_value = 0.15 * strength
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = kit.rgba(kit.look()["fire"])
    nt.links.new(gain.outputs[0], em.inputs["Strength"])
    nt.links.new(em.outputs[0], out.inputs["Volume"])
    return m


def cave(cache, paint):
    a = shell.build(cache=os.path.join(cache, "shell.npz"))
    rock = rock_material(paint)
    ob = mesh_object("cave", a["v"], a["f"], {k: a[k] for k in ("panel", "floor", "relief_mid", "relief_broad",
                                                                  "paint_uv")}, rock)
    return ob, rock


def block(cache, rock, name, loc, scale=(1, 1, 1), rot_z=0.0):
    p = os.path.join(cache, "block.npz")
    if not os.path.exists(p):
        np.savez(p, **shell.block())
    z = np.load(p)
    ob = mesh_object(name, z["v"], z["f"], {"relief_mid": z["relief_mid"], "relief_broad": z["relief_broad"]}, rock)
    ob.location, ob.scale, ob.rotation_euler = loc, scale, (0, 0, rot_z)
    return ob


def stone(cache, rock, kind, name, at, top, rot_z=0.0, squash=(1.0, 1.0)):
    """A sculpted stone from shell.py (`stalagmite` or `boulder`), cached, scaled so its top (where
    something rests on it) is at height `top`."""
    p = os.path.join(cache, kind + ".npz")
    if not os.path.exists(p):
        np.savez(p, **getattr(shell, kind)())
    z = np.load(p)
    ob = mesh_object(name, z["v"], z["f"], {"relief_mid": z["relief_mid"], "relief_broad": z["relief_broad"]}, rock)
    k = top / float(z["top"])
    ob.location, ob.scale, ob.rotation_euler = at, (k * squash[0], k * squash[1], k), (0, 0, rot_z)
    return ob


def flame_tongue(name, h, r, lean, twist, mat, seed):
    """One tongue of flame: a teardrop that thins to a flickering tip, leaning and twisting."""
    bm = bmesh.new()
    rings, around = 22, 18
    rng = random.Random(seed)
    ph = rng.uniform(0, 6.28)
    rows = []
    for j in range(rings + 1):
        t = j / rings
        rad = r * math.sin(math.pi * min(1.0, t * 1.15) ** 0.6) * (1 - t) ** 0.8
        cx = lean * t * t + 0.02 * math.sin(t * 9 + ph) * t
        cy = 0.02 * math.cos(t * 7 + ph) * t
        row = []
        for i in range(around):
            a = i / around * math.tau + twist * t
            row.append(bm.verts.new((cx + rad * math.cos(a), cy + rad * 0.8 * math.sin(a), h * t)))
        rows.append(row)
    for j in range(rings):
        for i in range(around):
            bm.faces.new((rows[j][i], rows[j][(i + 1) % around], rows[j + 1][(i + 1) % around], rows[j + 1][i]))
    return kit.from_bmesh(name, bm, mat)


def fire(rock, strength=1.0):
    """The hearth: a ring of stones, crossed logs burning down, embers, flames and its light."""
    root = kit.link(bpy.data.objects.new("fire", None))
    rng = random.Random(9)
    stone = kit.mat("rock", WALL_HIGH)
    for i in range(9):
        a = i / 9 * math.tau + rng.uniform(-0.15, 0.15)
        rr = 0.36 + rng.uniform(-0.03, 0.03)
        s = kit.lumpy(f"hearth_stone{i}", 0.075, loc=(math.cos(a) * rr, math.sin(a) * rr, 0.03),
                      scale=(1.2, 0.9, 0.65), material=stone, amp=0.3, seed=i + 3)
        s.rotation_euler = (0, 0, a)
        s.parent = root
    wood = kit.mat("wood", "#4a4743")
    char = kit.mat("wood", "#1d1b19")
    for i in range(5):
        a = i / 5 * math.tau + 0.3
        lg = kit.cyl(f"log{i}", 0.032 + 0.008 * (i % 2), 0.62, loc=(math.cos(a) * 0.12, math.sin(a) * 0.12, 0.08),
                     rot=(math.pi / 2 - 0.32, 0, a + math.pi / 2), material=wood if i % 2 else char, segs=14)
        lg.parent = root
    ember = kit.mat("fire", 3.0)
    for i in range(14):
        a, rr = rng.uniform(0, math.tau), rng.uniform(0.0, 0.17)
        e = kit.lumpy(f"ember{i}", rng.uniform(0.015, 0.03), loc=(math.cos(a) * rr, math.sin(a) * rr, 0.025),
                      material=ember, amp=0.4, seed=40 + i)
        e.parent = root
    fl = flame_material(60.0 * strength)
    for i in range(7):
        a = i / 7 * math.tau
        rr = 0.05 if i else 0.0
        t = flame_tongue(f"flame{i}", rng.uniform(0.32, 0.6) * (1.25 if i == 0 else 1.0), rng.uniform(0.07, 0.1),
                         rng.uniform(-0.08, 0.08), rng.uniform(-1.5, 1.5), fl, i)
        t.location = (math.cos(a) * rr, math.sin(a) * rr, 0.06)
        t.parent = root
    lk = kit.look()
    li = kit.point_light("fire_light", (0, 0, 0.42), 520 * strength, color=lk["fire"], radius=0.22)
    li.parent = root
    lo = kit.point_light("ember_light", (0, 0, 0.1), 90 * strength, color=lk["fire"], radius=0.18)
    lo.parent = root
    root.location = FIRE
    return root


def load_figure(cache, name):
    path = os.path.join(cache, name + ".blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(name + "_")]
    obs = [o for o in dst.objects if o is not None]
    for o in obs:
        kit.link(o)
    marks = json.load(open(os.path.join(cache, name + ".json")))
    return obs, marks


def place_figures(cache, rock):
    """Every statue at its spot, facing whom it faces; seats become rocks; food in their hands."""
    where = {k: Vector((*p, 0.0)) for k, (p, _) in PEOPLE.items()}
    clay = kit.mat("clay")
    out = {}
    for name, (_p, to) in PEOPLE.items():
        if not os.path.exists(os.path.join(cache, name + ".blend")):
            print(f"[scene] no {name}.blend in the cache yet: left out", flush=True)
            continue
        frm = where[name]
        tgt = FIRE if to == "fire" else where[to]
        d = tgt - frm
        rot = math.atan2(d.x, -d.y)          # bodies face -Y before they are turned
        obs, marks = load_figure(cache, name)
        M = Matrix.Translation(frm) @ Matrix.Rotation(rot, 4, "Z")
        for o in obs:
            if o.name.endswith("_seat"):
                # the seat box becomes a rock of the same top height
                s = marks["seat"]
                top = s["top"]
                c = M @ Vector((0, s["y"], 0))
                stone(cache, rock, "boulder", name + "_rock", (c.x, c.y, 0.0), top + 0.005, rot_z=rot,
                      squash=(1.0, 0.95))
                bpy.data.objects.remove(o, do_unlink=True)
                continue
            o.matrix_basis = M @ o.matrix_basis   # appended objects' world matrices aren't evaluated yet
            if o.data and hasattr(o.data, "materials"):
                o.data.materials.clear()
                o.data.materials.append(clay)
        hands = [M @ Vector(marks[f"hand_{s}"]) for s in "lr"]
        out[name] = dict(rot=rot, hands=hands, head=M @ Vector(marks["head"]), at=frm)
    return out


def haunch(name, loc, length=0.2, rot=(0, 0, 0), material=None):
    """A leg of venison: a rounded lump of meat tapering to the shank, the bone's knuckle showing a
    hand's width past it, so it reads as meat and not as a paddle on a stick."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1.0)
    for v in bm.verts:
        x = v.co.x
        # pear-shaped along x: fat at one end, tapering hard to the shank
        k = 1.0 - 0.6 * max(0.0, x) ** 1.2
        v.co.y *= 0.4 * k
        v.co.z *= 0.36 * k
        v.co.x *= 0.62
        v.co += v.co.normalized() * 0.03 * noise.noise(v.co * 6.0 + Vector((3, 1, 2)))
    meat = kit.from_bmesh(name, bm, material)
    meat.scale = (length, length, length)
    bone = kit.cyl(name + "_bone", 0.055, 0.5, rot=(0, math.pi / 2, 0), material=material, segs=12)
    bone.location = (0.72, 0, 0)
    knob = kit.lumpy(name + "_knob", 0.08, loc=(0.98, 0, 0), scale=(0.8, 1.0, 1.25), material=material, amp=0.2)
    for o in (bone, knob):
        o.parent = meat
    meat.location, meat.rotation_euler = loc, rot
    return meat


def gear(wood):
    """The hunter's bow, strung, leaning on the back wall with two arrows: his, kept, not traded for the
    meat. It stands in the lit gap behind the fire, between the eater and the hunter."""
    foot, top = Vector((1.32, 3.55, 0.0)), Vector((1.16, 3.86, 1.48))
    axis = (top - foot).normalized()
    # the bow's plane faces the camera, so its curve and string read
    side = Vector((1.0, 0.0, 0.0))
    side = (side - axis * side.dot(axis)).normalized()
    pts = [foot + (top - foot) * (i / 20) + side * (0.13 * math.sin(math.pi * i / 20)) for i in range(21)]
    kit.curve_tube("bow", pts, 0.017, material=wood)
    kit.curve_tube("bow_string", [pts[0] + side * 0.012, pts[-1] + side * 0.012], 0.003, material=wood)
    for k, (dx, h) in enumerate(((-0.14, 0.92), (-0.2, 0.86))):
        a = foot + Vector((dx, -0.02 * k, 0.0))
        b = a + Vector((0.03, 0.22, h))
        kit.curve_tube(f"arrow{k}", [a, b], 0.007, material=wood)
        kit.lumpy(f"arrow{k}_point", 0.02, loc=b + (b - a).normalized() * 0.02, scale=(0.6, 0.35, 1.6), material=wood,
                  amp=0.15, seed=k)


def food(fig, clay):
    """The meat in everyone's hands and the rest of the haunch on a stone beside the hunter."""
    for name, f in fig.items():
        hl, hr = f["hands"]
        mid = (hl + hr) / 2
        rot = (0, 0, f["rot"] + math.pi / 2)
        if name == "hunter":
            haunch("food_" + name, mid + Vector((0, 0, 0.045)), 0.2, (0, 0, -0.35), clay)
        elif name == "mother":
            haunch("food_" + name, mid + Vector((0, 0, 0.02)), 0.13, rot, clay)
        elif name in ("child", "eater"):
            haunch("food_" + name, mid + Vector((0, 0, 0.0)), 0.09 if name == "child" else 0.11,
                   (0.0, -1.1, f["rot"] + math.pi / 2), clay)
    if "hunter" not in fig:
        return
    h = fig["hunter"]
    side = Matrix.Rotation(h["rot"], 3, "Z") @ Vector((-0.45, 0.05, 0))   # at his right hand side
    slab = kit.lumpy("meat_stone", 0.2, loc=h["at"] + side + Vector((0, 0, 0.03)), scale=(1.2, 0.95, 0.22),
                     material=kit.mat("rock", WALL_HIGH), amp=0.18, seed=5)
    haunch("food_rest", slab.location + Vector((0, 0, 0.09)), 0.3, (0, 0, h["rot"] + 0.4), clay)
    haunch("food_rest2", slab.location + Vector((0.06, 0.08, 0.07)), 0.18, (0, 0.2, h["rot"] - 1.2), clay)


def nugget(cache, at, height=0.08):
    """The ore from scene one, small: its foot set on the block at the money spot."""
    with bpy.data.libraries.load(os.path.join(cache, "ore.blend"), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in ("ore", "ore_quartz")]
    obs = [o for o in dst.objects if o is not None]
    k = height / 1.1
    for o in obs:
        kit.link(o)
        o.scale = (o.scale.x * k, o.scale.y * k, o.scale.z * k)
        o.location = (at.x, at.y, at.z + (o.location.z) * k)
        o.rotation_euler = (1.35, 0.2, 2.4)   # lying on its side, the crack turned away: just a lump of gold
        o["hero"] = True
    # set it down: its lowest point on the stone
    bpy.context.view_layer.update()
    ore = next(o for o in obs if o.name == "ore")
    mw = ore.matrix_world
    lo = min((mw @ v.co).z for v in ore.data.vertices)
    for o in obs:
        o.location.z += at.z - lo
    return obs


def build(cache, paint=None, view="plateau", dim=None):
    cave_ob, rock = cave(cache, paint)
    clay = kit.mat("clay")
    fire(rock)
    fig = place_figures(cache, rock)
    food(fig, clay)
    gear(kit.mat("clay_dim"))
    loc, tgt, lens = CAMERAS[view]
    cam = kit.camera(loc, tgt, lens=lens)
    # the fallen block in the foreground with the gold on it, at the money spot (plateau view only)
    hero_view = view if view in ("plateau", "low") else "low"
    pc = kit.camera(*CAMERAS[hero_view][:2], lens=CAMERAS[hero_view][2])
    hp = scenes.hero_point(pc)
    bpy.data.objects.remove(pc, do_unlink=True)
    bpy.context.scene.camera = cam
    # what holds the money: a waist-high hump of fallen roof in the foreground, dark against the lit
    # floor, the gold on its crest (a stalagmite stump here walled off a fifth of the frame)
    _fwd, _right, yaw = scenes._cam_axes(cam)
    stone(cache, rock, "mound", "pedestal", Vector((hp.x, hp.y, 0.0)), hp.z - 0.01, rot_z=yaw)
    gold = nugget(cache, Vector((hp.x, hp.y, hp.z - 0.01)))
    # the hump's crest catches a little light from the fire side, so it reads as stone and not as a hole
    kit.area_light("pedestal_fill", (hp.x + 0.7, hp.y + 0.6, hp.z + 0.3), (hp.x - 0.3, hp.y, hp.z - 0.2), 10, size=0.8)
    scenes.hero_light(cam if view == "plateau" else cam, hp, 6.0)
    # a faint cool-free fill from the cave mouth behind the camera, so the dark is not black
    kit.area_light("mouth_fill", (-0.4, -4.2, 1.6), (0.2, 1.5, 1.0), 30, size=2.0, kind="fill")
    if dim is not None:
        kit.dim(dim)
    return cam, gold


if __name__ == "__main__":
    cache = arg("--cache")
    res = tuple(int(x) for x in arg("--res", "1280x800").split("x"))
    kit.reset("a", res=res, samples=int(arg("--samples", "64")))
    kit.backdrop("dark")
    build(cache, paint=arg("--paint"), view=arg("--view", "plateau"),
          dim=float(arg("--dim")) if arg("--dim") else None)
    if arg("--blend"):
        bpy.ops.wm.save_as_mainfile(filepath=arg("--blend"))
    kit.render(arg("--out"))
