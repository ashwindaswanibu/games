import sharp, { type Sharp } from "sharp";
import {
  averageColor,
  bandColumns,
  createImage,
  DEFAULT_STORY_TRIM,
  cropMattes,
  detectMattes,
  dominantColor,
  filmLook,
  LEVEL1_BANDS,
  layoutColumns,
  lumaOf,
  meanBrightness,
  missingFrameLimit,
  pasteStrip,
  pickStripX,
  pictureBox,
  sampleFrames,
  squeezeColumn,
  stripEdges,
  stripFrames,
  stripSchedule,
  storyRange,
  type FilmLook,
  type FrameRange,
  type Hex,
  type Mattes,
  type Pace,
  type RgbImage,
  type StoryTrim,
  type StripLevel,
} from "./barcode-levels.mjs";
import { mapPool } from "./http.mjs";

/**
 * Renders a film's ten Fade to Color levels from a `FrameSource` (the maths is in
 * `barcode-levels.mts`; this module does the IO: asking the source for frames, decoding and
 * resizing them with sharp). The same renderer serves the real pipeline (movie-screencaps.com
 * frames, `screencaps.mts`) and the DEV FIXTURE generator (procedural frames), so fixtures
 * exercise the real algorithm.
 */

/**
 * Where frames come from. Frames are numbered 1…`frameCount` in film order. A source may lack a
 * frame (the CDN answers 404 for it): it says so instead of failing, and the renderer works around
 * it (`MAX_MISSING_SHARE`).
 * - `thumbnails`: small frames, all one size, decoded, in the order asked for; null for a missing one.
 * - `prefetchFrames`: fetch (and cache) full-quality frames at least `width` pixels wide before
 *   they are used, so the renderer can then read them one at a time with `frame`. Resolves to the
 *   numbers it found missing (never to be asked for with `frame`).
 */
export interface FrameSource {
  readonly description: string;
  readonly frameCount: number;
  thumbnails(numbers: readonly number[], onProgress?: (done: number, total: number) => void): Promise<(RgbImage | null)[]>;
  prefetchFrames(numbers: readonly number[], options: { width: number }, onProgress?: (done: number, total: number) => void): Promise<number[]>;
  frame(number: number): Promise<RgbImage>;
}

export interface RenderOptions {
  /** Level canvas size. Default 2400 × 800: crisp at laptop width on a retina screen. */
  width?: number;
  height?: number;
  pace: Pace;
  /** Frames sampled for level 1 (and the dark-frame check). Default: the canvas width, kept within 1,600–3,000. */
  samples?: number;
  /** Bands level 1 averages its frames into. Default `LEVEL1_BANDS`; as many as `samples` gives one frame per band. */
  bands?: number;
  /** Frames decoded and resized at once while drawing a strip level. Default 4. */
  concurrency?: number;
  /** Opening and closing stretches strips never come from. Default `DEFAULT_STORY_TRIM`. */
  trim?: StoryTrim;
  /**
   * Called with the film's colourfulness as soon as the thumbnails are in, before any full-quality
   * frame is fetched; throw to stop the run there (a black-and-white film, say).
   */
  checkLook?: (look: FilmLook) => void;
  log?: (message: string) => void;
}

export interface RenderedLevel {
  /** 1–10. */
  level: number;
  image: RgbImage;
  average: Hex;
  dominant: Hex;
  /** Strips in this level (level 1: its bands, each the mean of a run of squeezed frames). */
  strips: number;
  /** Crop position, 0 (frame edge) to 1 (centre); null for level 1. */
  crop: number | null;
  /** The frame each strip was cut from, left to right (level 1: empty). */
  frames: number[];
}

export interface RenderedFilm {
  levels: RenderedLevel[];
  look: FilmLook;
  mattes: Mattes;
  /** The frames strips may come from (the film minus its trimmed opening and closing). */
  story: FrameRange;
  /** Frames squeezed into level 1 (those sampled, less any missing), and full-quality frames the strips are cut from. */
  sampled: number;
  fetched: number;
  /** Frames the source lacked, left out of level 1 or replaced by a nearby frame for their strips. */
  missing: number[];
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
  const { width = DEFAULT_LEVEL_WIDTH, height = DEFAULT_LEVEL_HEIGHT, pace, bands = LEVEL1_BANDS, concurrency = 4, trim = DEFAULT_STORY_TRIM, log = () => {} } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 32 || width > 8192 || height > 8192) {
    throw new Error(`Invalid level size ${width}×${height}`);
  }
  if (!Number.isInteger(bands) || bands < 1) throw new Error(`Invalid band count ${bands}`);
  const schedule = stripSchedule(pace);
  const total = source.frameCount;
  const story = storyRange(total, trim);
  const asked = sampleFrames(total, options.samples ?? defaultSamples(width));
  const limit = missingFrameLimit(asked.length);
  const missing = new Set<number>();
  const noteMissing = (numbers: readonly number[], what: string) => {
    for (const n of numbers) {
      missing.add(n);
      log(`    frame ${n} is missing from the source; ${what}`);
    }
    if (missing.size > limit) {
      throw new Error(`${missing.size} frames are missing from ${source.description} (at most ${limit} may be): is the gallery broken?`);
    }
  };

  // --- Thumbnails: mattes, brightness (for skipping dark frames), colourfulness, level 1. ---
  log(`  sampling ${asked.length} of ${total} frames`);
  const fetchedThumbs = await source.thumbnails(asked, (done, all) => {
    if (done % 500 === 0 || done === all) log(`    thumbnails ${done}/${all}`);
  });
  if (fetchedThumbs.length !== asked.length) throw new Error(`Asked for ${asked.length} thumbnails, got ${fetchedThumbs.length}`);
  noteMissing(
    asked.filter((_, i) => fetchedThumbs[i] === null),
    "left out of level 1 (its neighbours cover it)",
  );
  const sampled = asked.filter((_, i) => fetchedThumbs[i] !== null);
  const thumbs = fetchedThumbs.filter((t) => t !== null);
  if (thumbs.length === 0) throw new Error(`No thumbnail could be fetched from ${source.description}`);
  const mattes = detectMattes(thumbs);
  const pictures = thumbs.map((t) => cropMattes(t, mattes));
  const brightness = new Map(sampled.map((n, i) => [n, meanBrightness(pictures[i]!)] as const));
  const look = filmLook(pictures);
  log(
    `  mattes t${(mattes.top * 100).toFixed(1)}% b${(mattes.bottom * 100).toFixed(1)}% l${(mattes.left * 100).toFixed(1)}% r${(mattes.right * 100).toFixed(1)}%; ` +
      `saturation ${look.saturation.toFixed(3)}, chromatic ${(look.chromaticShare * 100).toFixed(1)}%${look.monochrome ? " (black and white)" : ""}`,
  );
  options.checkLook?.(look);

  const levels: RenderedLevel[] = [];
  const rows = pictures[0]!.height;
  const banded = bandColumns(
    pictures.map((p) => squeezeColumn(p, rows)),
    bands,
  );
  const squeezed = layoutColumns(banded, width);
  const level1 = await toRaw(fromRaw(squeezed).resize({ width, height, fit: "fill", kernel: "cubic" }));
  levels.push({ level: 1, image: level1, average: averageColor(level1), dominant: dominantColor(level1), strips: banded.length, crop: null, frames: [] });
  log(`  level 1: ${sampled.length} frames in ${banded.length} bands`);

  // --- Which frame each strip comes from, decided from thumbnails, so each is fetched once. ---
  // Strips cover the story only: the trimmed opening and closing can hold titles and credits.
  log(`  strips from frames ${story.first}–${story.last} of ${total} (trim ${(trim.head * 100).toFixed(1)}% head, ${(trim.tail * 100).toFixed(1)}% tail)`);
  // Full-quality frames must give a picture at least `height` tall once the mattes are cut away.
  const thumb = thumbs[0]!;
  const box = pictureBox(thumb.width, thumb.height, mattes);
  const frameWidth = Math.ceil(((height * thumb.height) / box.height) * (thumb.width / thumb.height));
  // A frame the source turns out to lack is replaced by the next choice in its stretch, which is
  // fetched in turn; strips whose frame was there keep it.
  const asks = new Set<number>();
  let plan: (StripLevel & { frames: number[] })[];
  for (;;) {
    plan = schedule.map((step) => ({ ...step, frames: stripFrames(story, step.strips, total, sampled, brightness, missing) }));
    const needed = [...new Set(plan.flatMap((p) => p.frames))].filter((n) => !asks.has(n)).sort((a, b) => a - b);
    if (needed.length === 0) break;
    for (const n of needed) asks.add(n);
    log(`  fetching ${needed.length} full-quality frames (${frameWidth}px wide)`);
    const lacking = await source.prefetchFrames(needed, { width: frameWidth }, (done, all) => {
      if (done % 100 === 0 || done === all) log(`    frames ${done}/${all}`);
    });
    if (lacking.length === 0) break;
    noteMissing(lacking, "its strips take a nearby frame");
  }

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
    levels.push({ level: step.level, image: canvas, average: averageColor(canvas), dominant: dominantColor(canvas), strips: step.strips, crop: step.crop, frames: step.frames });
    log(`  level ${step.level}: ${step.strips} strips, crop ${step.crop.toFixed(2)}`);
  }
  const fetched = new Set(plan.flatMap((p) => p.frames)).size;
  return { levels, look, mattes, story, sampled: sampled.length, fetched, missing: [...missing].sort((a, b) => a - b) };
}
