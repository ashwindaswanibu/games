import sharp, { type Sharp } from "sharp";
import {
  averageColor,
  chooseFrame,
  chunkOf,
  createImage,
  cropMattes,
  detectMattes,
  dominantColor,
  filmLook,
  layoutColumns,
  lumaOf,
  meanBrightness,
  pasteStrip,
  pickStripX,
  pictureBox,
  sampleFrames,
  squeezeColumn,
  stripEdges,
  stripSchedule,
  type FilmLook,
  type Hex,
  type Mattes,
  type Pace,
  type RgbImage,
} from "./barcode-levels.mjs";
import { mapPool } from "./http.mjs";

/**
 * Renders a film's ten Color Barcode levels from a `FrameSource` (the maths is in
 * `barcode-levels.mts`; this module does the IO: asking the source for frames, decoding and
 * resizing them with sharp). The same renderer serves the real pipeline (movie-screencaps.com
 * frames, `screencaps.mts`) and the DEV FIXTURE generator (procedural frames), so fixtures
 * exercise the real algorithm.
 */

/**
 * Where frames come from. Frames are numbered 1…`frameCount` in film order.
 * - `thumbnails`: small frames, all one size, decoded, in the order asked for.
 * - `prefetchFrames`: fetch (and cache) full-quality frames at least `width` pixels wide before
 *   they are used, so the renderer can then read them one at a time with `frame`.
 */
export interface FrameSource {
  readonly description: string;
  readonly frameCount: number;
  thumbnails(numbers: readonly number[], onProgress?: (done: number, total: number) => void): Promise<RgbImage[]>;
  prefetchFrames(numbers: readonly number[], options: { width: number }, onProgress?: (done: number, total: number) => void): Promise<void>;
  frame(number: number): Promise<RgbImage>;
}

export interface RenderOptions {
  /** Level canvas size. Default 2400 × 800: crisp at laptop width on a retina screen. */
  width?: number;
  height?: number;
  pace: Pace;
  /** Frames sampled for level 1 (and the dark-frame check). Default: the canvas width, kept within 1,600–3,000. */
  samples?: number;
  /** Frames decoded and resized at once while drawing a strip level. Default 4. */
  concurrency?: number;
  log?: (message: string) => void;
}

export interface RenderedLevel {
  /** 1–10. */
  level: number;
  image: RgbImage;
  average: Hex;
  dominant: Hex;
  /** Strips in this level (level 1: the number of squeezed frames). */
  strips: number;
  /** Crop position, 0 (frame edge) to 1 (centre); null for level 1. */
  crop: number | null;
}

export interface RenderedFilm {
  levels: RenderedLevel[];
  look: FilmLook;
  mattes: Mattes;
  /** Frames sampled for level 1, and full-quality frames fetched for the strips. */
  sampled: number;
  fetched: number;
}

export const DEFAULT_LEVEL_WIDTH = 2400;
export const DEFAULT_LEVEL_HEIGHT = 800;

/** Default number of frames squeezed into level 1. */
export function defaultSamples(width: number): number {
  return Math.min(3000, Math.max(1600, width));
}

/** Raw RGB → sharp, and back. */
const fromRaw = (image: RgbImage) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
async function toRaw(pipeline: Sharp): Promise<RgbImage> {
  const { data, info } = await pipeline.removeAlpha().toColorspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected RGB, got ${info.channels} channels`);
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/**
 * A full-quality frame with its mattes cut away, scaled to the canvas height. A frame narrower
 * than `minWidth` (a very tall picture with a very wide strip) is scaled up to cover it and
 * cropped to the centre vertically.
 */
async function prepareFrame(frame: RgbImage, mattes: Mattes, height: number, minWidth: number): Promise<RgbImage> {
  const picture = cropMattes(frame, mattes);
  const scaledWidth = Math.round((picture.width * height) / picture.height);
  if (scaledWidth >= minWidth) return toRaw(fromRaw(picture).resize({ width: scaledWidth, height, fit: "fill" }));
  return toRaw(fromRaw(picture).resize({ width: minWidth, height, fit: "cover", position: "centre" }));
}

export async function renderLevels(source: FrameSource, options: RenderOptions): Promise<RenderedFilm> {
  const { width = DEFAULT_LEVEL_WIDTH, height = DEFAULT_LEVEL_HEIGHT, pace, concurrency = 4, log = () => {} } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 32 || width > 8192 || height > 8192) {
    throw new Error(`Invalid level size ${width}×${height}`);
  }
  const schedule = stripSchedule(pace);
  const total = source.frameCount;
  const sampled = sampleFrames(total, options.samples ?? defaultSamples(width));

  // --- Thumbnails: mattes, brightness (for skipping dark frames), colourfulness, level 1. ---
  log(`  sampling ${sampled.length} of ${total} frames`);
  const thumbs = await source.thumbnails(sampled, (done, all) => {
    if (done % 500 === 0 || done === all) log(`    thumbnails ${done}/${all}`);
  });
  if (thumbs.length !== sampled.length) throw new Error(`Asked for ${sampled.length} thumbnails, got ${thumbs.length}`);
  const mattes = detectMattes(thumbs);
  const pictures = thumbs.map((t) => cropMattes(t, mattes));
  const brightness = new Map(sampled.map((n, i) => [n, meanBrightness(pictures[i]!)] as const));
  const look = filmLook(pictures);
  log(
    `  mattes t${(mattes.top * 100).toFixed(1)}% b${(mattes.bottom * 100).toFixed(1)}% l${(mattes.left * 100).toFixed(1)}% r${(mattes.right * 100).toFixed(1)}%; ` +
      `saturation ${look.saturation.toFixed(3)}, chromatic ${(look.chromaticShare * 100).toFixed(1)}%${look.monochrome ? " (black and white)" : ""}`,
  );

  const levels: RenderedLevel[] = [];
  const rows = pictures[0]!.height;
  const squeezed = layoutColumns(
    pictures.map((p) => squeezeColumn(p, rows)),
    width,
  );
  const level1 = await toRaw(fromRaw(squeezed).resize({ width, height, fit: "fill", kernel: "cubic" }));
  levels.push({ level: 1, image: level1, average: averageColor(level1), dominant: dominantColor(level1), strips: sampled.length, crop: null });

  // --- Which frame each strip comes from, decided from thumbnails, so each is fetched once. ---
  const plan = schedule.map((step) => ({
    ...step,
    frames: Array.from({ length: step.strips }, (_, i) => chooseFrame(chunkOf(total, step.strips, i), total, sampled, brightness)),
  }));
  const needed = [...new Set(plan.flatMap((p) => p.frames))].sort((a, b) => a - b);
  // Full-quality frames must give a picture at least `height` tall once the mattes are cut away.
  const thumb = thumbs[0]!;
  const box = pictureBox(thumb.width, thumb.height, mattes);
  const frameWidth = Math.ceil(((height * thumb.height) / box.height) * (thumb.width / thumb.height));
  log(`  fetching ${needed.length} full-quality frames (${frameWidth}px wide)`);
  await source.prefetchFrames(needed, { width: frameWidth }, (done, all) => {
    if (done % 100 === 0 || done === all) log(`    frames ${done}/${all}`);
  });

  for (const step of plan) {
    const canvas = createImage(width, height);
    const edges = stripEdges(width, step.strips);
    const widest = Math.max(...edges.slice(1).map((e, i) => e - edges[i]!));
    await mapPool(step.frames, concurrency, async (number, i) => {
      const stripWidth = edges[i + 1]! - edges[i]!;
      if (stripWidth < 1) return;
      const frame = await prepareFrame(await source.frame(number), mattes, height, widest);
      const x = pickStripX({ width: frame.width, height: frame.height, luma: lumaOf(frame) }, stripWidth, i % 2 === 0, step.crop);
      pasteStrip(canvas, frame, x, stripWidth, edges[i]!);
    });
    levels.push({ level: step.level, image: canvas, average: averageColor(canvas), dominant: dominantColor(canvas), strips: step.strips, crop: step.crop });
    log(`  level ${step.level}: ${step.strips} strips, crop ${step.crop.toFixed(2)}`);
  }
  return { levels, look, mattes, sampled: sampled.length, fetched: needed.length };
}
