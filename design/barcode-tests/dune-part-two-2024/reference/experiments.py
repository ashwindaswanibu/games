"""Reveal-strategy experiments for the Color Barcode game (Dune: Part Two).

Frames are cached in frames_cache/ while experimenting (delete the folder when done).
Each strategy renders a 10-guess sheet: guess 1 = colour barcode, guesses 2-10 = slices.
"""
import io, os, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

BASE = "https://caps2.b-cdn.net/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-{n}.jpg?width=1280"
REFERER = "https://movie-screencaps.com/dune-part-two-2024-4k/"
LAST = 23457
OUT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(OUT, "frames_cache")
os.makedirs(CACHE, exist_ok=True)
W, H = 1600, 533
KS = [128, 88, 60, 42, 30, 21, 15, 10, 6]  # slices for guesses 2..10
BARCODE = Image.open(os.path.join(OUT, "dune2-flat-light-average.png")).resize((W, H), Image.NEAREST)

def fetch(n):
    path = os.path.join(CACHE, f"{n:05d}.jpg")
    if not os.path.exists(path):
        req = urllib.request.Request(BASE.format(n=n), headers={"User-Agent": "Mozilla/5.0", "Referer": REFERER})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                Image.open(io.BytesIO(data)).verify()
                open(path, "wb").write(data)
                time.sleep(0.08)
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
    return Image.open(path).convert("RGB")

_frame_memo = {}
def frame_near(n):
    if n in _frame_memo: return _frame_memo[n]
    for off in (0, 60, -60, 120, -120, 240):
        m = min(max(1, n + off), LAST)
        im = fetch(m)
        if np.asarray(im, dtype=np.float32).mean() > 22:
            break
    im = im.resize((int(im.width * H / im.height), H), Image.LANCZOS)
    _frame_memo[n] = im
    return im

def lerp(a, b, t): return a + (b - a) * t

def render(k, p):
    """p: crop_pos (0 edge..1 centre), height (band fraction), blur (px), block (mosaic px), develop ('full'|'gray'|'duo'|'field')."""
    canvas = Image.new("RGB", (W, H))
    edges = np.linspace(0, W, k + 1).astype(int)
    for i in range(k):
        fr = frame_near(int(round((i + 0.5) / k * LAST)))
        sw = edges[i + 1] - edges[i]
        centre = fr.width / 2
        edge = sw / 2 + 8 if i % 2 == 0 else fr.width - sw / 2 - 8
        cx = lerp(edge, centre, p.get("crop_pos", 1.0))
        x0 = int(max(0, min(fr.width - sw, cx - sw / 2)))
        strip = fr.crop((x0, 0, x0 + sw, H))
        mean = tuple(int(v) for v in np.asarray(strip, dtype=np.float32).reshape(-1, 3).mean(0))
        dev = p.get("develop", "full")
        if dev == "field":
            strip = strip.filter(ImageFilter.GaussianBlur(28))
        elif dev == "duo":
            g = ImageOps.grayscale(strip.filter(ImageFilter.GaussianBlur(p.get("blur", 0))))
            dark = tuple(int(c * 0.25) for c in mean); light = tuple(min(255, int(c * 1.6 + 30)) for c in mean)
            strip = ImageOps.colorize(ImageOps.posterize(g, 3), dark, light)
        elif dev == "gray":
            strip = ImageOps.grayscale(strip).convert("RGB")
        if p.get("blur", 0) and dev not in ("field", "duo"):
            strip = strip.filter(ImageFilter.GaussianBlur(p["blur"]))
        if p.get("block", 0) > 1:
            b = int(p["block"])
            small = strip.resize((max(1, sw // b), max(1, H // b)), Image.BILINEAR)
            strip = small.resize((sw, H), Image.NEAREST)
        band = p.get("height", 1.0)
        if band < 1.0:
            base = Image.new("RGB", (sw, H), mean)
            bh = max(2, int(H * band)); y0 = (H - bh) // 2
            base.paste(strip.crop((0, y0, sw, y0 + bh)), (0, y0))
            strip = base
        canvas.paste(strip, (edges[i], 0))
    return canvas

def sheet(name, title, schedule):
    rows = [BARCODE] + [render(k, p) for k, p in zip(KS, schedule)]
    rh, gap, top = H // 2, 10, 54
    out = Image.new("RGB", (W, top + len(rows) * (rh + gap)), (16, 16, 16))
    d = ImageDraw.Draw(out)
    d.text((16, 16), title, fill=(235, 230, 220))
    for i, im in enumerate(rows):
        y = top + i * (rh + gap)
        out.paste(im.resize((W, rh), Image.LANCZOS), (0, y))
        d.rectangle((0, y, 58, y + 22), fill=(16, 16, 16)); d.text((8, y + 5), f"G{i + 1}", fill=(235, 230, 220))
    out.save(os.path.join(OUT, f"exp-{name}.jpg"), quality=85)
    print("saved", name, flush=True)

n9 = lambda vals: [dict(v) for v in vals]
ramp = lambda a, b: [lerp(a, b, t) for t in np.linspace(0, 1, 9)]
geo = lambda a, b: list(np.geomspace(a, b, 9))

STRATS = {
    "A-current": ("A. Current: width only (centre strip, full height, sharp)", n9([{} for _ in KS])),
    "B-aperture-focus": ("B. Aperture & Focus: band opens + focus pulls + crops move edge->centre",
        n9([{"height": h, "blur": b, "crop_pos": c} for h, b, c in zip(geo(0.06, 1.0), [14, 11, 8.5, 6.5, 5, 3.5, 2.2, 1.0, 0], ramp(0.0, 1.0))])),
    "C-focus-pull": ("C. Focus pull: starts very soft, sharpens each guess (centre, full height)",
        n9([{"blur": b} for b in [22, 16, 12, 9, 6.5, 4.5, 3, 1.5, 0]])),
    "D-shutter": ("D. Projector shutter: thin band opens vertically each guess (sharp, centre)",
        n9([{"height": h} for h in geo(0.04, 1.0)])),
    "E-darkroom": ("E. Darkroom: colour fields -> duotone -> grey -> full colour (edge->centre)",
        n9([{"develop": d, "blur": b, "crop_pos": c} for d, b, c in zip(
            ["field", "field", "duo", "duo", "duo", "gray", "gray", "full", "full"], [0, 0, 3, 2, 1, 1.5, 0.5, 0.8, 0], ramp(0.0, 1.0))])),
    "F-mosaic": ("F. Mosaic: big pixels get finer each guess (centre, full height)",
        n9([{"block": b} for b in [64, 44, 30, 22, 16, 11, 7, 4, 2]])),
    "G-edges-first": ("G. Edges first: same as current but crops start at frame edges, move to centre",
        n9([{"crop_pos": c} for c in ramp(0.0, 1.0)])),
}

only = sys.argv[1:] or list(STRATS)
for name in only:
    title, sched = STRATS[name]
    sheet(name, title, sched)
