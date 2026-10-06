import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ASSET_MIMES } from "@/core/assets";
import type { EncodedImage } from "../../lib/images.mjs";

/**
 * The local stills cache written by `content:movies:stills` and read by the image games'
 * pipelines. Files are already in `puzzle_assets` form (webp, ≤ 1280 px, no metadata), so a reader
 * passes them to `newAsset(kind, image)` unchanged, or decodes them for further processing.
 */

export const STILLS_DIR = fileURLToPath(new URL("../../../../content/movies/stills/", import.meta.url));

export function stillsDirFor(tmdbId: number): string {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) throw new Error(`Not a TMDB id: ${tmdbId}`);
  return join(STILLS_DIR, `tmdb-${tmdbId}`);
}

export const stillsManifestSchema = z.object({
  version: z.literal(1),
  source: z.literal("tmdb"),
  fetchedAt: z.iso.datetime(),
  film: z.object({
    /** movie_films.id in the database that ran the fetch (ids are local; match on tmdbId/wikidataId elsewhere). */
    catalogId: z.number().int().positive(),
    title: z.string().min(1),
    year: z.number().int().nullable(),
    tmdbId: z.number().int().positive(),
    imdbId: z.string().nullable(),
    wikidataId: z.string().nullable(),
  }),
  stills: z
    .array(
      z.object({
        file: z.string().regex(/^\d{2}\.webp$/),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        mime: z.enum(ASSET_MIMES),
        tmdbPath: z.string(),
        voteAverage: z.number(),
        voteCount: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type StillsManifest = z.infer<typeof stillsManifestSchema>;

export function writeManifest(dir: string, manifest: StillsManifest): void {
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(stillsManifestSchema.parse(manifest), null, 2)}\n`);
}

/** A film's cached stills, best first, ready for `newAsset`; null if it hasn't been fetched. */
export function readCachedStills(tmdbId: number): { manifest: StillsManifest; images: EncodedImage[] } | null {
  const dir = stillsDirFor(tmdbId);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = stillsManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const images = manifest.stills.map((still) => ({ bytes: readFileSync(join(dir, still.file)), mime: still.mime, width: still.width, height: still.height }));
  return { manifest, images };
}
