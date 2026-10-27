"""Rung 1 of the figure ladder: a belted tunic simulated as real cloth on a posed MakeHuman body.

The body is first put in a T-pose and that pose becomes its rest pose, so a wide tube of cloth can be
built around the torso and legs with the arms out of the way. Its belt ring and the top edge over each
shoulder are pinned and pulled in over the first frames, the way a tied belt gathers fabric, so the
cloth buckles into folds. The rig then moves from the T-pose to the target pose over a few dozen frames
while the cloth is simulated against the body (and a floor or seat if given).

Lower a figure through its Root pose bone, not the rig object: an Armature modifier on an object that is
not parented to the rig ignores the rig object's own location, so the pins would stay behind.
"""
import math
import random

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def tpose_rest(ob, rig, down=0.0):
    """Raise the arms straight out (horizontal, or tilted down by `down` per unit out) and make that the
    rig's rest pose (body mesh re-based to match)."""
    import mh_figure as mh
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"upperarm_{s}", (sx, 0.0, -down))
        mh.aim(rig, f"lowerarm_{s}", (sx, 0.0, -down))
        mh.aim(rig, f"hand_{s}", (sx, 0.0, -down))
    bpy.context.view_layer.update()
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="rig")
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = rig
    bpy.context.view_layer.update()


def _bvh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(ob.matrix_world)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    tree = BVHTree.FromBMesh(bm)
    ev.to_mesh_clear()
    return tree, bm


def _outer_hit(tree, origin, d, max_dist):
    """Farthest surface crossing along a ray from origin (within max_dist): the body's outer skin."""
    far, o, travelled = None, origin.copy(), 0.0
    for _ in range(12):
        hit, _n, _i, dist = tree.ray_cast(o, d, max_dist - travelled)
        if hit is None:
            break
        travelled += dist + 1e-4
        far = travelled
        o = hit + d * 1e-4
    return far


def make_tunic(ob, rig, name, material, hem=0.078, rx=0.31, ry=0.27, top=0.10, waist_z=None,
               around=96, step=0.016, seed=1, cinch=(2, 14), rx_top=0.215):
    """Build the tunic tube around a body in its (T-pose) rest. Returns the cloth object, unsimulated.

    The tube starts wide and loose (just clear of the skin). Its belt ring and the top edge over each
    shoulder are pinned, and a shape key animated over the `cinch` frames pulls those pins in to the
    waist and onto the shoulders, so the cloth gathers the way a tied belt gathers real fabric."""
    tree, _bm = _bvh(ob)
    bones = rig.data.bones
    if waist_z is None:
        h = bones["spine_01"]
        waist_z = (h.head_local.z + h.tail_local.z) / 2
    cy = (bones["spine_01"].head_local.y + bones["spine_02"].head_local.y) / 2
    sh_y = (bones["clavicle_l"].tail_local.y + bones["upperarm_l"].head_local.y) / 2
    sh = bones["upperarm_l"].head_local
    # heights from this body's own landmarks (bodies differ in height): hem above the soles, top above
    # the shoulder joint, arm holes below it
    floor = min(ob.data.vertices[i].co.z for p in ob.data.polygons for i in p.vertices)
    hem_z = floor + hem
    top_z = sh.z + top
    armpit_z = sh.z - 0.13

    rows = int(round((top_z - hem_z) / step)) + 1
    zs = [hem_z + i * (top_z - hem_z) / (rows - 1) for i in range(rows)]
    rng = random.Random(seed)
    bm = bmesh.new()
    grid = []

    def rx_at(z):
        # full width below the belt, narrowing toward the arm holes so the sides don't wing out
        t = min(max((z - waist_z) / (armpit_z - 0.04 - waist_z), 0.0), 1.0)
        return rx + (rx_top - rx) * t

    for z in zs:
        row = []
        for k in range(around):
            a = k / around * math.tau
            row.append(bm.verts.new((rx_at(z) * math.cos(a), cy + ry * math.sin(a), z)))
        grid.append(row)
    for j in range(rows - 1):
        for k in range(around):
            a, b = grid[j][k], grid[j][(k + 1) % around]
            c, d = grid[j + 1][(k + 1) % around], grid[j + 1][k]
            # arm holes: drop the sides above the armpit
            if min(v.co.z for v in (a, b, c, d)) > armpit_z and min(abs(v.co.x) for v in (a, b, c, d)) > 0.205:
                continue
            bm.faces.new((a, b, c, d))
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.verts.index_update()
    bm.verts.ensure_lookup_table()

    # loose start shape: the tube, pushed clear of the skin wherever the body bulges into it
    off = 0.014
    skin_r = {}
    for v in bm.verts:
        p = v.co
        d = Vector((p.x, p.y - cy, 0.0))
        r = d.length
        d.normalize()
        hit = _outer_hit(tree, Vector((0.0, cy, p.z)), d, r + 0.05)
        skin = (hit if hit is not None and hit < r + 0.05 else 0.0) + off
        skin_r[v.index] = (d, skin)
        v.co = Vector((0.0, cy, p.z)) + d * max(r, skin + 0.01)
        v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.001
    loose_co = [v.co.copy() for v in bm.verts]

    # pin targets: the belt ring on the waist, the top edge on each shoulder (pulled toward the neck a
    # little so the neckline has slack to drape)
    tgt = {}
    for v in bm.verts:
        if abs(v.co.z - waist_z) < step * 0.55:
            d, skin = skin_r[v.index]
            tgt[v.index] = Vector((0.0, cy, v.co.z)) + d * skin
    for v in bm.verts:
        x = abs(v.co.x)
        if abs(v.co.z - top_z) < 1e-3 and 0.10 < x:
            sx = 1 if v.co.x > 0 else -1
            nx = sx * min(0.075 + (x - 0.10) * 0.95, sh.x - 0.035)
            hit, _n, _i, _dist = tree.ray_cast(Vector((nx, sh_y, sh.z + 0.22)), Vector((0, 0, -1)), 1.0)
            if hit is None:
                continue
            front = v.co.y < cy
            tgt[v.index] = Vector((nx, sh_y + (-0.01 if front else 0.01), hit.z + off))

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    _bm.free()
    cob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(cob)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    cob.shape_key_add(name="Basis")
    sk = cob.shape_key_add(name="cinch")
    for i, c in tgt.items():
        sk.data[i].co = c
    sk.value = 0.0
    sk.keyframe_insert("value", frame=cinch[0])
    sk.value = 1.0
    sk.keyframe_insert("value", frame=cinch[1])

    # skin weights from the nearest body vertex (rest pose), so the pins ride the armature; pins take
    # the weights of the spot they end up on
    from mathutils.kdtree import KDTree
    bme = ob.data
    used = sorted({i for p in bme.polygons for i in p.vertices})
    kd = KDTree(len(used))
    for i in used:
        kd.insert(ob.matrix_world @ bme.vertices[i].co, i)
    kd.balance()
    gnames = {g.index: g.name for g in ob.vertex_groups}
    groups = {}
    for i, c in enumerate(loose_co):
        _co, bi, _d = kd.find(tgt.get(i, c))
        for g in bme.vertices[bi].groups:
            groups.setdefault(gnames[g.group], []).append((i, g.weight))
    for gname, pairs in groups.items():
        vg = cob.vertex_groups.new(name=gname)
        for i, w in pairs:
            vg.add([i], w, "REPLACE")
    pg = cob.vertex_groups.new(name="pin")
    for i in tgt:
        pg.add([i], 1.0, "REPLACE")
    # the shoulder pins ride the shoulder girdle, not the upper arm (an arm swinging down would drag them)
    for i, c in tgt.items():
        if c.z > waist_z + 0.15:
            for g in cob.vertex_groups:
                if g.name != "pin":
                    g.remove([i])
            side = "l" if c.x > 0 else "r"
            cob.vertex_groups[f"clavicle_{side}"].add([i], 0.6, "REPLACE")
            cob.vertex_groups["spine_03"].add([i], 0.4, "REPLACE")
    arm = cob.modifiers.new("rig", "ARMATURE")
    arm.object = rig
    cob["waist_z"] = waist_z
    return cob


def add_cloth(cob, frames, bending=1.2, mass=0.35, self_collide=True, quality=8, tension=15.0, shear=5.0,
              shrink=0.0, stiff_group=None, bending_max=None, shrink_max=None):
    mod = cob.modifiers.new("cloth", "CLOTH")
    s = mod.settings
    s.quality = quality
    s.mass = mass
    s.air_damping = 1.0
    s.tension_stiffness = s.compression_stiffness = tension
    s.shear_stiffness = shear
    s.bending_stiffness = bending
    s.vertex_group_mass = "pin"
    s.pin_stiffness = 1.0
    s.shrink_min = shrink  # negative: the cloth is a little larger than its mesh (slack to sit down in)
    if stiff_group:
        s.vertex_group_bending = stiff_group
        s.bending_stiffness_max = bending_max
        if shrink_max is not None:
            # the same map sets the slack: `shrink` where its weight is 0, `shrink_max` where it is 1
            s.vertex_group_shrink = stiff_group
            s.shrink_max = shrink_max
    c = mod.collision_settings
    c.collision_quality = 3
    c.distance_min = 0.006
    c.use_self_collision = self_collide
    c.self_distance_min = 0.004
    c.self_friction = 5.0
    mod.point_cache.frame_start = 1
    mod.point_cache.frame_end = frames
    return mod


def collider(ob, outer=0.004, friction=5.0):
    ob.modifiers.new("collision", "COLLISION")
    ob.collision.thickness_outer = outer
    ob.collision.cloth_friction = friction
    ob.collision.damping = 0.5


def key_pose(rig, frame):
    for pb in rig.pose.bones:
        if pb.rotation_mode == "QUATERNION":
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        else:
            pb.keyframe_insert("rotation_euler", frame=frame)
        pb.keyframe_insert("location", frame=frame)


def run(frames, report=10):
    import time
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    t0 = time.time()
    for f in range(1, frames + 1):
        sc.frame_set(f)
        if f % report == 0:
            print(f"[sim] frame {f}/{frames} {time.time() - t0:.0f}s", flush=True)


def bake(ob, name, material=None):
    """The evaluated object (cloth result, posed body) as a static mesh in world space."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    me.transform(ob.matrix_world)
    nob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(nob)
    if material is not None:
        me.materials.clear()
        me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return nob
