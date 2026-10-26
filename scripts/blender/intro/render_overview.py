"""Render the intro overview frames: every scene, in either look.

    python scripts/blender/intro/render_overview.py --out DIR [--scenes ore,cave] [--looks a,b]
                                                    [--res 1440x900] [--samples 64] [--dim 0.12]

Needs Blender's Python module (bpy 5.2.3); see README.md. Frames land in DIR as <scene>_<look>.png.
--dim renders the transition state instead: everything but the era's money turned down to that
fraction (scenes.HERO), saved as <scene>_<look>_dim.png.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
import scenes  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--scenes", default=",".join(scenes.SCENES))
    ap.add_argument("--looks", default="a,b")
    ap.add_argument("--res", default="1440x900")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--dim", type=float, default=None)
    args = ap.parse_args()
    w, h = (int(x) for x in args.res.split("x"))
    os.makedirs(args.out, exist_ok=True)
    for name in args.scenes.split(","):
        for lk in args.looks.split(","):
            t = time.time()
            kit.reset(lk, res=(w, h), samples=args.samples)
            scenes.SCENES[name]()
            if args.dim is not None:
                kit.dim(args.dim)
            path = os.path.join(args.out, f"{name}_{lk}{'_dim' if args.dim is not None else ''}.png")
            kit.render(path)
            print(f"[overview] {name} look {lk}: {time.time() - t:.1f}s -> {path}", flush=True)


if __name__ == "__main__":
    main()
