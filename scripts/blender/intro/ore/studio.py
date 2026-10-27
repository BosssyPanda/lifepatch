"""The studio the gold reflects: a few white softboxes in the dark, rendered to one equirectangular
HDR. Both the Blender look-dev renders and the browser light the ore with this same file, so what
is judged here is what the page shows.

    python scripts/blender/intro/ore/studio.py --out public/intro/env/studio.hdr

Neutral white light only (DESIGN.md: no colour casts). Units are metres, Z up, the ore at the
origin, the front of the ore facing -Y (towards the opening camera).
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# name, centre, size (w, h), strength. Each panel faces the origin.
PANELS = [
    ("key", (-2.6, -2.8, 3.0), (6.0, 4.0), 6.0),        # big soft key, high front-left
    ("top", (0.2, 0.0, 4.0), (5.0, 3.0), 2.0),          # overhead softbox, gives the plates' tops
    ("rim_l", (-3.2, 2.2, 1.6), (1.0, 3.6), 5.0),       # tall strip behind left, edge light
    ("rim_r", (3.2, 1.8, 1.8), (1.0, 3.6), 4.5),        # tall strip behind right
    ("fill", (3.0, -2.6, 0.8), (4.0, 2.6), 0.8),        # soft fill, front-right
    ("bounce", (0.0, 0.0, -3.0), (6.0, 6.0), 0.3),      # a faint floor so undersides are not black
]
AMBIENT = 0.04   # the dark studio walls: dim grey, so no facet of the gold reflects pure black


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (AMBIENT, AMBIENT, AMBIENT, 1)
    for name, c, (pw, ph), strength in PANELS:
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=c)
        ob = bpy.context.object
        ob.name = name
        ob.scale = (pw, ph, 1)
        d = (Vector((0, 0, 0)) - Vector(c)).normalized()
        ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()  # the plane's +Z normal faces the ore
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type != "OUTPUT_MATERIAL":
                nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (1, 1, 1, 1)
        em.inputs["Strength"].default_value = strength
        nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
        ob.data.materials.append(m)
    cam_data = bpy.data.cameras.new("pano")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("pano", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)  # equirect centre looks down +X, Z up
    sc.camera = cam
    return sc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", default="1024x512")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    sc = build()
    sc.render.resolution_x, sc.render.resolution_y = (int(v) for v in args.res.split("x"))
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "HDR"
    sc.view_settings.view_transform = "Standard"
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sc.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)
    print("[studio]", args.out)


if __name__ == "__main__":
    main()
