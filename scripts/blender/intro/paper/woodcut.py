"""The picture on the jiaozi note, cut like a woodblock from the scene's own hall and people, with a pine.

Li You's description of the notes says their printed design used "houses, trees and people". Rather than
drawing those by hand, the scene itself, with a pine added beside the hall for the trees (the 3D scene leaves
the pine out: full size it read as flat stones on a pipe, in the print it reads as a tree), is rendered three times from the front (surface direction, distance
from the lens, and plain clay shading) and turned into a block print: outlines where the surface turns or
steps back, hatching in the shadows, solid ink in the darkest. The result is an ink mask (black lines on
white) that note.py prints into the note's picture panel.

    python scripts/blender/intro/paper/woodcut.py --figs DIR --out woodcut.png [--res 1520x1240]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, os.path.join(INTRO, "proofs"), INTRO]

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import kit  # noqa: E402
import props  # noqa: E402
import scene  # noqa: E402

CAM = ((-1.2, -6.4, 2.3), (0.15, 1.9, 1.45), 42)


def _emit_override(kind):
    m = bpy.data.materials.new("override_" + kind)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    if kind == "normal":
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        vm = nt.nodes.new("ShaderNodeVectorMath")
        vm.operation = "MULTIPLY_ADD"
        vm.inputs[1].default_value = (0.5, 0.5, 0.5)
        vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs["Normal"], vm.inputs[0])
        nt.links.new(vm.outputs[0], em.inputs["Color"])
    else:
        cd = nt.nodes.new("ShaderNodeCameraData")
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 3.0
        mr.inputs["From Max"].default_value = 13.0
        nt.links.new(cd.outputs["View Z Depth"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], em.inputs["Color"])
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return m


def _render(path, samples):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(path)
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
    bpy.data.images.remove(im)
    return px


def cut(normal, depth, shade, alpha):
    """Block-print ink mask (1 = ink) from the three passes."""
    n = normal[..., :3] * 2 - 1
    d = depth[..., 0]
    lum = shade[..., :3].mean(axis=2)
    a = alpha > 0.5
    ink = np.zeros(d.shape, dtype=np.float32)
    # outlines: the surface direction turns, or the depth steps back, between neighbouring pixels
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        n2 = np.roll(np.roll(n, dy, 0), dx, 1)
        d2 = np.roll(np.roll(d, dy, 0), dx, 1)
        a2 = np.roll(np.roll(a, dy, 0), dx, 1)
        turn = (n * n2).sum(axis=2) < 0.82
        step = np.abs(d - d2) > 0.004 + 0.02 * d
        ink[(turn | step) & (a | a2)] = 1
        ink[a != a2] = 1
    # thicken the lines a little, as a knife leaves them
    ink = np.maximum(ink, np.roll(ink, 1, 1))
    # shadows: diagonal hatching, cross-hatched deeper, solid in the darkest
    h, w = d.shape
    yy, xx = np.mgrid[0:h, 0:w]
    hatch1 = ((xx + yy) % 7) < 2
    hatch2 = ((xx - yy) % 7) < 2
    ink[a & (lum < 0.30) & hatch1] = 1
    ink[a & (lum < 0.18) & hatch2] = 1
    ink[a & (lum < 0.08)] = 1
    ink[:3, :] = ink[-3:, :] = 0      # np.roll wraps round: clear what it dragged in from the far edge
    ink[:, :3] = ink[:, -3:] = 0
    return ink


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]

    def arg(n, d=None):
        return args[args.index(n) + 1] if n in args else d

    figs, out = arg("--figs"), arg("--out")
    w, h = (int(x) for x in arg("--res", "1520x1240").split("x"))
    tmp = os.path.splitext(out)[0]
    kit.reset("a", res=(w, h), samples=16)
    scene.build(figs, None)
    props.pine("pine", (-3.15, 2.45, 0.0), height=3.3, seed=5)
    # the official's darker robe would print as a solid black shape: cut it in outline like the others
    for k in ("cloth", "belt", "shoes"):
        bpy.data.objects["official_" + k].material_slots[0].material = kit.mat("clay")
    for o in bpy.data.objects:
        if o.name.startswith("island"):
            o.hide_render = True
    scene.lights()
    loc, tgt, lens = CAM
    kit.camera(loc, tgt, lens=lens)
    sc = bpy.context.scene
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    shade = _render(tmp + "_shade.png", 24)
    vl = bpy.context.view_layer
    sc.cycles.use_denoising = False
    vl.material_override = _emit_override("normal")
    normal = _render(tmp + "_normal.png", 8)
    vl.material_override = _emit_override("depth")
    depth = _render(tmp + "_depth.png", 8)
    ink = cut(normal, depth, shade, shade[..., 3])
    from PIL import Image
    Image.fromarray(((1 - ink) * 255).astype(np.uint8)).save(out)
    print("[woodcut]", out)


if __name__ == "__main__":
    main()
