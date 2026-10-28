"""The paper money scene's three statues, built at rung 1 of the figure ladder (cloth simulated per pose):

  official   behind the counter, Song official's hat with long stiff wings, long robe with wide sleeves,
             a stiff belt, boots; holds the new note out in both hands
  depositor  in front of the counter, soft cap, long robe with narrower sleeves, cord belt, shoes;
             reaches for the note with both hands
  porter     short tunic to the knee with elbow sleeves, cord belt, bamboo hat, straw-shoe stand-ins;
             a carrying pole on his right shoulder, right hand on the pole

Each figure is built at the origin facing -Y (MakeHuman's frame), simulated, baked to static meshes and
saved to <out>/<fig>.blend, so the scene can be laid out and re-rendered without simulating again. The
pose also records where the hands and the shoulder ended up (custom properties on the body), which the
scene uses to put the note in the official's hands and the pole on the porter's shoulder.

    python scripts/blender/intro/paper/figures.py --out DIR --fig official [--views front,side --res 800x1000]

Needs MPFB_DATA (see ../proofs/README.md).
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, os.path.join(INTRO, "proofs"), INTRO]

import bpy  # noqa: E402  (first: it puts bmesh and mathutils on the path)
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import cloth  # noqa: E402
import details  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import tailor  # noqa: E402

FLOOR = -0.818  # MakeHuman's soles in rest units
# Song men's caps were black gauze; in the LEDGER look that is a dark neutral grey (DESIGN.md: clay and
# rock are neutral greys; only the money may be gold)
HAT_TONE = "#46423d"


# ------------------------------------------------------------------------------------------------ posing

def ik_arm(rig, side, target, pole):
    """Aim upper and lower arm so the wrist lands on target, the elbow bending toward pole (world points;
    the rig sits at the origin unrotated, so armature space is world space)."""
    bpy.context.view_layer.update()
    b = rig.pose.bones
    s = b[f"upperarm_{side}"].head.copy()
    l1 = rig.data.bones[f"upperarm_{side}"].length
    l2 = rig.data.bones[f"lowerarm_{side}"].length
    t = Vector(target)
    d = t - s
    dist = min(d.length, (l1 + l2) * 0.995)
    d.normalize()
    # elbow on the circle where the two bones meet, on the pole's side
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    p = Vector(pole) - s
    p = (p - d * p.dot(d)).normalized()
    e = s + d * a + p * h
    mh.aim(rig, f"upperarm_{side}", e - s)
    mh.aim(rig, f"lowerarm_{side}", s + d * dist - e)


def relax_hands(rig, grip=None):
    """Fingers gently curled (the ladder's relaxed hands); grip = sides that close round a pole."""
    for s, sx in (("l", 1), ("r", -1)):
        g = grip and s in grip
        for f, base, spread in (("index", 0.21, -0.06), ("middle", 0.27, 0.0), ("ring", 0.36, 0.06),
                                ("pinky", 0.47, 0.12)):
            for k in ("01", "02", "03"):
                pb = rig.pose.bones[f"{f}_{k}_{s}"]
                pb.rotation_mode = "XYZ"
                amt = (1.25 if g else base) * (0.6 if k == "01" else 1.0)
                pb.rotation_euler = (amt, 0, spread * sx if k == "01" and not g else 0)
        for k, a in (("01", 0.1), ("02", 0.2), ("03", 0.25)):
            pb = rig.pose.bones[f"thumb_{k}_{s}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (a * (2.5 if g else 1.0), 0, 0)


def pose_present(rig):
    """The official: both hands forward over the counter, palms up, the note across the fingers."""
    for s, sx in (("l", 1), ("r", -1)):
        ik_arm(rig, s, (0.10 * sx, -0.36, 0.215), (0.45 * sx, 0.1, -0.4))
        mh.twist(rig, f"lowerarm_{s}", mh.PALM_UP * sx * 0.85)
        mh.aim(rig, f"hand_{s}", (-0.15 * sx, -1.0, 0.05))
    mh.aim(rig, "spine_03", (0, -0.12, 1))
    mh.aim(rig, "head", (0, -0.55, 1.0))


def pose_receive(rig):
    """The depositor: leaning in over the counter, reaching forward with both hands, palms up, a little closer
    together. He stands on the street, so the counter's depth has to be bridged by the lean and the reach."""
    mh.aim(rig, "spine_02", (0, -0.15, 1))
    mh.aim(rig, "spine_03", (0, -0.3, 1))
    for s, sx in (("l", 1), ("r", -1)):
        ik_arm(rig, s, (0.075 * sx, -0.53, 0.255), (0.45 * sx, 0.1, -0.35))
        mh.twist(rig, f"lowerarm_{s}", mh.PALM_UP * sx)
        mh.aim(rig, f"hand_{s}", (-0.1 * sx, -1.0, 0.12))
    mh.aim(rig, "head", (0, -0.6, 1.0))


def pose_carry(rig):
    """The porter: a pole on the right shoulder running fore and aft, the right hand on it in front of the
    shoulder, the left arm hanging easy. Leans a little into the load."""
    mh.aim(rig, "spine_01", (0.0, -0.05, 1))
    mh.aim(rig, "spine_03", (0.04, -0.08, 1))
    bpy.context.view_layer.update()
    sh = rig.pose.bones["upperarm_r"].head
    ik_arm(rig, "r", (sh.x + 0.03, sh.y - 0.31, sh.z + 0.05), (sh.x - 0.4, sh.y + 0.1, sh.z - 0.6))
    mh.twist(rig, "lowerarm_r", 1.2)
    mh.aim(rig, "hand_r", (0.0, -1.0, 0.3))
    mh.aim(rig, "upperarm_l", (0.12, -0.12, -1.0))
    mh.aim(rig, "lowerarm_l", (0.02, -0.35, -1.0))
    mh.aim(rig, "hand_l", (0.0, -0.2, -1.0))
    mh.aim(rig, "head", (-0.1, -0.12, 1.0))     # looking ahead up the street, chin clear of the pole


# ------------------------------------------------------------------------------------------------ garments

def pin_armhole_backs(ob, rig, cob, top=0.10):
    """Pin the back edge of each of the tunic's arm holes onto the skin behind the shoulder. Free, that edge
    hung straight down while arms reaching forward pulled the sleeve root away from it, and a dark slit
    opened behind the armpit; pinned, it rides forward with the arm and the back panel stretches across
    the shoulder blade, as cloth does when you reach."""
    tree, _bm = cloth._bvh(ob)
    _bm.free()
    bones = rig.data.bones
    sh = bones["upperarm_l"].head_local
    cy = (bones["spine_01"].head_local.y + bones["spine_02"].head_local.y) / 2
    lo, hi = sh.z - 0.13 + 0.015, sh.z + top - 0.03
    me = cob.data
    uses = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            uses[ek] = uses.get(ek, 0) + 1
    edge_verts = {i for ek, n in uses.items() if n == 1 for i in ek}
    key = me.shape_keys.key_blocks["cinch"]
    pg = cob.vertex_groups["pin"]
    n = 0
    for i in edge_verts:
        co = me.vertices[i].co
        if abs(co.x) > 0.19 and lo < co.z < hi and co.y > cy:
            loc, nor, _i, _d = tree.find_nearest(co)
            if loc is None:
                continue
            key.data[i].co = loc + nor.normalized() * 0.014
            pg.add([i], 1.0, "REPLACE")
            n += 1
    print(f"[tunic] pinned {n} arm-hole back-edge vertices", flush=True)


def sleeves(ob, rig, cob, material, r0=0.075, r1=0.14, reach=1.0, around=40, step=0.018):
    """Sleeves for the tunic, built round each arm in the T-pose rest and joined into the tunic's mesh (one
    object, so its self-collision keeps sleeve and body cloth apart). Each is a tube hanging from a line
    pinned along the top of the arm: the inner end slants from the shoulder top to just outside the armpit
    so it overlaps the tunic's arm hole, the cuff widens to r1 (wide sleeves hang in a deep curve below the
    forearm when it comes forward). reach: 1 = to the wrist, ~0.55 = just past the elbow."""
    tree, _bm = cloth._bvh(ob)
    _bm.free()
    bones = rig.data.bones
    tgt_pins = {}
    bm = bmesh.new()
    rows_all = []
    for s, sx in (("l", 1), ("r", -1)):
        sh = bones[f"upperarm_{s}"].head_local
        wr = bones[f"hand_{s}"].head_local
        y0, z0 = sh.y, sh.z
        x_cuff = sh.x + (wr.x - sh.x) * reach - sx * 0.005
        n = int(abs(x_cuff - sx * 0.12) / step) + 1
        rows = []
        for j in range(n + 1):
            u = j / n
            r = r0 + (r1 - r0) * u ** 1.3
            row = []
            for k in range(around):
                th = k / around * math.tau            # 0 = top of the arm
                x_in = sx * (0.12 + 0.10 * (1 - math.cos(th)) / 2)
                x = x_in + (x_cuff - x_in) * u
                # top of the arm at this x: ray down onto the skin
                hit, _n, _i, _d = tree.ray_cast(Vector((x, y0, z0 + 0.3)), Vector((0, 0, -1)), 1.0)
                top = (hit.z if hit is not None else z0 + 0.05) + 0.02
                c = Vector((x, y0, top - r))
                p = c + Vector((0.0, math.sin(th) * r, math.cos(th) * r))
                row.append(bm.verts.new(p))
            rows.append(row)
        for j in range(n):
            for k in range(around):
                a, b = rows[j][k], rows[j][(k + 1) % around]
                c, d = rows[j + 1][(k + 1) % around], rows[j + 1][k]
                bm.faces.new((a, b, c, d) if sx > 0 else (d, c, b, a))
        rows_all.append((s, rows))
    bm.verts.index_update()
    # pins: the top line along the arm, and the whole inner end with the next ring under the arm. Pinning only
    # the upper half let the back of the root pull away when the arms came forward, opening a dark slit
    # between sleeve and tunic behind the armpit.
    for s, rows in rows_all:
        for j, row in enumerate(rows):
            for k, v in enumerate(row):
                th = k / around * math.tau
                top = min(th, math.tau - th) < 1.6 * math.tau / around
                inner = j == 0 or (j == 1 and math.cos(th) < 0.2)
                if top or inner:
                    tgt_pins[v.index] = v.co.copy()
    # push everything clear of the skin (the cuff can be narrower than the forearm's muscle)
    for v in bm.verts:
        loc, nor, _i, dist = tree.find_nearest(v.co)
        if loc is not None and (dist < 0.012 or (v.co - loc).dot(nor) < 0):
            v.co = loc + nor.normalized() * 0.012
    me = bpy.data.meshes.new("sleeves")
    bm.to_mesh(me)
    bm.free()
    sob = bpy.data.objects.new("sleeves", me)
    bpy.context.scene.collection.objects.link(sob)
    me.materials.append(material)
    sob.shape_key_add(name="Basis")
    sob.shape_key_add(name="cinch")
    # weights from the nearest body vertex: the pins ride the arm; the inner end the shoulder girdle
    from mathutils.kdtree import KDTree
    bme = ob.data
    used = sorted({i for p in bme.polygons for i in p.vertices})
    kd = KDTree(len(used))
    for i in used:
        kd.insert(ob.matrix_world @ bme.vertices[i].co, i)
    kd.balance()
    gnames = {g.index: g.name for g in ob.vertex_groups}
    vgs = {}
    for v in me.vertices:
        _co, bi, _d = kd.find(v.co)
        for g in bme.vertices[bi].groups:
            nm = gnames[g.group]
            if nm not in vgs:
                vgs[nm] = sob.vertex_groups.new(name=nm)
            vgs[nm].add([v.index], g.weight, "REPLACE")
    pg = sob.vertex_groups.new(name="pin")
    pg.add(list(tgt_pins), 1.0, "REPLACE")
    # join into the tunic (shape keys and vertex groups match by name)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    sob.select_set(True)
    cob.select_set(True)
    bpy.context.view_layer.objects.active = cob
    bpy.ops.object.join()
    return cob


# ------------------------------------------------------------------------------------------------ hats

def _head_frame(rig):
    """Matrix taking rest-pose points on the head to their posed place."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones["head"]
    return rig.matrix_world @ pb.matrix @ rig.data.bones["head"].matrix_local.inverted()


def _head_dims(ob):
    """Rest-pose head: crown top, brow height, front/back/sides at the brow (vertices weighted to the head)."""
    hg = ob.vertex_groups["head"].index
    used = {i for p in ob.data.polygons for i in p.vertices}
    pts = [v.co.copy() for v in ob.data.vertices if v.index in used
           and any(g.group == hg and g.weight > 0.6 for g in v.groups)]
    top = max(p.z for p in pts)
    brow = top - 0.085
    band = [p for p in pts if abs(p.z - brow) < 0.01]
    return dict(top=top, brow=brow,
                front=min(p.y for p in band), back=max(p.y for p in band),
                half=max(abs(p.x) for p in band),
                cy=(min(p.y for p in band) + max(p.y for p in band)) / 2)


def _apply_mods(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def _lofted_cap(ob, H, name, material, margin=0.014, back_drop=0.05, lift_front=0.012, n=48):
    """A cap that sits on the skull: horizontal slices of the rest-pose head (convex hull of each, pushed
    out by margin) lofted from below the ears to a rounded crown, then cut along a line that runs from just
    above the brow at the front down by back_drop at the nape."""
    import numpy as np
    import robe_loft
    hg = ob.vertex_groups["head"].index
    used = {i for p in ob.data.polygons for i in p.vertices}
    P = np.array([tuple(v.co) for v in ob.data.vertices if v.index in used
                  and any(g.group == hg and g.weight > 0.6 for g in v.groups)])
    P = P[np.abs(P[:, 0]) < H["half"] + 0.004]   # leave the ears out
    z_lo = H["brow"] - back_drop - 0.02
    rings = []
    for z in np.linspace(z_lo, H["top"] - 0.004, 12):
        sl = P[np.abs(P[:, 2] - z) < 0.006][:, :2]
        if len(sl) < 6:
            continue
        hp = robe_loft.hull(sl)
        c = np.array(hp).mean(axis=0)
        rings.append((z, c, robe_loft.ring(hp, c, n, margin)))
    z_t, c_t, r_t = rings[-1]
    for dz, k in ((0.012, 0.86), (0.022, 0.56)):
        rings.append((z_t + dz, c_t, [c_t + (p - c_t) * k for p in r_t]))
    bm = bmesh.new()
    vr = [[bm.verts.new((x, y, z)) for x, y in r] for z, c, r in rings]
    for a, b in zip(vr, vr[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    top = bm.verts.new((c_t[0], c_t[1], z_t + 0.027))
    for k in range(n):
        bm.faces.new((vr[-1][k], vr[-1][(k + 1) % n], top))
    dy = H["back"] - H["front"]
    no = Vector((0.0, -back_drop, -dy)).normalized()
    co = Vector((0.0, H["front"], H["brow"] + lift_front))
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co,
                           plane_no=no, clear_outer=True)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cap = kit.from_bmesh(name, bm, material)
    sm = cap.modifiers.new("smooth", "SMOOTH")
    sm.factor, sm.iterations = 0.6, 4
    so = cap.modifiers.new("thick", "SOLIDIFY")
    so.thickness, so.offset = 0.005, -1.0
    sd = cap.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 2
    return _apply_mods(cap)


def futou(ob, rig, material, wings=0.30):
    """The Song official's hat (zhanjiao futou): a stiff dark cap over the skull, a taller squarish back
    over the topknot, and two long straight stiff wings standing out level from its back."""
    H = _head_dims(ob)
    cap = _lofted_cap(ob, H, "futou", material, margin=0.016, back_drop=0.06)
    tier = kit.box("futou_tier", (0.104, 0.082, 0.075), loc=(0, H["cy"] + 0.028, H["top"] + 0.012),
                   material=material, bevel=0.03)
    parts = [cap, _apply_mods(tier)]
    wy = H["back"] + 0.004
    wz = H["top"] - 0.04
    for sx in (1, -1):
        bm = bmesh.new()
        n = 12
        prev = None
        for i in range(n + 1):
            t = i / n
            x = sx * (0.04 + wings * t)
            w = 0.022 + 0.01 * t
            ring = [bm.verts.new((x, wy + dy, wz + dz)) for dy, dz in
                    ((-0.002, -w / 2), (0.002, -w / 2), (0.002, w / 2), (-0.002, w / 2))]
            if prev:
                for k in range(4):
                    bm.faces.new((prev[k], prev[(k + 1) % 4], ring[(k + 1) % 4], ring[k]))
            else:
                bm.faces.new(ring[::-1])
            prev = ring
        bm.faces.new(prev)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        wob = kit.from_bmesh(f"wing{sx}", bm, material, smooth=False)
        bev = wob.modifiers.new("bev", "BEVEL")
        bev.width, bev.segments = 0.0012, 2
        parts.append(_apply_mods(wob))
    return _to_head(parts, rig, "hat")


def soft_cap(ob, rig, material):
    """The depositor's soft wrapped cap (an unstiffened futou): the cap over the skull and a rounded knot of
    cloth over the topknot."""
    H = _head_dims(ob)
    cap = _lofted_cap(ob, H, "softcap", material, margin=0.011, back_drop=0.075)
    knot = kit.box("softcap_knot", (0.085, 0.075, 0.055), loc=(0, H["cy"] + 0.025, H["top"] + 0.006),
                   material=material, bevel=0.026)
    # (the two ties that hang at the nape stood out like feelers on a bowed head, so they are left off)
    parts = [cap, _apply_mods(knot)]
    return _to_head(parts, rig, "hat")


def bamboo_hat(ob, rig, material, r=0.25, rise=0.13):
    """A conical bamboo hat: a shallow cone with a knob at the top and an inner band that sits on the
    crown. Woven texture comes from the material (radial grooves)."""
    H = _head_dims(ob)
    seat = H["top"] - 0.02
    bm = bmesh.new()
    segs, rings = 64, 14
    apex = seat + rise
    rim_z = seat + rise - rise * 1.0 - 0.02
    grid = []
    for j in range(1, rings + 1):
        t = j / rings
        rr = r * t
        z = apex - (apex - rim_z) * (t ** 0.85)
        grid.append([bm.verts.new((rr * math.cos(a), H["cy"] + rr * math.sin(a), z))
                     for a in (k / segs * math.tau for k in range(segs))])
    top = bm.verts.new((0, H["cy"], apex))
    for k in range(segs):
        bm.faces.new((top, grid[0][k], grid[0][(k + 1) % segs]))
    for j in range(rings - 1):
        for k in range(segs):
            bm.faces.new((grid[j][k], grid[j + 1][k], grid[j + 1][(k + 1) % segs], grid[j][(k + 1) % segs]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    hat = kit.from_bmesh("douli", bm, material)
    so = hat.modifiers.new("thick", "SOLIDIFY")
    so.thickness, so.offset = 0.006, -1.0
    hat = _apply_mods(hat)
    knob = kit.sphere("douli_knob", 0.018, loc=(0, H["cy"], apex + 0.006), scale=(1, 1, 0.7), material=material,
                      subdiv=2)
    band = kit.cyl("douli_band", 0.083, 0.05, loc=(0, H["cy"] + 0.005, seat + 0.03), material=material, segs=32)
    return _to_head([hat, _apply_mods(knob), _apply_mods(band)], rig, "hat")


def _curve_to_mesh(cu):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(cu.evaluated_get(dg), depsgraph=dg)
    ob = bpy.data.objects.new(cu.name + "_m", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = cu.matrix_world
    me.materials.clear()
    me.materials.append(cu.data.materials[0] if cu.data.materials else None)
    bpy.data.objects.remove(cu, do_unlink=True)
    return ob


def _to_head(parts, rig, name):
    """Join hat parts (built in rest-pose head space) and carry them to the posed head."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    hob = bpy.context.active_object
    hob.name = name
    hob["_head_space"] = True
    return hob


# ------------------------------------------------------------------------------------------------ figures

FIGS = {
    "official": dict(targets=[("asian-male-old", 0.7), ("asian-male-young", 0.3)], pose=pose_present,
                     hem=0.07, sleeve=dict(r0=0.08, r1=0.15, reach=1.0), hat=futou, belt="band",
                     shoes=True),
    "depositor": dict(targets=[("asian-male-young", 1.0)], pose=pose_receive,
                      hem=0.09, sleeve=dict(r0=0.075, r1=0.115, reach=1.0), hat=soft_cap, belt="cord",
                      shoes=True),
    "porter": dict(targets=[("asian-male-young", 1.0), ("universal-male-young-maxmuscle-minweight", 0.5)],
                   pose=pose_carry, hem=0.36, sleeve=dict(r0=0.07, r1=0.08, reach=0.55), hat=bamboo_hat,
                   belt="cord", shoes=False),
}


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
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def belt(cob, garment, kind, material):
    """A belt over the tunic's pinned waist ring: a cord, or the official's stiff flat band."""
    pg = cob.vertex_groups["pin"].index
    basis = cob.data.shape_keys.key_blocks["Basis"].data
    ring = [v.index for v in cob.data.vertices if any(g.group == pg for g in v.groups)
            and abs(basis[v.index].co.z - cob["waist_z"]) < 0.02]
    pts = [garment.data.vertices[i].co.copy() for i in sorted(ring)]
    c = sum(pts, Vector()) / len(pts)
    # order round the waist by angle (vertex order is round the tube already, but be safe)
    pts.sort(key=lambda p: math.atan2(p.y - c.y, p.x - c.x))
    if kind == "cord":
        pts = [p + ((p - c) * Vector((1, 1, 0))).normalized() * 0.008 for p in pts]
        return kit.curve_tube("belt", pts, 0.011, material=material, closed=True)
    bm = bmesh.new()
    lo, hi = [], []
    for p in pts:
        o = ((p - c) * Vector((1, 1, 0))).normalized()
        q = p + o * 0.012
        lo.append(bm.verts.new(q - Vector((0, 0, 0.022))))
        hi.append(bm.verts.new(q + Vector((0, 0, 0.022))))
    n = len(pts)
    for k in range(n):
        bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bob = kit.from_bmesh("belt", bm, material)
    so = bob.modifiers.new("thick", "SOLIDIFY")
    so.thickness, so.offset = 0.008, 1.0
    sd = bob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    return bob


def build(fig, frames=75, bending=0.3):
    """Simulate and bake one figure. Returns {part name: object} in world space, soles at z = 0."""
    spec = FIGS[fig]
    t0 = time.time()
    clay = kit.mat("clay")
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    scalp = hair.scalp_verts(ob, rig)
    L = tailor.landmarks(ob, rig)
    cob = cloth.make_tunic(ob, rig, fig + "_tunic", clay, hem=spec["hem"])
    if spec.get("pin_back", True):
        pin_armhole_backs(ob, rig, cob)
    if spec["sleeve"]:
        cob = sleeves(ob, rig, cob, clay, **spec["sleeve"])
    shoes = None
    if spec["shoes"]:
        shoes = details.shoes(ob, L, clay)
        tailor.skin(shoes, ob, rig)
    hat = spec["hat"](ob, rig, kit.mat("clay", tone=HAT_TONE) if spec["hat"] is not bamboo_hat else clay)
    # learn the pose: drop to the floor, then back to rest for the simulation's start
    spec["pose"](rig)
    relax_hands(rig, grip="r" if fig == "porter" else None)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    drop(rig, dz)
    final = store_pose(rig)
    set_pose(rig)
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    floor = bpy.context.active_object
    cloth.collider(floor)
    cloth.add_cloth(cob, frames, bending=bending)
    print(f"[{fig}] cut {time.time() - t0:.0f}s, simulating", flush=True)
    cloth.run(frames)
    head = _head_frame(rig)
    hands = {s: rig.matrix_world @ rig.pose.bones[f"hand_{s}"].tail for s in "lr"}
    palms = {s: rig.matrix_world @ rig.pose.bones[f"middle_01_{s}"].head for s in "lr"}
    shoulder_r = rig.matrix_world @ rig.pose.bones["upperarm_r"].head
    body = cloth.bake(ob, fig + "_body", clay)
    tun = cloth.bake(cob, fig + "_cloth", clay)
    parts = {"body": body, "cloth": tun}
    parts["belt"] = belt(cob, tun, spec["belt"], clay)
    if spec["hat"] is bamboo_hat:
        # under the caps the hair is tied up out of sight (a shell there only pokes through the cap)
        parts["hair"] = hair.hair_shell(body, scalp, fig + "_hair", clay, style="smooth")
    if shoes:
        parts["shoes"] = cloth.bake(shoes, fig + "_shoes", clay)
    hat.matrix_world = head @ hat.matrix_world
    parts["hat"] = hat
    for o in (ob, cob, rig, floor) + ((shoes,) if shoes else ()):
        bpy.data.objects.remove(o, do_unlink=True)
    for k, o in parts.items():
        o.location.z -= FLOOR
        o.name = f"{fig}_{k}"
    lift = Vector((0, 0, -FLOOR))
    body["hand_l"], body["hand_r"] = tuple(hands["l"] + lift), tuple(hands["r"] + lift)
    body["palm_l"], body["palm_r"] = tuple(palms["l"] + lift), tuple(palms["r"] + lift)
    body["shoulder_r"] = tuple(shoulder_r + lift)
    for o in parts.values():
        o["figure"] = fig
    print(f"[{fig}] built {time.time() - t0:.0f}s", flush=True)
    return parts


def finish(parts):
    """Thickness and smoothing on the cloth (as the ladder renders it)."""
    tun = parts["cloth"]
    th = tun.modifiers.new("thick", "SOLIDIFY")
    th.thickness, th.offset = 0.005, -1.0
    sd = tun.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1


def save(parts, path):
    bpy.context.view_layer.update()
    bpy.data.libraries.write(path, set(parts.values()), fake_user=True)


def load(path, fig):
    """Append a saved figure; returns {part: object} linked into the scene."""
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [n for n in src.objects]
    parts = {}
    for o in dst.objects:
        bpy.context.scene.collection.objects.link(o)
        parts[o.name.split("_", 1)[1] if o.name.startswith(fig + "_") else o.name] = o
    return parts


def _arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


if __name__ == "__main__":
    out = _arg("--out")
    fig = _arg("--fig", "official")
    res = tuple(int(x) for x in _arg("--res", "800x1000").split("x"))
    samples = int(_arg("--samples", "32"))
    views = [v for v in _arg("--views", "front,side").split(",") if v]
    os.makedirs(out, exist_ok=True)
    kit.reset("a", res=res, samples=samples)
    parts = build(fig, frames=int(_arg("--frames", "75")))
    save(parts, os.path.join(out, f"{fig}.blend"))
    finish(parts)
    import scenes  # noqa: E402
    kit.island(radius=2.0, depth=0.6, seed=11)
    scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
    cams = {"front": ((0.9, -3.4, 1.15), (0.0, 0.0, 0.85)), "side": ((-3.3, -1.0, 1.15), (0.0, 0.0, 0.85)),
            "back": ((-0.9, 3.4, 1.15), (0.0, 0.0, 0.85)),
            "head": ((0.5, -1.4, 1.75), (0.0, 0.0, 1.45))}
    for v in views:
        loc, tgt = cams[v]
        kit.camera(loc, tgt, lens=50 if v != "head" else 70)
        kit.render(os.path.join(out, f"{fig}_{v}.png"))
