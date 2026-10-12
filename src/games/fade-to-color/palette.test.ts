import { describe, expect, it } from "vitest";
import { accentOf, barCount, barGradient, columnMeans, gradeRgb, litBands, luminance, oklchToRgb, pressBars, rgbToOklch, type Rgb } from "./palette";

/** RGBA pixels, one per colour, in order. */
function pixels(...colors: Rgb[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
}

const hueDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe("OKLCH round trip", () => {
  it.each(
    ([
      [0, 0, 0],
      [255, 255, 255],
      [200, 120, 40],
      [20, 90, 160],
      [128, 128, 128],
    ] as Rgb[]).map((rgb) => ({ rgb })),
  )("returns $rgb unchanged", ({ rgb }) => {
    expect(oklchToRgb(rgbToOklch(rgb))).toEqual(rgb);
  });

  it("brings out-of-gamut colours in by lowering chroma, keeping the hue", () => {
    const wild = { l: 0.8, c: 0.4, h: 0.5 };
    const rgb = oklchToRgb(wild);
    rgb.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    rgb.forEach((v) => expect(v).toBeLessThanOrEqual(255));
    const back = rgbToOklch(rgb);
    expect(back.l).toBeCloseTo(0.8, 2);
    expect(hueDistance(back.h, 0.5)).toBeLessThan(0.05);
  });
});

describe("accentOf", () => {
  it("lifts a dark, muddy film to a luminous accent of the same hue", () => {
    const muddy: Rgb = [52, 40, 30];
    const accent = accentOf(pixels(muddy, muddy, muddy));
    expect(rgbToOklch(accent).l).toBeCloseTo(0.79, 2);
    expect(hueDistance(rgbToOklch(accent).h, rgbToOklch(muddy).h)).toBeLessThan(0.1);
  });

  it("lets vivid pixels outweigh grey ones", () => {
    const red: Rgb = [200, 30, 30];
    const grey: Rgb = [120, 120, 120];
    const accent = accentOf(pixels(red, grey, grey, grey));
    expect(hueDistance(rgbToOklch(accent).h, rgbToOklch(red).h)).toBeLessThan(0.35);
  });

  it("never goes neon", () => {
    expect(rgbToOklch(accentOf(pixels([255, 0, 255]))).c).toBeLessThanOrEqual(0.1501);
  });

  it("is light enough for dark text on it", () => {
    for (const color of [[10, 10, 60], [60, 0, 0], [0, 40, 0], [5, 5, 5]] as Rgb[]) {
      // Contrast of near-black (#0a0a0a) text on the accent stays at least 7:1.
      expect((luminance(accentOf(pixels(color))) + 0.05) / (luminance([10, 10, 10]) + 0.05)).toBeGreaterThan(7);
    }
  });

  it("has an answer for an empty image", () => {
    expect(accentOf(new Uint8ClampedArray())).toHaveLength(3);
  });
});

describe("litBands", () => {
  it("gives one colour per column, in order", () => {
    // Two columns, two rows: a blue column then an orange one.
    const blue: Rgb = [20, 40, 90];
    const orange: Rgb = [120, 60, 10];
    const bands = litBands(pixels(blue, orange, blue, orange), 2, 2);
    expect(bands).toHaveLength(2);
    expect(hueDistance(rgbToOklch(bands[0]).h, rgbToOklch(blue).h)).toBeLessThan(0.15);
    expect(hueDistance(rgbToOklch(bands[1]).h, rgbToOklch(orange).h)).toBeLessThan(0.15);
  });

  it("relights dark columns but keeps some of the film's rhythm", () => {
    const dark: Rgb = [15, 15, 20];
    const bright: Rgb = [180, 170, 150];
    const [a, b] = litBands(pixels(dark, bright), 2, 1);
    expect(rgbToOklch(a).l).toBeGreaterThan(0.6);
    expect(rgbToOklch(b).l).toBeGreaterThan(rgbToOklch(a).l);
  });
});

describe("columnMeans", () => {
  it("gives each column's mean colour, left to right", () => {
    // Two columns, two rows: black over white, then red over blue.
    const means = columnMeans(pixels([0, 0, 0], [200, 0, 0], [255, 255, 255], [0, 0, 100]), 2, 2);
    expect(means).toEqual([
      [127.5, 127.5, 127.5],
      [100, 0, 50],
    ]);
  });
});

describe("pressBars", () => {
  it("presses an even film into even bars at the luminous level", () => {
    const columns = Array.from({ length: 480 }, (): Rgb => [90, 70, 50]);
    const bars = pressBars(columns, 32);
    expect(bars).toHaveLength(32);
    for (const bar of bars) {
      expect(bar).toEqual(bars[0]);
      expect(Math.abs(rgbToOklch(bar).l - 0.74)).toBeLessThan(0.005);
    }
  });

  it("keeps the film's order and most of its rhythm: a dark run is a dark bar", () => {
    const dark: Rgb = [20, 25, 40];
    const bright: Rgb = [200, 170, 120];
    const columns = [...Array<Rgb>(10).fill(dark), ...Array<Rgb>(10).fill(bright)];
    const [a, b] = pressBars(columns, 2);
    expect(rgbToOklch(b).l - rgbToOklch(a).l).toBeGreaterThan(0.25);
    expect(hueDistance(rgbToOklch(a).h, rgbToOklch(dark).h)).toBeLessThan(0.15);
  });

  it("keeps a black-and-white film grey", () => {
    const columns: Rgb[] = [[30, 30, 30], [120, 120, 120], [220, 220, 220]];
    for (const bar of pressBars(columns, 3)) expect(rgbToOklch(bar).c).toBeLessThan(0.02);
  });

  it("gives every bar at least one column when there are more bars than columns", () => {
    expect(pressBars([[10, 20, 30], [200, 100, 50]], 5)).toHaveLength(5);
    expect(pressBars([], 5)).toEqual([]);
  });
});

describe("barGradient", () => {
  it("holds each bar between two stops, for hard edges", () => {
    const css = barGradient([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(css.startsWith("linear-gradient(90deg, ")).toBe(true);
    expect(css).toContain("rgb(1 2 3) 0% 33.333%");
    expect(css).toContain("rgb(4 5 6) 33.333% 66.667%");
    expect(css).toContain("rgb(7 8 9) 66.667% 100%");
  });
});

describe("barCount", () => {
  it("is so many per letter, within 12–120", () => {
    expect(barCount(1, 5)).toBe(12);
    expect(barCount(7, 5)).toBe(35);
    expect(barCount(30, 7)).toBe(120);
  });
});

describe("gradeRgb", () => {
  it("leaves mid grey alone", () => {
    expect(gradeRgb([128, 128, 128])).toEqual([128, 128, 128]);
  });

  it("is the identity at contrast 1, saturate 1", () => {
    expect(gradeRgb([200, 120, 40], { contrast: 1, saturate: 1 })).toEqual([200, 120, 40]);
  });

  it("pushes lights lighter and darks darker", () => {
    expect(gradeRgb([200, 200, 200])[0]).toBeGreaterThan(200);
    expect(gradeRgb([60, 60, 60])[0]).toBeLessThan(60);
  });

  it("makes a colour more colourful without changing its hue much", () => {
    const warm: Rgb = [200, 150, 110];
    const graded = gradeRgb(warm);
    expect(rgbToOklch(graded).c).toBeGreaterThan(rgbToOklch(warm).c);
    expect(hueDistance(rgbToOklch(graded).h, rgbToOklch(warm).h)).toBeLessThan(0.15);
  });

  it("stays in range", () => {
    for (const v of gradeRgb([255, 0, 255])) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
