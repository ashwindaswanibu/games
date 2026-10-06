import { z } from "zod";

/**
 * Color barcode math, shared by the content pipeline (`scripts/content/movies/barcodes.mts`), the
 * DEV FIXTURE generator and the game. Pure: no IO, no clocks, no randomness.
 *
 * A film's color barcode is its frames in order, each squeezed to one average color, then grouped
 * into N vertical stripes. Averages are taken in linear light (not on gamma-encoded sRGB values),
 * so a stripe is the color the frame would blur to on screen, and letterbox bars are left out so
 * a 2.39:1 film isn't dimmed by its black mattes.
 */

/** A stripe color as stored in the puzzle: lowercase `#rrggbb`. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, "Expected a lowercase #rrggbb color");
export type HexColor = z.infer<typeof hexColorSchema>;

/** Linear-light RGB, each channel 0–1. */
export type LinearRgb = readonly [number, number, number];

/** sRGB 8-bit channel → linear light (the IEC 61966-2-1 transfer function). */
export function srgbToLinear(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light → sRGB 8-bit channel, rounded and clamped. */
export function linearToSrgb(linear: number): number {
  const l = Math.min(1, Math.max(0, linear));
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/** Precomputed `srgbToLinear` for every 8-bit value. */
const LINEAR_LUT: Float64Array = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i);
  return lut;
})();

export function rgbToHex(r: number, g: number, b: number): HexColor {
  const part = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 255)
      throw new Error(`Color channel out of range: ${n}`);
    return n.toString(16).padStart(2, "0");
  };
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const parsed = hexColorSchema.parse(hex);
  return [
    parseInt(parsed.slice(1, 3), 16),
    parseInt(parsed.slice(3, 5), 16),
    parseInt(parsed.slice(5, 7), 16),
  ];
}

export function linearToHex([r, g, b]: LinearRgb): HexColor {
  return rgbToHex(linearToSrgb(r), linearToSrgb(g), linearToSrgb(b));
}

export function hexToLinear(hex: string): LinearRgb {
  const [r, g, b] = hexToRgb(hex);
  return [LINEAR_LUT[r], LINEAR_LUT[g], LINEAR_LUT[b]];
}

/** Rec. 709 relative luminance of a linear color. */
export function luminance([r, g, b]: LinearRgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The mean of linear colors (light adds linearly, so this is the color they blur to). */
export function meanLinear(colors: readonly LinearRgb[]): LinearRgb {
  if (colors.length === 0) throw new Error("Cannot average zero colors");
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [cr, cg, cb] of colors) {
    r += cr;
    g += cg;
    b += cb;
  }
  return [r / colors.length, g / colors.length, b / colors.length];
}

/**
 * Groups frames into `count` stripes of (nearly) equal length, in order, each the linear mean of
 * its frames. Needs at least one frame per stripe.
 */
export function toStripes(
  frames: readonly LinearRgb[],
  count: number,
): HexColor[] {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`Stripe count must be a positive integer, got ${count}`);
  if (frames.length < count) {
    throw new Error(
      `Only ${frames.length} frames for ${count} stripes. Sample more frames per second or ask for fewer stripes.`,
    );
  }
  const stripes: HexColor[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * frames.length) / count);
    const end = Math.floor(((i + 1) * frames.length) / count);
    stripes.push(linearToHex(meanLinear(frames.slice(start, end))));
  }
  return stripes;
}

// ---------------------------------------------------------------------------------------------
// Raw frames (the pipeline's ffmpeg output): packed 8-bit RGB, `width × height` per frame.
// ---------------------------------------------------------------------------------------------

export interface FrameGeometry {
  width: number;
  height: number;
}

/** Rows/columns trimmed from each edge as letterbox or pillarbox mattes. */
export interface Mattes {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A row or column counts as matte when even its brightest moments stay this dark (linear Y). */
export const MATTE_LUMINANCE = 0.012;
/** "Brightest moments": this quantile of the line's luminance over the whole film. */
const MATTE_QUANTILE = 0.98;

function frameCountOf(
  raw: Uint8Array,
  { width, height }: FrameGeometry,
): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(`Invalid frame size ${width}×${height}`);
  }
  const frameBytes = width * height * 3;
  if (raw.length === 0) throw new Error("The video produced no frames");
  if (raw.length % frameBytes !== 0) {
    throw new Error(
      `Raw video is ${raw.length} bytes, not a whole number of ${width}×${height} RGB frames`,
    );
  }
  return raw.length / frameBytes;
}

function quantile(values: Float64Array, q: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * Finds black mattes: rows (from the top and bottom) and columns (from the left and right) that
 * stay dark for practically the whole film. Never trims more than 40% from any side, so a film
 * that is simply dark is left alone.
 */
export function detectMattes(raw: Uint8Array, geometry: FrameGeometry): Mattes {
  const { width, height } = geometry;
  const frames = frameCountOf(raw, geometry);
  const rowLuma = Array.from(
    { length: height },
    () => new Float64Array(frames),
  );
  const colLuma = Array.from({ length: width }, () => new Float64Array(frames));
  for (let f = 0; f < frames; f++) {
    const base = f * width * height * 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = base + (y * width + x) * 3;
        const yLin =
          0.2126 * LINEAR_LUT[raw[i]] +
          0.7152 * LINEAR_LUT[raw[i + 1]] +
          0.0722 * LINEAR_LUT[raw[i + 2]];
        rowLuma[y][f] += yLin / width;
        colLuma[x][f] += yLin / height;
      }
    }
  }
  const isMatte = (series: Float64Array) =>
    quantile(series, MATTE_QUANTILE) < MATTE_LUMINANCE;
  const scan = (lines: Float64Array[], fromEnd: boolean) => {
    const limit = Math.floor(lines.length * 0.4);
    let n = 0;
    while (n < limit && isMatte(lines[fromEnd ? lines.length - 1 - n : n])) n++;
    return n;
  };
  return {
    top: scan(rowLuma, false),
    bottom: scan(rowLuma, true),
    left: scan(colLuma, false),
    right: scan(colLuma, true),
  };
}

/** Each frame's mean linear color over the picture area (inside the mattes). */
export function frameColors(
  raw: Uint8Array,
  geometry: FrameGeometry,
  mattes: Mattes,
): LinearRgb[] {
  const { width, height } = geometry;
  const frames = frameCountOf(raw, geometry);
  const x0 = mattes.left;
  const x1 = width - mattes.right;
  const y0 = mattes.top;
  const y1 = height - mattes.bottom;
  if (x1 <= x0 || y1 <= y0) throw new Error("The mattes leave no picture area");
  const pixels = (x1 - x0) * (y1 - y0);
  const colors: LinearRgb[] = [];
  for (let f = 0; f < frames; f++) {
    const base = f * width * height * 3;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = base + (y * width + x) * 3;
        r += LINEAR_LUT[raw[i]];
        g += LINEAR_LUT[raw[i + 1]];
        b += LINEAR_LUT[raw[i + 2]];
      }
    }
    colors.push([r / pixels, g / pixels, b / pixels]);
  }
  return colors;
}

/** Raw frames → the finished barcode: detect mattes, average each frame, group into stripes. */
export function barcodeFromFrames(
  raw: Uint8Array,
  geometry: FrameGeometry,
  stripes: number,
): { stripes: HexColor[]; frames: number; mattes: Mattes } {
  const mattes = detectMattes(raw, geometry);
  const colors = frameColors(raw, geometry, mattes);
  return { stripes: toStripes(colors, stripes), frames: colors.length, mattes };
}
