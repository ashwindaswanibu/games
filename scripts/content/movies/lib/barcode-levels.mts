/**
 * Color Barcode level maths ("G+ edges-first"). Pure: no IO, no sharp, no clocks, no randomness,
 * so every rule here is unit-tested on synthetic images (`barcode-levels.test.mts`). The IO side
 * (fetching, decoding, resizing, encoding) is `barcode-render.mts`.
 *
 * A puzzle has ten levels, each a full-width picture of the whole film, in film order:
 *
 * - **Level 1, the squeezed-frame barcode.** Frames sampled evenly across the film, each squeezed
 *   horizontally into its own column (so its vertical structure survives: sky above, ground below),
 *   laid out left to right. Letterbox mattes are cut away first.
 * - **Levels 2–10, edges first.** The film is cut into N equal stretches (N falls each level, so
 *   strips get wider). Each stretch contributes its middle frame (or a nearby one, if that frame is
 *   near black), and from it a full-height strip as wide as one N-th of the canvas. Early levels cut
 *   the strip at the frame's left or right edge (alternating), where there is texture and colour but
 *   rarely a face; each level the cut drifts toward the centre, choosing among nearby windows the
 *   most informative one and never crossing the centre.
 *
 * Strips come from the film's story only: an opening stretch (studio logos, titles, credits
 * over the first scenes) and a closing stretch (end cards) are left out, because a credit names the
 * film. Level 1 still covers the whole film; squeezed into columns, text can't be read.
 *
 * Images are packed 8-bit RGB (`RgbImage`). Level 1 averages gamma-encoded sRGB values, as the
 * approved prototype did (PIL resizes, `make_barcode.py`); the per-level colour data averages in
 * linear light.
 */

// ---------------------------------------------------------------------------------------------
// Images and colour
// ---------------------------------------------------------------------------------------------

/** Packed 8-bit RGB, row-major, `width × height × 3` bytes. */
export interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export function createImage(width: number, height: number): RgbImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid image size ${width}×${height}`);
  }
  return { width, height, data: new Uint8Array(width * height * 3) };
}

export function assertImage(image: RgbImage): void {
  if (image.data.length !== image.width * image.height * 3) {
    throw new Error(`Image data is ${image.data.length} bytes, not ${image.width}×${image.height} RGB`);
  }
}

/** A `#rrggbb` colour, lowercase. */
export type Hex = `#${string}`;

const SRGB_TO_LINEAR: Float64Array = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return lut;
})();

/** sRGB 8-bit channel → linear light 0–1. */
export function srgbToLinear(channel8: number): number {
  return SRGB_TO_LINEAR[channel8]!;
}

/** Linear light 0–1 → sRGB 8-bit channel, clamped and rounded. */
export function linearToSrgb(linear: number): number {
  const l = Math.min(1, Math.max(0, linear));
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

export function rgbToHex(r: number, g: number, b: number): Hex {
  const part = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Copies a rectangle out of an image. The rectangle must lie inside it. */
export function crop(image: RgbImage, x0: number, y0: number, width: number, height: number): RgbImage {
  if (x0 < 0 || y0 < 0 || width < 1 || height < 1 || x0 + width > image.width || y0 + height > image.height) {
    throw new Error(`Crop ${width}×${height}+${x0}+${y0} is outside the ${image.width}×${image.height} image`);
  }
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * image.width + x0) * 3;
    out.data.set(image.data.subarray(from, from + width * 3), y * width * 3);
  }
  return out;
}

/** Mean of every channel of every pixel, 0–255 (the prototype's "is this frame near black?" test). */
export function meanBrightness(image: RgbImage): number {
  let sum = 0;
  for (let i = 0; i < image.data.length; i++) sum += image.data[i]!;
  return sum / image.data.length;
}

/** Luma (ITU-R 601, as PIL's "L" mode), one float 0–255 per pixel. */
export function lumaOf(image: RgbImage): Float32Array {
  const out = new Float32Array(image.width * image.height);
  const d = image.data;
  for (let p = 0, i = 0; p < out.length; p++, i += 3) out[p] = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Area resampling: exact box-filter weights between two 1-D grids
// ---------------------------------------------------------------------------------------------

/**
 * For each of `dstLength` output cells, the source cells it covers and how much of each (the
 * weights of a cell sum to 1). Works both ways: shrinking averages neighbours, growing repeats a
 * source cell across the output cells inside it.
 */
export function areaWeights(srcLength: number, dstLength: number): { index: number; weight: number }[][] {
  if (!Number.isInteger(srcLength) || !Number.isInteger(dstLength) || srcLength < 1 || dstLength < 1) {
    throw new Error(`Invalid resample ${srcLength} → ${dstLength}`);
  }
  const scale = srcLength / dstLength;
  const cells: { index: number; weight: number }[][] = [];
  for (let d = 0; d < dstLength; d++) {
    const start = d * scale;
    const end = (d + 1) * scale;
    const parts: { index: number; weight: number }[] = [];
    for (let s = Math.floor(start); s < Math.min(srcLength, Math.ceil(end)); s++) {
      const overlap = Math.min(end, s + 1) - Math.max(start, s);
      if (overlap > 1e-9) parts.push({ index: s, weight: overlap / scale });
    }
    cells.push(parts);
  }
  return cells;
}

// ---------------------------------------------------------------------------------------------
// Letterbox and pillarbox mattes
// ---------------------------------------------------------------------------------------------

/** Fractions of the frame to cut from each side. */
export interface Mattes {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const NO_MATTES: Mattes = { top: 0, bottom: 0, left: 0, right: 0 };

/** A line counts as matte when even its brightest moments stay this dark (linear luminance). */
export const MATTE_LUMINANCE = 0.012;
/** "Brightest moments": this quantile of the line's luminance over the sampled frames. */
const MATTE_QUANTILE = 0.98;
/** Never cut more than this from any one side: a film that is simply dark stays whole. */
const MATTE_MAX_SIDE = 0.4;

function quantile(values: Float64Array, q: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/**
 * Finds black bars that stay dark across practically the whole film: rows from the top and
 * bottom, columns from the left and right. Frames must share one size (thumbnails of one
 * gallery). Returns fractions, so the same cut applies to the full-quality frames.
 */
export function detectMattes(frames: readonly RgbImage[]): Mattes {
  if (frames.length === 0) throw new Error("No frames to find mattes in");
  const { width, height } = frames[0]!;
  for (const f of frames) {
    assertImage(f);
    if (f.width !== width || f.height !== height) throw new Error(`Frames differ in size (${width}×${height} and ${f.width}×${f.height})`);
  }
  const rows = Array.from({ length: height }, () => new Float64Array(frames.length));
  const cols = Array.from({ length: width }, () => new Float64Array(frames.length));
  frames.forEach((frame, f) => {
    const d = frame.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        const lum = 0.2126 * srgbToLinear(d[i]!) + 0.7152 * srgbToLinear(d[i + 1]!) + 0.0722 * srgbToLinear(d[i + 2]!);
        rows[y]![f] += lum / width;
        cols[x]![f] += lum / height;
      }
    }
  });
  const isMatte = (series: Float64Array) => quantile(series, MATTE_QUANTILE) < MATTE_LUMINANCE;
  const scan = (lines: Float64Array[], fromEnd: boolean) => {
    const limit = Math.floor(lines.length * MATTE_MAX_SIDE);
    let n = 0;
    while (n < limit && isMatte(lines[fromEnd ? lines.length - 1 - n : n]!)) n++;
    return n;
  };
  return { top: scan(rows, false) / height, bottom: scan(rows, true) / height, left: scan(cols, false) / width, right: scan(cols, true) / width };
}

/** The picture rectangle inside the mattes, in pixels of an image of this size (at least 1×1). */
export function pictureBox(width: number, height: number, mattes: Mattes): { x: number; y: number; width: number; height: number } {
  const x = Math.round(mattes.left * width);
  const y = Math.round(mattes.top * height);
  const right = Math.max(x + 1, width - Math.round(mattes.right * width));
  const bottom = Math.max(y + 1, height - Math.round(mattes.bottom * height));
  return { x, y, width: Math.min(width, right) - x, height: Math.min(height, bottom) - y };
}

export function cropMattes(image: RgbImage, mattes: Mattes): RgbImage {
  const box = pictureBox(image.width, image.height, mattes);
  if (box.x === 0 && box.y === 0 && box.width === image.width && box.height === image.height) return image;
  return crop(image, box.x, box.y, box.width, box.height);
}

// ---------------------------------------------------------------------------------------------
// Level 1: the squeezed-frame barcode
// ---------------------------------------------------------------------------------------------

/**
 * One frame squeezed into a single column of `rows` sRGB colours (0–255, unrounded): each output
 * row is the mean of the frame's pixels in that horizontal band, across the whole width. Means are
 * of the encoded sRGB values, like the approved prototype's PIL resize (averaging in linear light
 * instead brightens contrasty frames: +20% median column brightness on Dune: Part Two).
 */
export function squeezeColumn(frame: RgbImage, rows: number): Float32Array {
  assertImage(frame);
  const { width, height, data } = frame;
  const rowMeans = new Float64Array(height * 3);
  for (let y = 0; y < height; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0, i = y * width * 3; x < width; x++, i += 3) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    rowMeans[y * 3] = r / width;
    rowMeans[y * 3 + 1] = g / width;
    rowMeans[y * 3 + 2] = b / width;
  }
  const out = new Float32Array(rows * 3);
  areaWeights(height, rows).forEach((parts, row) => {
    for (const { index, weight } of parts) {
      for (let c = 0; c < 3; c++) out[row * 3 + c]! += rowMeans[index * 3 + c]! * weight;
    }
  });
  return out;
}

/**
 * Lays squeezed columns (film order) side by side across `width` pixels. With more columns than
 * pixels, neighbours are averaged into one pixel (in sRGB, like the prototype's BOX resize); with
 * fewer, each column spans several pixels.
 */
export function layoutColumns(columns: readonly Float32Array[], width: number): RgbImage {
  if (columns.length === 0) throw new Error("No columns to lay out");
  const rows = columns[0]!.length / 3;
  if (!Number.isInteger(rows) || rows < 1 || columns.some((c) => c.length !== rows * 3)) throw new Error("Columns must all have the same number of rows");
  const out = createImage(width, rows);
  areaWeights(columns.length, width).forEach((parts, x) => {
    for (let y = 0; y < rows; y++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const { index, weight } of parts) {
        const col = columns[index]!;
        r += col[y * 3]! * weight;
        g += col[y * 3 + 1]! * weight;
        b += col[y * 3 + 2]! * weight;
      }
      const i = (y * width + x) * 3;
      out.data[i] = Math.min(255, Math.max(0, Math.round(r)));
      out.data[i + 1] = Math.min(255, Math.max(0, Math.round(g)));
      out.data[i + 2] = Math.min(255, Math.max(0, Math.round(b)));
    }
  });
  return out;
}

/** The frame numbers (1-based, of `total`) sampled for the squeezed barcode: evenly spread, in order. */
export function sampleFrames(total: number, count: number): number[] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Invalid frame count ${total}`);
  const n = Math.min(total, Math.max(1, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => 1 + Math.floor(((i + 0.5) * total) / n));
}

// ---------------------------------------------------------------------------------------------
// Levels 2–10: the edges-first schedule
// ---------------------------------------------------------------------------------------------

export const PACE_NAMES = ["normal", "slower", "faster"] as const;
export type PaceName = (typeof PACE_NAMES)[number];

export interface Pace {
  /** Strips per level, for levels 2–10 (nine entries, falling). */
  strips: readonly number[];
  /** Crop position for level i of the nine is (i / 8) ^ ease: 0 at the frame edge, 1 at the centre. */
  ease: number;
}

/** Owner-approved presets (design/barcode-tests/.../reference/gplus.py). */
export const PACES: Readonly<Record<PaceName, Pace>> = {
  normal: { strips: [128, 88, 60, 42, 30, 21, 15, 10, 6], ease: 1.0 },
  /** More, thinner strips; stays at the edges longer. */
  slower: { strips: [160, 120, 90, 66, 48, 34, 24, 16, 10], ease: 1.6 },
  /** Fewer, wider strips; reaches the centre sooner. */
  faster: { strips: [96, 64, 42, 28, 20, 14, 10, 7, 4], ease: 0.7 },
};

export interface StripLevel {
  /** 2–10. */
  level: number;
  strips: number;
  /** 0 = cut at the frame edge, 1 = cut at the centre. */
  crop: number;
}

/** Levels 2… for a pace: strip count and crop position per level. */
export function stripSchedule(pace: Pace): StripLevel[] {
  const n = pace.strips.length;
  if (n < 2) throw new Error("A pace needs at least two strip levels");
  return pace.strips.map((strips, i) => {
    if (!Number.isInteger(strips) || strips < 1) throw new Error(`Invalid strip count ${strips}`);
    return { level: i + 2, strips, crop: (i / (n - 1)) ** pace.ease };
  });
}

/** Left edges of `count` equal strips across `width` (plus `width` at the end), like numpy's linspace(...).astype(int). */
export function stripEdges(width: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.floor((i * width) / count));
}

/** Stretch `index` of `count` equal stretches of a film of `total` frames: its middle frame and bounds (inclusive, 1-based). */
export function chunkOf(total: number, count: number, index: number): { target: number; first: number; last: number } {
  const first = Math.min(total, Math.floor((index * total) / count) + 1);
  const last = Math.max(first, Math.min(total, Math.floor(((index + 1) * total) / count)));
  const target = Math.min(last, Math.max(first, Math.round(((index + 0.5) / count) * total)));
  return { target, first, last };
}

/** Frames `first`…`last` (inclusive, 1-based) of a film. */
export interface FrameRange {
  first: number;
  last: number;
}

/** Fractions of the film left out of the strips at each end. */
export interface StoryTrim {
  /** Opening: logos, titles and credits, which often run over the first scenes. */
  head: number;
  /** Closing: end cards and credits (screencap galleries mostly stop before the credit roll). */
  tail: number;
}

/**
 * Defaults, from the seeded films' galleries: opening credits end by 2.9% (Amélie), 3.7% (Mad Max:
 * Fury Road's title card) and 6.1% (Barbie, credits over Barbieland, which needs `head` 0.065); the
 * end cards sit in the last 0.2%. A film whose titles run longer gets its own `--head`/`--tail`.
 */
export const DEFAULT_STORY_TRIM: StoryTrim = { head: 0.05, tail: 0.015 };
/** Trims are refused above this: past it, the strips would no longer stand for the whole film. */
export const MAX_TRIM = 0.25;

/** The frames strips may come from: the film minus its trimmed opening and closing. */
export function storyRange(total: number, trim: StoryTrim): FrameRange {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Invalid frame count ${total}`);
  for (const [name, value] of Object.entries(trim)) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_TRIM) throw new Error(`The ${name} trim must be 0–${MAX_TRIM}, not ${value}`);
  }
  const first = Math.min(total, 1 + Math.floor(trim.head * total));
  const last = Math.max(first, total - Math.floor(trim.tail * total));
  return { first, last };
}

/** `chunkOf` within a range of frames: stretch `index` of `count` equal stretches of `range`. */
export function chunkIn(range: FrameRange, count: number, index: number): { target: number; first: number; last: number } {
  const offset = range.first - 1;
  const chunk = chunkOf(range.last - offset, count, index);
  return { target: chunk.target + offset, first: chunk.first + offset, last: chunk.last + offset };
}

/** A frame whose mean brightness (0–255, all channels) is at or below this is "near black". */
export const NEAR_BLACK_FRAME = 22;
/** How far to look for a brighter frame, as fractions of the film (60 and 240 caps of Dune: Part Two's 23,457). */
export const NEARBY_OFFSETS: readonly number[] = [0, 0.0025, -0.0025, 0.005, -0.005, 0.01];

/**
 * The frame to cut a strip from: the stretch's middle frame, or the first nearby frame (in
 * `NEARBY_OFFSETS` order, kept inside the stretch so strips stay in film order) that isn't near
 * black. Brightness is known for the sampled frames only, so each candidate snaps to the nearest
 * sampled frame inside the stretch. With no bright candidate, the middle frame is used anyway.
 */
export function chooseFrame(
  chunk: { target: number; first: number; last: number },
  total: number,
  sampled: readonly number[],
  brightness: ReadonlyMap<number, number>,
): number {
  const nearestSampled = (n: number): number | null => {
    let lo = 0;
    let hi = sampled.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sampled[mid]! < n) lo = mid + 1;
      else hi = mid;
    }
    let best: number | null = null;
    for (const i of [lo - 1, lo]) {
      const s = sampled[i];
      if (s === undefined || s < chunk.first || s > chunk.last) continue;
      if (best === null || Math.abs(s - n) < Math.abs(best - n)) best = s;
    }
    return best;
  };
  let fallback: number | null = null;
  for (const offset of NEARBY_OFFSETS) {
    const wanted = Math.min(chunk.last, Math.max(chunk.first, chunk.target + Math.round(offset * total)));
    const candidate = nearestSampled(wanted);
    if (candidate === null) continue;
    fallback ??= candidate;
    if ((brightness.get(candidate) ?? 0) > NEAR_BLACK_FRAME) return candidate;
  }
  return fallback ?? chunk.target;
}

// ---------------------------------------------------------------------------------------------
// Smart crop: the most informative window near the target
// ---------------------------------------------------------------------------------------------

/** A window whose mean luma is below this is near black and never chosen while another exists. */
export const NEAR_BLACK_WINDOW = 24;
export const REJECTED = -1e9;

/**
 * How much a strip shows: mean absolute vertical plus horizontal luma gradient (edges, texture),
 * plus 0.35 × the luma standard deviation (contrast). Near-black windows score `REJECTED`.
 * `luma` is the whole frame (`lumaOf`); the window is columns [x0, x0 + width).
 */
export function infoScore(luma: Float32Array, frameWidth: number, frameHeight: number, x0: number, width: number): number {
  if (x0 < 0 || width < 1 || x0 + width > frameWidth) throw new Error(`Window ${x0}+${width} is outside a frame ${frameWidth} wide`);
  let sum = 0;
  let sumSq = 0;
  let dy = 0;
  let dx = 0;
  for (let y = 0; y < frameHeight; y++) {
    const row = y * frameWidth + x0;
    for (let x = 0; x < width; x++) {
      const v = luma[row + x]!;
      sum += v;
      sumSq += v * v;
      if (x + 1 < width) dx += Math.abs(luma[row + x + 1]! - v);
      if (y + 1 < frameHeight) dy += Math.abs(luma[row + frameWidth + x]! - v);
    }
  }
  const n = width * frameHeight;
  const mean = sum / n;
  if (mean < NEAR_BLACK_WINDOW) return REJECTED;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const gradY = frameHeight > 1 ? dy / ((frameHeight - 1) * width) : 0;
  const gradX = width > 1 ? dx / (frameHeight * (width - 1)) : 0;
  return gradY + gradX + 0.35 * std;
}

/** A luma step above this between neighbours is a sharp edge (a letter's stroke, on a ground). */
const TEXT_EDGE = 64;
/** Text has at least this share of sharp-edge pixels (a horizon line alone is ~1 / frame height). */
const TEXT_MIN_EDGES = 0.004;
/** Share of the window within ±8 luma of its mode at which text-likeness starts, and where it is full. */
const TEXT_GROUND_FROM = 0.5;
const TEXT_GROUND_FULL = 0.75;
/** A fully text-like window keeps this share of its information score. */
export const TEXT_SCORE_KEPT = 0.25;

/**
 * How much a window looks like text on a flat ground (a title card, a credit, a sign), 0–1. Text
 * on a plain background is exactly what `infoScore` rewards most (sharp edges, high contrast), and
 * it can name the film, so `pickStripX` marks such windows down. Signals: most of the window sits
 * within a narrow band of luma (the ground), yet it has sharp, high-contrast edges (the strokes).
 */
export function textLikeness(luma: Float32Array, frameWidth: number, frameHeight: number, x0: number, width: number): number {
  if (x0 < 0 || width < 1 || x0 + width > frameWidth) throw new Error(`Window ${x0}+${width} is outside a frame ${frameWidth} wide`);
  const bins = new Uint32Array(64);
  let strong = 0;
  for (let y = 0; y < frameHeight; y++) {
    const row = y * frameWidth + x0;
    for (let x = 0; x < width; x++) {
      const v = luma[row + x]!;
      bins[Math.min(63, Math.floor(v / 4))]!++;
      if ((x + 1 < width && Math.abs(luma[row + x + 1]! - v) > TEXT_EDGE) || (y + 1 < frameHeight && Math.abs(luma[row + frameWidth + x]! - v) > TEXT_EDGE)) strong++;
    }
  }
  const n = width * frameHeight;
  let mode = 0;
  for (let b = 1; b < 64; b++) if (bins[b]! > bins[mode]!) mode = b;
  let ground = 0;
  for (let b = Math.max(0, mode - 2); b <= Math.min(63, mode + 2); b++) ground += bins[b]!;
  if (strong / n < TEXT_MIN_EDGES) return 0;
  return Math.min(1, Math.max(0, (ground / n - TEXT_GROUND_FROM) / (TEXT_GROUND_FULL - TEXT_GROUND_FROM)));
}

/** Candidate windows tried around the target, spread evenly over ± `spread`. */
export const CROP_CANDIDATES = 9;

/** Frame height the approved prototype chose crops at; its distance penalty was per pixel of this. */
export const PROTOTYPE_FRAME_HEIGHT = 533;
/** The prototype's penalty for straying from the target: this much score per prototype pixel. */
const DISTANCE_PENALTY = 0.02;

/**
 * Score lost for choosing a window `offset` pixels from the target in a frame `frameHeight` tall:
 * 0.02 per pixel of the prototype's 533-pixel frames, so the trade-off between information and
 * distance doesn't change with the resolution the frames are fetched at.
 */
export function distancePenalty(offset: number, frameHeight: number): number {
  return DISTANCE_PENALTY * Math.abs(offset) * (PROTOTYPE_FRAME_HEIGHT / frameHeight);
}

/**
 * Where to cut a strip `stripWidth` wide from a frame: the target moves from the frame's left (or
 * right) edge at `crop` = 0 to its centre at 1; of `CROP_CANDIDATES` windows around it (within
 * 12% of the frame width at the edge, narrowing to 4.8% at the centre) the most informative wins,
 * with a small penalty for straying from the target (`distancePenalty`) and a large one for looking
 * like text on a flat ground (`textLikeness`). A window's centre never passes the frame's
 * centre, so left-side strips stay left and right-side strips stay right. Returns the left x.
 */
export function pickStripX(
  frame: { width: number; height: number; luma: Float32Array },
  stripWidth: number,
  fromLeft: boolean,
  crop: number,
): number {
  const { width, height, luma } = frame;
  if (stripWidth > width) throw new Error(`A strip ${stripWidth} wide doesn't fit a frame ${width} wide`);
  const centre = width / 2;
  // The prototype kept the first cut 8 px in from the edge of its 533-pixel frames.
  const margin = (8 * height) / PROTOTYPE_FRAME_HEIGHT;
  const edge = fromLeft ? stripWidth / 2 + margin : width - stripWidth / 2 - margin;
  const target = edge + (centre - edge) * crop;
  const spread = width * 0.12 * (1 - 0.6 * crop);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < CROP_CANDIDATES; i++) {
    const offset = -spread + (2 * spread * i) / (CROP_CANDIDATES - 1);
    let cx = target + offset;
    cx = fromLeft ? Math.min(cx, centre) : Math.max(cx, centre);
    const x0 = Math.floor(Math.max(0, Math.min(width - stripWidth, cx - stripWidth / 2)));
    const info = infoScore(luma, width, height, x0, stripWidth);
    const kept = info === REJECTED ? 1 : 1 - (1 - TEXT_SCORE_KEPT) * textLikeness(luma, width, height, x0, stripWidth);
    const score = info * kept - distancePenalty(offset, height);
    if (score > bestScore) {
      best = x0;
      bestScore = score;
    }
  }
  return best;
}

/** Copies columns [srcX, srcX + width) of `frame` into `canvas` at column `dstX`. Heights must match. */
export function pasteStrip(canvas: RgbImage, frame: RgbImage, srcX: number, width: number, dstX: number): void {
  if (frame.height !== canvas.height) throw new Error(`Frame is ${frame.height} tall; the canvas is ${canvas.height}`);
  if (srcX < 0 || srcX + width > frame.width || dstX < 0 || dstX + width > canvas.width) throw new Error("Strip is out of bounds");
  for (let y = 0; y < canvas.height; y++) {
    const from = (y * frame.width + srcX) * 3;
    canvas.data.set(frame.data.subarray(from, from + width * 3), (y * canvas.width + dstX) * 3);
  }
}

// ---------------------------------------------------------------------------------------------
// Colour data: per-level average and dominant colour, and how colourful the film is
// ---------------------------------------------------------------------------------------------

/** The image's mean colour in linear light, as sRGB hex (what it blurs to). */
export function averageColor(image: RgbImage): Hex {
  const d = image.data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 3) {
    r += srgbToLinear(d[i]!);
    g += srgbToLinear(d[i + 1]!);
    b += srgbToLinear(d[i + 2]!);
  }
  const n = d.length / 3;
  return rgbToHex(linearToSrgb(r / n), linearToSrgb(g / n), linearToSrgb(b / n));
}

/** Bins whose brightest channel is below this are near black, and only win if they hold most of the picture. */
const DOMINANT_DARK = 40;

/**
 * The most common colour: pixels binned 4 bits per channel, the fullest bin wins (near-black bins
 * only if they hold more than half the picture, so a dark film's glow isn't simply black), and its
 * pixels' mean is returned.
 */
export function dominantColor(image: RgbImage): Hex {
  const d = image.data;
  const count = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  for (let i = 0; i < d.length; i += 3) {
    const bin = ((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4);
    count[bin]!++;
    sums[bin * 3] += d[i]!;
    sums[bin * 3 + 1] += d[i + 1]!;
    sums[bin * 3 + 2] += d[i + 2]!;
  }
  const pixels = d.length / 3;
  const order = Array.from(count.keys()).filter((bin) => count[bin]! > 0).sort((a, b) => count[b]! - count[a]! || a - b);
  const isDark = (bin: number) => Math.max(sums[bin * 3]!, sums[bin * 3 + 1]!, sums[bin * 3 + 2]!) / count[bin]! < DOMINANT_DARK;
  const pick = order.find((bin) => !isDark(bin) || count[bin]! > pixels / 2) ?? order[0]!;
  const n = count[pick]!;
  return rgbToHex(sums[pick * 3]! / n, sums[pick * 3 + 1]! / n, sums[pick * 3 + 2]! / n);
}

/** Pixels whose brightest channel is below this (0–255) are too dark for their saturation to mean anything. */
const SATURATION_MIN_VALUE = 32;
/** A pixel at least this saturated (HSV) counts as chromatic. */
const CHROMATIC_SATURATION = 0.25;
/** A film with less than this share of chromatic pixels is black and white (or as good as). */
export const MONOCHROME_CHROMATIC_SHARE = 0.03;

export interface FilmLook {
  /** Mean HSV saturation (0–1) of the film's non-dark pixels: how colourful it is. */
  saturation: number;
  /** Share (0–1) of non-dark pixels that are clearly coloured. */
  chromaticShare: number;
  /** Black and white (or nearly): almost no pixel carries colour. */
  monochrome: boolean;
}

/** How colourful a film is, over its sampled frames (mattes already cut away). */
export function filmLook(frames: readonly RgbImage[]): FilmLook {
  let n = 0;
  let satSum = 0;
  let chromatic = 0;
  for (const frame of frames) {
    const d = frame.data;
    for (let i = 0; i < d.length; i += 3) {
      const max = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
      if (max < SATURATION_MIN_VALUE) continue;
      const s = (max - Math.min(d[i]!, d[i + 1]!, d[i + 2]!)) / max;
      n++;
      satSum += s;
      if (s >= CHROMATIC_SATURATION) chromatic++;
    }
  }
  if (n === 0) return { saturation: 0, chromaticShare: 0, monochrome: true };
  const chromaticShare = chromatic / n;
  return { saturation: satSum / n, chromaticShare, monochrome: chromaticShare < MONOCHROME_CHROMATIC_SHARE };
}
