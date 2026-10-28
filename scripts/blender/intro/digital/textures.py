"""The digital scene's glowing numbers, drawn in code: the wall quote board, the moving ticker band, the
desk quote units' readouts and the phone's balance screen.

Board, ticker and readouts are lamp dots (a 5 x 7 dot font defined here), the way the electric boards of
the time drew characters; the phone uses the game's own fonts (Anton, IBM Plex Mono, from
app/api/og/_fonts). Everything is ink on near-black (DESIGN.md: digital money stays in the ink scale).

The prices are decoration, not real 1971 quotes, and the symbols are made up: three letters each,
checked against nothing, so none is meant to name a real company. Prices are in eighths, as US stock
prices were quoted until 2001.

    python3 scripts/blender/intro/digital/textures.py OUT_DIR
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
FONTS = os.path.join(ROOT, "app", "api", "og", "_fonts")
BG = (19, 17, 16)        # --color-bg #131110
INK = (244, 240, 230)    # --color-ink #f4f0e6
DIM = (58, 54, 50)       # an unlit lamp

# 5 x 7 lamp font: each glyph is 7 rows of 5 bits, top row first
GLYPHS = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    " ": ["00000"] * 7,
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}


def lamp_text(draw, x, y, s, pitch, lit=INK, unlit=DIM, r=0.36, gap=1):
    """Draw s in lamp dots with its top-left at (x, y); pitch = dot spacing in pixels. Every cell of the
    5 x 7 grid gets a lamp (an unlit lamp is a dim dot), as on a real board. Returns the end x."""
    rad = pitch * r
    for ch in s:
        g = GLYPHS.get(ch.upper(), GLYPHS[" "])
        for j, row in enumerate(g):
            for i, bit in enumerate(row):
                cx, cy = x + (i + 0.5) * pitch, y + (j + 0.5) * pitch
                col = lit if bit == "1" else unlit
                if col is not None:
                    draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=col)
        x += (5 + gap) * pitch
    return x


def text_width(s, pitch, gap=1):
    return len(s) * (5 + gap) * pitch


def _symbols(n, seed):
    rnd = random.Random(seed)
    letters = "ABCDEFGHJKLMNOPRSTUVWXZ"
    out = set()
    while len(out) < n:
        out.add("".join(rnd.choice(letters) for _ in range(3)))
    return sorted(out)


def _price(rnd):
    whole = rnd.randint(8, 96)
    eighth = rnd.randint(0, 7)
    if eighth == 0:
        return f"{whole}"
    num, den = eighth, 8
    while num % 2 == 0:
        num, den = num // 2, den // 2
    return f"{whole} {num}/{den}"


def _change(rnd):
    sign = rnd.choice("+-")
    e = rnd.randint(1, 14)
    whole, eighth = divmod(e, 8)
    num, den = eighth, 8
    while num and num % 2 == 0:
        num, den = num // 2, den // 2
    frac = f"{num}/{den}" if num else ""
    body = f"{whole} {frac}".strip() if whole else frac
    return sign + body


def lamp_matrix(draw, w, h, pitch, x0=0.0, y0=0.0, col=(36, 33, 31), r=0.30):
    """Every lamp of the board, unlit: the faint grid a lamp board shows between its characters."""
    rad = pitch * r
    y = y0 + pitch / 2
    while y < h:
        x = x0 + pitch / 2
        while x < w:
            draw.ellipse((x - rad, y - rad, x + rad, y + rad), fill=col)
            x += pitch
        y += pitch


def board(path, w=4096, h=1536, cols=3, rows=8, seed=71):
    """The wall quote board: columns of symbol, last price and change in fixed-width fields (numbers
    right-aligned, as on a board whose lamps are wired per character), divided by thin rules."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    pad = 70
    cell_w = (w - 2 * pad) / cols
    cell_h = (h - 2 * pad) / rows
    fields = (3, 6, 6)  # symbol, price, change (characters)
    chars = sum(fields) + 2
    pitch = int(min(cell_w / ((chars + 2) * 6), cell_h / 10.5))
    syms = _symbols(cols * rows, seed)
    for c in range(cols):
        x0 = pad + c * cell_w
        left = x0 + (cell_w - chars * 6 * pitch) / 2
        lamp_matrix(d, w, h, pitch, x0=left % pitch, y0=(pad + (cell_h - 7 * pitch) / 2) % pitch)
        break
    for c in range(cols):
        x0 = pad + c * cell_w
        if c:
            d.line((x0, pad * 0.6, x0, h - pad * 0.6), fill=(58, 54, 50), width=6)
        left = x0 + (cell_w - chars * 6 * pitch) / 2
        for r in range(rows):
            y0 = pad + r * cell_h + (cell_h - 7 * pitch) / 2
            vals = (syms[c * rows + r], _price(rnd), _change(rnd))
            x = left
            for n, (val, width) in enumerate(zip(vals, fields)):
                cell = val if n == 0 else val.rjust(width)
                lamp_text(d, x, y0, cell, pitch, unlit=None)
                x += (width + 1) * 6 * pitch
    img.save(path)
    return path


def ticker(path, w=8192, h=256, seed=1971):
    """The moving ticker band: one line of symbol + price pairs, made to repeat seamlessly (the browser
    scrolls it; its end joins its start)."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    pitch = int(h / 9)
    y = (h - 7 * pitch) / 2
    x = pitch * 2
    lamp_matrix(d, w, h, pitch, x0=x % pitch, y0=y % pitch, col=(32, 29, 27))
    syms = _symbols(60, seed)
    i = 0
    while True:
        item = f"{syms[i % len(syms)]} {_price(rnd)}"
        wd = text_width(item + "   ", pitch)
        if x + wd > w - pitch * 2:
            break
        lamp_text(d, x, y, item, pitch, unlit=None)
        x += wd
        i += 1
    img.save(path)
    return path


def readout(path, seed, w=512, h=96):
    """A desk quote unit's one-line readout: price and change."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    pitch = int(h / 9)
    s = f"{_price(rnd)} {_change(rnd)}"
    lamp_text(d, (w - text_width(s, pitch)) / 2, (h - 7 * pitch) / 2, s, pitch, unlit=(30, 28, 26))
    img.save(path)
    return path


def readouts(path, n=9, w=512, h=96):
    """All the desk readouts in one image, one row each (row 0 at the top), so the page loads one texture."""
    img = Image.new("RGB", (w, h * n), BG)
    tmp = path + ".row.png"
    for i in range(n):
        readout(tmp, seed=100 + i, w=w, h=h)
        img.paste(Image.open(tmp), (0, i * h))
    os.remove(tmp)
    img.save(path)
    return path


def phone_screen(path, w=720, h=1480, balance="$1,971.08"):
    """The hero phone's screen: a balance, in the game's own type. Ink on near-black; no gold (digital
    money stays in the ink scale) and no accent (the accent is for interaction, and this is a prop)."""
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    mono = ImageFont.truetype(os.path.join(FONTS, "IBMPlexMono-Regular.ttf"), 34)
    mono_s = ImageFont.truetype(os.path.join(FONTS, "IBMPlexMono-Regular.ttf"), 30)
    anton = ImageFont.truetype(os.path.join(FONTS, "Anton-Regular.ttf"), 168)
    dim = (150, 144, 134)
    faint = (64, 60, 55)
    # status bar
    d.text((60, 52), "9:41", font=mono_s, fill=dim)
    d.rectangle((w - 120, 60, w - 64, 84), outline=dim, width=3)
    d.rectangle((w - 116, 64, w - 84, 80), fill=dim)
    # eyebrow, the balance, a rule
    d.text((64, 300), "AVAILABLE BALANCE", font=mono, fill=dim, spacing=4)
    d.text((58, 350), balance, font=anton, fill=INK)
    d.line((64, 600, w - 64, 600), fill=faint, width=3)
    # three transaction rows, as bars (unreadable at this size on purpose: no claims)
    rnd = random.Random(8)
    for i in range(5):
        y = 660 + i * 120
        d.rectangle((64, y, 64 + rnd.randint(180, 330), y + 26), fill=(96, 90, 82))
        d.rectangle((64, y + 46, 64 + rnd.randint(110, 200), y + 64), fill=faint)
        rw = rnd.randint(110, 170)
        d.rectangle((w - 64 - rw, y, w - 64, y + 26), fill=(96, 90, 82))
    # home indicator
    d.rounded_rectangle((w / 2 - 110, h - 44, w / 2 + 110, h - 34), radius=5, fill=dim)
    img.save(path)
    return path


def glow(path, out, radius=6):
    """A softened copy for the bloom-free browser look: the lamps' halo baked into the texture."""
    im = Image.open(path).convert("RGB")
    halo = im.filter(ImageFilter.GaussianBlur(radius))
    Image.blend(halo, im, 0.65).save(out)
    return out


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    board(os.path.join(out, "board.png"))
    ticker(os.path.join(out, "ticker.png"))
    readouts(os.path.join(out, "readouts.png"))
    phone_screen(os.path.join(out, "phone_screen.png"))
    print("ok", out)
