import sharp from "sharp";
import type { AssetRef } from "@/core/assets";
import { extractPalette, gaussianBlur, reinhardTransfer, roundShares, createRgbImage, type RgbImage } from "@/games/color-grade/imaging";
import { PALETTE_SIZE, type Swatch } from "@/games/color-grade/logic";
import type { AssetInput } from "../../lib/fixtures.mjs";
import { fixtureSvg } from "../../lib/images.mjs";

/**
 * Color Grade's image build, shared by the TMDB pipeline (`scripts/content/movies/color-grade.mts`)
 * and the DEV FIXTURE generator (`scripts/content/fixtures/color-grade.mts`), so fixtures exercise
 * exactly the code real puzzles go through. The colour maths is in `src/games/color-grade/imaging.ts`.
 *
 * From one film still and one neutral photo it makes:
 *   - the palette: k-means (k = 5) in Lab over the still, largest share first;
 *   - `graded`: the neutral photo with the still's Lab mean and spread (Reinhard transfer);
 *   - `blurred`: the still under a heavy Gaussian blur, in linear light;
 *   - `still` and `neutral`: both, cropped to the common frame.
 */

/** Every stage image shares one 16:9 frame, so the board never jumps between stages. */
export const FRAME_WIDTH = 1280;
export const FRAME_HEIGHT = 720;
/** Blur radius as a fraction of the frame width: enough to dissolve every shape, keep the light. */
export const BLUR_SIGMA_FRACTION = 0.03;

export interface ColorGradeImages {
  palette: Swatch[];
  neutral: AssetRef;
  graded: AssetRef;
  blurred: AssetRef;
  still: AssetRef;
}

export interface BuildOptions {
  /** Film frame (any format sharp reads). */
  still: Buffer;
  /** Ordinary, evenly lit, colour-balanced photo to regrade. */
  neutral: Buffer;
  /** Seeds the palette's k-means. */
  seed: number;
  /** Registers an encoded asset with the day being built (the fixture context's `addAsset`). */
  addAsset(input: AssetInput): Promise<AssetRef>;
  /** Stamps this label on every image (DEV FIXTURE puzzles). */
  fixtureLabel?: string;
}

/** Decodes any image to an sRGB raster cropped to the stage frame (centre crop, no letterboxing). */
export async function decodeFrame(input: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: FRAME_WIDTH, height: FRAME_HEIGHT, fit: "cover", position: "centre" })
    .toColorspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected an RGB raster, got ${info.channels} channels`);
  return createRgbImage(info.width, info.height, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

/** Raster → lossless PNG (optionally with the fixture label), for `addAsset` to re-encode. */
async function toPng(image: RgbImage, fixtureLabel: string | undefined): Promise<Buffer> {
  let pipeline = sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 3 },
  });
  if (fixtureLabel) {
    // An otherwise empty SVG renders transparent except for the label.
    const tag = fixtureSvg({ width: image.width, height: image.height, content: "", label: fixtureLabel });
    pipeline = pipeline.composite([{ input: Buffer.from(tag), top: 0, left: 0 }]);
  }
  return pipeline.png().toBuffer();
}

/** The palette as stored in the puzzle: lowercase hex, shares rounded to 0.1% and summing to 1. */
export function paletteSwatches(still: RgbImage, seed: number): Swatch[] {
  const palette = extractPalette(still, { k: PALETTE_SIZE, seed });
  const shares = roundShares(palette.map((p) => p.share));
  return palette.map((p, i) => ({ hex: p.hex, share: shares[i] }));
}

export async function buildColorGradeImages({ still, neutral, seed, addAsset, fixtureLabel }: BuildOptions): Promise<ColorGradeImages> {
  const stillFrame = await decodeFrame(still);
  const neutralFrame = await decodeFrame(neutral);

  const palette = paletteSwatches(stillFrame, seed);
  const graded = reinhardTransfer(neutralFrame, stillFrame);
  const blurred = gaussianBlur(stillFrame, FRAME_WIDTH * BLUR_SIGMA_FRACTION);

  // Every image is secret: each is earned at a later stage, or shown with the reveal.
  const add = async (kind: string, image: RgbImage) =>
    addAsset({ kind, visibility: "secret", image: await toPng(image, fixtureLabel), format: "webp", quality: 84 });
  return {
    palette,
    neutral: await add("neutral", neutralFrame),
    graded: await add("graded", graded),
    blurred: await add("blurred", blurred),
    still: await add("still", stillFrame),
  };
}
