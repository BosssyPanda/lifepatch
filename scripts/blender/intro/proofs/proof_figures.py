"""Render the figure proof: today's metaball stand-in beside posed CC0 MakeHuman bodies, LEDGER look."""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]  # proofs/ and the intro kit beside it

import bpy  # noqa: E402

import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import scenes  # noqa: E402

out = sys.argv[sys.argv.index("--out") + 1]
res = tuple(int(x) for x in sys.argv[sys.argv.index("--res") + 1].split("x")) if "--res" in sys.argv else (1280, 800)
samples = int(sys.argv[sys.argv.index("--samples") + 1]) if "--samples" in sys.argv else 32
variant = sys.argv[sys.argv.index("--variant") + 1] if "--variant" in sys.argv else "lineup"

t0 = time.time()
kit.reset("a", res=res, samples=samples)
kit.island(radius=4.0, depth=0.6, seed=11)
clay = kit.mat("clay")
stats = []


def mh_fig(name, targets, pose, loc, rot_z, keep=("body", "helper-l-eye", "helper-r-eye"), robe=False):
    ob, rob = mh.build(name, targets=targets, groups_keep=keep, material=clay, robe=robe)
    pose(rob)
    mh.ground(ob, rob, 0.0)
    rob.location.x += loc[0]
    rob.location.y += loc[1]
    rob.rotation_euler = (0, 0, rot_z)
    stats.append((name, mh.tri_count(ob)))
    return ob, rob


if variant == "lineup":
    # 1: today's stand-in, for comparison (kit figures face +Y; turn to the camera)
    kit.figure("standin", "give", loc=(-1.9, 0.2, 0), rot_z=math.pi, hat="hair")
    # 2: offer, male body
    mh_fig("mh_offer_m", [("caucasian-male-young", 1.0)], mh.pose_offer, (-0.85, 0.1), 0.25, robe=True)
    # 3: offer, female body, with MakeHuman's own long-skirt helper as a robe test
    mh_fig("mh_offer_f", [("caucasian-female-young", 1.0)], mh.pose_offer, (0.05, 0.35), -0.2, robe=True)
    # 4: seated scribe on a block
    kit.box("block", (0.42, 0.4, 0.44), loc=(0.95, 0.55, 0.22), material=kit.mat("clay_dim"), bevel=0.02)
    ob, rob = mh_fig("mh_scribe", [("asian-male-old", 1.0)], mh.pose_sit_write, (0.95, 0.42), 0.0, robe=True)
    # 5: Atlas kneeling under a sphere
    ob, rob = mh_fig("mh_atlas", [("african-male-young", 1.0), ("universal-male-young-maxmuscle-averageweight", 0.6)],
                     mh.pose_kneel_lift, (2.05, 0.6), -0.35)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    used = {i for p in me.polygons for i in p.vertices}
    pts = [ev.matrix_world @ me.vertices[i].co for i in used]
    ev.to_mesh_clear()
    top = max(p.z for p in pts)
    hands = [p for p in pts if p.z > top - 0.12]
    cx = sum(p.x for p in hands) / len(hands)
    cy = sum(p.y for p in hands) / len(hands)
    half = (max(p.x for p in hands) - min(p.x for p in hands)) / 2
    R = max(0.36, half * 1.02)
    kit.sphere("load", R, loc=(cx, cy, top - 0.1 + (R * R - min(half, R * 0.98) ** 2) ** 0.5), material=clay, subdiv=5)
    scenes._lights_studio(target=(0, 0.4, 0.9), key=900, fill=260, rim=450, spread=1.3)
    kit.camera((0.1, -5.4, 1.15), (0.1, 0.4, 0.85), lens=40)
elif variant == "closeup":
    # two figures exchanging, at the overview's cave distance, to judge hands and faces
    mh_fig("mh_give", [("caucasian-male-young", 1.0)], mh.pose_offer, (-0.36, 0.0), math.pi / 2 - 0.15, robe=True)
    mh_fig("mh_take", [("caucasian-female-young", 1.0)], mh.pose_offer, (0.36, 0.0), -math.pi / 2 + 0.15, robe=True)
    scenes._lights_studio(target=(0, 0, 1.2), key=900, fill=260, rim=450, spread=1.0)
    kit.camera((0.35, -2.4, 1.45), (0.0, 0.0, 1.25), lens=50)

path = os.path.join(out, f"figures_{variant}.png")
kit.render(path)
for n, t in stats:
    print(f"[tris] {n}: {t}")
print(f"[done] {path} in {time.time() - t0:.1f}s")
