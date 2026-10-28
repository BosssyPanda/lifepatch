"""Export each overview scene as a GLB (metaballs, curves and text turned to meshes, modifiers applied),
so its triangle count and compressed size can be measured against the web budget."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]  # proofs/ and the intro kit beside it

import bpy  # noqa: E402

import kit  # noqa: E402
import scenes  # noqa: E402

out = sys.argv[sys.argv.index("--out") + 1]
names = sys.argv[sys.argv.index("--scenes") + 1].split(",")
os.makedirs(out, exist_ok=True)

for name in names:
    kit.reset("a", res=(320, 200), samples=1)
    scenes.SCENES[name]()
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    # bake every renderable object to a plain mesh in world space
    tris = 0
    objs = []
    for ob in list(bpy.context.scene.objects):
        if ob.type not in ("MESH", "META", "CURVE", "FONT"):
            continue
        ev = ob.evaluated_get(dg)
        try:
            me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
        except RuntimeError:
            continue
        if not me.polygons:
            continue
        me.transform(ob.matrix_world)
        nob = bpy.data.objects.new(ob.name + "_x", me)
        objs.append(nob)
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
    for ob in list(bpy.context.scene.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for nob in objs:
        bpy.context.scene.collection.objects.link(nob)
    path = os.path.join(out, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_materials="NONE",
                              export_texcoords=False, export_normals=True, export_apply=True)
    print(f"[scene] {name}: {len(objs)} meshes, {tris} triangles -> {path}", flush=True)
