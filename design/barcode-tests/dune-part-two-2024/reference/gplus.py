"""G+ : edges-first reveal with (1) squeezed-frame barcode as guess 1 and (2) smart edge crops
that skip black / flat strips. Renders three paces: normal, slower, faster."""
import os
import numpy as np
from PIL import Image, ImageDraw

ns = {"__file__": os.path.abspath("experiments.py")}
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "experiments.py")).read()
exec(src.split("def lerp")[0], ns)  # fetch(), frame_near(), constants, caches
W, H, LAST, frame_near = ns["W"], ns["H"], ns["LAST"], ns["frame_near"]
OUT = os.path.dirname(os.path.abspath(__file__))
SQUEEZED = Image.open(os.path.join(OUT, "dune2-squeezed-frames.png")).resize((W, H), Image.LANCZOS)

def info_score(strip):
    a = np.asarray(strip.convert("L"), dtype=np.float32)
    if a.mean() < 24: return -1e9                      # near-black: useless
    grad = np.abs(np.diff(a, axis=0)).mean() + np.abs(np.diff(a, axis=1)).mean()
    return grad + 0.35 * a.std()

def pick_x(fr, sw, side_left, c):
    """Target moves from the frame edge (c=0) to the centre (c=1); choose the most informative
    window among nearby candidates, never jumping past the centre."""
    centre = fr.width / 2
    edge = sw / 2 + 8 if side_left else fr.width - sw / 2 - 8
    target = edge + (centre - edge) * c
    spread = fr.width * 0.12 * (1 - 0.6 * c)
    best, best_s = target, -1e18
    for off in np.linspace(-spread, spread, 9):
        cx = target + off
        cx = min(cx, centre) if side_left else max(cx, centre)
        x0 = int(max(0, min(fr.width - sw, cx - sw / 2)))
        s = info_score(fr.crop((x0, 0, x0 + sw, H))) - 0.02 * abs(off)
        if s > best_s: best, best_s = x0, s
    return int(best)

def render(k, c):
    canvas = Image.new("RGB", (W, H)); edges = np.linspace(0, W, k + 1).astype(int)
    for i in range(k):
        fr = frame_near(int(round((i + 0.5) / k * LAST)))
        sw = edges[i + 1] - edges[i]
        x0 = pick_x(fr, sw, i % 2 == 0, c)
        canvas.paste(fr.crop((x0, 0, x0 + sw, H)), (edges[i], 0))
    return canvas

PACES = {
    "normal": ([128, 88, 60, 42, 30, 21, 15, 10, 6], 1.0),
    "slower": ([160, 120, 90, 66, 48, 34, 24, 16, 10], 1.6),   # more, thinner strips; stays at edges longer
    "faster": ([96, 64, 42, 28, 20, 14, 10, 7, 4], 0.7),       # fewer, wider strips; reaches centre sooner
}
for name, (ks, ease) in PACES.items():
    cs = [t ** ease for t in np.linspace(0, 1, len(ks))]
    rows = [SQUEEZED] + [render(k, c) for k, c in zip(ks, cs)]
    rh, gap, top = H // 2, 10, 54
    out = Image.new("RGB", (W, top + len(rows) * (rh + gap)), (16, 16, 16)); d = ImageDraw.Draw(out)
    d.text((16, 16), f"G+ edges-first, {name}: strips per guess {ks}", fill=(235, 230, 220))
    for i, im in enumerate(rows):
        y = top + i * (rh + gap); out.paste(im.resize((W, rh), Image.LANCZOS), (0, y))
        d.rectangle((0, y, 58, y + 22), fill=(16, 16, 16)); d.text((8, y + 5), f"G{i + 1}", fill=(235, 230, 220))
    out.save(os.path.join(OUT, f"exp-Gplus-{name}.jpg"), quality=85)
    print("saved", name, flush=True)
