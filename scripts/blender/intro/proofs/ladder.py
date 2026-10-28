"""Figure quality ladder: the same three figures (standing offer, seated scribe, kneeling Atlas) built at
each rung, most ambitious first, to find the best quality that is still clean and buildable.

  rung 1  cloth simulated on each pose, sculpted curly hair, relaxed hands
  rung 2  one tunic simulated once in the rest pose, then bent by the bones (no per-pose sim), smooth hair cap
  rung 3  plain robe lofted from slices of the posed body, bald, default hands (proof_robe.py)
  rung 4  today's metaball stand-ins (kit.figure)

--web also decimates each figure to the web budget, renders that version and exports it as GLB.
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]  # proofs/ and the intro kit beside it

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import cloth  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import robe_loft  # noqa: E402
import scenes  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


out = arg("--out")
fig = arg("--fig", "offer")
rung = int(arg("--rung", "1"))
res = tuple(int(x) for x in arg("--res", "800x1000").split("x"))
samples = int(arg("--samples", "32"))
frames = int(arg("--frames", "75"))
bending = float(arg("--bending", "0.3"))
web = int(arg("--web", "0"))  # target triangles per figure, 0 = off
views = arg("--views", "full").split(",")
tablet = int(arg("--tablet", "0"))  # the scribe's writing tablet on the lap, simulated as a collider
FLOOR = -0.818  # MakeHuman's soles in rest units

FIGS = {
    "offer": dict(targets=[("caucasian-male-young", 1.0)], pose=mh.pose_offer, hem=0.078, standin="receive"),
    "scribe": dict(targets=[("asian-male-old", 1.0)], pose=mh.pose_sit_write, hem=0.078, standin="stool"),
    "atlas": dict(targets=[("african-male-young", 1.0), ("universal-male-young-maxmuscle-averageweight", 0.6)],
                  pose=mh.pose_kneel_lift, hem=0.50, standin="kneel_lift"),
}


def relax_hands(rig):
    """Fingers gently curled, more toward the little finger, and closed up (no spread claw)."""
    for s, sx in (("l", 1), ("r", -1)):
        for f, base, spread in (("index", 0.21, -0.06), ("middle", 0.27, 0.0), ("ring", 0.36, 0.06),
                                ("pinky", 0.47, 0.12)):
            for k in ("01", "02", "03"):
                pb = rig.pose.bones[f"{f}_{k}_{s}"]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (base * (0.6 if k == "01" else 1.0), 0, spread * sx if k == "01" else 0)
        for k, a in (("01", 0.1), ("02", 0.2), ("03", 0.25)):
            pb = rig.pose.bones[f"thumb_{k}_{s}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (a, 0, 0)


def posed_points(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    used = {i for p in me.polygons for i in p.vertices}
    pts = [ev.matrix_world @ me.vertices[i].co for i in used]
    ev.to_mesh_clear()
    return pts


def store_pose(rig):
    return {pb.name: (tuple(pb.rotation_quaternion), tuple(pb.rotation_euler), tuple(pb.location))
            for pb in rig.pose.bones}


def set_pose(rig, pose=None):
    for pb in rig.pose.bones:
        q, e, loc = pose[pb.name] if pose else ((1, 0, 0, 0), (0, 0, 0), (0, 0, 0))
        pb.rotation_quaternion, pb.rotation_euler, pb.location = q, e, loc


def drop(rig, dz):
    """Lower the whole skeleton by dz through the Root bone (an Armature modifier on an object that isn't
    parented to the rig ignores the rig object's own location, so moving the rig object would leave
    pinned cloth behind)."""
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def learn_pose(ob, rig, hands):
    """Apply the figure's pose once to learn the drop to the floor and the seat height, then go back to rest."""
    spec["pose"](rig)
    if hands:
        relax_hands(rig)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    seat_top = None
    if fig == "scribe":
        seat_top = min(p.z for p in pts if -0.1 < p.y < 0.2 and abs(p.x) < 0.2 and p.z < 0.2) + dz
    drop(rig, dz)
    final = store_pose(rig)
    set_pose(rig)
    return final, dz, seat_top


def belt_for(cob, garment):
    """A cord belt over the tunic's pinned waist ring (garment: the baked tunic, same vertex order)."""
    pg = cob.vertex_groups["pin"].index
    basis = cob.data.shape_keys.key_blocks["Basis"].data
    ring = [v.index for v in cob.data.vertices if any(g.group == pg for g in v.groups)
            and abs(basis[v.index].co.z - cob["waist_z"]) < 0.02]
    pts = [garment.data.vertices[i].co.copy() for i in sorted(ring)]
    c = sum(pts, Vector()) / len(pts)
    pts = [p + ((p - c) * Vector((1, 1, 0))).normalized() * 0.008 for p in pts]
    return kit.curve_tube(fig + "_belt", pts, 0.011, material=clay, closed=True)


def skin_from(target, ob, rig):
    """Give target the weights of the nearest rest-pose body vertex, and an Armature modifier."""
    from mathutils.kdtree import KDTree
    bme = ob.data
    used = sorted({i for p in bme.polygons for i in p.vertices})
    kd = KDTree(len(used))
    for i in used:
        kd.insert(ob.matrix_world @ bme.vertices[i].co, i)
    kd.balance()
    gnames = {g.index: g.name for g in ob.vertex_groups}
    vgs = {}
    for v in target.data.vertices:
        _co, bi, _d = kd.find(target.matrix_world @ v.co)
        for g in bme.vertices[bi].groups:
            n = gnames[g.group]
            if n not in vgs:
                vgs[n] = target.vertex_groups.new(name=n)
            vgs[n].add([v.index], g.weight, "REPLACE")
    m = target.modifiers.new("rig", "ARMATURE")
    m.object = rig


def floor_and_seat(seat_top, animate):
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    floor = bpy.context.active_object
    cloth.collider(floor)
    seat = None
    if seat_top is not None:
        seat = kit.box("seat", (0.46, 0.36, 0.6), loc=(0, 0.06, seat_top - 0.3), material=kit.mat("clay_dim"),
                       bevel=0.02)
        if animate:
            # the seat rises into place once the legs have bent, like sitting down
            seat.location.z -= 0.8
            seat.keyframe_insert("location", frame=34)
            seat.location.z += 0.8
            seat.keyframe_insert("location", frame=52)
        cloth.collider(seat)
    return floor, seat


def rung_1():
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    scalp = hair.scalp_verts(ob, rig)
    cob = cloth.make_tunic(ob, rig, fig + "_tunic", clay, hem=spec["hem"])
    final, dz, seat_top = learn_pose(ob, rig, hands=True)
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob)
    _floor, seat = floor_and_seat(seat_top, animate=True)
    extra = []
    if tablet and fig == "scribe":
        bpy.context.view_layer.update()
        hp = [rig.matrix_world @ rig.pose.bones[f"hand_{s}"].tail for s in "lr"]
        c = (hp[0] + hp[1]) / 2
        tab = kit.box("tablet", (0.30, 0.21, 0.02), loc=(c.x, c.y + 0.02, c.z - 0.035 + 0.4), material=clay,
                      bevel=0.004)
        tab.keyframe_insert("location", frame=44)
        tab.location.z -= 0.4
        tab.keyframe_insert("location", frame=60)
        cloth.collider(tab)
        extra.append(tab)
    cloth.add_cloth(cob, frames, bending=bending)
    cloth.run(frames)
    body = cloth.bake(ob, fig + "_body", clay)
    tun = cloth.bake(cob, fig + "_cloth", clay)
    belt = belt_for(cob, tun)
    cap = hair.hair_shell(body, scalp, fig + "_hair", clay, style="curls", cell=0.008, amp=0.003)
    for t in extra:
        t.animation_data_clear()
        t.modifiers.clear()
    return [body, tun, belt, cap] + extra, seat, body, scalp


def rung_2():
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    scalp = hair.scalp_verts(ob, rig)
    cob = cloth.make_tunic(ob, rig, fig + "_tunic", clay, hem=spec["hem"])
    final, dz, seat_top = learn_pose(ob, rig, hands=True)
    # simulate once, standing in the rest pose; that settled tunic is the garment for every pose
    cloth.collider(ob)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    cloth.collider(bpy.context.active_object)
    cloth.add_cloth(cob, 40, bending=bending)
    cloth.run(40)
    rest_tun = cloth.bake(cob, fig + "_cloth", clay)
    bpy.context.scene.frame_set(1)
    skin_from(rest_tun, ob, rig)
    set_pose(rig, final)
    bpy.context.view_layer.update()
    _floor, seat = floor_and_seat(seat_top, animate=False)
    body = cloth.bake(ob, fig + "_body", clay)
    tun = cloth.bake(rest_tun, fig + "_cloth_posed", clay)
    belt = belt_for(cob, tun)
    cap = hair.hair_shell(body, scalp, fig + "_hair", clay, style="smooth")
    bpy.data.objects.remove(rest_tun, do_unlink=True)
    return [body, tun, belt, cap], seat, body, scalp


def rung_3():
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    scalp = hair.scalp_verts(ob, rig)
    spec["pose"](rig)
    pts = posed_points(ob)
    rig.location.z += FLOOR - min(p.z for p in pts)
    seat_top = None
    if fig == "scribe":
        seat_top = min(p.z for p in posed_points(ob) if -0.1 < p.y < 0.2 and abs(p.x) < 0.2 and p.z < 0.2)
    bpy.context.view_layer.update()
    robe = robe_loft.robe_for(ob, fig + "_robe", clay)
    _floor, seat = floor_and_seat(seat_top, animate=False)
    body = cloth.bake(ob, fig + "_body", clay)
    rb = cloth.bake(robe, fig + "_robe_b", clay)
    return [body, rb], seat, body, scalp


def rung_4():
    root = kit.figure(fig, spec["standin"], loc=(0, 0, 0), rot_z=math.pi, hat="hair")
    for mb in bpy.data.metaballs:
        mb.resolution = mb.render_resolution  # bake at the quality the overview renders at
    bpy.context.view_layer.update()
    parts = [o for o in root.children]
    # metaballs and parts to plain meshes, so they can be counted and exported like the others
    objs = [cloth.bake(o, o.name + "_m", None) for o in parts]
    for o in parts + [root]:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in objs:
        o.location.z += FLOOR  # undone below with the others
    seat = None
    if fig == "scribe":
        seat = kit.box("seat", (0.42, 0.4, 0.42), loc=(0, 0.06, 0.21 + FLOOR), material=kit.mat("clay_dim"), bevel=0.02)
    return objs, seat, None, None


t0 = time.time()
kit.reset("a", res=res, samples=samples)
clay = kit.mat("clay")
spec = FIGS[fig]
objs, seat, body, scalp = {1: rung_1, 2: rung_2, 3: rung_3, 4: rung_4}[rung]()
print(f"[built] rung {rung} {fig} {time.time() - t0:.0f}s", flush=True)

keep = {o.name for o in objs} | ({seat.name} if seat else set())
for o in list(bpy.context.scene.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
for o in objs + ([seat] if seat else []):
    o.location.z -= FLOOR
if seat:
    seat.animation_data_clear()
    seat.modifiers.clear()
if body is not None and scalp:
    hc = sum((body.data.vertices[i].co for i in scalp), Vector()) / len(scalp) + body.location
else:
    hc = Vector((0, 0, 1.55 if fig == "offer" else (1.15 if fig == "scribe" else 1.3)))
for o in objs:
    if o.name.endswith("_cloth") or o.name.endswith("_cloth_posed"):
        th = o.modifiers.new("thick", "SOLIDIFY")
        th.thickness, th.offset = 0.005, -1.0
        sd = o.modifiers.new("sub", "SUBSURF")
        sd.levels = sd.render_levels = 1

# triangle count as rendered, and as a single web mesh
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
tris_full = 0
for o in objs:
    me = o.evaluated_get(dg).to_mesh()
    tris_full += sum(len(p.vertices) - 2 for p in me.polygons)
    o.evaluated_get(dg).to_mesh_clear()
print(f"[tris] rendered {tris_full}", flush=True)
suffix = ""
if web:
    # bake everything to one mesh with no subdivision, decimate to the target, export GLB
    for o in objs:
        for m in list(o.modifiers):
            if m.type == "SUBSURF" and not o.name.endswith("_hair"):
                o.modifiers.remove(m)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    merged = []
    for o in objs:
        merged.append(cloth.bake(o, o.name + "_w", clay))
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in merged:
        o.select_set(True)
    bpy.context.view_layer.objects.active = merged[0]
    bpy.ops.object.join()
    wob = bpy.context.active_object
    n0 = mh.tri_count(wob)
    dec = wob.modifiers.new("dec", "DECIMATE")
    dec.ratio = min(1.0, web / max(n0, 1))
    bpy.context.view_layer.update()
    bpy.ops.object.modifier_apply(modifier="dec")
    objs = [wob]
    print(f"[web] {n0} -> {mh.tri_count(wob)} triangles", flush=True)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    wob.select_set(True)
    glb = os.path.join(out, f"ladder_r{rung}_{fig}_web.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_materials="NONE", use_selection=True,
                              export_texcoords=False, export_normals=True, export_apply=True)
    suffix = "_web"

kit.island(radius=2.0, depth=0.6, seed=11)
scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
CAMS = {"full": ((0.9, -3.4, 1.15), (0.0, 0.0, 0.85), 50), "side": ((-3.3, -1.0, 1.15), (0.0, 0.0, 0.85), 50)}
for vname in views:
    if vname == "torso":
        tgt = (hc.x, hc.y - 0.05, hc.z - 0.32)
        loc, lens = (tgt[0] + 0.55, tgt[1] - 1.5, tgt[2] + 0.25), 50
    else:
        loc, tgt, lens = CAMS[vname]
    kit.camera(loc, tgt, lens=lens)
    path = os.path.join(out, f"ladder_r{rung}_{fig}_{vname}{suffix}{'_tablet' if tablet else ''}.png")
    kit.render(path)
print(f"[done] rung {rung} {fig} {time.time() - t0:.0f}s")
