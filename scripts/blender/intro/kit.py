"""Shared Blender kit for the 3D intro: looks, clay materials, statue figures, props, lights, camera, render.

Runs under Blender's Python module (bpy 5.2.3, Python 3.13); see README.md in this folder.
Every scene script builds its diorama from these helpers, so the two candidate looks differ only
in the LOOKS table below, never in the geometry.

Units are metres, Z is up. Figures face +Y in their own frame before they are rotated into place.
"""
import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector, noise

# --------------------------------------------------------------------------------------------
# Colour
# --------------------------------------------------------------------------------------------


def lin(hex_str):
    """'#rrggbb' (sRGB, as written in DESIGN.md) -> linear RGB for Blender."""
    h = hex_str.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def rgba(hex_str):
    return (*lin(hex_str), 1.0)


# Look "a" is today's LEDGER contract (DESIGN.md): ink-white clay on near-black paper, neutral light,
# and gold spent only on the ore and the money. Look "b" is the storyboard's warm clay world.
# Only these values change between the two; the scenes never branch on the look except through them.
LOOKS = {
    "a": {
        "label": "LEDGER",
        "bg": "#131110",
        "ground": "#2a2623",
        "clay": "#e6e1d5",
        "clay_dim": "#b9b4a9",
        "paint": "#e6e1d5",
        "wood": "#8f8b81",
        "paper": "#f4f0e6",
        "print": "#131110",
        "rock": "#3d3935",
        "fire": "#f4f0e6",
        "key": "#ffffff",
        "fill": "#ffffff",
        "sky_top": None,
        "sky_low": None,
        "world": 0.05,
        "fill_mult": 0.35,
    },
    "b": {
        "label": "Warm storyboard",
        "bg": "#1b1612",
        "ground": "#5c4838",
        "clay": "#c4ab92",
        "clay_dim": "#9c8670",
        "paint": "#5c2414",
        "wood": "#7a5636",
        "paper": "#e9dcc0",
        "print": "#5a2a1a",
        "rock": "#7d6450",
        "fire": "#ff9440",
        "key": "#ffd8ad",
        "fill": "#9db7e0",
        "sky_top": "#5d7fa6",
        "sky_low": "#f2c08a",
        "world": 0.35,
        "fill_mult": 1.0,
    },
}

GOLD = (1.0, 0.766, 0.336)      # linear F0 of gold
SILVER = (0.962, 0.949, 0.922)  # linear F0 of silver
ELECTRUM = (0.98, 0.86, 0.55)   # gold with a lot of silver in it: paler than gold

_STATE = {"look": None, "mats": {}, "seed": 1, "backdrop": "look"}


def look():
    return _STATE["look"]


# --------------------------------------------------------------------------------------------
# Scene and render settings
# --------------------------------------------------------------------------------------------


def reset(look_key, res=(1440, 900), samples=64, seed=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _STATE["look"] = dict(LOOKS[look_key], key_name=look_key)
    _STATE["mats"] = {}
    _STATE["seed"] = seed
    _STATE["backdrop"] = "look"
    _STATE["backdrop_k"] = 1.0
    random.seed(seed)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 6
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 4
    cy.sample_clamp_indirect = 6.0
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    _world()
    return sc


def backdrop(mode):
    """'look' (default) or 'dark': the ore and the inside of the rock are dark in both looks."""
    _STATE["backdrop"] = mode


def _world():
    lk = look()
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    if lk["sky_top"]:
        # Lighting sees a soft sky (blue above, warm at the horizon); the camera never sees it,
        # because the frame is composited onto the painted backdrop afterwards.
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.45
        ramp.color_ramp.elements[0].color = rgba(lk["sky_low"])
        ramp.color_ramp.elements[1].position = 0.75
        ramp.color_ramp.elements[1].color = rgba(lk["sky_top"])
        mapr = nt.nodes.new("ShaderNodeMapRange")
        mapr.inputs["From Min"].default_value = -1.0
        mapr.inputs["From Max"].default_value = 1.0
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        nt.links.new(sep.outputs["Z"], mapr.inputs["Value"])
        nt.links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = rgba(lk["bg"])
    bg.inputs["Strength"].default_value = lk["world"]


# --------------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------------


def _principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def _bump(nt, bsdf, scale=40.0, strength=0.12, distance=0.004):
    """Fine fingerprint-scale unevenness, so clay reads as clay and not as plastic."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = distance
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def mat(kind, tone=None):
    """Cached materials. kind: clay | clay_dim | ground | rock | wood | paper | paint | ink |
    gold | electrum | silver | bronze | quartz | fire | glass_screen | void."""
    key = (kind, tone)
    if key in _STATE["mats"]:
        return _STATE["mats"][key]
    lk = look()
    if kind in ("clay", "clay_dim", "ground", "rock", "wood", "paper", "paint", "ink"):
        hexes = {
            "clay": lk["clay"], "clay_dim": lk["clay_dim"], "ground": lk["ground"],
            "rock": lk["rock"], "wood": lk["wood"], "paper": lk["paper"], "paint": lk["paint"],
            "ink": lk["print"],
        }
        m, nt, b = _principled(kind)
        b.inputs["Base Color"].default_value = rgba(tone or hexes[kind])
        b.inputs["Roughness"].default_value = 0.88 if kind != "paper" else 0.8
        _bump(nt, b, scale=30.0 if kind in ("ground", "rock") else 45.0,
              strength=0.25 if kind in ("ground", "rock") else 0.1)
    elif kind in ("gold", "electrum", "silver", "bronze"):
        col = {"gold": GOLD, "electrum": ELECTRUM, "silver": SILVER, "bronze": (0.85, 0.55, 0.3)}[kind]
        m, nt, b = _principled(kind)
        b.inputs["Base Color"].default_value = (*col, 1.0)
        b.inputs["Metallic"].default_value = 1.0
        b.inputs["Roughness"].default_value = 0.24 if kind == "gold" else 0.3
        _bump(nt, b, scale=80.0, strength=0.05, distance=0.002)
    elif kind == "quartz":
        # milky vein quartz: pale, a little waxy, light sinks in a few millimetres
        m, nt, b = _principled("quartz")
        b.inputs["Base Color"].default_value = rgba(tone or "#ece8e0")
        b.inputs["Roughness"].default_value = 0.35
        b.inputs["Subsurface Weight"].default_value = 0.5
        b.inputs["Subsurface Scale"].default_value = 0.01
        _bump(nt, b, scale=60.0, strength=0.08, distance=0.002)
    elif kind == "fire":
        m = bpy.data.materials.new("fire")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type != "OUTPUT_MATERIAL":
                nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = rgba(lk["fire"])
        em.inputs["Strength"].default_value = tone or 12.0
        nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    elif kind == "glass_screen":
        m = bpy.data.materials.new("screen")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type != "OUTPUT_MATERIAL":
                nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = rgba(tone or lk["paper"])
        em.inputs["Strength"].default_value = 2.0
        nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    elif kind == "void":
        m, nt, b = _principled("void")
        b.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        b.inputs["Roughness"].default_value = 1.0
    else:
        raise ValueError(kind)
    _STATE["mats"][key] = m
    return m


# --------------------------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------------------------


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def from_bmesh(name, bm, material=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me))
    if material:
        me.materials.append(material)
    return ob


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """Move and turn an object; scale only when given, so a shaped object keeps its proportions."""
    ob.location = loc
    ob.rotation_euler = rot
    if scale is not None:
        ob.scale = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
    return ob


def bake_scale(ob):
    """Move an object's scale into its mesh, so children and later scaling start from 1."""
    ob.data.transform(Matrix.Diagonal((*ob.scale, 1.0)))
    ob.scale = (1, 1, 1)
    return ob


def join(obs, name=None):
    """Join meshes into the first one (materials are kept per face)."""
    obs = [o for o in obs if o is not None]
    with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs, object=obs[0]):
        bpy.ops.object.join()
    if name:
        obs[0].name = name
    return obs[0]


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), material=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    ob = from_bmesh(name, bm, material, smooth=False)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "NONE"
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    return place(ob, loc, rot)


def cyl(name, r, depth, loc=(0, 0, 0), rot=(0, 0, 0), material=None, segs=32, r2=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    ob = from_bmesh(name, bm, material, smooth=True)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    return place(ob, loc, rot)


def sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), material=None, subdiv=4):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    ob = from_bmesh(name, bm, material)
    return place(ob, loc, (0, 0, 0), scale)


def lumpy(name, r, loc=(0, 0, 0), scale=(1, 1, 1), material=None, amp=0.25, freq=1.6, subdiv=4, seed=0):
    """A pebble, a lump of metal, a boulder: an icosphere pushed around by noise."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
    for v in bm.verts:
        n = noise.noise(v.co * (freq / r) + off)
        v.co *= 1.0 + amp * n
    ob = from_bmesh(name, bm, material)
    return place(ob, loc, (0, 0, 0), scale)


def curve_tube(name, pts, radius, material=None, closed=False):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts):
        p.co = (*co, 1.0)
    sp.use_cyclic_u = closed
    ob = link(bpy.data.objects.new(name, cu))
    if material:
        cu.materials.append(material)
    return ob


def text(name, body, size=0.1, loc=(0, 0, 0), rot=(math.pi / 2, 0, 0), material=None,
         extrude=0.0, align="CENTER"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    ob = link(bpy.data.objects.new(name, cu))
    if material:
        cu.materials.append(material)
    return place(ob, loc, rot)


def island(name="island", radius=3.0, depth=0.6, material=None, wobble=0.18, seed=3, top_noise=0.04):
    """The ground every diorama stands on: a thick, irregular clay disc floating in the dark."""
    bm = bmesh.new()
    segs = 96
    rings = 10
    off = Vector((seed * 1.7, seed * 2.9, 0))
    top = []
    for j in range(rings + 1):
        rr = radius * j / rings
        ring = []
        for i in range(segs if j else 1):
            a = 2 * math.pi * i / segs
            edge = 1.0 + wobble * noise.noise(Vector((math.cos(a), math.sin(a), 0)) * 1.3 + off)
            x, y = rr * edge * math.cos(a), rr * edge * math.sin(a)
            z = top_noise * noise.noise(Vector((x, y, 0)) * 0.9 + off) if j < rings else -0.02
            ring.append(bm.verts.new((x, y, z)))
        top.append(ring)
    # fan centre + quads
    for i in range(segs):
        bm.faces.new((top[0][0], top[1][i], top[1][(i + 1) % segs]))
    for j in range(1, rings):
        for i in range(segs):
            bm.faces.new((top[j][i], top[j + 1][i], top[j + 1][(i + 1) % segs], top[j][(i + 1) % segs]))
    # skirt down to a rounded bottom
    rim = top[rings]
    prev = rim
    for k, (shrink, dz) in enumerate(((0.985, -depth * 0.35), (0.93, -depth * 0.75), (0.8, -depth))):
        cur = [bm.verts.new((v.co.x * shrink, v.co.y * shrink, dz)) for v in rim]
        for i in range(segs):
            bm.faces.new((prev[i], cur[i], cur[(i + 1) % segs], prev[(i + 1) % segs]))
        prev = cur
    bm.faces.new(list(reversed(prev)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = from_bmesh(name, bm, material or mat("ground"))
    return ob


# --------------------------------------------------------------------------------------------
# Figures: frozen clay statues built from metaballs, so joints blend like modelled clay
# --------------------------------------------------------------------------------------------

_VIS = 0.575  # visible radius of a metaball element per unit of influence radius (measured)


def _cap(mb, a, b, r):
    a, b = Vector(a), Vector(b)
    d = b - a
    e = mb.elements.new(type="CAPSULE")
    e.co = (a + b) / 2
    e.radius = r / _VIS
    e.size_x = max(d.length / 2, 1e-4)
    e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized() if d.length > 1e-6 else Vector((1, 0, 0)))
    return e


def _ell(mb, c, half, rot=None):
    e = mb.elements.new(type="ELLIPSOID")
    e.co = Vector(c)
    e.radius = 1.0 / _VIS
    e.size_x, e.size_y, e.size_z = half
    if rot is not None:
        e.rotation = rot
    return e


def _dir(v):
    return Vector(v).normalized()


# Pose library. Directions are in the figure's own frame: X right, Y forward, Z up.
# arm = (upper arm direction, forearm direction); leg = (thigh direction, shin direction).
POSES = {
    "stand": dict(h=0.95, lean=0.0, la=((-0.18, 0.02, -1), (-0.05, 0.12, -1)), ra=((0.18, 0.02, -1), (0.05, 0.12, -1)),
                  ll=((-0.04, 0, -1), (0, -0.02, -1)), rl=((0.04, 0, -1), (0, -0.02, -1))),
    "give": dict(h=0.95, lean=0.08, la=((-0.15, 0.0, -1), (0, 0.1, -1)), ra=((0.12, 0.85, -0.45), (0.0, 1, 0.05)),
                 ll=((-0.05, 0.12, -1), (0, -0.05, -1)), rl=((0.05, -0.12, -1), (0, -0.2, -1))),
    "receive": dict(h=0.95, lean=0.05, la=((-0.12, 0.7, -0.6), (0.2, 1, 0.1)), ra=((0.12, 0.7, -0.6), (-0.2, 1, 0.1)),
                    ll=((-0.05, 0, -1), (0, -0.02, -1)), rl=((0.05, 0, -1), (0, -0.02, -1))),
    "carry": dict(h=0.95, lean=-0.05, la=((-0.15, 0.25, -1), (0.35, 1, 0.25)), ra=((0.15, 0.25, -1), (-0.35, 1, 0.25)),
                  ll=((-0.05, 0.15, -1), (0, -0.05, -1)), rl=((0.05, -0.12, -1), (0, -0.15, -1))),
    "point": dict(h=0.95, lean=0.0, la=((-0.15, 0.0, -1), (0, 0.1, -1)), ra=((0.25, 0.9, 0.35), (0.1, 1, 0.3)),
                  ll=((-0.05, 0, -1), (0, -0.02, -1)), rl=((0.05, 0, -1), (0, -0.02, -1))),
    "hammer": dict(h=0.9, lean=0.25, la=((-0.25, 0.6, -0.7), (0.3, 1, -0.2)), ra=((0.35, 0.2, 0.9), (0.0, 0.6, 1.0)),
                   ll=((-0.15, 0.15, -1), (0, -0.05, -1)), rl=((0.15, -0.2, -1), (0, -0.1, -1))),
    "sit": dict(h=0.2, lean=0.15, la=((-0.25, 0.4, -1), (0.4, 1, -0.1)), ra=((0.25, 0.4, -1), (-0.4, 1, -0.1)),
                ll=((-0.55, 1, -0.05), (0.6, 0.3, -0.1)), rl=((0.55, 1, -0.05), (-0.6, 0.3, -0.1))),
    "sit_work": dict(h=0.2, lean=0.35, la=((-0.2, 0.6, -0.8), (0.35, 1, -0.3)), ra=((0.2, 0.6, -0.8), (-0.35, 1, -0.3)),
                     ll=((-0.55, 1, -0.05), (0.6, 0.3, -0.1)), rl=((0.55, 1, -0.05), (-0.6, 0.3, -0.1))),
    "stool": dict(h=0.5, lean=0.12, la=((-0.18, 0.5, -0.9), (0.15, 1, 0.05)), ra=((0.18, 0.5, -0.9), (-0.15, 1, 0.05)),
                  ll=((-0.1, 1, -0.05), (0, 0.05, -1)), rl=((0.1, 1, -0.05), (0, 0.05, -1))),
    "kneel": dict(h=0.55, lean=0.2, la=((-0.2, 0.5, -0.9), (0.2, 1, -0.2)), ra=((0.2, 0.5, -0.9), (-0.2, 1, -0.2)),
                  ll=((-0.08, 0.95, -0.35), (0, 0.05, -1)), rl=((0.1, -0.2, -1), (0, -1, -0.05))),
    "crouch": dict(h=0.45, lean=0.45, la=((-0.2, 0.7, -0.7), (0.15, 1, -0.4)), ra=((0.2, 0.7, -0.7), (-0.15, 1, -0.4)),
                   ll=((-0.2, 0.9, -0.3), (0, -0.25, -1)), rl=((0.2, 0.9, -0.3), (0, -0.25, -1))),
    "lift": dict(h=0.62, lean=-0.15, la=((-0.35, 0.15, 0.95), (-0.1, 0.0, 1)), ra=((0.35, 0.15, 0.95), (0.1, 0.0, 1)),
                 ll=((-0.2, 0.55, -0.85), (0, -0.25, -1)), rl=((0.2, -0.3, -1), (0, -0.9, -0.3))),
    "kneel_lift": dict(h=0.55, lean=0.05, la=((-0.45, 0.15, 0.85), (-0.1, 0.1, 1)), ra=((0.45, 0.15, 0.85), (0.1, 0.1, 1)),
                       ll=((-0.08, 0.95, -0.35), (0, 0.05, -1)), rl=((0.1, -0.2, -1), (0, -1, -0.05))),
    "hold_up": dict(h=0.95, lean=-0.05, la=((-0.3, 0.45, 0.85), (-0.05, 0.35, 1)), ra=((0.3, 0.45, 0.85), (0.05, 0.35, 1)),
                    ll=((-0.06, 0.1, -1), (0, -0.05, -1)), rl=((0.06, -0.1, -1), (0, -0.05, -1))),
    "read": dict(h=0.95, lean=0.1, la=((-0.15, 0.3, -1), (0.2, 1, 0.55)), ra=((0.15, 0.3, -1), (-0.2, 1, 0.55)),
                 ll=((-0.05, 0, -1), (0, -0.02, -1)), rl=((0.05, 0, -1), (0, -0.02, -1))),
}

# Body proportions for a 1.7 m adult (scale the whole figure for children or a giant).
_UP, _UF, _TH, _SH = 0.29, 0.27, 0.45, 0.45


def _tunic(name, pelvis, up, w, m, long=True, seed=0):
    """A tunic with a crisp hem and a few soft folds. Long: to the knee; short: a shirt over the hips."""
    rings = [(0.42, 0.15, 0.105), (0.3, 0.165, 0.118), (0.14, 0.158, 0.118), (0.0, 0.168, 0.13)]
    rings += [(-0.2, 0.2, 0.165), (-0.4, 0.235, 0.2)] if long else [(-0.08, 0.19, 0.155)]
    segs = 40
    bm = bmesh.new()
    loops = []
    for k, (hrel, rx, ry) in enumerate(rings):
        c = pelvis + (up * hrel if hrel > 0 else Vector((0, 0, hrel)))
        depth = max(0.0, -hrel) / 0.4
        loop = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            fold = 1.0 + 0.05 * depth * math.sin(7 * a + seed) + 0.025 * depth * math.sin(3 * a + 2 * seed)
            loop.append(bm.verts.new((c.x + rx * w * fold * math.cos(a), c.y + ry * w * fold * math.sin(a), c.z)))
        loops.append(loop)
    for a_loop, b_loop in zip(loops, loops[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a_loop[i], a_loop[j], b_loop[j], b_loop[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = from_bmesh(name, bm, m)
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.014
    sol.offset = 1.0
    sub = ob.modifiers.new("smooth", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    return ob


def figure(name, pose="stand", loc=(0, 0, 0), rot_z=0.0, scale=1.0, material=None, hat=None,
           robe=True, build=1.0, head_tilt=0.0):
    """A clay statue. hat: None | 'cap' | 'brim' | 'hair' | 'band'. Returns the root empty."""
    p = POSES[pose]
    mb = bpy.data.metaballs.new(name + "_mb")
    mb.resolution = 0.03
    mb.render_resolution = 0.014
    mb.threshold = 0.6
    body = link(bpy.data.objects.new(name, mb))  # unique base name -> its own metaball family
    m = material or mat("clay")
    mb.materials.append(m)

    lean = p["lean"]
    up = Vector((0, math.sin(lean), math.cos(lean)))
    pelvis = Vector((0, 0, p["h"]))
    chest = pelvis + up * 0.36
    neck = pelvis + up * 0.52
    head = pelvis + up * 0.67 + Vector((0, 0.015, 0))
    w = build

    _ell(mb, pelvis + up * 0.03, (0.15 * w, 0.11 * w, 0.12))
    _cap(mb, pelvis + up * 0.05, chest, 0.125 * w)
    _ell(mb, chest + up * 0.02, (0.165 * w, 0.115 * w, 0.15))
    _cap(mb, chest + up * 0.1, neck, 0.055)

    for side, arm in ((-1, p["la"]), (1, p["ra"])):
        sho = chest + up * 0.11 + Vector((0.165 * side * w, 0, 0))
        elb = sho + _dir(arm[0]) * _UP
        hand = elb + _dir(arm[1]) * _UF
        _ell(mb, sho, (0.07 * w, 0.065 * w, 0.065))
        _cap(mb, sho, elb, 0.06 * w)
        _cap(mb, elb, hand, 0.052 * w)
        # mitten hand, long axis along the forearm
        fa = _dir(arm[1])
        _ell(mb, hand + fa * 0.05, (0.045, 0.07, 0.03),
             rot=Vector((0, 1, 0)).rotation_difference(fa))

    for side, leg in ((-1, p["ll"]), (1, p["rl"])):
        hip = pelvis + Vector((0.085 * side * w, 0, -0.04))
        knee = hip + _dir(leg[0]) * _TH
        foot = knee + _dir(leg[1]) * _SH
        _cap(mb, hip, knee, 0.085 * w)
        _cap(mb, knee, foot, 0.066 * w)
        fwd = Vector((0, 1, 0)) if abs(_dir(leg[1]).z) > 0.5 else -_dir(leg[1])
        flat = Vector((fwd.x, fwd.y, 0)).normalized() if fwd.xy.length > 1e-6 else Vector((0, 1, 0))
        _ell(mb, foot + flat * 0.06 + Vector((0, 0, -0.015)), (0.055, 0.12, 0.045),
             rot=Vector((0, 1, 0)).rotation_difference(flat))

    if robe and p["h"] <= 0.5:
        _ell(mb, pelvis + Vector((0, 0.1, 0.03)), (0.23 * w, 0.22 * w, 0.1))  # cloth over a seated lap

    # head: a separate smooth egg, so the silhouette stays crisp; a nose, brow and ears make it a person
    tilt = lean + head_tilt
    hrot = Matrix.Rotation(tilt, 4, "X")
    hd = sphere(name + "_head", 0.118, loc=head, scale=(0.9, 1.0, 1.1), material=m)
    hd.rotation_euler = (tilt, 0, 0)
    face = [
        (name + "_nose", Vector((0, 0.11, -0.015)), (0.02, 0.028, 0.032), 0.0),
        (name + "_earL", Vector((-0.104, 0.0, 0.0)), (0.016, 0.024, 0.032), 0.0),
        (name + "_earR", Vector((0.104, 0.0, 0.0)), (0.016, 0.024, 0.032), 0.0),
    ]
    parts = [body, hd]
    for fname, off, sc, _ in face:
        f = sphere(fname, 1.0, loc=head + (hrot @ off), scale=sc, material=m, subdiv=3)
        f.rotation_euler = (tilt, 0, 0)
        parts.append(f)
    if robe:
        parts.append(_tunic(name + "_tunic", pelvis, up, w, m, long=p["h"] > 0.7, seed=hash(name) % 97))
        belt = cyl(name + "_belt", 0.172 * w, 0.032, loc=pelvis + up * 0.12, material=m)
        belt.scale = (1.0, 0.78, 1.0)
        belt.rotation_euler = (lean, 0, 0)
        parts.append(belt)
    if hat == "cap":
        cap = sphere(name + "_cap", 0.128, loc=head + Vector((0, -0.01, 0.04)), scale=(0.98, 1.04, 0.6), material=m)
        parts.append(cap)
    elif hat == "brim":
        crown = cyl(name + "_crown", 0.095, 0.1, loc=head + Vector((0, 0, 0.11)), material=m, r2=0.08, bevel=0.01)
        brim = cyl(name + "_brim", 0.21, 0.014, loc=head + Vector((0, 0, 0.075)), material=m, bevel=0.005)
        parts += [crown, brim]
    elif hat == "hair":
        hair = sphere(name + "_hair", 0.125, loc=head + Vector((0, -0.025, 0.035)), scale=(1.0, 1.02, 0.95), material=m)
        parts.append(hair)
    elif hat == "band":
        band = cyl(name + "_band", 0.12, 0.032, loc=head + Vector((0, 0, 0.035)), material=m)
        parts.append(band)

    root = link(bpy.data.objects.new(name + "_root", None))
    for ob in parts:
        ob.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    return root


def hand_pos(pose, side, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    """World position of a figure's hand, for placing what it holds. side: -1 left, +1 right."""
    p = POSES[pose]
    lean = p["lean"]
    up = Vector((0, math.sin(lean), math.cos(lean)))
    chest = Vector((0, 0, p["h"])) + up * 0.36
    arm = p["la"] if side < 0 else p["ra"]
    sho = chest + up * 0.12 + Vector((0.18 * side, 0, 0))
    hand = sho + _dir(arm[0]) * _UP + _dir(arm[1]) * (_UF + 0.05)
    return Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Scale(scale, 4) @ hand


# --------------------------------------------------------------------------------------------
# Lights and camera
# --------------------------------------------------------------------------------------------


def _aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def area_light(name, loc, target, energy, size=2.0, color=None, kind="key"):
    lk = look()
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy * (lk["fill_mult"] if kind == "fill" else 1.0)
    ld.size = size
    ld.color = lin(color or (lk["fill"] if kind == "fill" else lk["key"]))
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    _aim(ob, target)
    return ob


def spot_light(name, loc, target, energy, angle=0.6, blend=0.6, color=None, radius=0.2):
    lk = look()
    ld = bpy.data.lights.new(name, "SPOT")
    ld.energy = energy
    ld.spot_size = angle
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    ld.color = lin(color or lk["key"])
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    _aim(ob, target)
    return ob


def point_light(name, loc, energy, color=None, radius=0.3):
    ld = bpy.data.lights.new(name, "POINT")
    ld.energy = energy
    ld.shadow_soft_size = radius
    ld.color = lin(color or look()["fire"])
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    return ob


def camera(loc, target, lens=40.0, fstop=None, focus=None):
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.clip_start = 0.02
    cd.clip_end = 200.0
    ob = link(bpy.data.objects.new("cam", cd))
    ob.location = loc
    _aim(ob, target)
    if fstop:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = fstop
        cd.dof.focus_distance = (Vector(focus or target) - Vector(loc)).length
    bpy.context.scene.camera = ob
    return ob


def screen_point(cam, sx, sy, dist):
    """World point at frame position (sx, sy) and distance dist in front of camera cam.
    sx, sy run from -0.5 to 0.5 across the frame's width and height, +sy up."""
    sc = bpy.context.scene
    aspect = sc.render.resolution_y / sc.render.resolution_x
    half_w = dist * cam.data.sensor_width / 2 / cam.data.lens
    p = Vector((sx * 2 * half_w, sy * 2 * half_w * aspect, -dist))
    return cam.location + cam.rotation_euler.to_matrix() @ p


def ray_hit(origin, direction):
    """First surface hit from origin along direction: (location, normal), or (None, None)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, nor, _i, _ob, _m = bpy.context.scene.ray_cast(dg, Vector(origin), Vector(direction).normalized())
    return (loc, nor) if hit else (None, None)


def dim(k):
    """Scale every light, the world and every glow by k, except what is marked as the hero
    (ob["hero"] = True on the object or its parent): a scene going dark around its money."""
    def is_hero(ob):
        while ob is not None:
            if ob.get("hero"):
                return True
            ob = ob.parent
        return False

    keep = set()
    for ob in bpy.context.scene.objects:
        if is_hero(ob) and ob.type in ("MESH", "CURVE", "FONT", "META"):
            keep.update(m for m in ob.data.materials if m)
    for ob in bpy.context.scene.objects:
        if ob.type == "LIGHT" and not is_hero(ob):
            ob.data.energy *= k
    w = bpy.context.scene.world
    if w:
        w.node_tree.nodes["Background"].inputs["Strength"].default_value *= k
    _STATE["backdrop_k"] *= k
    for m in bpy.data.materials:
        if m in keep or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == "EMISSION":
                n.inputs["Strength"].default_value *= k


# --------------------------------------------------------------------------------------------
# Render + backdrop composite
# --------------------------------------------------------------------------------------------


def render(path):
    """Render with a transparent film, then lay the frame on the look's backdrop: flat paper for
    LEDGER (so the ground is exactly DESIGN.md's #131110), a painted dusk gradient for the warm look."""
    import numpy as np

    sc = bpy.context.scene
    tmp = path + ".rgba.png"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)  # bottom-up, display-referred
    lk = look()
    if lk["sky_top"] and _STATE["backdrop"] == "look":
        top = np.array(_srgb01(lk["sky_top"]), dtype=np.float32)
        low = np.array(_srgb01(lk["sky_low"]), dtype=np.float32)
        t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]  # 0 bottom, 1 top
        t = np.clip((t - 0.25) / 0.75, 0, 1) ** 0.8
        back = low * (1 - t) + top * t
        bg = np.array(_srgb01(lk["bg"]), dtype=np.float32)
        back = bg + (back - bg) * _STATE["backdrop_k"]  # the painted sky fades with the lights
        back = np.broadcast_to(back, (h, w, 3))
    else:
        back = np.broadcast_to(np.array(_srgb01(lk["bg"]), dtype=np.float32), (h, w, 3))
    a = px[..., 3:4]
    out = px[..., :3] * a + back * (1 - a)  # straight alpha over the backdrop
    rgba_out = np.concatenate([out, np.ones_like(a)], axis=2)
    res = bpy.data.images.new("out", w, h, alpha=False)
    res.pixels[:] = rgba_out.ravel()
    res.filepath_raw = path
    res.file_format = "PNG"
    res.save()
    import os
    os.remove(tmp)
    return path


def _srgb01(hex_str):
    h = hex_str.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
