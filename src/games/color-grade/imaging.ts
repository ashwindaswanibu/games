import { createRng, type Rng } from "@/core/random";

/**
 * Colour-science for Color Grade's image pipeline: palette extraction, the "regrade" of a neutral
 * photo to a film's look, and the blurred-still derivative.
 *
 * Pure and deterministic (no IO, no `Math.random()`): the content scripts decode images with sharp
 * and hand raw RGB buffers to these functions, so every step is unit-tested on synthetic pixels.
 *
 * Colour handling:
 *   - Pixels are 8-bit sRGB (D65). Perceptual work (clustering, statistics, transfer) happens in
 *     CIELAB, where Euclidean distance roughly tracks perceived difference (ΔE*76).
 *   - Blurring happens in linear light, so a blur mixes light the way a defocused lens does
 *     (bright highlights bloom instead of turning muddy).
 */

/** An 8-bit RGB raster, row-major, 3 bytes per pixel, no padding. */
export interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** CIELAB (D65): L in [0, 100], a/b roughly [-128, 127]. */
export type Lab = readonly [l: number, a: number, b: number];
export type Rgb = readonly [r: number, g: number, b: number];

export function createRgbImage(width: number, height: number, data?: Uint8Array): RgbImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Image dimensions must be positive integers, got ${width}×${height}`);
  }
  const size = width * height * 3;
  if (data && data.length !== size) throw new Error(`Expected ${size} bytes for a ${width}×${height} RGB image, got ${data.length}`);
  return { width, height, data: data ?? new Uint8Array(size) };
}

// ---------------------------------------------------------------------------------------------
// sRGB ⇄ linear ⇄ XYZ ⇄ Lab
// ---------------------------------------------------------------------------------------------

/** sRGB byte → linear light [0, 1]. Exact for all 256 inputs, so it's a table. */
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export function srgbToLinear(byte: number): number {
  return SRGB_TO_LINEAR[byte];
}

/** Linear light → sRGB byte, rounded and clamped to [0, 255]. */
export function linearToSrgb(value: number): number {
  const c = value <= 0 ? 0 : value >= 1 ? 1 : value;
  const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

// D65 reference white.
const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;
const EPSILON = (6 / 29) ** 3;
const KAPPA = 3 * (6 / 29) ** 2;

const labF = (t: number) => (t > EPSILON ? Math.cbrt(t) : t / KAPPA + 4 / 29);
const labFInverse = (t: number) => (t > 6 / 29 ? t * t * t : KAPPA * (t - 4 / 29));

export function linearRgbToLab(r: number, g: number, b: number): Lab {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab → linear RGB, unclamped (out-of-gamut colours fall outside [0, 1]). */
export function labToLinearRgb(l: number, a: number, b: number): Rgb {
  const fy = (l + 16) / 116;
  const x = XN * labFInverse(fy + a / 500);
  const y = YN * labFInverse(fy);
  const z = ZN * labFInverse(fy - b / 200);
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

export function srgbToLab(r: number, g: number, b: number): Lab {
  return linearRgbToLab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b]);
}

/** Lab → sRGB bytes. Out-of-gamut colours are clipped per channel. */
export function labToSrgb(l: number, a: number, b: number): Rgb {
  const [r, g, bl] = labToLinearRgb(l, a, b);
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

/** Every pixel in Lab, 3 floats per pixel. */
export function toLabPixels(image: RgbImage): Float32Array {
  const { data } = image;
  const lab = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const [l, a, b] = srgbToLab(data[i], data[i + 1], data[i + 2]);
    lab[i] = l;
    lab[i + 1] = a;
    lab[i + 2] = b;
  }
  return lab;
}

export function fromLabPixels(lab: Float32Array, width: number, height: number): RgbImage {
  const image = createRgbImage(width, height);
  if (lab.length !== image.data.length) throw new Error("Lab buffer doesn't match the image size");
  for (let i = 0; i < lab.length; i += 3) {
    const [r, g, b] = labToSrgb(lab[i], lab[i + 1], lab[i + 2]);
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
  }
  return image;
}

/** "#rrggbb", lowercase. */
export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** CIE76 colour difference. ~2.3 is a just-noticeable difference. */
export function deltaE(x: Lab, y: Lab): number {
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------------------------------------
// Palette: k-means in Lab
// ---------------------------------------------------------------------------------------------

export interface PaletteColor {
  /** "#rrggbb" of the cluster's Lab centroid. */
  hex: string;
  rgb: Rgb;
  lab: Lab;
  /** Fraction of sampled pixels in this cluster; the palette's shares sum to 1. */
  share: number;
}

export interface PaletteOptions {
  /** Number of colours. Default 5. */
  k?: number;
  /** Seeds sampling and k-means++ initialisation. Same image + seed → same palette. Default 1. */
  seed?: number;
  /** Pixels sampled (stratified) before clustering. Default 24 000. */
  maxSamples?: number;
  /** Lloyd iterations cap; stops early once no pixel changes cluster. Default 40. */
  maxIterations?: number;
}

/** Expands a 32-bit seed into the four words `createRng` wants (splitmix32). */
function rngFromSeed(seed: number): Rng {
  let state = seed >>> 0;
  const word = () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return createRng([word(), word(), word(), word()]);
}

/** Stratified sample of pixel indices: one random pixel from each of `count` equal runs. */
function samplePixels(pixelCount: number, count: number, rng: Rng): Uint32Array {
  if (count >= pixelCount) return Uint32Array.from({ length: pixelCount }, (_, i) => i);
  const out = new Uint32Array(count);
  const step = pixelCount / count;
  for (let i = 0; i < count; i++) out[i] = Math.min(pixelCount - 1, Math.floor((i + rng.next()) * step));
  return out;
}

const squaredDistance = (points: Float32Array, i: number, centers: Float64Array, c: number) => {
  const dl = points[i * 3] - centers[c * 3];
  const da = points[i * 3 + 1] - centers[c * 3 + 1];
  const db = points[i * 3 + 2] - centers[c * 3 + 2];
  return dl * dl + da * da + db * db;
};

/**
 * The image's `k` dominant colours, by k-means clustering in Lab (k-means++ initialisation,
 * deterministic for a given seed), largest cluster first.
 *
 * Throws if the image has fewer than `k` perceptibly distinct colours (a flat or near-flat frame
 * makes a meaningless palette; the pipeline should choose another still).
 */
export function extractPalette(image: RgbImage, options: PaletteOptions = {}): PaletteColor[] {
  const { k = 5, seed = 1, maxSamples = 24_000, maxIterations = 40 } = options;
  if (!Number.isInteger(k) || k < 1 || k > 16) throw new Error(`Palette size must be 1–16, got ${k}`);
  const rng = rngFromSeed(seed);
  const pixelCount = image.width * image.height;
  const indices = samplePixels(pixelCount, Math.max(k, maxSamples), rng);
  const n = indices.length;

  const points = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = indices[i] * 3;
    const [l, a, b] = srgbToLab(image.data[p], image.data[p + 1], image.data[p + 2]);
    points[i * 3] = l;
    points[i * 3 + 1] = a;
    points[i * 3 + 2] = b;
  }

  // k-means++: each new centre is a sample drawn with probability ∝ squared distance to the
  // nearest existing centre.
  const centers = new Float64Array(k * 3);
  const nearest = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const setCenter = (c: number, i: number) => {
    centers[c * 3] = points[i * 3];
    centers[c * 3 + 1] = points[i * 3 + 1];
    centers[c * 3 + 2] = points[i * 3 + 2];
    for (let j = 0; j < n; j++) nearest[j] = Math.min(nearest[j], squaredDistance(points, j, centers, c));
  };
  setCenter(0, rng.int(0, n - 1));
  // Below ~1 ΔE two colours are indistinguishable; a palette needs k distinct ones.
  const DISTINCT = 1;
  for (let c = 1; c < k; c++) {
    let total = 0;
    let farthest = 0;
    for (let j = 0; j < n; j++) {
      total += nearest[j];
      if (nearest[j] > farthest) farthest = nearest[j];
    }
    if (farthest < DISTINCT * DISTINCT) {
      throw new Error(`The image has fewer than ${k} distinct colours, so it can't make a ${k}-colour palette`);
    }
    let target = rng.next() * total;
    let chosen = n - 1;
    for (let j = 0; j < n; j++) {
      target -= nearest[j];
      if (target < 0) {
        chosen = j;
        break;
      }
    }
    setCenter(c, chosen);
  }

  // Lloyd iterations.
  const nearestCenter = (i: number) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let c = 0; c < k; c++) {
      const d = squaredDistance(points, i, centers, c);
      if (d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
    return best;
  };
  const assignment = new Int32Array(n).fill(-1);
  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const best = nearestCenter(i);
      if (assignment[i] !== best) {
        assignment[i] = best;
        changed++;
      }
    }
    if (changed === 0 && iteration > 0) break;

    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignment[i];
      counts[c]++;
      sums[c * 3] += points[i * 3];
      sums[c * 3 + 1] += points[i * 3 + 1];
      sums[c * 3 + 2] += points[i * 3 + 2];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c * 3] = sums[c * 3] / counts[c];
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
        continue;
      }
      // An empty cluster takes over the sample worst served by its current centre.
      let worst = 0;
      let worstDistance = -1;
      for (let i = 0; i < n; i++) {
        const d = squaredDistance(points, i, centers, assignment[i]);
        if (d > worstDistance) {
          worstDistance = d;
          worst = i;
        }
      }
      centers[c * 3] = points[worst * 3];
      centers[c * 3 + 1] = points[worst * 3 + 1];
      centers[c * 3 + 2] = points[worst * 3 + 2];
      assignment[worst] = c;
    }
  }

  // Shares from a final assignment against the final centres.
  counts.fill(0);
  for (let i = 0; i < n; i++) counts[nearestCenter(i)]++;

  const palette = Array.from({ length: k }, (_, c): PaletteColor => {
    const lab: Lab = [centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]];
    const rgb = labToSrgb(...lab);
    return { hex: rgbToHex(rgb), rgb, lab, share: counts[c] / n };
  });
  // Largest first; ties broken by lightness so the order never depends on cluster numbering.
  palette.sort((x, y) => y.share - x.share || y.lab[0] - x.lab[0]);
  return palette;
}

// ---------------------------------------------------------------------------------------------
// Reinhard colour transfer
// ---------------------------------------------------------------------------------------------

export interface LabStats {
  mean: Lab;
  std: Lab;
}

/** Per-channel mean and (population) standard deviation of Lab pixels. */
export function labStats(lab: Float32Array): LabStats {
  const n = lab.length / 3;
  if (n < 1 || !Number.isInteger(n)) throw new Error("labStats needs at least one Lab pixel");
  const mean = [0, 0, 0];
  for (let i = 0; i < lab.length; i += 3) {
    mean[0] += lab[i];
    mean[1] += lab[i + 1];
    mean[2] += lab[i + 2];
  }
  for (let c = 0; c < 3; c++) mean[c] /= n;
  const variance = [0, 0, 0];
  for (let i = 0; i < lab.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const d = lab[i + c] - mean[c];
      variance[c] += d * d;
    }
  }
  return { mean: [mean[0], mean[1], mean[2]], std: [Math.sqrt(variance[0] / n), Math.sqrt(variance[1] / n), Math.sqrt(variance[2] / n)] };
}

export interface TransferOptions {
  /** 0 leaves the target untouched, 1 is the full transfer. Default 1. */
  strength?: number;
  /**
   * Caps how far a channel's contrast may be stretched or squeezed (σ_source / σ_target is clamped
   * to [1 / maxScale, maxScale]), so a nearly flat target channel isn't blown into noise. Default 3.
   */
  maxScale?: number;
}

/**
 * Reinhard et al. (2001) colour transfer, in CIELAB: shift and scale each channel of `target` so its
 * mean and standard deviation match `source`'s. Applied to a neutral photo with a film still as the
 * source, it gives the photo that film's grade (its tint, contrast and colourfulness) without any
 * of the film's content.
 *
 * `source` may be an image or precomputed statistics.
 */
export function reinhardTransfer(target: RgbImage, source: RgbImage | LabStats, options: TransferOptions = {}): RgbImage {
  const { strength = 1, maxScale = 3 } = options;
  if (!(strength >= 0 && strength <= 1)) throw new Error(`strength must be within [0, 1], got ${strength}`);
  if (!(maxScale >= 1)) throw new Error(`maxScale must be at least 1, got ${maxScale}`);
  const sourceStats = "data" in source ? labStats(toLabPixels(source)) : source;
  const lab = toLabPixels(target);
  const targetStats = labStats(lab);

  const scale = [0, 1, 2].map((c) => {
    const t = targetStats.std[c];
    // A constant channel has no contrast to rescale; only its mean moves.
    if (t < 1e-6) return 1;
    return Math.min(maxScale, Math.max(1 / maxScale, sourceStats.std[c] / t));
  });

  for (let i = 0; i < lab.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const value = lab[i + c];
      const moved = (value - targetStats.mean[c]) * scale[c] + sourceStats.mean[c];
      lab[i + c] = value + strength * (moved - value);
    }
    // Keep lightness physical; a and b clip in labToSrgb.
    lab[i] = Math.min(100, Math.max(0, lab[i]));
  }
  return fromLabPixels(lab, target.width, target.height);
}

// ---------------------------------------------------------------------------------------------
// Blur
// ---------------------------------------------------------------------------------------------

/**
 * Widths of three successive box blurs whose combination approximates a Gaussian of `sigma`
 * (Kovesi, "Fast almost-Gaussian filtering", 2010). Each width is odd.
 */
export function boxWidthsForGaussian(sigma: number, passes = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4));
  return Array.from({ length: passes }, (_, i) => (i < m ? lower : upper));
}

/** One horizontal box-blur pass of radius r over a single-channel plane (edges clamp). */
function boxBlurRows(src: Float32Array, dst: Float32Array, width: number, height: number, r: number) {
  const span = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum / span;
      const add = src[row + Math.min(width - 1, x + r + 1)];
      const remove = src[row + Math.max(0, x - r)];
      sum += add - remove;
    }
  }
}

function transpose(src: Float32Array, dst: Float32Array, width: number, height: number) {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) dst[x * height + y] = src[y * width + x];
}

/**
 * Gaussian blur (three box passes each way) in linear light. `sigma` is in pixels; 0 returns a
 * copy. Dimensions are unchanged; edges are extended, so a frame's border doesn't darken.
 */
export function gaussianBlur(image: RgbImage, sigma: number): RgbImage {
  if (!(sigma >= 0) || !Number.isFinite(sigma)) throw new Error(`sigma must be a finite number ≥ 0, got ${sigma}`);
  const { width, height, data } = image;
  if (sigma === 0) return createRgbImage(width, height, data.slice());
  const radii = boxWidthsForGaussian(sigma).map((w) => (w - 1) / 2);
  const size = width * height;
  const out = createRgbImage(width, height);
  const plane = new Float32Array(size);
  const scratch = new Float32Array(size);

  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < size; i++) plane[i] = SRGB_TO_LINEAR[data[i * 3 + channel]];
    for (const r of radii) {
      boxBlurRows(plane, scratch, width, height, r);
      plane.set(scratch);
    }
    transpose(plane, scratch, width, height);
    for (const r of radii) {
      boxBlurRows(scratch, plane, height, width, r);
      scratch.set(plane);
    }
    transpose(scratch, plane, height, width);
    for (let i = 0; i < size; i++) out.data[i * 3 + channel] = linearToSrgb(plane[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers for display
// ---------------------------------------------------------------------------------------------

/** WCAG relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b];
}

/** Parses "#rrggbb" (case-insensitive). */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/**
 * Rounds palette shares to `decimals` places so they still sum to exactly 1 (largest-remainder
 * method), for storing in a puzzle.
 */
export function roundShares(shares: readonly number[], decimals = 3): number[] {
  const unit = 10 ** decimals;
  const total = shares.reduce((sum, s) => sum + s, 0);
  if (!(total > 0)) throw new Error("Shares must sum to a positive number");
  const scaled = shares.map((s) => (s / total) * unit);
  const floors = scaled.map(Math.floor);
  let remainder = unit - floors.reduce((sum, s) => sum + s, 0);
  const order = scaled.map((s, i) => ({ i, frac: s - floors[i] })).sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]++;
    remainder--;
  }
  return floors.map((f) => f / unit);
}
