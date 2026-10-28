"""Budget test for a posed MakeHuman figure: bake the pose, decimate to about 8k triangles, render the
full and decimated meshes side by side, and export the decimated one as a GLB for compression."""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]  # proofs/ and the intro kit beside it

import bpy  # noqa: E402

import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import scenes  # noqa: E402

out = sys.argv[sys.argv.index("--out") + 1]
kit.reset("a", res=(1280, 800), samples=32)
kit.island(radius=3.0, depth=0.6, seed=11)
clay = kit.mat("clay")


def baked(name, ratio, x):
    ob, rob = mh.build(name, targets=[("caucasian-male-young", 1.0)], material=clay)
    mh.pose_offer(rob)
    mh.ground(ob, rob, 0.0)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    me.transform(ob.matrix_world)
    nob = bpy.data.objects.new(name + "_baked", me)
    bpy.context.scene.collection.objects.link(nob)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.objects.remove(rob, do_unlink=True)
    # drop the loose (unrendered helper) vertices
    bpy.context.view_layer.objects.active = nob
    nob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.delete_loose()
    bpy.ops.object.mode_set(mode="OBJECT")
    if ratio < 1:
        d = nob.modifiers.new("dec", "DECIMATE")
        d.ratio = ratio
        bpy.ops.object.modifier_apply(modifier="dec")
    nob.select_set(False)
    nob.location.x += x
    nob.rotation_euler.z = math.radians(15)
    print(f"[tris] {name} ratio {ratio}: {sum(len(p.vertices) - 2 for p in nob.data.polygons)}", flush=True)
    return nob


full = baked("full", 1.0, -0.45)
low = baked("low", 0.27, 0.45)
scenes._lights_studio(target=(0, 0, 1.0), key=900, fill=260, rim=450, spread=1.0)
kit.camera((0.0, -3.6, 1.2), (0.0, 0.0, 0.95), lens=45)
kit.render(os.path.join(out, "figure_decimate.png"))
for ob in list(bpy.context.scene.objects):
    ob.select_set(ob.name == "low_baked")
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "figure_low.glb"), export_format="GLB", use_selection=True,
                          export_materials="NONE", export_texcoords=False, export_normals=True)
for ob in list(bpy.context.scene.objects):
    ob.select_set(ob.name == "full_baked")
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "figure_full.glb"), export_format="GLB", use_selection=True,
                          export_materials="NONE", export_texcoords=False, export_normals=True)
print("[done]")
