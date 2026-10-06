/**
 * Film stills from TMDB, re-encoded and cached locally for the image games' pipelines.
 *
 *   npm run content:movies:stills -- --top 100            the 100 best-known catalog films
 *   npm run content:movies:stills -- --film 42 --film 7   specific catalog films (movie_films.id)
 *   npm run content:movies:stills -- --top 100 --per-film 10 --refresh
 *
 * Needs TMDB_API_KEY (see README.md) and the imported catalog. For each film it finds the TMDB id
 * (Wikidata usually provides it; otherwise it's looked up from the IMDb id), downloads the best
 * **textless** backdrops (language-tagged ones usually show the title), and re-encodes each with
 * sharp: webp, at most 1280 px wide, every byte of metadata stripped. That is exactly the form
 * `puzzle_assets` stores, so later steps embed these files as they are (`newAsset(kind, image)`).
 *
 * Output (not committed; TMDB images are copyrighted and licensed to us for display only):
 *   content/movies/stills/tmdb-<id>/manifest.json   film identity + one entry per still
 *   content/movies/stills/tmdb-<id>/01.webp …       best first
 * A film whose folder already has a manifest is skipped unless --refresh is passed.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ContentDb } from "../lib/db.mjs";
import { mapPool } from "./lib/http.mjs";
import { pipelineDb, positiveInt } from "./lib/pipeline.mjs";
import { STILLS_DIR, stillsDirFor, writeManifest, type StillsManifest } from "./lib/stills-cache.mjs";
import { fetchFilmStills, tmdbClient, type TmdbClient } from "./lib/tmdb.mjs";

const { values: args } = parseArgs({
  options: {
    film: { type: "string", multiple: true },
    top: { type: "string" },
    "per-film": { type: "string", default: "8" },
    refresh: { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

interface FilmRow {
  id: number;
  title: string;
  year: number | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  wikidata_id: string | null;
}

const FILM_COLUMNS = "id, title, year, tmdb_id, imdb_id, wikidata_id";

async function chooseFilms(db: ContentDb): Promise<FilmRow[]> {
  if (args.film?.length) {
    const ids = args.film.map((value) => positiveInt(value, "film", { max: 2_147_483_647 }));
    const { data, error } = await db.from("movie_films").select(FILM_COLUMNS).in("id", ids);
    if (error) throw new Error(error.message);
    const missing = ids.filter((id) => !data.some((row) => row.id === id));
    if (missing.length) throw new Error(`No catalog film with id ${missing.join(", ")}`);
    return ids.map((id) => data.find((row) => row.id === id)!);
  }
  if (!args.top) throw new Error("Choose films with --top <n> or --film <catalog id> (repeatable).");
  const top = positiveInt(args.top, "top", { max: 1000 });
  const { data, error } = await db
    .from("movie_films")
    .select(FILM_COLUMNS)
    .or("tmdb_id.not.is.null,imdb_id.not.is.null")
    .order("popularity", { ascending: false })
    .order("id")
    .limit(top);
  if (error) throw new Error(error.message);
  if (data.length === 0) throw new Error("The catalog has no films with a TMDB or IMDb id. Run `npm run content:movies:catalog` first.");
  return data;
}

async function resolveTmdbId(client: TmdbClient, film: FilmRow): Promise<number | null> {
  if (film.tmdb_id !== null) return film.tmdb_id;
  return film.imdb_id ? client.movieIdForImdb(film.imdb_id) : null;
}

async function main() {
  // Check the key before touching the database or the network, so a missing key fails first.
  const client = tmdbClient();
  const perFilm = positiveInt(args["per-film"], "per-film", { max: 30 });
  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const films = await chooseFilms(db);
  mkdirSync(STILLS_DIR, { recursive: true });

  let fetched = 0;
  let failures = 0;
  await mapPool(films, 3, async (film) => {
    const label = `${film.title}${film.year ? ` (${film.year})` : ""} [#${film.id}]`;
    try {
      const tmdbId = await resolveTmdbId(client, film);
      if (tmdbId === null) {
        console.log(`· ${label}: no TMDB match`);
        return;
      }
      const dir = stillsDirFor(tmdbId);
      if (existsSync(join(dir, "manifest.json")) && !args.refresh) {
        console.log(`· ${label}: cached (use --refresh)`);
        return;
      }
      const stills = await fetchFilmStills(client, tmdbId, perFilm);
      if (stills.length === 0) {
        console.log(`· ${label}: no textless backdrops on TMDB`);
        return;
      }
      // Replace the folder's images atomically enough for a local cache: clear, then write.
      mkdirSync(dir, { recursive: true });
      for (const file of readdirSync(dir)) if (file.endsWith(".webp")) rmSync(join(dir, file));
      const manifest: StillsManifest = {
        version: 1,
        source: "tmdb",
        fetchedAt: new Date().toISOString(),
        film: { catalogId: film.id, title: film.title, year: film.year, tmdbId, imdbId: film.imdb_id, wikidataId: film.wikidata_id },
        stills: stills.map((still, i) => {
          const file = `${String(i + 1).padStart(2, "0")}.webp`;
          writeFileSync(join(dir, file), still.bytes);
          return { file, width: still.width, height: still.height, mime: still.mime, tmdbPath: still.source, voteAverage: still.voteAverage, voteCount: still.voteCount };
        }),
      };
      writeManifest(dir, manifest);
      fetched++;
      const size = stills.reduce((sum, s) => sum + s.bytes.length, 0);
      console.log(`✓ ${label}: ${stills.length} still(s), ${Math.round(size / 1024)} KB`);
    } catch (error) {
      failures++;
      console.error(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  console.log(`\n${fetched} film(s) fetched into ${STILLS_DIR}.${failures ? ` ${failures} failed.` : ""}`);
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
