import { describe, expect, it } from "vitest";
import { chunkIn, createImage, missingFrameLimit, NEAR_BLACK_FRAME, PACES, stripEdges, type RgbImage } from "./barcode-levels.mjs";
import { renderLevels, type FrameSource } from "./barcode-render.mjs";

/**
 * `renderLevels` end to end on an in-memory film: every frame is one flat colour that encodes its
 * number, inside black letterbox bars, so each strip on a rendered level can be traced back to the
 * frame it came from.
 */

const TOTAL = 3000;
const WIDTH = 256;
const HEIGHT = 64;
/** Frames 1520–1540 are a fade to black. */
const isDark = (n: number) => n >= 1520 && n <= 1540;
const colourOf = (n: number): [number, number, number] => (isDark(n) ? [4, 4, 4] : [40 + (n % 200), 40 + (Math.floor(n / 200) % 200), 150]);
const numberOf = (rgb: readonly number[]) => (rgb[1]! - 40) * 200 + (rgb[0]! - 40);

/** A 16:9 frame with black bars (a ninth of the height) top and bottom around a flat picture. */
function frameImage(n: number, width: number, height: number): RgbImage {
  const image = createImage(width, height);
  const bar = height / 9;
  const rgb = colourOf(n);
  for (let y = bar; y < height - bar; y++) for (let x = 0; x < width; x++) image.data.set(rgb, (y * width + x) * 3);
  return image;
}

/** An in-memory film. Dead caps: `noThumbnail` has no thumbnail, `noFrame` no full-quality copy. */
class MemorySource implements FrameSource {
  readonly description = "in-memory test film";
  readonly frameCount = TOTAL;
  thumbnailCalls: number[][] = [];
  prefetched: number[][] = [];
  frameCalls: number[] = [];

  constructor(private readonly dead: { noThumbnail?: readonly number[]; noFrame?: readonly number[] } = {}) {}

  async thumbnails(numbers: readonly number[]): Promise<(RgbImage | null)[]> {
    this.thumbnailCalls.push([...numbers]);
    return numbers.map((n) => (this.dead.noThumbnail?.includes(n) ? null : frameImage(n, 64, 36)));
  }

  async prefetchFrames(numbers: readonly number[], options: { width: number }): Promise<number[]> {
    expect(options.width).toBeGreaterThan(0);
    this.prefetched.push([...numbers]);
    return numbers.filter((n) => this.dead.noFrame?.includes(n));
  }

  async frame(n: number): Promise<RgbImage> {
    if (!this.prefetched.some((batch) => batch.includes(n))) throw new Error(`frame ${n} was not prefetched`);
    if (this.dead.noFrame?.includes(n)) throw new Error(`frame ${n} is missing`);
    this.frameCalls.push(n);
    return frameImage(n, 320, 180);
  }
}

const pixelAt = (image: RgbImage, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];
const trim = { head: 0.05, tail: 0.02 };

describe("renderLevels", async () => {
  const source = new MemorySource();
  const film = await renderLevels(source, { width: WIDTH, height: HEIGHT, pace: PACES.normal, samples: 600, bands: 120, trim });

  it("renders ten levels at the requested size, level 1 from `samples` squeezed frames in `bands` bands", () => {
    expect(film.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const level of film.levels) expect([level.image.width, level.image.height]).toEqual([WIDTH, HEIGHT]);
    expect(film.levels[0]!.strips).toBe(120);
    expect(film.sampled).toBe(600);
    expect(film.missing).toEqual([]);
    expect(film.levels.slice(1).map((l) => l.strips)).toEqual(PACES.normal.strips);
  });

  it("asks for thumbnails once and fetches each strip frame exactly once, before drawing", () => {
    expect(source.thumbnailCalls).toHaveLength(1);
    expect(source.thumbnailCalls[0]).toHaveLength(600);
    expect(source.prefetched).toHaveLength(1);
    const prefetched = source.prefetched[0]!;
    expect(new Set(prefetched).size).toBe(prefetched.length);
    const used = new Set(film.levels.flatMap((l) => l.frames));
    expect([...used].sort((a, b) => a - b)).toEqual(prefetched);
    expect(film.fetched).toBe(prefetched.length);
  });

  it("takes each strip from its own stretch of the story, in film order, skipping the fade to black", () => {
    expect(film.story).toEqual({ first: 151, last: 2940 });
    for (const level of film.levels.slice(1)) {
      expect(level.frames).toHaveLength(level.strips);
      level.frames.forEach((n, i) => {
        const chunk = chunkIn(film.story, level.strips, i);
        expect(n).toBeGreaterThanOrEqual(chunk.first);
        expect(n).toBeLessThanOrEqual(chunk.last);
        if (i > 0) expect(n).toBeGreaterThan(level.frames[i - 1]!);
      });
      // The stretch whose middle falls in the fade found a lit frame nearby.
      expect(level.frames.some((n) => isDark(n))).toBe(false);
    }
  });

  it("pastes each strip from the frame it names, with the letterbox bars cut away", () => {
    for (const level of film.levels.slice(1)) {
      const edges = stripEdges(WIDTH, level.strips);
      level.frames.forEach((n, i) => {
        if (edges[i + 1]! - edges[i]! < 1) return;
        const x = edges[i]!;
        // Top and bottom rows too: no black bar survives.
        for (const y of [0, HEIGHT >> 1, HEIGHT - 1]) expect(numberOf(pixelAt(level.image, x, y))).toBe(n);
      });
    }
  });

  it("cuts the bars from level 1 too, and keeps it in film order", () => {
    const level1 = film.levels[0]!.image;
    // Each column is one flat frame, so with the bars gone its top row matches its middle.
    for (let x = 0; x < WIDTH; x++) expect(pixelAt(level1, x, 0)).toEqual(pixelAt(level1, x, HEIGHT >> 1));
    expect(Math.max(...pixelAt(level1, 4, 0))).toBeGreaterThan(NEAR_BLACK_FRAME);
    expect(film.mattes.top).toBeCloseTo(1 / 9, 3);
    expect(film.mattes.bottom).toBeCloseTo(1 / 9, 3);
    // Green counts up in steps of 200 frames: early frames on the left, late ones on the right.
    const green = (x: number) => pixelAt(level1, x, HEIGHT >> 1)[1]!;
    expect(green(10)).toBeLessThan(green(128));
    expect(green(128)).toBeLessThan(green(250));
    // Pixel 64 lies inside one band, of five frames in the same 200-frame step.
    expect(Math.abs(green(64) - (40 + Math.floor((TOTAL * 64.5) / WIDTH / 200)))).toBeLessThanOrEqual(1);
  });

  it("works around a few missing frames: left out of level 1, replaced for the strips", async () => {
    const asked = source.thumbnailCalls[0]!;
    // A sampled frame with no thumbnail, and the last level's first five strip frames with no
    // full-quality copy: six in all, as many as 1% of 600 allows.
    const noThumbnail = [asked[100]!];
    const noFrame = film.levels[9]!.frames.slice(0, 5);
    const lost = [...noThumbnail, ...noFrame];
    const gappy = new MemorySource({ noThumbnail, noFrame });
    const logs: string[] = [];
    const patched = await renderLevels(gappy, { width: WIDTH, height: HEIGHT, pace: PACES.normal, samples: 600, bands: 120, trim, log: (m) => logs.push(m) });
    expect(patched.missing).toEqual([...lost].sort((a, b) => a - b));
    expect(patched.sampled).toBe(599);
    expect(patched.levels[0]!.strips).toBe(120);
    expect(logs.filter((m) => m.includes("missing from the source"))).toHaveLength(6);
    patched.levels.slice(1).forEach((level, l) => {
      expect(level.frames.some((n) => lost.includes(n))).toBe(false);
      expect(level.frames.every((n, i) => i === 0 || n > level.frames[i - 1]!)).toBe(true);
      // Only the strips whose frame was lost changed.
      level.frames.forEach((n, i) => {
        const before = film.levels[l + 1]!.frames[i]!;
        if (!lost.includes(before)) expect(n).toBe(before);
      });
    });
    // Replacements not already on the way were fetched in a second round; nothing was fetched twice.
    const fetched = gappy.prefetched.flat();
    const late = [...new Set(patched.levels.flatMap((l) => l.frames))].filter((n) => !gappy.prefetched[0]!.includes(n)).sort((a, b) => a - b);
    expect(late.length).toBeGreaterThan(0);
    expect(gappy.prefetched).toHaveLength(2);
    expect(gappy.prefetched[1]).toEqual(late);
    expect(new Set(fetched).size).toBe(fetched.length);
    for (const level of patched.levels.slice(1)) for (const n of level.frames) expect(fetched).toContain(n);
  });

  it("gives up when more than 1% of the sampled frames are missing, before any full-quality frame", async () => {
    const asked = source.thumbnailCalls[0]!;
    const broken = new MemorySource({ noThumbnail: asked.slice(0, missingFrameLimit(600) + 1) });
    await expect(renderLevels(broken, { width: WIDTH, height: HEIGHT, pace: PACES.normal, samples: 600, trim })).rejects.toThrow(/7 frames are missing.*at most 6/);
    expect(broken.prefetched).toHaveLength(0);
  });

  it("stops before fetching any full-quality frame when checkLook refuses the film", async () => {
    const refused = new MemorySource();
    await expect(
      renderLevels(refused, {
        width: WIDTH,
        height: HEIGHT,
        pace: PACES.normal,
        samples: 200,
        checkLook: () => {
          throw new Error("black and white");
        },
      }),
    ).rejects.toThrow("black and white");
    expect(refused.thumbnailCalls).toHaveLength(1);
    expect(refused.prefetched).toHaveLength(0);
    expect(refused.frameCalls).toHaveLength(0);
  });
});
