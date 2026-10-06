"""Experimental: build Dune: Part Two barcodes from movie-screencaps.com thumbnails.

Downloads every STEP-th screencap thumbnail in film order, computes per-frame colours,
renders several barcode styles + progressive per-guess levels, saves colour data as JSON,
then deletes the thumbnails.
"""
import io, json, os, sys, time, shutil, concurrent.futures as cf, urllib.request
from PIL import Image
import numpy as np

BASE = "https://caps2.b-cdn.net/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-{n}.jpg?class=thumbnail"
REFERER = "https://movie-screencaps.com/dune-part-two-2024-4k/"
LAST, STEP = 23457, 8
OUT = os.path.dirname(os.path.abspath(__file__))
THUMBS = os.path.join(OUT, "thumbs")
os.makedirs(THUMBS, exist_ok=True)

def fetch(n):
    path = os.path.join(THUMBS, f"{n:05d}.jpg")
    if os.path.exists(path):
        return n, path
    req = urllib.request.Request(BASE.format(n=n), headers={"User-Agent": "Mozilla/5.0", "Referer": REFERER})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read()
            Image.open(io.BytesIO(data)).verify()
            with open(path, "wb") as f:
                f.write(data)
            time.sleep(0.05)
            return n, path
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return n, None

frames = list(range(1, LAST + 1, STEP))
ok = {}
with cf.ThreadPoolExecutor(max_workers=4) as ex:
    for i, (n, path) in enumerate(ex.map(fetch, frames)):
        if path: ok[n] = path
        if i % 500 == 0: print(f"  {i}/{len(frames)} fetched", flush=True)
print(f"fetched {len(ok)}/{len(frames)}")

def srgb_to_lin(c): c = c / 255.0; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin_to_srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255

def crop_bars(a):
    """Drop near-black letterbox rows/columns at the edges."""
    lum = a.mean(axis=2)
    rows = np.where(lum.mean(axis=1) > 12)[0]; cols = np.where(lum.mean(axis=0) > 12)[0]
    if len(rows) < 4 or len(cols) < 4: return a  # whole frame is dark (night scene / fade): keep it
    return a[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]

def dominant(a, k=4, iters=8, seed=0):
    px = a.reshape(-1, 3).astype(np.float32)
    rng = np.random.default_rng(seed); cent = px[rng.choice(len(px), k, replace=False)]
    for _ in range(iters):
        lab = ((px[:, None, :] - cent[None]) ** 2).sum(-1).argmin(1)
        for j in range(k):
            m = px[lab == j]
            if len(m): cent[j] = m.mean(0)
    counts = np.bincount(lab, minlength=k)
    # most populous cluster, preferring non-near-black ones when they are reasonably large
    order = np.argsort(-counts)
    for j in order:
        if cent[j].mean() > 20 or counts[j] > 0.6 * len(px): return cent[j]
    return cent[order[0]]

H = 96
mean_naive, mean_lin, dom, squeeze = [], [], [], []
for n in sorted(ok):
    a = np.asarray(Image.open(ok[n]).convert("RGB"), dtype=np.float32)
    a = crop_bars(a)
    mean_naive.append(a.reshape(-1, 3).mean(0))
    mean_lin.append(lin_to_srgb(srgb_to_lin(a).reshape(-1, 3).mean(0)))
    dom.append(dominant(a))
    col = np.asarray(Image.fromarray(a.astype(np.uint8)).resize((1, H), Image.BILINEAR), dtype=np.float32)[:, 0, :]
    squeeze.append(col)
mean_naive, mean_lin, dom = map(np.array, (mean_naive, mean_lin, dom))
squeeze = np.stack(squeeze, axis=1)  # H x frames x 3

def save_strip(colors, name, w=1600, h=420):
    img = Image.fromarray(np.clip(colors, 0, 255).astype(np.uint8)[None, :, :].repeat(2, 0))
    img.resize((w, h), Image.NEAREST if len(colors) <= w else Image.BOX).save(os.path.join(OUT, name))

save_strip(mean_naive, "dune2-flat-naive-average.png")
save_strip(mean_lin, "dune2-flat-light-average.png")
save_strip(dom, "dune2-flat-dominant.png")
Image.fromarray(np.clip(squeeze, 0, 255).astype(np.uint8)).resize((1600, 420), Image.BOX).save(os.path.join(OUT, "dune2-squeezed-frames.png"))

# Progressive levels: average (in linear light) over equal slices of the film.
lin = srgb_to_lin(mean_lin)
levels = [6, 12, 24, 48, 96, 192, len(lin)]
rows = []
for k in levels:
    edges = np.linspace(0, len(lin), k + 1).astype(int)
    bins = np.array([lin[edges[i]:max(edges[i + 1], edges[i] + 1)].mean(0) for i in range(k)])
    rows.append(lin_to_srgb(bins))
sheet = Image.new("RGB", (1600, len(levels) * 120 - 20), (24, 24, 24))
for i, cols in enumerate(rows):
    strip = Image.fromarray(np.clip(cols, 0, 255).astype(np.uint8)[None, :, :].repeat(2, 0))
    strip = strip.resize((1600, 100), Image.NEAREST if len(cols) <= 1600 else Image.BOX)
    sheet.paste(strip, (0, i * 120))
sheet.save(os.path.join(OUT, "dune2-levels-per-guess.png"))

json.dump({
    "film": "Dune: Part Two (2024)", "source": "movie-screencaps.com thumbnails (every %dth of %d caps)" % (STEP, LAST),
    "frames": len(lin), "levels": levels,
    "light_average": [f"#{int(r):02x}{int(g):02x}{int(b):02x}" for r, g, b in np.clip(mean_lin, 0, 255)],
    "dominant": [f"#{int(r):02x}{int(g):02x}{int(b):02x}" for r, g, b in np.clip(dom, 0, 255)],
}, open(os.path.join(OUT, "dune2-barcode.json"), "w"))

shutil.rmtree(THUMBS)
print("done; thumbnails deleted:", not os.path.exists(THUMBS))
