import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { RgbImage } from "./barcode-levels.mjs";
import type { FrameSource } from "./barcode-render.mjs";
import { fetchWithRetry, mapPool } from "./http.mjs";

/**
 * Frames from movie-screencaps.com: complete films as numbered screencaps in film order, free for
 * non-commercial use (the site's terms). A gallery page lists 180 caps; its images live on a CDN
 * that serves a ~199 px thumbnail (`?class=thumbnail`) or any width (`?width=1920`), and only to a
 * browser-like request that names the gallery page as its Referer.
 *
 * Politeness: at most 6 requests in flight, a short pause after each, retries with backoff (and
 * `Retry-After`) from `fetchWithRetry`. Frames are cached in a temp directory for the run only;
 * `close()` deletes it, so nothing but the rendered levels outlives a run.
 */

export const SCREENCAPS_ORIGIN = "https://movie-screencaps.com";
export const SCREENCAPS_DIRECTORY = `${SCREENCAPS_ORIGIN}/movie-directory/`;
/** The CDN refuses requests that don't look like a browser's. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
export const MAX_CONCURRENCY = 6;
/** Pause after each request, per worker. */
const REQUEST_PAUSE_MS = 60;
/** The CDN's largest useful width: the 4K originals. */
const MAX_FRAME_WIDTH = 3840;

// ---------------------------------------------------------------------------------------------
// Parsing (pure; tested in screencaps.test.mts)
// ---------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** A gallery URL in canonical form: https://movie-screencaps.com/<slug>/ */
export function canonicalGalleryUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== new URL(SCREENCAPS_ORIGIN).hostname) {
    throw new Error(`${url} isn't a movie-screencaps.com gallery`);
  }
  const slug = parsed.pathname.split("/").filter(Boolean)[0];
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) throw new Error(`${url} isn't a movie-screencaps.com gallery`);
  return `${SCREENCAPS_ORIGIN}/${slug}/`;
}

/** How to address cap N: `${prefix}${N}${suffix}` plus a size query. */
export interface CapPattern {
  prefix: string;
  suffix: string;
}

const CAP_URL = /^(https:\/\/[a-z0-9.-]+\/[^"'\s?<>]*\/full\/[^"'\s?<>/]+?-)(\d+)(\.(?:jpe?g|png|webp))(?:\?|$)/i;

/**
 * The cap URL pattern and the cap numbers on a gallery page, read from the thumbnails' `<img src>`
 * (the CDN the site itself loads them from; the links around them point at a different image
 * proxy). If several patterns appear, the most common one is the gallery's.
 */
export function parseCaps(html: string): { pattern: CapPattern; numbers: number[] } {
  const found = new Map<string, { pattern: CapPattern; numbers: Set<number> }>();
  for (const [, src] of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) {
    const match = CAP_URL.exec(decodeEntities(src!));
    if (!match) continue;
    const [, prefix, n, suffix] = match;
    const key = `${prefix}\u0000${suffix}`;
    const entry = found.get(key) ?? { pattern: { prefix: prefix!, suffix: suffix! }, numbers: new Set<number>() };
    entry.numbers.add(Number(n));
    found.set(key, entry);
  }
  const best = [...found.values()].sort((a, b) => b.numbers.size - a.numbers.size)[0];
  if (!best) throw new Error("No screencaps found on the gallery page");
  return { pattern: best.pattern, numbers: [...best.numbers].sort((a, b) => a - b) };
}

/** The gallery's last page number (1 when it has a single page). */
export function parseLastPage(html: string, galleryUrl: string): number {
  const base = canonicalGalleryUrl(galleryUrl).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let last = 1;
  for (const match of html.matchAll(new RegExp(`${base}page/(\\d+)`, "g"))) last = Math.max(last, Number(match[1]));
  return last;
}

export interface DirectoryEntry {
  title: string;
  year: number | null;
  /** Bracketed tags after the year, lowercased, e.g. ["4k"]. */
  tags: string[];
  url: string;
}

/** Every film on the directory page. */
export function parseDirectory(html: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  const item = /<li[^>]*class="asc-index-item"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, href, rawText] of html.matchAll(item)) {
    let url: string;
    try {
      url = canonicalGalleryUrl(decodeEntities(href!));
    } catch {
      continue;
    }
    const text = decodeEntities(rawText!.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    const tags = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim().toLowerCase());
    const withoutTags = text.replace(/\s*\[[^\]]*\]/g, "").trim();
    const yearMatch = /^(.*?)\s*\((\d{4})\)\s*$/.exec(withoutTags);
    entries.push({ title: yearMatch ? yearMatch[1]! : withoutTags, year: yearMatch ? Number(yearMatch[2]) : null, tags, url });
  }
  return entries;
}

/** Title key for matching: accents, case, punctuation, "&" vs "and" and a leading article don't matter. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

/**
 * The gallery for a catalog film: same normalised title, same year (one year either way is
 * accepted, since release years differ between countries), preferring the exact year and then a
 * 4K gallery. Throws with the near misses when nothing matches.
 */
export function findGallery(entries: readonly DirectoryEntry[], film: { title: string; year: number | null }): DirectoryEntry {
  const key = normalizeTitle(film.title);
  const sameTitle = entries.filter((e) => normalizeTitle(e.title) === key);
  const yearGap = (e: DirectoryEntry) => (film.year === null || e.year === null ? 0 : Math.abs(e.year - film.year));
  const candidates = sameTitle.filter((e) => yearGap(e) <= 1).sort((a, b) => yearGap(a) - yearGap(b) || Number(b.tags.includes("4k")) - Number(a.tags.includes("4k")));
  if (candidates[0]) return candidates[0];
  const near = sameTitle.length > 0 ? sameTitle : entries.filter((e) => normalizeTitle(e.title).includes(key) || (key.length > 3 && key.includes(normalizeTitle(e.title)) && e.year === film.year));
  const hint = near.slice(0, 5).map((e) => `${e.title} (${e.year ?? "?"}) ${e.url}`);
  throw new Error(`No movie-screencaps.com gallery for ${film.title} (${film.year ?? "?"})${hint.length ? `. Near misses:\n    ${hint.join("\n    ")}\n  Pass --url to pick one.` : ". Pass --url if it is listed under another title."}`);
}

// ---------------------------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithRetry(url, { headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html" } }, { attempts: 5, timeoutMs: 30_000, label: "movie-screencaps.com" });
  return response.text();
}

/** Looks a catalog film up in the movie-screencaps.com directory. */
export async function resolveGallery(film: { title: string; year: number | null }): Promise<DirectoryEntry> {
  return findGallery(parseDirectory(await fetchText(SCREENCAPS_DIRECTORY)), film);
}

export interface Gallery {
  url: string;
  pattern: CapPattern;
  /** Caps are numbered 1…frameCount. */
  frameCount: number;
}

/** Reads a gallery's first and last pages: the cap URL pattern and how many caps it has. */
export async function openGallery(url: string): Promise<Gallery> {
  const galleryUrl = canonicalGalleryUrl(url);
  const first = await fetchText(galleryUrl);
  const { pattern, numbers } = parseCaps(first);
  if (numbers[0] !== 1) throw new Error(`${galleryUrl}: page 1 doesn't start at cap 1 (found ${numbers[0]})`);
  const lastPage = parseLastPage(first, galleryUrl);
  const last = lastPage === 1 ? numbers : parseCaps(await fetchText(`${galleryUrl}page/${lastPage}`)).numbers;
  const frameCount = Math.max(...last);
  if (!Number.isInteger(frameCount) || frameCount < 100) throw new Error(`${galleryUrl}: only ${frameCount} caps; too few for a barcode`);
  return { url: galleryUrl, pattern, frameCount };
}

export function capUrl(gallery: Gallery, number: number, size: { thumbnail: true } | { width: number }): string {
  const query = "thumbnail" in size ? "class=thumbnail" : `width=${size.width}`;
  return `${gallery.pattern.prefix}${number}${gallery.pattern.suffix}?${query}`;
}

async function decode(bytes: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(bytes, { failOn: "error" }).removeAlpha().toColorspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/**
 * A gallery as a `FrameSource`. Downloads go to a fresh temp directory, reused within the run;
 * `close()` deletes it.
 */
export class ScreencapsSource implements FrameSource {
  readonly description: string;
  readonly frameCount: number;
  private readonly dir: string;
  private frameWidth: number | null = null;
  bytesDownloaded = 0;
  requests = 0;

  constructor(
    readonly gallery: Gallery,
    private readonly concurrency = MAX_CONCURRENCY,
  ) {
    if (concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error(`Concurrency must be 1–${MAX_CONCURRENCY}`);
    this.description = `${gallery.url} (${gallery.frameCount} caps)`;
    this.frameCount = gallery.frameCount;
    this.dir = mkdtempSync(path.join(tmpdir(), "barcode-frames-"));
  }

  private async download(url: string, file: string): Promise<Buffer> {
    const cached = await readFile(file).catch(() => null);
    if (cached) return cached;
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": BROWSER_USER_AGENT, referer: this.gallery.url, accept: "image/avif,image/webp,image/*;q=0.8" } },
      { attempts: 5, baseDelayMs: 1500, timeoutMs: 45_000, label: "screencaps cdn" },
    );
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error(`${url} answered ${type || "no content type"}, not an image`);
    const bytes = Buffer.from(await response.arrayBuffer());
    this.requests++;
    this.bytesDownloaded += bytes.length;
    await writeFile(file, bytes);
    await sleep(REQUEST_PAUSE_MS);
    return bytes;
  }

  async thumbnails(numbers: readonly number[], onProgress?: (done: number, total: number) => void): Promise<RgbImage[]> {
    let done = 0;
    const images = await mapPool(numbers, this.concurrency, async (n) => {
      const image = await decode(await this.download(capUrl(this.gallery, n, { thumbnail: true }), path.join(this.dir, `thumb-${n}.jpg`)));
      onProgress?.(++done, numbers.length);
      return image;
    });
    // One gallery's thumbnails share a size; normalise any odd one out to the first's.
    const { width, height } = images[0]!;
    return Promise.all(
      images.map(async (img) => {
        if (img.width === width && img.height === height) return img;
        const { data } = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).resize({ width, height, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
        return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
      }),
    );
  }

  async prefetchFrames(numbers: readonly number[], options: { width: number }, onProgress?: (done: number, total: number) => void): Promise<void> {
    this.frameWidth = Math.min(MAX_FRAME_WIDTH, Math.ceil(options.width / 16) * 16);
    let done = 0;
    await mapPool(numbers, this.concurrency, async (n) => {
      await this.download(this.frameUrl(n), this.framePath(n));
      onProgress?.(++done, numbers.length);
    });
  }

  private frameUrl(n: number): string {
    if (this.frameWidth === null) throw new Error("prefetchFrames must run before frame()");
    return capUrl(this.gallery, n, { width: this.frameWidth });
  }

  private framePath(n: number): string {
    return path.join(this.dir, `frame-${n}-${this.frameWidth}.jpg`);
  }

  async frame(n: number): Promise<RgbImage> {
    return decode(await this.download(this.frameUrl(n), this.framePath(n)));
  }

  /** Deletes every cached frame. Safe to call twice. */
  close(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** The temp directory (for tests and the run log). */
  get cacheDir(): string {
    return this.dir;
  }
}
