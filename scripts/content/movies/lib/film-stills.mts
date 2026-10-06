import { existsSync, readdirSync } from "node:fs";
import type { FilmRecord } from "@/server/game-services";
import { tmdbApiKey } from "../../lib/env.mjs";
import type { EncodedImage } from "../../lib/images.mjs";
import { readCachedStills, STILLS_DIR } from "./stills-cache.mjs";
import { fetchFilmStills, tmdbClient, type TmdbClient } from "./tmdb.mjs";

/**
 * Where the image games' pipelines get a film's stills: the local cache written by
 * `content:movies:stills` first (no network, and the same stills on every run), then TMDB.
 *
 * Every still is already in `puzzle_assets` form (webp, at most 1280 px, metadata stripped) and
 * textless (TMDB images without a language tag), best voted first.
 */

export interface SourcedStill extends EncodedImage {
  /** TMDB file path it came from (logs and deduplication only; never shown to players). */
  source: string;
  voteAverage: number;
  voteCount: number;
}

export interface FilmStills {
  tmdbId: number;
  from: "cache" | "tmdb";
  stills: SourcedStill[];
}

/** A film that isn't in the stills cache, while there's no TMDB key to fetch it with. */
export class StillsUnavailableError extends Error {}

export interface StillsSource {
  /** True when TMDB_API_KEY is set, so uncached films can be fetched. */
  readonly online: boolean;
  /** Up to `max` stills of the film, or null if TMDB doesn't know it. */
  stillsFor(film: FilmRecord, max: number): Promise<FilmStills | null>;
}

function cacheIsEmpty(): boolean {
  return !existsSync(STILLS_DIR) || readdirSync(STILLS_DIR).every((entry) => !entry.startsWith("tmdb-"));
}

/**
 * The stills source for a pipeline run. Without TMDB_API_KEY it serves cached films only; with an
 * empty cache as well it fails at once with the key's setup instructions (from `tmdbApiKey`).
 */
export function stillsSource(): StillsSource {
  const online = Boolean(process.env.TMDB_API_KEY?.trim());
  if (!online && cacheIsEmpty()) tmdbApiKey();
  let client: TmdbClient | null = null;
  const tmdb = () => (client ??= tmdbClient());

  return {
    online,
    async stillsFor(film, max) {
      let tmdbId = film.tmdbId;
      if (tmdbId === null) {
        if (film.imdbId === null) return null;
        if (!online) throw new StillsUnavailableError("no TMDB id in the catalog, and no TMDB_API_KEY to look it up");
        tmdbId = await tmdb().movieIdForImdb(film.imdbId);
        if (tmdbId === null) return null;
      }

      const cached = readCachedStills(tmdbId);
      if (cached) {
        const stills = cached.images.slice(0, max).map((image, i) => {
          const entry = cached.manifest.stills[i]!;
          return { ...image, source: entry.tmdbPath, voteAverage: entry.voteAverage, voteCount: entry.voteCount };
        });
        return { tmdbId, from: "cache", stills };
      }
      if (!online) throw new StillsUnavailableError("not in the stills cache (npm run content:movies:stills), and no TMDB_API_KEY");
      return { tmdbId, from: "tmdb", stills: await fetchFilmStills(tmdb(), tmdbId, max) };
    },
  };
}
