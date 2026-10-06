import { describe, expect, it } from "vitest";
import {
  boxWidthsForGaussian,
  createRgbImage,
  deltaE,
  extractPalette,
  gaussianBlur,
  hexToRgb,
  labStats,
  labToSrgb,
  linearToSrgb,
  reinhardTransfer,
  relativeLuminance,
  rgbToHex,
  roundShares,
  srgbToLab,
  srgbToLinear,
  toLabPixels,
  type Rgb,
  type RgbImage,
} from "./imaging";

/** An image made of horizontal bands: [color, rows][] stacked top to bottom. */
function bands(width: number, rows: readonly (readonly [Rgb, number])[]): RgbImage {
  const height = rows.reduce((sum, [, h]) => sum + h, 0);
  const image = createRgbImage(width, height);
  let y = 0;
  for (const [[r, g, b], h] of rows) {
    for (let row = y; row < y + h; row++) {
      for (let x = 0; x < width; x++) image.data.set([r, g, b], (row * width + x) * 3);
    }
    y += h;
  }
  return image;
}

function solid(width: number, height: number, color: Rgb): RgbImage {
  return bands(width, [[color, height]]);
}

/** Deterministic pseudo-random pixels (xorshift), for images with real spread. */
function noise(width: number, height: number, seed: number, around: Rgb, spread: number): RgbImage {
  const image = createRgbImage(width, height);
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000) / 1000;
  };
  for (let i = 0; i < image.data.length; i += 3) {
    for (let c = 0; c < 3; c++) image.data[i + c] = Math.max(0, Math.min(255, Math.round(around[c] + (next() - 0.5) * 2 * spread)));
  }
  return image;
}

const pixel = (image: RgbImage, x: number, y: number): Rgb => {
  const i = (y * image.width + x) * 3;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
};

describe("colour conversion", () => {
  it("maps the reference colours to their published Lab values", () => {
    const close = (lab: readonly number[], expected: readonly number[]) => lab.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 1));
    close(srgbToLab(255, 255, 255), [100, 0, 0]);
    close(srgbToLab(0, 0, 0), [0, 0, 0]);
    close(srgbToLab(255, 0, 0), [53.24, 80.09, 67.2]);
    close(srgbToLab(0, 0, 255), [32.3, 79.19, -107.86]);
    // Grays are achromatic.
    const [, a, b] = srgbToLab(128, 128, 128);
    expect(Math.abs(a)).toBeLessThan(1e-3);
    expect(Math.abs(b)).toBeLessThan(1e-3);
  });

  it("round-trips sRGB → Lab → sRGB exactly across the cube", () => {
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          expect(labToSrgb(...srgbToLab(r, g, b))).toEqual([r, g, b]);
        }
      }
    }
  });

  it("round-trips the transfer curve for every byte", () => {
    for (let i = 0; i < 256; i++) expect(linearToSrgb(srgbToLinear(i))).toBe(i);
    expect(linearToSrgb(-0.5)).toBe(0);
    expect(linearToSrgb(7)).toBe(255);
  });

  it("formats and parses hex", () => {
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
    expect(hexToRgb("#FF8000")).toEqual([255, 128, 0]);
    expect(() => hexToRgb("ff8000")).toThrow();
  });

  it("measures luminance and colour difference", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(deltaE(srgbToLab(10, 20, 30), srgbToLab(10, 20, 30))).toBe(0);
    expect(deltaE([50, 0, 0], [53, 4, 0])).toBe(5);
  });
});

describe("extractPalette", () => {
  const COLORS: Rgb[] = [
    [20, 40, 60],
    [230, 120, 40],
    [240, 230, 210],
    [40, 140, 120],
    [150, 20, 30],
  ];
  const ROWS = [40, 25, 15, 12, 8];
  const image = bands(50, COLORS.map((c, i) => [c, ROWS[i]] as const));

  it("finds each flat colour exactly, with its share, largest first", () => {
    const palette = extractPalette(image, { k: 5, seed: 7 });
    expect(palette.map((p) => p.hex)).toEqual(COLORS.map(rgbToHex));
    palette.forEach((p, i) => expect(p.share).toBeCloseTo(ROWS[i] / 100, 1));
    expect(palette.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 10);
  });

  it("is deterministic for a seed and stable across seeds on well-separated colours", () => {
    const a = extractPalette(image, { seed: 1 });
    expect(extractPalette(image, { seed: 1 })).toEqual(a);
    expect(extractPalette(image, { seed: 99 }).map((p) => p.hex)).toEqual(a.map((p) => p.hex));
  });

  it("finds cluster centres in noisy images", () => {
    const left = noise(40, 40, 3, [200, 60, 50], 12);
    const right = noise(40, 40, 4, [30, 90, 200], 12);
    const merged = createRgbImage(80, 40);
    for (let y = 0; y < 40; y++) {
      merged.data.set(left.data.subarray(y * 120, y * 120 + 120), y * 240);
      merged.data.set(right.data.subarray(y * 120, y * 120 + 120), y * 240 + 120);
    }
    const palette = extractPalette(merged, { k: 2, seed: 5 });
    const expected = [srgbToLab(200, 60, 50), srgbToLab(30, 90, 200)];
    for (const target of expected) {
      expect(Math.min(...palette.map((p) => deltaE(p.lab, target)))).toBeLessThan(3);
    }
    palette.forEach((p) => expect(p.share).toBeCloseTo(0.5, 1));
  });

  it("refuses an image with too few distinct colours", () => {
    expect(() => extractPalette(solid(20, 20, [90, 90, 90]), { k: 5 })).toThrow(/fewer than 5 distinct colours/);
    expect(() => extractPalette(bands(10, [[[0, 0, 0], 5], [[255, 255, 255], 5]]), { k: 3 })).toThrow();
    expect(extractPalette(solid(4, 4, [90, 90, 90]), { k: 1 })[0]).toMatchObject({ hex: "#5a5a5a", share: 1 });
  });

  it("validates k", () => {
    expect(() => extractPalette(image, { k: 0 })).toThrow();
    expect(() => extractPalette(image, { k: 17 })).toThrow();
  });
});

describe("labStats", () => {
  it("computes per-channel mean and population standard deviation", () => {
    const stats = labStats(Float32Array.from([10, 0, -4, 30, 2, 4]));
    expect(stats.mean).toEqual([20, 1, 0]);
    expect(stats.std).toEqual([10, 1, 4]);
  });

  it("rejects an empty buffer", () => {
    expect(() => labStats(new Float32Array(0))).toThrow();
  });
});

describe("reinhardTransfer", () => {
  const neutral = noise(48, 32, 11, [128, 128, 128], 60);
  const warmLook = noise(48, 32, 12, [180, 120, 70], 25);

  it("gives the target the source's Lab mean and spread", () => {
    const graded = reinhardTransfer(neutral, warmLook);
    const got = labStats(toLabPixels(graded));
    const want = labStats(toLabPixels(warmLook));
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(got.mean[c] - want.mean[c])).toBeLessThan(1.5);
      expect(Math.abs(got.std[c] - want.std[c])).toBeLessThan(1.5);
    }
    // And it really did tint the gray scene warm.
    expect(got.mean[2]).toBeGreaterThan(15);
  });

  it("keeps the target's structure: brighter stays brighter", () => {
    const ramp = bands(4, [
      [[60, 60, 60], 2],
      [[120, 120, 120], 2],
      [[200, 200, 200], 2],
    ]);
    const graded = reinhardTransfer(ramp, warmLook);
    const l = (y: number) => srgbToLab(...pixel(graded, 0, y))[0];
    expect(l(0)).toBeLessThan(l(2));
    expect(l(2)).toBeLessThan(l(4));
  });

  it("is the identity when source and target match, or at strength 0", () => {
    const same = reinhardTransfer(warmLook, warmLook);
    for (let i = 0; i < same.data.length; i++) expect(Math.abs(same.data[i] - warmLook.data[i])).toBeLessThanOrEqual(1);
    expect(reinhardTransfer(neutral, warmLook, { strength: 0 }).data).toEqual(neutral.data);
  });

  it("accepts precomputed statistics", () => {
    const stats = labStats(toLabPixels(warmLook));
    expect(reinhardTransfer(neutral, stats).data).toEqual(reinhardTransfer(neutral, warmLook).data);
  });

  it("moves a flat target's mean without dividing by zero", () => {
    const graded = reinhardTransfer(solid(4, 4, [128, 128, 128]), warmLook);
    const lab = srgbToLab(...pixel(graded, 1, 1));
    const want = labStats(toLabPixels(warmLook)).mean;
    expect(deltaE(lab, want)).toBeLessThan(1.5);
    expect(graded.data.every((v) => Number.isInteger(v))).toBe(true);
  });

  it("caps the contrast stretch with maxScale", () => {
    const flatish = noise(32, 32, 5, [128, 128, 128], 3);
    const contrasty = noise(32, 32, 6, [128, 128, 128], 120);
    const capped = labStats(toLabPixels(reinhardTransfer(flatish, contrasty, { maxScale: 2 })));
    const before = labStats(toLabPixels(flatish));
    expect(capped.std[0]).toBeLessThan(before.std[0] * 2 + 0.5);
  });

  it("validates its options", () => {
    expect(() => reinhardTransfer(neutral, warmLook, { strength: 2 })).toThrow();
    expect(() => reinhardTransfer(neutral, warmLook, { maxScale: 0.5 })).toThrow();
  });
});

describe("gaussianBlur", () => {
  it("approximates a Gaussian with odd box widths", () => {
    for (const sigma of [1, 2.5, 8, 30]) {
      const widths = boxWidthsForGaussian(sigma);
      expect(widths).toHaveLength(3);
      widths.forEach((w) => expect(w % 2).toBe(1));
      // Variance of a box of width w is (w² − 1) / 12; three passes should sum to ≈ σ².
      const variance = widths.reduce((sum, w) => sum + (w * w - 1) / 12, 0);
      expect(Math.abs(variance - sigma * sigma) / (sigma * sigma)).toBeLessThan(0.35);
    }
  });

  it("leaves a flat image unchanged and keeps dimensions", () => {
    const flat = solid(17, 9, [12, 200, 77]);
    const blurred = gaussianBlur(flat, 4);
    expect(blurred.width).toBe(17);
    expect(blurred.height).toBe(9);
    expect(blurred.data).toEqual(flat.data);
  });

  it("returns a copy for sigma 0", () => {
    const image = noise(5, 5, 1, [100, 100, 100], 50);
    const copy = gaussianBlur(image, 0);
    expect(copy.data).toEqual(image.data);
    expect(copy.data).not.toBe(image.data);
  });

  it("spreads a point of light symmetrically and conserves its energy in linear light", () => {
    const size = 41;
    const dot = solid(size, size, [0, 0, 0]);
    dot.data.set([255, 255, 255], (20 * size + 20) * 3);
    const blurred = gaussianBlur(dot, 3);
    const at = (x: number, y: number) => pixel(blurred, x, y)[0];
    expect(at(20, 20)).toBeGreaterThan(at(23, 20));
    expect(at(23, 20)).toBeGreaterThan(at(26, 20));
    expect(at(17, 20)).toBe(at(23, 20));
    expect(at(20, 17)).toBe(at(20, 23));
    expect(at(0, 0)).toBe(0);
    let energy = 0;
    for (let i = 0; i < blurred.data.length; i += 3) energy += srgbToLinear(blurred.data[i]);
    expect(energy).toBeGreaterThan(0.8);
    expect(energy).toBeLessThan(1.2);
  });

  it("softens an edge into a monotonic ramp", () => {
    const edge = createRgbImage(30, 1);
    for (let x = 15; x < 30; x++) edge.data.set([255, 255, 255], x * 3);
    const blurred = gaussianBlur(edge, 3);
    for (let x = 1; x < 30; x++) expect(pixel(blurred, x, 0)[0]).toBeGreaterThanOrEqual(pixel(blurred, x - 1, 0)[0]);
    expect(pixel(blurred, 0, 0)[0]).toBe(0);
    expect(pixel(blurred, 29, 0)[0]).toBe(255);
  });

  it("rejects a bad sigma", () => {
    expect(() => gaussianBlur(solid(2, 2, [0, 0, 0]), -1)).toThrow();
    expect(() => gaussianBlur(solid(2, 2, [0, 0, 0]), Number.NaN)).toThrow();
  });
});

describe("createRgbImage", () => {
  it("checks dimensions and buffer size", () => {
    expect(() => createRgbImage(0, 4)).toThrow();
    expect(() => createRgbImage(2, 2, new Uint8Array(5))).toThrow();
    expect(createRgbImage(2, 2).data).toHaveLength(12);
  });
});

describe("roundShares", () => {
  it("rounds to the given precision while keeping the sum at exactly 1", () => {
    const rounded = roundShares([1 / 3, 1 / 3, 1 / 3]);
    expect(rounded).toEqual([0.334, 0.333, 0.333]);
    const many = roundShares([0.40004, 0.24996, 0.15, 0.12, 0.08]);
    expect(Math.round(many.reduce((s, x) => s + x, 0) * 1000)).toBe(1000);
    expect(roundShares([2, 2])).toEqual([0.5, 0.5]);
    expect(() => roundShares([0, 0])).toThrow();
  });
});
