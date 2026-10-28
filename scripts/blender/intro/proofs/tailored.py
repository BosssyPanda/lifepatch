"""Tailored clothes on the plaster statues (rung 1 for the eras after 1600): a seated trader in a 1970s suit,
simulated on the pose like the tunic. --sim 0 renders the cut garment on the rest body instead (to check
the cuts before spending a simulation).
"""
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
import scenes  # noqa: E402
import details  # noqa: E402
import tailor  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


out = arg("--out")
fig = arg("--fig", "trader")
res = tuple(int(x) for x in arg("--res", "800x1000").split("x"))
samples = int(arg("--samples", "32"))
frames = int(arg("--frames", "80"))
bending = float(arg("--bending", "1.0"))
bending_max = float(arg("--bending_max", "6.0"))
friction = float(arg("--friction", "0.3"))
shrink = float(arg("--shrink", "-0.07"))  # trousers
shrink_j = float(arg("--shrink_j", "-0.03"))  # jacket
sim = int(arg("--sim", "1"))
web = int(arg("--web", "0"))
views = arg("--views", "full,side").split(",")
tag = arg("--tag", "")
with_details = int(arg("--details", "1"))
FLOOR = -0.818

def pose_merchant(rob):
    """Standing, both hands held forward (handing over or receiving a share), head only slightly bowed so
    the chin stays clear of the ruff."""
    mh.pose_offer(rob)
    mh.aim(rob, "head", (0, -0.12, 1.0))


FIGS = {
    "trader": dict(targets=[("caucasian-male-young", 1.0)], pose=mh.pose_sit_write, seated=True, tablet=True,
                   kind="suit"),
    "merchant": dict(targets=[("caucasian-male-young", 0.6), ("universal-male-old-averagemuscle-averageweight", 0.4)],
                     pose=pose_merchant, seated=False, tablet=False, kind="voc"),
}
spec = FIGS[fig]


def relax_hands(rig):
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
    """Lower the skeleton through the Root bone (see cloth.py: never move the rig object)."""
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def learn_pose(ob, rig):
    spec["pose"](rig)
    relax_hands(rig)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    seat_top = None
    if spec["seated"]:
        seat_top = min(p.z for p in pts if -0.1 < p.y < 0.2 and abs(p.x) < 0.2 and p.z < 0.2) + dz
    drop(rig, dz)
    final = store_pose(rig)
    set_pose(rig)
    return final, seat_top


t0 = time.time()
kit.reset("a", res=res, samples=samples)
clay = kit.mat("clay")
ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
cloth.tpose_rest(ob, rig, down=0.45)
scalp = hair.scalp_verts(ob, rig)
kind = spec["kind"]
cob, L = tailor.suit(ob, rig, fig + "_suit", clay, kind=kind)
sob = None
if kind == "suit":
    sob = tailor.shirt(ob, L, clay)
    tailor.skin(sob, ob, rig)
strips, shoes, rigid = [], None, []
ssurf = None
if with_details and kind == "voc":
    nt = cob["n_trousers"]
    me = cob.data
    basis = [d.co.copy() for d in me.shape_keys.key_blocks["Basis"].data]
    jsurf = details.Surface(basis, [list(p.vertices) for p in me.polygons if min(p.vertices) >= nt])
    z = L["neck"] - 0.05
    while z > L["waist"] - 0.01:
        strips.append(details.Strip(f"button{len(strips)}", jsurf, details.disc(jsurf, 0.0, z, 0.008, lift=0.003),
                                    thick=0.0))
        z -= 0.034
    for s_ in "lr":
        hand, d = L["wrist"][s_]
        strips.append(details.Strip(f"cuff_{s_}", jsurf, details.band(jsurf, [basis[i] for i in cob[f"cuff_{s_}"]], -d),
                                    closed=True))
    rigid.append(details.ruff(ob, L, clay, rig))
    rigid.append(details.hat(ob, L, clay, rig))
    shoes = details.shoes(ob, L, clay)
    tailor.skin(shoes, ob, rig)
if with_details and kind == "suit":
    nt = cob["n_trousers"]
    me = cob.data
    basis = [d.co.copy() for d in me.shape_keys.key_blocks["Basis"].data]
    jsurf = details.Surface(basis, [list(p.vertices) for p in me.polygons if min(p.vertices) >= nt])
    ssurf = details.surface_of(sob)
    for n, g in enumerate(details.lapels(jsurf, L)):
        strips.append(details.Strip(f"lapel{n}", jsurf, g))
    neck_pts = [basis[i] for i in cob["neck_idx"]]
    strips.append(details.Strip("collar", jsurf, details.collar(jsurf, L, neck_pts)))
    bz = L["button"]
    for sx in (1, -1):
        strips.append(details.Strip(f"pocket{sx}", jsurf, details.patch(jsurf, sx * 0.115, bz - 0.105, 0.15, 0.05, lift=0.003)))
    strips.append(details.Strip("breast", jsurf, details.patch(jsurf, 0.125, 0.40, 0.085, 0.022, lift=0.002, tilt=0.12)))
    strips.append(details.Strip("button", jsurf, details.disc(jsurf, 0.0, bz, 0.011), closed=False, thick=0.0))
    shirt_top = max(v.co.z for v in sob.data.vertices if abs(v.co.x) < 0.02 and v.co.y < L["cy"])
    strips.append(details.Strip("tie", ssurf, details.tie(ssurf, L, shirt_top - 0.008, bz - 0.03)))
    for n, g in enumerate(details.collar_points(ssurf, L, shirt_top)):
        strips.append(details.Strip(f"point{n}", ssurf, g))
    shoes = details.shoes(ob, L, clay)
    tailor.skin(shoes, ob, rig)
print(f"[cut] {time.time() - t0:.0f}s", flush=True)

objs, seat = [], None
if not sim:
    objs = [o for o in (ob, cob, sob, shoes) if o] + rigid
    objs += [st.build(None, None, clay, rest=True) for st in strips]
    for o in objs:
        o.location.z -= FLOOR
else:
    final, seat_top = learn_pose(ob, rig)
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob, friction=friction)
    if sob:
        cloth.collider(sob, outer=0.002, friction=friction)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    cloth.collider(bpy.context.active_object)
    extra = []
    if seat_top is not None:
        top = seat_top - 0.012  # room for the cloth under the seat bones
        # a stool under the seat bones only, so the jacket's back skirt can fall behind it
        seat = kit.box("seat", (0.44, 0.30, 0.6), loc=(0, 0.0, top - 0.3), material=kit.mat("clay_dim"), bevel=0.02)
        seat.location.z -= 0.8
        seat.keyframe_insert("location", frame=34)
        seat.location.z += 0.8
        seat.keyframe_insert("location", frame=52)
        cloth.collider(seat, friction=friction)
    if spec["tablet"]:
        bpy.context.view_layer.update()
        set_pose(rig, final)
        bpy.context.view_layer.update()
        hp = [rig.matrix_world @ rig.pose.bones[f"hand_{s}"].tail for s in "lr"]
        set_pose(rig)
        bpy.context.scene.frame_set(1)
        c = (hp[0] + hp[1]) / 2
        tab = kit.box("tablet", (0.30, 0.21, 0.02), loc=(c.x, c.y + 0.02, c.z - 0.035 + 0.4), material=clay,
                      bevel=0.004)
        tab.keyframe_insert("location", frame=44)
        tab.location.z -= 0.4
        tab.keyframe_insert("location", frame=60)
        cloth.collider(tab)
        extra.append(tab)
    cloth.add_cloth(cob, frames, bending=bending, mass=0.3, quality=10, tension=25.0, shear=10.0, shrink=shrink,
                    stiff_group="stiff", bending_max=bending_max, shrink_max=shrink_j)
    cloth.run(frames)
    body = cloth.bake(ob, fig + "_body", clay)
    suit_b = cloth.bake(cob, fig + "_cloth", clay)
    shirt_b = cloth.bake(sob, fig + "_shirt", clay) if sob else None
    cap = hair.hair_shell(body, scalp, fig + "_hair", clay, style="smooth")
    for t in extra:
        t.animation_data_clear()
        t.modifiers.clear()
    objs = [o for o in (body, suit_b, shirt_b, cap) if o] + extra
    if with_details:
        jp, jn = details.posed_of(suit_b)
        sp, sn = details.posed_of(shirt_b) if shirt_b else (None, None)
        for st in strips:
            objs.append(st.build(sp, sn, clay) if st.surf is ssurf else st.build(jp, jn, clay))
        objs.append(cloth.bake(shoes, fig + "_shoes", clay))
        objs += [cloth.bake(o, o.name + "_b", clay) for o in rigid]
    keep = {o.name for o in objs} | ({seat.name} if seat else set())
    for o in list(bpy.context.scene.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in objs + ([seat] if seat else []):
        o.location.z -= FLOOR
    if seat:
        seat.animation_data_clear()
        seat.modifiers.clear()
    th = suit_b.modifiers.new("thick", "SOLIDIFY")
    th.thickness, th.offset = 0.004, -1.0
    sd = suit_b.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
print(f"[built] {time.time() - t0:.0f}s", flush=True)
if sim:
    # keep the baked figure, so renders and web exports can be redone without simulating again
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out, f"tailor_{fig}{tag}.blend")))

kit.island(radius=2.0, depth=0.6, seed=11)
scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
CAMS = {"full": ((0.9, -3.4, 1.15), (0.0, 0.0, 0.85), 50), "side": ((-3.3, -1.0, 1.15), (0.0, 0.0, 0.85), 50),
        "back": ((-0.9, 3.4, 1.15), (0.0, 0.0, 0.85), 50), "torso": ((0.5, -1.9, 1.3), (0.0, -0.05, 1.05), 50),
        "torso_back": ((-0.5, 1.9, 1.2), (0.0, 0.0, 0.95), 50),
        "seat_back": ((-0.15, 1.0, 0.95), (0.0, 0.05, 0.8), 50)}
for vname in views:
    loc, tgt, lens = CAMS[vname]
    kit.camera(loc, tgt, lens=lens)
    kit.render(os.path.join(out, f"tailor_{fig}_{'rest' if not sim else 'sim'}_{vname}{tag}.png"))

if web and sim:
    # the web version: everything (seat and island aside) baked to one mesh, decimated, exported as GLB
    figure = [o for o in objs if o.type == "MESH"]
    dg = bpy.context.evaluated_depsgraph_get()
    merged = [cloth.bake(o, o.name + "_w", clay) for o in figure]
    for o in figure:
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
    bpy.ops.object.modifier_apply(modifier="dec")
    print(f"[web] {n0} -> {mh.tri_count(wob)} triangles", flush=True)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    wob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"tailor_{fig}{tag}_web.glb"), export_format="GLB",
                              export_materials="NONE", use_selection=True, export_texcoords=False,
                              export_normals=True, export_apply=True)
    for vname in ("full", "side"):
        loc, tgt, lens = CAMS[vname]
        kit.camera(loc, tgt, lens=lens)
        kit.render(os.path.join(out, f"tailor_{fig}_sim_{vname}{tag}_web.png"))
print(f"[done] {time.time() - t0:.0f}s")
