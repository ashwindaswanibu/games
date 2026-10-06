import { z } from "zod";
import { tmdbApiKey } from "../../lib/env.mjs";
import { encodeImage, type EncodedImage } from "../../lib/images.mjs";
import { fetchWithRetry, HttpError, type RetryOptions } from "./http.mjs";

/**
 * TMDB (The Movie Database) client for film stills. Needs `TMDB_API_KEY` in .env.local: either a v3
 * API key (32 hex characters, sent as `api_key`) or a v4 API Read Access Token (a JWT, sent as a
 * bearer token). Without one, `tmdbClient()` throws with instructions (see `tmdbApiKey`).
 *
 * Terms: TMDB requires the attribution "This product uses the TMDB API but is not endorsed or
 * certified by TMDB" (with their logo) wherever TMDB data or images are shown. See README.md.
 */

export const TMDB_API = "https://api.themoviedb.org/3";
/** TMDB's documented image CDN base; sizes are path segments (w300, w780, w1280, original). */
export const TMDB_IMAGES = "https://image.tmdb.org/t/p";

/** Stills are stored at most this wide (and tall), as webp, metadata stripped. */
export const STILL_MAX_WIDTH = 1280;

const imageSchema = z.object({
  file_path: z.string().regex(/^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  iso_639_1: z.string().nullable(),
  vote_average: z.number(),
  vote_count: z.number().int(),
  aspect_ratio: z.number(),
});
export type TmdbImage = z.infer<typeof imageSchema>;

const imagesResponseSchema = z.object({ id: z.number().int(), backdrops: z.array(imageSchema) });
const findResponseSchema = z.object({ movie_results: z.array(z.object({ id: z.number().int().positive() })) });

export interface TmdbClient {
  /** TMDB movie id for an IMDb id (for catalog films Wikidata had no TMDB id for), or null. */
  movieIdForImdb(imdbId: string): Promise<number | null>;
  /**
   * The film's **textless** backdrops (no language tag), best first. Backdrops tagged with a
   * language usually carry the title treatment, which would give the answer away.
   */
  backdrops(tmdbId: number): Promise<TmdbImage[]>;
  /** Raw image bytes from the CDN. */
  download(filePath: string, size?: "w780" | "w1280" | "original"): Promise<Buffer>;
}

/** v4 read tokens are JWTs; v3 keys are 32 hex characters. */
export function tmdbAuth(key: string): { headers: Record<string, string>; query: Record<string, string> } {
  if (/^[0-9a-f]{32}$/i.test(key)) return { headers: {}, query: { api_key: key } };
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return { headers: { authorization: `Bearer ${key}` }, query: {} };
  throw new Error("TMDB_API_KEY doesn't look like a v3 API key (32 hex characters) or a v4 read access token (starts with eyJ).");
}

/** Usable stills: textless, landscape, at least 1280 px wide where possible, best voted first. */
export function rankBackdrops(images: readonly TmdbImage[], minWidth = STILL_MAX_WIDTH): TmdbImage[] {
  const textless = images.filter((image) => image.iso_639_1 === null && image.aspect_ratio >= 1.3);
  const wide = textless.filter((image) => image.width >= minWidth);
  const usable = wide.length ? wide : textless;
  return [...usable].sort((a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count || b.width - a.width || a.file_path.localeCompare(b.file_path));
}

export function tmdbClient(key: string = tmdbApiKey(), retry: RetryOptions = {}): TmdbClient {
  const auth = tmdbAuth(key);
  const api = async (path: string, query: Record<string, string> = {}): Promise<unknown> => {
    const url = `${TMDB_API}${path}?${new URLSearchParams({ ...query, ...auth.query })}`;
    const response = await fetchWithRetry(url, { headers: { accept: "application/json", ...auth.headers } }, { label: "tmdb", ...retry });
    return response.json();
  };
  return {
    async movieIdForImdb(imdbId) {
      if (!/^tt[0-9]{7,10}$/.test(imdbId)) throw new Error(`Not an IMDb id: ${imdbId}`);
      const parsed = findResponseSchema.parse(await api(`/find/${imdbId}`, { external_source: "imdb_id" }));
      return parsed.movie_results[0]?.id ?? null;
    },
    async backdrops(tmdbId) {
      if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) throw new Error(`Not a TMDB id: ${tmdbId}`);
      try {
        // `null` asks for images without a language: the textless ones.
        const parsed = imagesResponseSchema.parse(await api(`/movie/${tmdbId}/images`, { include_image_language: "null" }));
        return rankBackdrops(parsed.backdrops);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return [];
        throw error;
      }
    },
    async download(filePath, size = "w1280") {
      if (!imageSchema.shape.file_path.safeParse(filePath).success) throw new Error(`Unexpected TMDB image path: ${filePath}`);
      const response = await fetchWithRetry(`${TMDB_IMAGES}/${size}${filePath}`, {}, { label: "tmdb images", ...retry });
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) throw new Error(`TMDB returned ${type || "no content type"} for ${filePath}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/** Re-encodes a downloaded still for `puzzle_assets`: webp, ≤ 1280 px wide, metadata stripped. */
export function encodeStill(image: Buffer, quality = 82): Promise<EncodedImage> {
  return encodeImage(image, { maxWidth: STILL_MAX_WIDTH, maxHeight: STILL_MAX_WIDTH, format: "webp", quality });
}

export interface FetchedStill extends EncodedImage {
  /** TMDB file path it came from (for the manifest and deduplication; never shown to players). */
  source: string;
  voteAverage: number;
  voteCount: number;
}

/** Downloads and re-encodes up to `max` textless backdrops of a film, best first. */
export async function fetchFilmStills(client: TmdbClient, tmdbId: number, max: number): Promise<FetchedStill[]> {
  const out: FetchedStill[] = [];
  for (const image of (await client.backdrops(tmdbId)).slice(0, max)) {
    const encoded = await encodeStill(await client.download(image.file_path, image.width >= STILL_MAX_WIDTH ? "w1280" : "original"));
    out.push({ ...encoded, source: image.file_path, voteAverage: image.vote_average, voteCount: image.vote_count });
  }
  return out;
}
