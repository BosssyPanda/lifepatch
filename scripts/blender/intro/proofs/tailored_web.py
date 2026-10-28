"""The web version of a figure saved by tailored.py, without simulating again: open its .blend, join every
mesh but the seat into one, decimate to --web triangles, export GLB, and render it from the front and side.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]  # proofs/ and the intro kit beside it

import bpy  # noqa: E402

import cloth  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import scenes  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


blend = arg("--blend")
out = arg("--out")
web = int(arg("--web", "12000"))
name = os.path.splitext(os.path.basename(blend))[0]
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
kit._STATE.update(look=dict(kit.LOOKS["a"], key_name="a"), mats={})  # what kit.reset("a") sets, scene kept
clay = kit.mat("clay")
figure = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("seat")]
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
bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"{name}_web.glb"), export_format="GLB",
                          export_materials="NONE", use_selection=True, export_texcoords=False,
                          export_normals=True, export_apply=True)
kit.island(radius=2.0, depth=0.6, seed=11)
scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
for vname, (loc, tgt) in {"full": ((0.9, -3.4, 1.15), (0.0, 0.0, 0.85)),
                          "side": ((-3.3, -1.0, 1.15), (0.0, 0.0, 0.85))}.items():
    kit.camera(loc, tgt, lens=50)
    kit.render(os.path.join(out, f"{name}_{vname}_web.png"))
print("[done]")
