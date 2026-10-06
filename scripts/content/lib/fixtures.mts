import { createHash, randomUUID } from "node:crypto";
import type { AssetRef } from "@/core/assets";
import type { PuzzleDate } from "@/core/day";
import type { AnyGame, PuzzleOf, SolutionOf } from "@/core/game";
import { createRng, type Rng } from "@/core/random";
import type { FilmRecord, GameServices } from "@/server/game-services";
import type { ContentDb } from "./db.mjs";
import { encodeImage, type EncodedImage, type EncodeOptions } from "./images.mjs";

/**
 * DEV FIXTURE generators: one module per game in `scripts/content/fixtures/<game-id>.mts`, default-
 * exporting `defineFixtureGenerator(...)`. `npm run content:fixtures` runs them for a date range and
 * stores each day's puzzle and its images (see `scripts/content/fixtures.mts`).
 *
 * A generator only builds one day. The runner seeds its rng, validates the result against the
 * game's schemas, checks every asset's visibility, and writes puzzle + assets.
 */
export interface FixtureGenerator<G extends AnyGame = AnyGame> {
  readonly game: G;
  generate(ctx: FixtureContext): Promise<{ puzzle: PuzzleOf<G>; solution: SolutionOf<G> }>;
}

export function defineFixtureGenerator<G extends AnyGame>(generator: FixtureGenerator<G>): FixtureGenerator<G> {
  return generator;
}

/**
 * True for a stored puzzle payload that is a DEV FIXTURE. Every curated game with fixtures marks
 * its puzzle `fixture: true` (the board shows a "Dev fixture" tag from it); real content says
 * `false`. Replacing tools use this so they never overwrite a real, curated puzzle.
 */
export function isFixturePayload(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) && (payload as { fixture?: unknown }).fixture === true;
}

/**
 * - `shown`: on screen from the start; its ref may go in the puzzle.
 * - `secret`: unlocked later or revealed at the end; its ref must go in the solution only (the
 *   game copies it into state or reveal when earned). The runner rejects a secret asset whose id
 *   appears in the puzzle, because the puzzle is sent to every player who starts.
 */
export type AssetVisibility = "shown" | "secret";

export interface AssetInput extends EncodeOptions {
  /** What the asset is to the game: 'frame', 'palette', 'barcode'… (lowercase slug). */
  kind: string;
  visibility: AssetVisibility;
  /** Image bytes (any format sharp reads) or SVG markup. Re-encoded and metadata-stripped. */
  image: Buffer | string;
}

export interface PendingAsset extends EncodedImage {
  id: string;
  kind: string;
  visibility: AssetVisibility;
}

export interface FixtureContext {
  readonly gameId: string;
  readonly date: PuzzleDate;
  /** Seeded from (game, date): rerunning a day reproduces its choices. */
  readonly rng: Rng;
  /** Read-only catalog lookups (the same interface resolvers get). */
  readonly services: GameServices;
  /** Service-role client for anything else. Never write to `puzzles`/`puzzle_assets` directly. */
  readonly db: ContentDb;
  /** The most popular films in the catalog, most popular first. Good answer candidates. */
  topFilms(options: { limit: number; minYear?: number; requireDirectors?: boolean }): Promise<FilmRecord[]>;
  /** Encode an image and register it with this day's puzzle; embed the returned ref. */
  addAsset(input: AssetInput): Promise<AssetRef>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Fixture rng seed. Not secret: fixtures are development data. */
export function fixtureSeed(gameId: string, date: PuzzleDate): [number, number, number, number] {
  const digest = createHash("sha256").update(`fixture\u0000${gameId}\u0000${date}`).digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4), digest.readUInt32BE(8), digest.readUInt32BE(12)];
}

export function createFixtureContext(params: {
  gameId: string;
  date: PuzzleDate;
  services: GameServices;
  db: ContentDb;
}): { ctx: FixtureContext; assets: PendingAsset[] } {
  const { gameId, date, services, db } = params;
  const assets: PendingAsset[] = [];
  const ctx: FixtureContext = {
    gameId,
    date,
    rng: createRng(fixtureSeed(gameId, date)),
    services,
    db,
    async topFilms({ limit, minYear, requireDirectors = false }) {
      let query = db
        .from("movie_films")
        .select("id, title, year, genres, directors, popularity, tmdb_id, imdb_id, wikidata_id")
        .order("popularity", { ascending: false })
        .order("id")
        .limit(Math.min(Math.max(1, limit), 1000));
      if (minYear !== undefined) query = query.gte("year", minYear);
      if (requireDirectors) query = query.filter("directors", "neq", "{}");
      const { data, error } = await query;
      if (error) throw new Error(`Failed to load films: ${error.message}`);
      if (data.length === 0) {
        throw new Error("The movie catalog is empty. Import it first (see src/games/_movies/README.md, 'Catalog').");
      }
      const ids = data.map((row) => row.id);
      const records = await services.films.get(ids);
      return ids.flatMap((id) => (records.has(id) ? [records.get(id)!] : []));
    },
    async addAsset({ kind, visibility, image, ...encode }) {
      if (!SLUG.test(kind) || kind.length > 40) throw new Error(`Asset kind "${kind}" must be a lowercase slug (≤ 40 chars)`);
      const encoded = await encodeImage(image, encode);
      const asset: PendingAsset = { id: randomUUID(), kind, visibility, ...encoded };
      assets.push(asset);
      return { id: asset.id, width: asset.width, height: asset.height };
    },
  };
  return { ctx, assets };
}
