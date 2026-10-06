import { describe, expect, it } from "vitest";
import {
  areaWeights,
  averageColor,
  chooseFrame,
  chunkOf,
  createImage,
  crop,
  cropMattes,
  detectMattes,
  dominantColor,
  filmLook,
  infoScore,
  layoutColumns,
  linearToSrgb,
  lumaOf,
  meanBrightness,
  NEAR_BLACK_FRAME,
  PACES,
  pasteStrip,
  pickStripX,
  REJECTED,
  sampleFrames,
  squeezeColumn,
  srgbToLinear,
  stripEdges,
  stripSchedule,
  type RgbImage,
} from "./barcode-levels.mjs";

// ---------------------------------------------------------------------------------------------
// Synthetic images
// ---------------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** An image whose pixel (x, y) is `paint(x, y)`. */
function paint(width: number, height: number, fill: (x: number, y: number) => Rgb): RgbImage {
  const image = createImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) image.data.set(fill(x, y), (y * width + x) * 3);
  }
  return image;
}

const solid = (width: number, height: number, rgb: Rgb) => paint(width, height, () => rgb);
const pixel = (image: RgbImage, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];
const withLuma = (image: RgbImage) => ({ width: image.width, height: image.height, luma: lumaOf(image) });

/** A frame that is flat grey except for a checkerboard over columns [x0, x1). */
function texturedAt(width: number, height: number, x0: number, x1: number): RgbImage {
  return paint(width, height, (x, y) => (x >= x0 && x < x1 ? ((x >> 2) + (y >> 2)) % 2 ? [230, 230, 230] : [30, 30, 30] : [120, 120, 120]));
}

// ---------------------------------------------------------------------------------------------

describe("colour basics", () => {
  it("round-trips sRGB through linear light", () => {
    for (const v of [0, 1, 10, 54, 128, 200, 255]) expect(linearToSrgb(srgbToLinear(v))).toBe(v);
  });

  it("averages colour in linear light, not in gamma-encoded values", () => {
    // Half black, half white blurs to ~188 on screen, not 128.
    const image = paint(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
    expect(averageColor(image)).toBe("#bcbcbc");
  });

  it("measures mean brightness over every channel", () => {
    expect(meanBrightness(solid(4, 4, [30, 60, 90]))).toBe(60);
  });

  it("crops a rectangle and refuses one outside the image", () => {
    const image = paint(4, 3, (x, y) => [x, y, 0]);
    const part = crop(image, 1, 1, 2, 2);
    expect([part.width, part.height]).toEqual([2, 2]);
    expect(pixel(part, 0, 0)).toEqual([1, 1, 0]);
    expect(pixel(part, 1, 1)).toEqual([2, 2, 0]);
    expect(() => crop(image, 3, 0, 2, 1)).toThrow(/outside/);
  });
});

describe("areaWeights", () => {
  it("averages neighbours when shrinking and covers each output cell exactly once", () => {
    const cells = areaWeights(6, 4);
    for (const parts of cells) expect(parts.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 9);
    expect(cells[0]).toEqual([
      { index: 0, weight: 2 / 3 },
      { index: 1, weight: 1 / 3 },
    ]);
  });

  it("repeats a source cell when growing", () => {
    expect(areaWeights(2, 4).map((parts) => parts.map((p) => p.index))).toEqual([[0], [0], [1], [1]]);
  });
});

describe("detectMattes", () => {
  /** A 2.39:1 picture letterboxed in a 16:9 frame: black rows above and below. */
  const letterboxed = (shade: number) => paint(32, 18, (_, y) => (y < 4 || y >= 14 ? [0, 0, 0] : [shade, shade / 2, 40]));

  it("finds letterbox bars that stay black across the film", () => {
    const mattes = detectMattes([letterboxed(200), letterboxed(90), letterboxed(160)]);
    expect(mattes).toEqual({ top: 4 / 18, bottom: 4 / 18, left: 0, right: 0 });
    const cut = cropMattes(letterboxed(200), mattes);
    expect([cut.width, cut.height]).toEqual([32, 10]);
  });

  it("keeps a dark scene whole when the rest of the film fills the frame", () => {
    const night = paint(32, 18, (_, y) => (y < 6 ? [0, 0, 0] : [20, 20, 30]));
    const day = solid(32, 18, [180, 170, 150]);
    expect(detectMattes([night, day, day, day])).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("never cuts more than 40% from a side of an all-black film", () => {
    const black = solid(10, 10, [0, 0, 0]);
    const mattes = detectMattes([black, black]);
    expect(mattes.top).toBeLessThanOrEqual(0.4);
    expect(mattes.bottom).toBeLessThanOrEqual(0.4);
  });
});

describe("level 1: squeezed frames", () => {
  it("squeezes each band of a frame into one row and keeps the vertical structure", () => {
    // Blue sky over sand: the column is blue on top, sand below.
    const frame = paint(8, 4, (_, y) => (y < 2 ? [40, 90, 200] : [210, 180, 120]));
    const column = squeezeColumn(frame, 2);
    expect(Array.from(column).map((v) => linearToSrgb(v))).toEqual([40, 90, 200, 210, 180, 120]);
  });

  it("averages across the width in linear light", () => {
    const frame = paint(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
    expect(linearToSrgb(squeezeColumn(frame, 1)[0]!)).toBe(188);
  });

  it("lays columns out left to right in film order, spreading few columns over many pixels", () => {
    const red = squeezeColumn(solid(3, 3, [200, 0, 0]), 3);
    const green = squeezeColumn(solid(3, 3, [0, 200, 0]), 3);
    const strip = layoutColumns([red, green], 4);
    expect([strip.width, strip.height]).toEqual([4, 3]);
    expect([0, 1, 2, 3].map((x) => pixel(strip, x, 1))).toEqual([
      [200, 0, 0],
      [200, 0, 0],
      [0, 200, 0],
      [0, 200, 0],
    ]);
  });

  it("averages neighbouring columns when there are more frames than pixels", () => {
    const black = squeezeColumn(solid(2, 2, [0, 0, 0]), 2);
    const white = squeezeColumn(solid(2, 2, [255, 255, 255]), 2);
    const strip = layoutColumns([black, white, black, white], 2);
    expect(pixel(strip, 0, 0)).toEqual([188, 188, 188]);
    expect(pixel(strip, 1, 1)).toEqual([188, 188, 188]);
  });

  it("samples frames evenly over the whole film, in order", () => {
    expect(sampleFrames(100, 4)).toEqual([13, 38, 63, 88]);
    expect(sampleFrames(3, 10)).toEqual([1, 2, 3]);
    const many = sampleFrames(23457, 2400);
    expect(many).toHaveLength(2400);
    expect(many[0]).toBeGreaterThanOrEqual(1);
    expect(many.at(-1)).toBeLessThanOrEqual(23457);
    expect(many.every((n, i) => i === 0 || n > many[i - 1]!)).toBe(true);
  });
});

describe("levels 2–10: the edges-first schedule", () => {
  it("moves the crop from the frame edge to its centre over nine levels", () => {
    const schedule = stripSchedule(PACES.normal);
    expect(schedule.map((s) => s.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(schedule.map((s) => s.strips)).toEqual([128, 88, 60, 42, 30, 21, 15, 10, 6]);
    expect(schedule[0]!.crop).toBe(0);
    expect(schedule.at(-1)!.crop).toBe(1);
    expect(schedule[4]!.crop).toBeCloseTo(0.5, 9);
  });

  it("stays at the edges longer on the slower pace and reaches the centre sooner on the faster one", () => {
    const mid = (pace: keyof typeof PACES) => stripSchedule(PACES[pace])[4]!.crop;
    expect(mid("slower")).toBeLessThan(mid("normal"));
    expect(mid("faster")).toBeGreaterThan(mid("normal"));
    for (const pace of Object.values(PACES)) {
      expect(pace.strips).toHaveLength(9);
      expect(pace.strips.every((n, i) => i === 0 || n < pace.strips[i - 1]!)).toBe(true);
    }
  });

  it("cuts the canvas into equal strips that tile it exactly", () => {
    expect(stripEdges(2400, 6)).toEqual([0, 400, 800, 1200, 1600, 2000, 2400]);
    const edges = stripEdges(2400, 128);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(2400);
    const widths = edges.slice(1).map((e, i) => e - edges[i]!);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  it("takes each stretch's middle frame and keeps stretches in film order", () => {
    expect(chunkOf(1000, 4, 0)).toEqual({ target: 125, first: 1, last: 250 });
    expect(chunkOf(1000, 4, 3)).toEqual({ target: 875, first: 751, last: 1000 });
    const chunks = Array.from({ length: 128 }, (_, i) => chunkOf(23457, 128, i));
    expect(chunks.every((c, i) => c.first <= c.target && c.target <= c.last && (i === 0 || c.first === chunks[i - 1]!.last + 1))).toBe(true);
  });
});

describe("chooseFrame: skipping near-black frames", () => {
  const total = 10_000;
  const sampled = sampleFrames(total, 2000); // every 5th frame
  const chunk = chunkOf(total, 10, 4); // frames 4001–5000, middle 4500

  it("uses the stretch's middle frame when it isn't dark", () => {
    const bright = new Map(sampled.map((n) => [n, 120]));
    const chosen = chooseFrame(chunk, total, sampled, bright);
    expect(Math.abs(chosen - chunk.target)).toBeLessThanOrEqual(3);
  });

  it("looks a little later, then earlier, for a frame that isn't near black", () => {
    // Everything within 30 frames of the middle is black (a fade); the +0.25% candidate (25 frames on) is too.
    const brightness = new Map(sampled.map((n) => [n, Math.abs(n - chunk.target) <= 30 ? 5 : 120]));
    const chosen = chooseFrame(chunk, total, sampled, brightness);
    expect(brightness.get(chosen)).toBeGreaterThan(NEAR_BLACK_FRAME);
    expect(chosen).toBeGreaterThanOrEqual(chunk.first);
    expect(chosen).toBeLessThanOrEqual(chunk.last);
    expect(Math.abs(chosen - chunk.target)).toBeLessThanOrEqual(55);
  });

  it("never leaves the stretch, and falls back to the middle when everything nearby is black", () => {
    const black = new Map(sampled.map((n) => [n, 3]));
    const chosen = chooseFrame(chunk, total, sampled, black);
    expect(Math.abs(chosen - chunk.target)).toBeLessThanOrEqual(3);
    const tiny = chunkOf(total, 400, 7); // 25 frames wide: offsets of ±25 and ±50 frames are clamped into it
    const inTiny = chooseFrame(tiny, total, sampled, new Map(sampled.map((n) => [n, n === tiny.target ? 0 : 99])));
    expect(inTiny).toBeGreaterThanOrEqual(tiny.first);
    expect(inTiny).toBeLessThanOrEqual(tiny.last);
  });
});

describe("smart crop scoring", () => {
  it("rejects near-black windows", () => {
    const frame = withLuma(paint(40, 10, (x) => (x < 20 ? [5, 5, 5] : [150, 150, 150])));
    expect(infoScore(frame.luma, 40, 10, 0, 10)).toBe(REJECTED);
    expect(infoScore(frame.luma, 40, 10, 25, 10)).toBeGreaterThan(REJECTED);
  });

  it("scores texture and contrast above a flat field", () => {
    const frame = withLuma(texturedAt(80, 20, 40, 80));
    const flat = infoScore(frame.luma, 80, 20, 0, 20);
    const textured = infoScore(frame.luma, 80, 20, 50, 20);
    expect(flat).toBe(0);
    expect(textured).toBeGreaterThan(50);
  });

  it("matches the prototype's formula: mean |dy| + mean |dx| + 0.35 × std", () => {
    // Vertical stripes 0/100: |dx| is 100 everywhere, |dy| is 0, std is 50. Mean 50 > 24.
    const frame = withLuma(paint(4, 3, (x) => (x % 2 ? [100, 100, 100] : [0, 0, 0])));
    expect(infoScore(frame.luma, 4, 3, 0, 4)).toBeCloseTo(100 + 0.35 * 50, 3);
  });
});

describe("pickStripX: edges first, never past the centre", () => {
  const W = 400;
  const H = 20;
  const stripWidth = 40;

  it("cuts at the left edge first, and at the right edge for the next strip", () => {
    const frame = withLuma(paint(W, H, (x, y) => [((x * 7 + y * 13) % 200) + 40, 120, 90])); // evenly textured
    expect(pickStripX(frame, stripWidth, true, 0)).toBeLessThan(W * 0.15);
    expect(pickStripX(frame, stripWidth, false, 0) + stripWidth).toBeGreaterThan(W * 0.85);
  });

  it("ends at the centre on the last level", () => {
    const frame = withLuma(paint(W, H, (x, y) => [((x * 7 + y * 13) % 200) + 40, 120, 90]));
    for (const fromLeft of [true, false]) {
      const x = pickStripX(frame, stripWidth, fromLeft, 1);
      expect(Math.abs(x + stripWidth / 2 - W / 2)).toBeLessThanOrEqual(W * 0.05);
    }
  });

  it("moves toward the most informative window near the target", () => {
    // Flat frame with texture only between 50 and 100: near the left edge, the textured window wins.
    const frame = withLuma(texturedAt(W, H, 50, 100));
    const x = pickStripX(frame, stripWidth, true, 0);
    expect(x).toBeGreaterThanOrEqual(45);
    expect(x + stripWidth).toBeLessThanOrEqual(105);
  });

  it("skips a black edge for a nearby window with picture in it", () => {
    // The left 50 px are black (a dark doorway): the window at the very edge would be all black.
    const frame = withLuma(paint(W, H, (x, y) => (x < 50 ? [4, 4, 4] : [((x * 7 + y * 13) % 200) + 40, 110, 80])));
    expect(infoScore(frame.luma, W, H, 8, stripWidth)).toBe(REJECTED);
    const x = pickStripX(frame, stripWidth, true, 0);
    expect(infoScore(frame.luma, W, H, x, stripWidth)).toBeGreaterThan(REJECTED);
    expect(x).toBeLessThan(W * 0.2);
  });

  it("keeps a left strip's centre left of the frame's centre, however tempting the right half", () => {
    const frame = withLuma(texturedAt(W, H, 220, 400));
    for (const crop of [0.5, 0.8, 1]) {
      const x = pickStripX(frame, stripWidth, true, crop);
      expect(x + stripWidth / 2).toBeLessThanOrEqual(W / 2);
    }
  });

  it("refuses a strip wider than the frame", () => {
    expect(() => pickStripX(withLuma(solid(30, 5, [90, 90, 90])), 40, true, 0)).toThrow(/doesn't fit/);
  });
});

describe("pasteStrip", () => {
  it("copies a full-height strip into its place on the canvas", () => {
    const canvas = createImage(6, 2);
    const frame = paint(10, 2, (x) => [x * 10, 0, 0]);
    pasteStrip(canvas, frame, 4, 2, 3);
    expect(pixel(canvas, 3, 0)).toEqual([40, 0, 0]);
    expect(pixel(canvas, 4, 1)).toEqual([50, 0, 0]);
    expect(pixel(canvas, 2, 0)).toEqual([0, 0, 0]);
    expect(() => pasteStrip(canvas, frame, 9, 2, 0)).toThrow(/out of bounds/);
  });
});

describe("colour data", () => {
  it("finds the dominant colour, ignoring black unless it is most of the picture", () => {
    const mostlyBlackWithOrange = paint(10, 10, (x) => (x < 5 ? [0, 0, 0] : x < 8 ? [230, 120, 30] : [30, 90, 200]));
    expect(dominantColor(mostlyBlackWithOrange)).toBe("#e6781e");
    expect(dominantColor(paint(10, 10, (x) => (x < 8 ? [2, 2, 2] : [230, 120, 30])))).toBe("#020202");
  });

  it("measures colourfulness and flags black-and-white films", () => {
    const grey = [solid(8, 8, [120, 120, 120]), paint(8, 8, (x) => [x * 30, x * 30, x * 30])];
    const colour = [solid(8, 8, [200, 60, 40]), solid(8, 8, [40, 120, 200])];
    expect(filmLook(grey)).toMatchObject({ saturation: 0, monochrome: true });
    const look = filmLook(colour);
    expect(look.monochrome).toBe(false);
    expect(look.saturation).toBeGreaterThan(0.6);
    // A faint tint everywhere (a toned print) is still black and white.
    expect(filmLook([solid(8, 8, [130, 124, 112])]).monochrome).toBe(true);
  });
});
