import sharp from "sharp";
import type { AssetMime } from "@/core/assets";

/** Same cap as the `puzzle_assets.bytes` CHECK constraint. */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

export interface EncodeOptions {
  /** Longest edges to fit inside (never enlarged). Defaults: 1600 × 1600. */
  maxWidth?: number;
  maxHeight?: number;
  /** Defaults to webp. Use png for flat graphics that must stay pixel-exact (palettes, barcodes). */
  format?: "webp" | "jpeg" | "png";
  /** 1–100, for webp/jpeg. Default 82. */
  quality?: number;
  /** webp only: sharper chroma on thin coloured lines (slower to encode). Default false. */
  smartSubsample?: boolean;
}

export interface EncodedImage {
  bytes: Buffer;
  mime: AssetMime;
  width: number;
  height: number;
}

const MIME: Record<NonNullable<EncodeOptions["format"]>, AssetMime> = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png" };

/** Uncompressed pixels: packed 8-bit RGB, row-major (`width × height × 3` bytes). */
export interface RawRgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Re-encode any image (encoded bytes, SVG markup or raw RGB pixels) for `puzzle_assets`: applies
 * EXIF orientation, fits it inside the size limits, converts to sRGB and strips every byte of
 * metadata (sharp drops EXIF, XMP and ICC unless asked to keep them), so nothing about the source
 * travels with the asset.
 */
export async function encodeImage(input: Buffer | string | RawRgbImage, options: EncodeOptions = {}): Promise<EncodedImage> {
  const { maxWidth = 1600, maxHeight = 1600, format = "webp", quality = 82, smartSubsample = false } = options;
  const source =
    typeof input === "string"
      ? sharp(Buffer.from(input), { failOn: "error" })
      : Buffer.isBuffer(input)
        ? sharp(input, { failOn: "error" })
        : sharp(input.data, { raw: { width: input.width, height: input.height, channels: 3 } });
  let pipeline = source
    .rotate()
    .resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true })
    .toColorspace("srgb");
  pipeline =
    format === "webp"
      ? pipeline.webp({ quality, effort: 5, smartSubsample })
      : format === "jpeg"
        ? pipeline.jpeg({ quality, mozjpeg: true })
        : pipeline.png({ compressionLevel: 9 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  if (data.length > MAX_ASSET_BYTES) {
    throw new Error(`Encoded image is ${(data.length / 1048576).toFixed(1)} MB; the limit is 4 MB. Lower maxWidth or quality.`);
  }
  return { bytes: data, mime: MIME[format], width: info.width, height: info.height };
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Wraps procedural SVG content as a full document with a small "DEV FIXTURE" tag in the corner, so
 * a stand-in image can never be mistaken for real content in a screenshot.
 */
export function fixtureSvg({ width, height, content, label = "DEV FIXTURE" }: { width: number; height: number; content: string; label?: string }): string {
  const size = Math.max(10, Math.round(Math.min(width, height) * 0.035));
  const pad = Math.round(size * 0.6);
  const tagWidth = Math.round(label.length * size * 0.68 + pad * 2);
  const tagHeight = Math.round(size * 1.7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${content}
<g transform="translate(${pad} ${height - pad - tagHeight})">
  <rect width="${tagWidth}" height="${tagHeight}" fill="#000" fill-opacity="0.72"/>
  <text x="${pad}" y="${Math.round(tagHeight * 0.68)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" letter-spacing="${(size * 0.12).toFixed(1)}" fill="#fff">${escapeXml(label)}</text>
</g>
</svg>`;
}
