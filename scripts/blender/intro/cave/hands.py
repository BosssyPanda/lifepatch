"""Silhouettes of real hands for the cave's hand stencils, from the same CC0 MakeHuman bodies as the
statues: a man's, a woman's and a child's hand, fingers spread flat as if pressed to the wall, seen
square on. Writes white-on-black PNG masks that paintings.py sprays charcoal around.

    MPFB_DATA=... .venv-bpy/bin/python hands.py --out DIR
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(HERE), "proofs"), os.path.dirname(HERE)]

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402
import mh_figure as mh  # noqa: E402

HANDS = {
    "man": [("african-male-young", 1.0)],
    "woman": [("african-female-young", 1.0)],
    "child": [("caucasian-female-child", 1.0)],
}


def spread_flat(rig):
    """The left arm straight out to the side, palm down, fingers straight and fanned and the thumb out:
    a hand pressed flat on rock. In this T-pose the body faces -Y, so the thumb is on the -Y side."""
    # a hand bone's local Z comes out of the palm, so `up` (0, 0, -1) turns the palm to the floor
    for b in ("upperarm_l", "lowerarm_l", "hand_l"):
        mh.aim(rig, b, (1.0, 0.0, 0.0), up=(0, 0, -1))
    for f, fan in (("index", -15), ("middle", -3), ("ring", 9), ("pinky", 21)):
        a = math.radians(fan)
        for k in ("01", "02", "03"):
            mh.aim(rig, f"{f}_{k}_l", (math.cos(a), math.sin(a), 0.0), up=(0, 0, -1))
    for k, fan in (("01", -55), ("02", -40), ("03", -35)):
        a = math.radians(fan)
        mh.aim(rig, f"thumb_{k}_l", (math.cos(a), math.sin(a), -0.15), up=(0, 0, -1))


def render_hand(name, targets, out, res=512):
    kit.reset("a", res=(res, res), samples=1)
    sc = bpy.context.scene
    sc.render.film_transparent = False
    m = bpy.data.materials.new("white")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    ob, rig = mh.build(name, targets=targets, material=m)
    spread_flat(rig)
    bpy.context.view_layer.update()
    wrist = rig.matrix_world @ rig.pose.bones["hand_l"].head
    tip = rig.matrix_world @ rig.pose.bones["middle_03_l"].tail
    length = (tip - wrist).length
    centre = (wrist + tip) / 2
    # from above, square on to the back of the flat hand, fingers up the frame
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = length * 1.55
    cam = kit.link(bpy.data.objects.new("cam", cd))
    cam.location = centre + Vector((-0.1 * length, 0, 1.0))
    cam.rotation_euler = (0, 0, math.pi / 2)
    sc.camera = cam
    bpy.data.worlds["World"].node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.color_mode = "BW"
    sc.render.filepath = os.path.join(out, f"hand_{name}.png")
    bpy.ops.render.render(write_still=True)
    return length


if __name__ == "__main__":
    out = sys.argv[sys.argv.index("--out") + 1]
    os.makedirs(out, exist_ok=True)
    for name, targets in HANDS.items():
        print(name, "hand length", render_hand(name, targets, out))
