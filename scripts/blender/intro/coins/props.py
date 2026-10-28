"""Props of the Lydian mint: the anvil with its die, the punch, the hammer, the stoker's tongs, a clay
raised hearth with coals and a crucible, a stool, a bench with blanks and struck coins, and a hand balance.

Everything is built from code in the LEDGER clay look (kit.mat); metal tools are dark, wood is wood,
gold appears only in the coins themselves (DESIGN.md amendment G). Nothing here is a historical claim:
how the earliest coins were struck is known from the coins (an anvil die, a punch, a hammer); the rest
is a plausible workshop, so no caption leans on it.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import kit

mat = kit.mat


def rod(name, a, b, r, material, segs=16, r2=None):
    a, b = Vector(a), Vector(b)
    d = b - a
    ob = kit.cyl(name, r, d.length, material=material, segs=segs, r2=r2)
    ob.location = (a + b) / 2
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def lathe(name, prof, material, segs=48, cap_top=True, cap_bottom=True):
    """A body of revolution from a (radius, z) profile, bottom to top."""
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(i / segs * math.tau), r * math.sin(i / segs * math.tau), z)) for i in range(segs)]
             for r, z in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    if cap_bottom:
        bm.faces.new(rings[0][::-1])
    if cap_top:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.from_bmesh(name, bm, material)


def _roughen(ob, amp, freq, seed=0):
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in ob.data.vertices:
        v.co += v.normal * amp * noise.noise(v.co * freq + off)


def anvil(name, top_center, w=0.26, seed=4):
    """A squared block of stone, roughly dressed, with the obverse die set flush in its top and a blank
    lying on the die. top_center is where the blank sits (the punch's tip). Returns the root object."""
    t = Vector(top_center)
    h = t.z - 0.012
    root = kit.link(bpy.data.objects.new(name, None))
    stone = kit.box(name + "_stone", (w, w * 0.9, h), loc=(t.x, t.y, h / 2), material=mat("clay_dim", "#8a857c"))
    bm = bmesh.new()
    bm.from_mesh(stone.data)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.008, segments=2, affect="EDGES")
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
    bm.to_mesh(stone.data)
    bm.free()
    # chipped, uneven sides, easing to nothing at the top edge so the top stays flat where the die sits
    off = Vector((seed * 5.1, seed * 2.3, seed * 7.7))
    for v in stone.data.vertices:
        n = Vector((v.co.x, v.co.y, 0))
        if n.length > 1e-6:
            fade = min(1.0, max(0.0, (h / 2 - v.co.z) / 0.04))
            v.co += n.normalized() * 0.008 * fade * noise.noise(v.co * 14.0 + off)
    stone.data.update()
    stone.rotation_euler = (0, 0, 0.35)
    stone.data.set_sharp_from_angle(angle=math.radians(40))
    for p in stone.data.polygons:
        p.use_smooth = True
    stone.parent = root
    die = kit.cyl(name + "_die", 0.034, 0.03, loc=(t.x, t.y, h - 0.012), material=mat("rock"), segs=32, bevel=0.004)
    die.parent = root
    blank = kit.lumpy(name + "_blank", 0.011, loc=(t.x, t.y, h + 0.006), scale=(1.15, 1.0, 0.55),
                      material=mat("electrum"), amp=0.12, freq=1.5, subdiv=3, seed=7)
    blank.parent = root
    return root


def punch(name, grip, axis, below=0.15, above=0.045):
    """An iron punch, square in section, its struck top mushroomed, held at grip along axis (axis points
    up, out of the thumb side)."""
    g, ax = Vector(grip), Vector(axis).normalized()
    a, b = g - ax * below, g + ax * above
    shaft = rod(name, a, b, 0.011, mat("rock"), segs=4)
    shaft.rotation_mode = "QUATERNION"
    shaft.rotation_quaternion = (b - a).to_track_quat("Z", "Y") @ Matrix.Rotation(math.pi / 4, 4, "Z").to_quaternion()
    bev = shaft.modifiers.new("bev", "BEVEL")
    bev.width, bev.segments = 0.003, 2
    head = kit.lumpy(name + "_head", 0.016, loc=b, scale=(1, 1, 0.5), material=mat("rock"), amp=0.15, subdiv=3, seed=3)
    head.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return [shaft, head]


def hammer(name, grip, axis, below=0.07, above=0.27):
    """A short smith's hammer: wooden handle through the fist, iron head across its top."""
    g, ax = Vector(grip), Vector(axis).normalized()
    a, b = g - ax * below, g + ax * above
    handle = rod(name + "_handle", a, b, 0.014, mat("wood"), segs=16, r2=0.012)
    across = ax.cross(Vector((0, 0, 1)))
    if across.length < 1e-3:
        across = Vector((1, 0, 0))
    # the head lies across the swing: perpendicular to the handle, in the plane the arm swings in
    swing = ax.cross(across).normalized()
    hd = b + ax * 0.02
    head = kit.box(name + "_head", (0.05, 0.05, 0.13), material=mat("rock"), bevel=0.008)
    head.location = hd
    head.rotation_mode = "QUATERNION"
    head.rotation_quaternion = swing.to_track_quat("Z", "Y")
    return [handle, head]


def tongs(name, grip, axis, length=0.62, gape=0.05):
    """Smith's tongs: two iron arms crossing at a rivet, the jaws ahead of the fist along axis."""
    g, ax = Vector(grip), Vector(axis).normalized()
    # the arms open in the vertical plane through the tongs, so a side view shows the jaws apart
    side = ax.cross(ax.cross(Vector((0, 0, 1)))).normalized()
    pivot = g + ax * (length * 0.62)
    obs = []
    for k, s in enumerate((-1, 1)):
        tail = g - ax * 0.05 + side * s * 0.008
        jaw = g + ax * length - side * s * gape * 0.5
        obs.append(kit.curve_tube(f"{name}_arm{k}", [tail, pivot + side * s * 0.005, jaw, jaw - side * s * 0.03 + ax * 0.012],
                                  0.0065, material=mat("rock")))
    obs.append(kit.sphere(name + "_rivet", 0.009, loc=pivot, material=mat("rock"), subdiv=2))
    return obs


def stool(name, loc, top, rot_z=0.0, w=0.34, d=0.28):
    """A low wooden stool: a thick seat on three splayed legs."""
    root = kit.link(bpy.data.objects.new(name, None))
    seat = kit.box(name + "_seat", (w, d, 0.05), loc=(0, 0, top - 0.025), material=mat("wood"), bevel=0.012)
    seat.parent = root
    for i in range(3):
        a = math.radians(90 + i * 120)
        foot = Vector((math.cos(a) * w * 0.42, math.sin(a) * d * 0.42, 0))
        hip = Vector((math.cos(a) * w * 0.28, math.sin(a) * d * 0.28, top - 0.05))
        rod(f"{name}_leg{i}", foot, hip, 0.02, mat("wood"), segs=10).parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def coal_material(glow):
    """Charcoal: dark lumps whose undersides glow, as embers do (a dark crust on top, the heat beneath).
    Glowing patches painted over each whole lump read as a cow's hide; glowing whole lumps as popcorn."""
    key = f"coal_{glow:.1f}"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = kit.rgba("#1e1b19")
    b.inputs["Roughness"].default_value = 0.95
    if glow > 0:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
        under = nt.nodes.new("ShaderNodeMapRange")  # 1 at the lump's underside, 0 from just below its middle up
        under.inputs["From Min"].default_value = -0.004
        under.inputs["From Max"].default_value = -0.018
        under.inputs["To Max"].default_value = glow
        nt.links.new(tc.outputs["Object"], xyz.inputs["Vector"])
        nt.links.new(xyz.outputs["Z"], under.inputs["Value"])
        b.inputs["Emission Color"].default_value = kit.rgba(kit.look()["fire"])
        nt.links.new(under.outputs["Result"], b.inputs["Emission Strength"])
    return m


def ember_material(glow, radius):
    """The bed under the coals: brightest at the heart of the fire, dying away toward the rim, broken up
    by noise so it reads as heat and not as a lamp."""
    key = f"embers_{glow:.1f}_{radius:.3f}"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
    dist = nt.nodes.new("ShaderNodeVectorMath")
    dist.operation = "LENGTH"
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    fall = nt.nodes.new("ShaderNodeMapRange")
    fall.inputs["From Min"].default_value = 0.0
    fall.inputs["From Max"].default_value = radius
    fall.inputs["To Min"].default_value = glow * 1.6
    fall.inputs["To Max"].default_value = glow * 0.08
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 22.0
    nz.inputs["Detail"].default_value = 3.0
    mix = nt.nodes.new("ShaderNodeMapRange")  # noise 0.35..0.65 -> x0.4..x1.2
    mix.inputs["From Min"].default_value = 0.35
    mix.inputs["From Max"].default_value = 0.65
    mix.inputs["To Min"].default_value = 0.4
    mix.inputs["To Max"].default_value = 1.2
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = kit.rgba(kit.look()["fire"])
    nt.links.new(tc.outputs["Object"], xyz.inputs["Vector"])
    nt.links.new(xyz.outputs["X"], comb.inputs["X"])
    nt.links.new(xyz.outputs["Y"], comb.inputs["Y"])
    nt.links.new(comb.outputs["Vector"], dist.inputs[0])
    nt.links.new(dist.outputs["Value"], fall.inputs["Value"])
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], mix.inputs["Value"])
    nt.links.new(fall.outputs["Result"], mul.inputs[0])
    nt.links.new(mix.outputs["Result"], mul.inputs[1])
    nt.links.new(mul.outputs[0], em.inputs["Strength"])
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return m


def hearth(name, loc, r=0.3, h=0.12, base=0.34, glow=9.0, light=22.0, seed=3):
    """An open clay hearth raised on a block of mudbrick: a low ring wall full of glowing coals, a crucible
    sitting in them with its melt glowing. Returns (root, world point at the crucible's rim, where the
    tongs grip it)."""
    root = kit.link(bpy.data.objects.new(name, None))
    plinth = kit.box(name + "_base", (r * 2.5, r * 2.3, base), loc=(0, 0, base / 2), material=mat("clay_dim", "#77726a"),
                     bevel=0.03)
    plinth.parent = root
    top = kit.link(bpy.data.objects.new(name + "_top", None))
    top.location = (0, 0, base)
    top.parent = root
    wall = lathe(name + "_ring", [(r * 0.78, 0.0), (r, 0.0), (r * 1.02, h * 0.6), (r * 0.96, h), (r * 0.86, h * 1.02),
                                   (r * 0.8, h * 0.7), (r * 0.78, 0.02)], mat("clay_dim", "#8a857c"), segs=64)
    wall.parent = top
    # the coals: dark lumps heaped over a glowing bed, so the fire shows in the gaps between them (glow
    # painted on each lump read as a cow's hide). The heap rises above the rim, or the overview camera
    # sees only the ring wall.
    mound = 0.06
    bed = kit.cyl(name + "_bed", r * 0.8, mound, loc=(0, 0, h * 0.5 + mound / 2), material=ember_material(glow, r * 0.8),
                  segs=48, r2=r * 0.12)
    bed.parent = top
    rnd = random.Random(seed)
    for i in range(40):
        a, rr = rnd.uniform(0, math.tau), r * 0.72 * math.sqrt(rnd.random())
        z = h * 0.5 + mound * (1 - rr / (r * 0.8)) + rnd.uniform(0.0, 0.02)
        c = kit.lumpy(f"{name}_coal{i}", rnd.uniform(0.022, 0.038), loc=(math.cos(a) * rr, math.sin(a) * rr, z),
                      material=coal_material(glow), amp=0.4, subdiv=2, seed=seed * 17 + i)
        c.parent = top
    cr_r, cr_h = 0.075, 0.1
    cz = h * 0.55 + 0.035
    cru = lathe(name + "_crucible", [(0.0, 0.0), (cr_r * 0.6, 0.0), (cr_r, cr_h * 0.5), (cr_r * 1.02, cr_h), (cr_r * 0.86, cr_h * 1.02),
                                     (cr_r * 0.8, cr_h * 0.55), (0.0, cr_h * 0.5)], mat("clay_dim", "#9b968c"), segs=40,
                cap_top=False, cap_bottom=False)
    cru.location = (0.02, -0.02, cz)
    cru.parent = top
    melt = kit.cyl(name + "_melt", cr_r * 0.8, 0.004, loc=(0.02, -0.02, cz + cr_h * 0.7), material=mat("fire", glow * 1.4), segs=32)
    melt.parent = top
    lk = kit.look()
    kit.point_light(name + "_light", (0.0, 0.0, h + 0.18), light, color=lk["fire"], radius=0.2).parent = top
    root.location = loc
    bpy.context.view_layer.update()
    return root, top.matrix_world @ Vector((0.02, -0.02, cz + cr_h))


def plinth_coins(name, center, rows, cols, step, coin_size, rot_z=0.0, seed=1):
    """Struck coins laid out in rows on a cloth: small copies of the hero coin's shape (no relief at this
    size; it would not show)."""
    import coin as coinmod
    proto = coinmod.coin_mesh(name + "_proto", coinmod.Coin(seed=seed), size=coin_size, voxel=0.12)
    rnd = random.Random(seed)
    obs = []
    c = Vector(center)
    rot = Matrix.Rotation(rot_z, 3, "Z")
    for i in range(rows):
        for j in range(cols):
            p = c + rot @ Vector(((j - (cols - 1) / 2) * step, (i - (rows - 1) / 2) * step, 0))
            ob = bpy.data.objects.new(f"{name}_{i}_{j}", proto.data)
            kit.link(ob)
            flip = rnd.random() < 0.35  # some lie reverse up, punch marks showing
            lift = coin_size * 0.2
            ob.location = (p.x + rnd.uniform(-1, 1) * step * 0.08, p.y + rnd.uniform(-1, 1) * step * 0.08, p.z + lift)
            ob.rotation_euler = (math.pi if flip else 0.0, 0, rnd.uniform(0, math.tau))
            obs.append(ob)
    bpy.data.objects.remove(proto, do_unlink=True)
    return obs


def bowl(name, loc, r=0.13, h=0.06, material=None):
    prof = [(0.0, 0.0), (r * 0.55, 0.0), (r * 0.9, h * 0.45), (r, h), (r * 0.94, h * 1.02), (r * 0.84, h * 0.5),
            (r * 0.5, h * 0.18), (0.0, h * 0.15)]
    ob = lathe(name, prof, material or mat("clay_dim"), segs=48, cap_top=False, cap_bottom=False)
    return kit.place(ob, loc)


def blanks(name, center, n, spread, size, seed=2):
    """Lumps of electrum ready for striking: weighed pellets, roughly bean-shaped."""
    rnd = random.Random(seed)
    obs = []
    c = Vector(center)
    for i in range(n):
        a, rr = rnd.uniform(0, math.tau), spread * math.sqrt(rnd.random())
        p = c + Vector((math.cos(a) * rr, math.sin(a) * rr, size * 0.45 + rnd.uniform(0, size * 0.3)))
        ob = kit.lumpy(f"{name}_{i}", size / 2, loc=p, scale=(1.15, 1.0, 0.6), material=mat("electrum"), amp=0.15,
                       freq=1.4, subdiv=3, seed=seed * 31 + i)
        ob.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, math.tau))
        obs.append(ob)
    return obs


def bench(name, loc, size=(1.1, 0.5, 0.72), rot_z=0.0):
    """A plank bench on two trestle ends. Returns (root, local-to-world matrix of its top surface)."""
    w, d, h = size
    root = kit.link(bpy.data.objects.new(name, None))
    kit.box(name + "_top", (w, d, 0.06), loc=(0, 0, h - 0.03), material=mat("wood"), bevel=0.012).parent = root
    for sx in (-1, 1):
        kit.box(f"{name}_end{sx}", (0.07, d * 0.8, h - 0.06), loc=(sx * (w / 2 - 0.12), 0, (h - 0.06) / 2),
                material=mat("wood"), bevel=0.01).parent = root
    kit.box(name + "_rail", (w - 0.3, 0.05, 0.06), loc=(0, 0, 0.18), material=mat("wood"), bevel=0.008).parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    bpy.context.view_layer.update()
    top = root.matrix_world @ Matrix.Translation((0, 0, h))
    return root, top


def hand_balance(name, grip, beam_half=0.15, drop=0.11, pan_drop=0.17, pan_r=0.055, facing=0.0, tilt=0.0):
    """A hand balance hanging from the fist at grip: a cord down to the beam's centre, a bronze-dark beam
    turned by `facing` about Z, a shallow pan hanging under each end on three cords. `tilt` (radians) dips
    the left pan, as when a coin is a little heavy."""
    g = Vector(grip)
    dark = mat("rock")
    obs = []
    c = g - Vector((0, 0, drop))
    obs.append(rod(name + "_cord", g + Vector((0, 0, 0.01)), c, 0.0018, dark, segs=6))
    rot = Matrix.Rotation(facing, 3, "Z") @ Matrix.Rotation(tilt, 3, "Y")
    ends = [c + rot @ Vector((s * beam_half, 0, 0)) for s in (-1, 1)]
    obs.append(rod(name + "_beam", ends[0], ends[1], 0.005, dark, segs=12))
    obs.append(kit.sphere(name + "_pivot", 0.009, loc=c, material=dark, subdiv=2))
    for k, e in enumerate(ends):
        p = e - Vector((0, 0, pan_drop))
        pan = lathe(f"{name}_pan{k}", [(0.0, 0.0), (pan_r * 0.6, 0.0), (pan_r, 0.012), (pan_r * 0.97, 0.014),
                                         (pan_r * 0.55, 0.004), (0.0, 0.003)], dark, segs=40, cap_top=False, cap_bottom=False)
        pan.location = p
        obs.append(pan)
        for j in range(3):
            a = j / 3 * math.tau + facing
            rim = p + Vector((math.cos(a) * pan_r * 0.93, math.sin(a) * pan_r * 0.93, 0.013))
            obs.append(rod(f"{name}_str{k}{j}", rim, e, 0.0012, dark, segs=5))
    return obs


def brick_wall(name, loc, size, rot_z=0.0):
    """A mudbrick wall: the dark wall tone with shallow brick courses in the surface (shader bump, so it
    bakes into the web normal map)."""
    m = bpy.data.materials.get("mudbrick")
    if m is None:
        m = mat("rock").copy()
        m.name = "mudbrick"
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        br = nt.nodes.new("ShaderNodeTexBrick")
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Mortar Size"].default_value = 0.012
        br.inputs["Brick Width"].default_value = 0.42
        br.inputs["Row Height"].default_value = 0.11
        br.inputs["Color1"].default_value = (1, 1, 1, 1)
        br.inputs["Color2"].default_value = (0.85, 0.85, 0.85, 1)
        br.inputs["Mortar"].default_value = (0, 0, 0, 1)
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        nt.links.new(sep.outputs["X"], comb.inputs["X"])
        nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
        nt.links.new(sep.outputs["Y"], comb.inputs["Z"])
        nt.links.new(comb.outputs[0], br.inputs["Vector"])
        old = [l for l in nt.links if l.to_socket == b.inputs["Normal"]]
        bump_old = old[0].from_node if old else None
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.5
        bump.inputs["Distance"].default_value = 0.01
        nt.links.new(br.outputs["Fac"], bump.inputs["Height"])
        if bump_old is not None:
            nt.links.new(bump_old.outputs["Normal"], bump.inputs["Normal"])
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return kit.box(name, size, loc=loc, rot=(0, 0, rot_z), material=m, bevel=0.02)
