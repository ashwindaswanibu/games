import { describe, expect, it } from "vitest";
import {
  barcodeFromFrames,
  detectMattes,
  frameColors,
  hexToLinear,
  hexToRgb,
  linearToHex,
  linearToSrgb,
  meanLinear,
  rgbToHex,
  srgbToLinear,
  toStripes,
} from "./barcode";

describe("color conversions", () => {
  it("round-trips every 8-bit sRGB value through linear light", () => {
    for (let v = 0; v < 256; v++) expect(linearToSrgb(srgbToLinear(v))).toBe(v);
  });

  it("parses and formats hex", () => {
    expect(hexToRgb("#0a80ff")).toEqual([10, 128, 255]);
    expect(rgbToHex(10, 128, 255)).toBe("#0a80ff");
    expect(linearToHex(hexToLinear("#c0ffee"))).toBe("#c0ffee");
    expect(() => hexToRgb("#FFF")).toThrow();
    expect(() => rgbToHex(256, 0, 0)).toThrow();
  });

  it("averages in linear light, not on encoded values", () => {
    // Black and white blur to a mid gray of 50% light, which is #bcbcbc in sRGB, not #808080.
    expect(
      linearToHex(meanLinear([hexToLinear("#000000"), hexToLinear("#ffffff")])),
    ).toBe("#bcbcbc");
    expect(() => meanLinear([])).toThrow();
  });
});

describe("toStripes", () => {
  const red = hexToLinear("#ff0000");
  const blue = hexToLinear("#0000ff");

  it("groups frames in order into equal stripes", () => {
    expect(toStripes([red, red, blue, blue], 2)).toEqual([
      "#ff0000",
      "#0000ff",
    ]);
    expect(toStripes([red, blue, red, blue, red, blue], 3)).toEqual(
      Array(3).fill(linearToHex(meanLinear([red, blue]))),
    );
  });

  it("covers every frame exactly once when the counts don't divide", () => {
    const frames = [red, red, red, blue, blue, blue, blue];
    const stripes = toStripes(frames, 3);
    expect(stripes).toHaveLength(3);
    expect(stripes[0]).toBe("#ff0000");
    expect(stripes[2]).toBe("#0000ff");
  });

  it("refuses more stripes than frames", () => {
    expect(() => toStripes([red], 2)).toThrow(/Only 1 frames for 2 stripes/);
    expect(() => toStripes([red], 0)).toThrow();
  });
});

/** Builds raw rgb24 frames of `width × height`, painting each pixel with `paint(frame, x, y)`. */
function rawFrames(
  count: number,
  width: number,
  height: number,
  paint: (f: number, x: number, y: number) => [number, number, number],
) {
  const raw = new Uint8Array(count * width * height * 3);
  for (let f = 0; f < count; f++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        raw.set(paint(f, x, y), (f * width * height + y * width + x) * 3);
      }
    }
  }
  return raw;
}

describe("letterbox detection and frame colors", () => {
  const geometry = { width: 8, height: 10 };
  // Two black rows top and bottom (a letterbox), one black column on the right (a pillar).
  const matte = (x: number, y: number) => y < 2 || y >= 8 || x >= 7;
  const raw = rawFrames(20, 8, 10, (f, x, y) =>
    matte(x, y) ? [0, 0, 0] : f < 10 ? [200, 40, 40] : [30, 60, 220],
  );

  it("finds black mattes on every side", () => {
    expect(detectMattes(raw, geometry)).toEqual({
      top: 2,
      bottom: 2,
      left: 0,
      right: 1,
    });
  });

  it("averages only the picture inside the mattes", () => {
    const colors = frameColors(raw, geometry, detectMattes(raw, geometry));
    expect(linearToHex(colors[0])).toBe("#c82828");
    expect(linearToHex(colors[19])).toBe("#1e3cdc");
  });

  it("doesn't mistake a dark film for a letterbox", () => {
    const dark = rawFrames(10, 4, 4, (f) =>
      f === 9 ? [90, 90, 90] : [2, 2, 2],
    );
    expect(detectMattes(dark, { width: 4, height: 4 })).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it("never trims more than 40% from a side, even for an all-black video", () => {
    const black = rawFrames(5, 10, 10, () => [0, 0, 0]);
    const mattes = detectMattes(black, { width: 10, height: 10 });
    expect(
      Math.max(mattes.top, mattes.bottom, mattes.left, mattes.right),
    ).toBeLessThanOrEqual(4);
  });

  it("builds a barcode end to end", () => {
    expect(barcodeFromFrames(raw, geometry, 2)).toEqual({
      stripes: ["#c82828", "#1e3cdc"],
      frames: 20,
      mattes: { top: 2, bottom: 2, left: 0, right: 1 },
    });
  });

  it("rejects truncated or empty video", () => {
    expect(() =>
      detectMattes(raw.subarray(0, raw.length - 1), geometry),
    ).toThrow(/whole number/);
    expect(() => detectMattes(new Uint8Array(0), geometry)).toThrow(
      /no frames/,
    );
  });
});
