"""Compose the ladder renders into comparison sheets: rows = figures, columns = rungs 1-4 (system Python + Pillow)."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

src = sys.argv[1]
dst = sys.argv[2]
view = sys.argv[3] if len(sys.argv) > 3 else "full"
suffix = sys.argv[4] if len(sys.argv) > 4 else ""
FONT = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"
f_big = ImageFont.truetype(FONT, 24)
f_small = ImageFont.truetype(FONT, 18)
RUNGS = [(1, "1  Cloth sim per pose", "carved curls, relaxed hands"), (2, "2  Sim once, skinned", "tunic bent by the bones"),
         (3, "3  Lofted robe", "bald, default hands"), (4, "4  Metaball dolls", "today's overview")]
FIGS = [("offer", "Standing"), ("scribe", "Seated"), ("atlas", "Kneeling")]
crop = (150, 70, 650, 960) if view in ("full", "side") else (100, 0, 700, 1000)
scale = 0.6
cw, ch = int((crop[2] - crop[0]) * scale), int((crop[3] - crop[1]) * scale)
figs = FIGS if view in ("full", "side") else FIGS[:1]
left, top = 150, 90
W, H = left + cw * len(RUNGS), top + ch * len(figs)
sheet = Image.new("RGB", (W, H), (19, 17, 16))
d = ImageDraw.Draw(sheet)
for c, (r, name, sub) in enumerate(RUNGS):
    x = left + c * cw + 12
    d.text((x, 18), name, font=f_big, fill=(230, 225, 213))
    d.text((x, 52), sub, font=f_small, fill=(150, 145, 138))
for rr, (fig, label) in enumerate(figs):
    y = top + rr * ch
    d.text((16, y + ch // 2 - 14), label, font=f_big, fill=(230, 225, 213))
    for c, (r, _n, _s) in enumerate(RUNGS):
        p = os.path.join(src, f"ladder_r{r}_{fig}_{view}{suffix}.png")
        if not os.path.exists(p):
            d.text((left + c * cw + 20, y + ch // 2), "missing", font=f_small, fill=(200, 80, 60))
            continue
        im = Image.open(p).convert("RGB").crop(crop).resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (left + c * cw, y))
    d.line([(left, y), (W, y)], fill=(40, 37, 35), width=2)
for c in range(1, len(RUNGS)):
    d.line([(left + c * cw, top), (left + c * cw, H)], fill=(40, 37, 35), width=2)
sheet.save(dst, quality=90)
print(dst, sheet.size)
