/**
 * The colours a film's barcode lends a screen (the Movie Barcode theater, and the home's Movies
 * name), so every film lights the room in its own colours. Pure functions over RGBA pixel data
 * (what a canvas returns), so they run in the browser on a small downsample of a picture and are
 * tested without one (src/games/fade-to-color/palette.test.ts). Kept out of the game's folder so
 * the home can use them without loading the game.
 *
 * Films are often dark and muted: their raw average colour is a muddy brown. So colours are
 * reworked in OKLCH, a perceptual space: hue is kept, lightness is set to a luminous level and
 * chroma is held within a band. A dim, desaturated film still glows in its own hue; a vivid one
 * never turns neon. Where the film's colour touches type it is pressed into hard bars
 * (`pressBars`, `barGradient`): flat colour in film order, never a gradient or a glow.
 */

export type Rgb = readonly [r: number, g: number, b: number];

interface Oklch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
};

export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH to sRGB, lowering chroma (never shifting hue or lightness) until the colour fits. */
export function oklchToRgb(color: Oklch): Rgb {
  let lo = 0;
  let hi = color.c;
  if (!inGamut(oklchToLinear(color))) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    color = { ...color, c: lo };
  }
  const [r, g, b] = oklchToLinear(color);
  return [Math.round(fromLinear(r)), Math.round(fromLinear(g)), Math.round(fromLinear(b))];
}

/** Lightness and chroma targets for the two uses below. */
const ACCENT = { l: 0.79, cMin: 0.05, cMax: 0.15, boost: 1.35 };
const BANDS = { l: 0.78, cMin: 0.035, cMax: 0.16, boost: 1.7, rhythm: 0.35 };

/**
 * The level's accent: the colour that tints the reel's light, its edge print, the guess button
 * and the counter. A saturation-weighted average (vivid pixels count more than grey ones, near
 * black ones barely count), relit to one luminous lightness so dark text stays readable on it.
 */
export function accentOf(pixels: Uint8ClampedArray): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const R = pixels[i];
    const G = pixels[i + 1];
    const B = pixels[i + 2];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const sat = max > 0 ? (max - min) / max : 0;
    const w = 0.15 + sat * sat * 3 + (max > 60 ? 0.3 : 0);
    r += R * w;
    g += G * w;
    b += B * w;
    weight += w;
  }
  if (weight === 0) return oklchToRgb({ l: ACCENT.l, c: ACCENT.cMin, h: 1.2 });
  const { c, h } = rgbToOklch([r / weight, g / weight, b / weight]);
  return oklchToRgb({ l: ACCENT.l, c: clamp(c * ACCENT.boost, ACCENT.cMin, ACCENT.cMax), h });
}

/**
 * The barcode as light: each column's average colour, relit to a luminous level while keeping a
 * little of its original lightness, so the film's rhythm (dark stretches, bright ones) survives.
 * Spills up and down from the reel into the room and washes across it; the soft light, never type.
 */
export function litBands(pixels: Uint8ClampedArray, width: number, height: number): Rgb[] {
  const columns: Oklch[] = [];
  for (let x = 0; x < width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
    }
    columns.push(rgbToOklch([r / height, g / height, b / height]));
  }
  const meanL = columns.reduce((sum, col) => sum + col.l, 0) / Math.max(1, columns.length);
  return columns.map(({ l, c, h }) =>
    oklchToRgb({
      l: clamp(BANDS.l + (l - meanL) * BANDS.rhythm, 0.6, 0.9),
      c: clamp(c * BANDS.boost, BANDS.cMin, BANDS.cMax),
      h,
    }),
  );
}

/** Each column's mean colour (sRGB, as stored), left to right: the barcode before any relighting. */
export function columnMeans(pixels: Uint8ClampedArray, width: number, height: number): Rgb[] {
  const columns: Rgb[] = [];
  for (let x = 0; x < width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
    }
    columns.push([r / height, g / height, b / height]);
  }
  return columns;
}

/** Lightness and chroma targets for the pressed bars. */
const PRESS = { l: 0.74, rhythm: 0.85, lMin: 0.56, lMax: 0.93, grey: 0.02, boost: 1.6, cMin: 0.03, cMax: 0.15 };

/**
 * The film pressed into `n` bars: the columns split into `n` equal runs in film order, each run's
 * mean colour (sRGB), relit around one luminous level. Unlike `litBands` it keeps most of the
 * film's dark/bright rhythm (85% against 35%), so a dark stretch reads as a dark bar; a grey bar
 * stays grey, so a black-and-white film presses in greys. Hue is always the film's own.
 */
export function pressBars(columns: readonly Rgb[], n: number): Rgb[] {
  const W = columns.length;
  if (W === 0 || n < 1) return [];
  const bars: Oklch[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * W) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * W) / n));
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = from; x < to; x++) {
      r += columns[x][0];
      g += columns[x][1];
      b += columns[x][2];
    }
    const k = to - from;
    bars.push(rgbToOklch([r / k, g / k, b / k]));
  }
  const meanL = bars.reduce((sum, bar) => sum + bar.l, 0) / n;
  return bars.map(({ l, c, h }) =>
    oklchToRgb({
      l: clamp(PRESS.l + (l - meanL) * PRESS.rhythm, PRESS.lMin, PRESS.lMax),
      c: c < PRESS.grey ? c : clamp(c * PRESS.boost, PRESS.cMin, PRESS.cMax),
      h,
    }),
  );
}

/**
 * Bars as a CSS gradient of hard, flat stripes: each colour held between two stops, so every edge
 * is sharp at any size, with no image smoothing (and WebKit draws it the same).
 */
export function barGradient(bars: readonly Rgb[]): string {
  const n = bars.length;
  const at = (i: number) => (i === 0 ? "0%" : i === n ? "100%" : `${((100 * i) / n).toFixed(3)}%`);
  return `linear-gradient(90deg, ${bars.map(([r, g, b], i) => `rgb(${r} ${g} ${b}) ${at(i)} ${at(i + 1)}`).join(", ")})`;
}

/** How many bars a title of `letters` letters is pressed into: `perLetter` each, within 12–120. */
export function barCount(letters: number, perLetter: number): number {
  return clamp(Math.round(letters * perLetter), 12, 120);
}

/** The grade the title's light takes (the win's bloom, halo and aura): a touch more contrast and colour. */
export const TITLE_GRADE = { contrast: 1.15, saturate: 1.4 } as const;

/**
 * A colour through CSS's `contrast(c) saturate(s)` filter, worked out once instead of filtering a
 * layer live: contrast first (each channel pushed away from mid grey), then saturation (the
 * filter's luminance-preserving matrix), on 0–255 sRGB values as browsers apply them.
 */
export function gradeRgb([r, g, b]: Rgb, { contrast, saturate }: { contrast: number; saturate: number } = TITLE_GRADE): Rgb {
  const [cr, cg, cb] = [r, g, b].map((v) => clamp((v / 255 - 0.5) * contrast + 0.5, 0, 1));
  const s = saturate;
  const out = [
    (0.213 + 0.787 * s) * cr + (0.715 - 0.715 * s) * cg + (0.072 - 0.072 * s) * cb,
    (0.213 - 0.213 * s) * cr + (0.715 + 0.285 * s) * cg + (0.072 - 0.072 * s) * cb,
    (0.213 - 0.213 * s) * cr + (0.715 - 0.715 * s) * cg + (0.072 + 0.928 * s) * cb,
  ];
  return out.map((v) => Math.round(clamp(v, 0, 1) * 255)) as unknown as Rgb;
}

/** "r g b", the form the CSS custom properties take (`rgb(var(--accent) / 0.5)`). */
export const cssTriplet = ([r, g, b]: Rgb) => `${r} ${g} ${b}`;

/** Relative luminance (WCAG), for checking text drawn on an accent. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * The one rule for colour on type: wherever the film touches a title, it is the film pressed into
 * hard vertical bars of flat colour, in film order (see `pressBars`), never a gradient or a glow.
 * A title gets so many bars per letter, so a short word and a long title read at the same grain.
 * Callers always press from the first reel's columns: the barcode itself, never a later picture.
 */

/** How many letters `text` has (whitespace doesn't count). */
export function letterCount(text: string): number {
  return [...text].filter((ch) => ch.trim()).length;
}

/** `text`'s fill (a CSS gradient), `perLetter` bars to a letter; null with no columns to press. */
export function barsFill(columns: readonly Rgb[] | null | undefined, text: string, perLetter: number): string | null {
  if (!columns || columns.length === 0) return null;
  return barGradient(pressBars(columns, barCount(letterCount(text), perLetter)));
}
