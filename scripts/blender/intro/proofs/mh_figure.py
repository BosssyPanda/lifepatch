"""Proof: a CC0 MakeHuman body (MPFB2 assets: base.obj, game_engine rig + weights, macro targets),
posed in Blender and rendered in the LEDGER clay look, to test whether real human figures can
replace the metaball stand-ins.

Assets: https://github.com/makehumancommunity/mpfb2 (LICENSE.ASSETS.md = CC0 1.0).
"""
import gzip
import json
import os

import bpy
from mathutils import Matrix, Vector

MPFB = os.environ.get("MPFB_DATA", "")  # path to mpfb2/src/mpfb/data
S = 0.1  # MakeHuman units are decimetres


def _to_bl(x, y, z):
    return Vector((x * S, -z * S, y * S))


def load_obj(groups_keep=("body", "helper-l-eye", "helper-r-eye")):
    verts, groups = [], {}
    cur = None
    with open(os.path.join(MPFB, "3dobjs", "base.obj")) as f:
        for line in f:
            if line.startswith("v "):
                _, x, y, z = line.split()[:4]
                verts.append((float(x), float(y), float(z)))
            elif line.startswith("g "):
                cur = line.split(None, 1)[1].strip()
                groups.setdefault(cur, [])
            elif line.startswith("f "):
                groups[cur].append([int(t.split("/")[0]) - 1 for t in line.split()[1:]])
    return verts, groups


def apply_targets(verts, targets):
    """targets: list of (file name in targets/macrodetails, weight)."""
    v = [list(p) for p in verts]
    for name, w in targets:
        path = os.path.join(MPFB, "targets", "macrodetails", name + ".target.gz")
        with gzip.open(path, "rt") as f:
            for line in f:
                p = line.split()
                if len(p) == 4 and not line.startswith("#"):
                    i = int(p[0])
                    v[i][0] += float(p[1]) * w
                    v[i][1] += float(p[2]) * w
                    v[i][2] += float(p[3]) * w
    return v


def build(name, targets=(), groups_keep=("body", "helper-l-eye", "helper-r-eye"), material=None, robe=False, hair=False):
    raw, groups = load_obj()
    verts = apply_targets(raw, targets)
    co = [_to_bl(*p) for p in verts]
    # mesh: every vertex (so rig/weight indices stay valid), only the faces we render
    me = bpy.data.meshes.new(name)
    faces = [f for g in groups_keep for f in groups.get(g, [])]
    top = []
    if robe:
        # a robe from MakeHuman's own fitting helpers: the long skirt, and the tights' upper body cut
        # above the waist and below the elbows, pushed off the skin so it reads as cloth
        faces += groups["helper-skirt"]
        top = [f for f in groups["helper-tights"]
               if all(0.10 < co[i].z < 0.545 and abs(co[i].x) < 0.29 for i in f)]
        faces += top
    if hair:
        faces += groups["helper-hair"]      # MakeHuman's hair-fitting cap, pushed out: cropped hair
    me.from_pydata([tuple(c) for c in co], [], faces)
    me.update()
    if hair:
        for i in {i for f in groups["helper-hair"] for i in f}:
            me.vertices[i].co += me.vertices[i].normal * 0.008
        me.update()
    if robe:
        tv = {i for f in top for i in f}
        for i in tv:
            me.vertices[i].co += me.vertices[i].normal * 0.012
        sv = {i for f in groups["helper-skirt"] for i in f}
        for i in sv:
            me.vertices[i].co += me.vertices[i].normal * 0.006
        me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    if material:
        me.materials.append(material)

    # joints: mean of each joint cube's vertices
    joint = {}
    for g, fs in groups.items():
        if g.startswith("joint-"):
            ids = {i for f in fs for i in f}
            joint[g] = sum((co[i] for i in ids), Vector()) / len(ids)

    rig = json.load(open(os.path.join(MPFB, "rigs", "standard", "rig.game_engine.json")))

    def pos(spec):
        st = spec["strategy"]
        if st == "CUBE":
            return joint[spec["cube_name"]]
        if st == "MEAN":
            return sum((co[i] for i in spec["vertex_indices"]), Vector()) / len(spec["vertex_indices"])
        if st == "VERTEX":
            return co[spec["vertex_index"]]
        raise ValueError(st)

    arm = bpy.data.armatures.new(name + "_rig")
    rob = bpy.data.objects.new(name + "_rig", arm)
    bpy.context.scene.collection.objects.link(rob)
    bpy.context.view_layer.objects.active = rob
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, spec in rig.items():
        eb = arm.edit_bones.new(bn)
        eb.head = pos(spec["head"])
        eb.tail = pos(spec["tail"])
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, 0.05))
        eb.roll = spec.get("roll", 0.0)
    for bn, spec in rig.items():
        if spec["parent"]:
            arm.edit_bones[bn].parent = arm.edit_bones[spec["parent"]]
            arm.edit_bones[bn].use_connect = spec.get("use_connect", False)
    bpy.ops.object.mode_set(mode="OBJECT")

    wts = json.load(open(os.path.join(MPFB, "rigs", "standard", "weights.game_engine.json")))["weights"]
    for bn, pairs in wts.items():
        vg = ob.vertex_groups.new(name=bn)
        for i, w in pairs:
            vg.add([i], w, "REPLACE")
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = rob
    ob.parent = rob
    return ob, rob


def aim(rob, bone, direction, up=None):
    """Point a pose bone along a world direction (armature space = world, rig unrotated)."""
    bpy.context.view_layer.update()
    pb = rob.pose.bones[bone]
    m = pb.matrix.copy()
    y = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    d = Vector(direction).normalized()
    q = y.rotation_difference(d)
    r = q.to_matrix() @ m.to_3x3()
    if up is not None:
        # twist about the new bone axis so its local Z leans toward 'up'
        z = r @ Vector((0, 0, 1))
        u = Vector(up) - d * Vector(up).dot(d)
        if u.length > 1e-6:
            zz = z - d * z.dot(d)
            ang = zz.angle(u) if zz.length > 1e-6 else 0.0
            if zz.cross(u).dot(d) < 0:
                ang = -ang
            r = Matrix.Rotation(ang, 3, d) @ r
    nm = r.to_4x4()
    nm.translation = m.translation
    pb.matrix = nm
    bpy.context.view_layer.update()


PALM_UP = float(os.environ.get("PALM_UP", "-1.4"))
FINGER = float(os.environ.get("FINGER", "0.2"))


def twist(rob, bone, ang):
    """Turn a pose bone about its own length (forearm roll: palms up or down)."""
    bpy.context.view_layer.update()
    pb = rob.pose.bones[bone]
    pb.matrix = pb.matrix @ Matrix.Rotation(ang, 4, "Y")
    bpy.context.view_layer.update()


def curl_fingers(rob, side, amount=0.9, thumb=0.4):
    for f in ("index", "middle", "ring", "pinky"):
        for k in ("01", "02", "03"):
            pb = rob.pose.bones[f"{f}_{k}_{side}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (amount * (0.5 if k == "01" else 1.0), 0, 0)
    for k in ("02", "03"):
        pb = rob.pose.bones[f"thumb_{k}_{side}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (thumb, 0, 0)


def ground(ob, rob, z=0.0):
    """Shift the rig so the posed mesh's lowest point sits at z."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    used = {i for p in me.polygons for i in p.vertices}
    lo = min((ev.matrix_world @ me.vertices[i].co).z for i in used)
    ev.to_mesh_clear()
    rob.location.z += z - lo


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------- poses
# World frame of a fresh body: it faces -Y, +X is its left, Z up. Directions below use that frame.

def pose_offer(rob, lean=0.0):
    """Two hands held forward, palms up: giving or receiving (no one-armed gestures)."""
    for s, sx in (("l", 1), ("r", -1)):
        aim(rob, f"upperarm_{s}", (0.1 * sx, -0.4, -1.0))
        aim(rob, f"lowerarm_{s}", (-0.05 * sx, -1.0, 0.3))
        twist(rob, f"lowerarm_{s}", PALM_UP * sx)
        aim(rob, f"hand_{s}", (-0.05 * sx, -1.0, 0.15))
        curl_fingers(rob, s, FINGER, 0.1)
    aim(rob, "head", (0, -0.35, 1.0))


def pose_kneel_lift(rob):
    """Atlas: right knee on the ground, left foot planted, both arms up holding a load overhead."""
    aim(rob, "spine_01", (0, 0.05, 1))
    aim(rob, "spine_03", (0, 0.12, 1))
    aim(rob, "thigh_l", (0.12, -1.0, -0.15))
    aim(rob, "calf_l", (0.0, 0.08, -1.0))
    aim(rob, "foot_l", (0.0, -1.0, -0.35))
    aim(rob, "thigh_r", (-0.08, -0.15, -1.0))
    aim(rob, "calf_r", (0.0, 1.0, -0.02))
    aim(rob, "foot_r", (0.0, 0.25, -1.0))
    for s, sx in (("l", 1), ("r", -1)):
        aim(rob, f"clavicle_{s}", (sx, 0.0, 0.35))
        aim(rob, f"upperarm_{s}", (0.9 * sx, 0.05, 0.75))
        aim(rob, f"lowerarm_{s}", (0.05 * sx, 0.05, 1.0))
        aim(rob, f"hand_{s}", (-0.35 * sx, 0.0, 1.0))
        curl_fingers(rob, s, 0.35, 0.2)
    aim(rob, "neck_01", (0, -0.1, 1))
    aim(rob, "head", (0, -0.45, 1.0))


def pose_sit_write(rob):
    """A scribe seated on a block, forearms on the knees, head bowed over a tablet."""
    for s, sx in (("l", 1), ("r", -1)):
        aim(rob, f"thigh_{s}", (0.12 * sx, -1.0, -0.05))
        aim(rob, f"calf_{s}", (0.03 * sx, -0.1, -1.0))
        aim(rob, f"foot_{s}", (0.0, -1.0, -0.3))
        aim(rob, f"upperarm_{s}", (0.15 * sx, -0.35, -1.0))
        aim(rob, f"lowerarm_{s}", (-0.25 * sx, -1.0, -0.15))
        curl_fingers(rob, s, 0.5, 0.2)
    aim(rob, "spine_02", (0, -0.25, 1))
    aim(rob, "spine_03", (0, -0.35, 1))
    aim(rob, "head", (0, -0.9, 0.6))
