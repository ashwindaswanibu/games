/**
 * Color Grade puzzles from real film stills.
 *
 * For each day: pick a popular catalog film (seeded by PUZZLE_SEED_SECRET, never a film an earlier
 * puzzle used), take one of its text-free backdrops (from the local stills cache written by
 * `content:movies:stills`, else from TMDB), and build the stages from it and a
 * neutral photo from content/neutral/ (`./lib/color-grade.mts`: k-means palette in Lab, Reinhard
 * colour transfer, blur). Images are re-encoded into `puzzle_assets`; nothing is hot-linked.
 *
 * Needs:
 *   - stills: cached by `npm run content:movies:stills`, or fetched with TMDB_API_KEY in .env.local
 *     (a v3 API key or a v4 read access token; free at https://www.themoviedb.org/settings/api)
 *   - PUZZLE_SEED_SECRET in .env.local (already there for the app)
 *   - the movie catalog imported (scripts/content/movies/catalog.mts)
 *   - neutral photos in content/neutral/*.jpg (see content/neutral/README.md)
 *
 *   npm run content:movies:color-grade   (= tsx --conditions=react-server --env-file=.env.local scripts/content/movies/color-grade.mts)
 *     [--from 2026-10-20]   first day (default: today, New York)
 *     [--days 8]            how many days (1–366)
 *     [--film <catalog id>] use this film instead of picking one (only with --days 1)
 *     [--replace]           regenerate days that have a puzzle nobody has played yet
 *     [--dry-run]           build and validate everything, write nothing
 *     [--allow-remote]      allow a non-local Supabase
 *
 * Days that already have a puzzle are left alone unless --replace; a day someone has played is
 * never replaced. This product uses the TMDB API but is not endorsed or certified by TMDB.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { PuzzleDate } from "@/core/day";
import { createRng, type Rng } from "@/core/random";
import { toFilmDetails } from "@/games/_movies/server";
import { colorGrade, type Puzzle, type Solution } from "@/games/color-grade/logic";
import { createGameServices, type FilmRecord } from "@/server/game-services";
import { requireEnv } from "../lib/env.mjs";
import { createFixtureContext, type PendingAsset } from "../lib/fixtures.mjs";
import { buildColorGradeImages } from "./lib/color-grade.mjs";
import { stillsSource, StillsUnavailableError, type FilmStills, type SourcedStill, type StillsSource } from "./lib/film-stills.mjs";
import { contentSeed, insertPuzzleIfAbsent, pipelineDb, positiveInt, puzzleDateRange, selectAllPages, type ContentDb } from "./lib/pipeline.mjs";

const NEUTRAL_DIR = fileURLToPath(new URL("../../../content/neutral/", import.meta.url));
const NEUTRAL_EXTENSIONS = /\.(jpe?g)$/i;
/** Answer candidates: the most popular films with a director on record. */
const CANDIDATE_POOL = 400;
/** Films tried per day before giving up (no usable backdrop, flat frame…). */
const MAX_FILM_ATTEMPTS = 12;

// ---------------------------------------------------------------------------------------------
// Stills
// ---------------------------------------------------------------------------------------------

/** Stills considered per film; a few of the best usable ones are tried. */
const STILLS_PER_FILM = 8;
const STILLS_TRIED = 4;

/** Stage-sized (1280 wide) and roughly 16:9, so the still fills the stage without upscaling. */
function usableStill(still: SourcedStill): boolean {
  const ratio = still.width / still.height;
  return still.width >= 1280 && ratio >= 1.6 && ratio <= 2.0;
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

function neutralPhotos(): string[] {
  const hint =
    "Add a few ordinary, evenly lit, colour-balanced photos you have the rights to (JPEG, at least 1280×720) " +
    "as content/neutral/*.jpg. See content/neutral/README.md.";
  if (!existsSync(NEUTRAL_DIR)) throw new Error(`content/neutral/ doesn't exist. ${hint}`);
  const files = readdirSync(NEUTRAL_DIR)
    .filter((f) => NEUTRAL_EXTENSIONS.test(f))
    .sort();
  if (files.length === 0) throw new Error(`content/neutral/ has no .jpg photos. ${hint}`);
  return files.map((f) => `${NEUTRAL_DIR}${f}`);
}

/** Every film any color-grade puzzle has used, so an answer never repeats. */
async function usedAnswers(db: ContentDb): Promise<Map<number, string>> {
  const rows = await selectAllPages((from, to) =>
    db.from("puzzles").select("puzzle_date, solution").eq("game_id", colorGrade.id).order("puzzle_date").range(from, to),
  );
  const used = new Map<number, string>();
  for (const row of rows) {
    const parsed = colorGrade.solutionSchema.safeParse(row.solution);
    if (parsed.success) used.set(parsed.data.answer.id, row.puzzle_date);
  }
  return used;
}

async function playCount(db: ContentDb, date: PuzzleDate): Promise<number> {
  const { count, error } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", colorGrade.id).eq("puzzle_date", date);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ---------------------------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------------------------

interface BuiltDay {
  puzzle: Puzzle;
  solution: Solution;
  assets: PendingAsset[];
  film: FilmRecord;
  backdrop: string;
}

/** Tries candidate films in seeded order until one yields a full set of stage images. */
async function buildDay(params: { db: ContentDb; source: StillsSource; date: PuzzleDate; candidates: FilmRecord[]; neutrals: string[]; rng: Rng }): Promise<BuiltDay> {
  const { db, source, date, candidates, neutrals, rng } = params;
  const problems: string[] = [];
  for (const film of candidates.slice(0, MAX_FILM_ATTEMPTS)) {
    const label = `${film.title}${film.year ? ` (${film.year})` : ""}`;
    let found: FilmStills | null;
    try {
      found = await source.stillsFor(film, STILLS_PER_FILM);
    } catch (error) {
      if (!(error instanceof StillsUnavailableError)) throw error;
      problems.push(`${label}: ${error.message}`);
      continue;
    }
    if (!found) {
      problems.push(`${label}: not on TMDB`);
      continue;
    }
    // Vary the frame between runs of different days, but stay among the best-rated few.
    const stills = rng.shuffle(found.stills.filter(usableStill).slice(0, STILLS_TRIED));
    if (stills.length === 0) {
      problems.push(`${label}: no text-free 16:9 backdrop`);
      continue;
    }
    for (const backdrop of stills) {
      // A fresh context per attempt, so a failed attempt leaves no stray assets behind.
      const { ctx, assets } = createFixtureContext({ gameId: colorGrade.id, date, services: createGameServices(db), db });
      try {
        const images = await buildColorGradeImages({
          still: backdrop.bytes,
          neutral: readFileSync(rng.pick(neutrals)),
          seed: rng.int(1, 2 ** 31 - 1),
          addAsset: (input) => ctx.addAsset(input),
        });
        const puzzle = colorGrade.puzzleSchema.parse({ fixture: false, palette: images.palette });
        const solution = colorGrade.solutionSchema.parse({
          answer: toFilmDetails(film),
          neutral: images.neutral,
          graded: images.graded,
          blurred: images.blurred,
          still: images.still,
        });
        return { puzzle, solution, assets, film, backdrop: backdrop.source };
      } catch (error) {
        problems.push(`${label} ${backdrop.source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw new Error(`No usable film for ${date}:\n  ${problems.join("\n  ")}`);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      from: { type: "string" },
      days: { type: "string", default: "8" },
      film: { type: "string" },
      replace: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "allow-remote": { type: "boolean", default: false },
    },
    strict: true,
  });

  // Check every prerequisite before touching the network or the database. Without TMDB_API_KEY only
  // films in the stills cache can be used; with neither, this fails with the key's instructions.
  const source = stillsSource();
  if (!source.online) console.log("TMDB_API_KEY isn't set: using cached stills only (npm run content:movies:stills).");
  requireEnv("PUZZLE_SEED_SECRET", "It's in .env.local (the same secret the app uses for daily seeds).");
  const neutrals = neutralPhotos();
  const dates = puzzleDateRange(positiveInt(args.days, "days", { max: 366 }), args.from);
  const forcedFilm = args.film === undefined ? null : positiveInt(args.film, "film");
  if (forcedFilm !== null && dates.length !== 1) throw new Error("--film picks one day's answer; use it with --days 1");

  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const services = createGameServices(db);
  const used = await usedAnswers(db);

  let pool: FilmRecord[];
  if (forcedFilm !== null) {
    const film = (await services.films.get([forcedFilm])).get(forcedFilm);
    if (!film) throw new Error(`Film ${forcedFilm} isn't in the catalog`);
    pool = [film];
  } else {
    const { data, error } = await db
      .from("movie_films")
      .select("id")
      .filter("directors", "neq", "{}")
      .order("popularity", { ascending: false })
      .order("id")
      .limit(CANDIDATE_POOL);
    if (error) throw new Error(`Couldn't read the catalog: ${error.message}`);
    if (data.length === 0) throw new Error("The movie catalog is empty. Import it first: scripts/content/movies/catalog.mts.");
    const records = await services.films.get(data.map((row) => row.id));
    pool = data.flatMap((row) => (records.has(row.id) ? [records.get(row.id)!] : []));
  }

  let failures = 0;
  for (const date of dates) {
    try {
      const { data: existing, error } = await db.from("puzzles").select("game_id").eq("game_id", colorGrade.id).eq("puzzle_date", date).maybeSingle();
      if (error) throw new Error(error.message);
      if (existing && !args.replace) {
        console.log(`· ${date} exists (use --replace)`);
        continue;
      }
      if (existing && (await playCount(db, date)) > 0) {
        console.log(`· ${date} kept: already played`);
        continue;
      }

      const rng = createRng(contentSeed(colorGrade.id, date));
      const candidates = forcedFilm !== null ? pool : rng.shuffle(pool.filter((film) => !used.has(film.id) || used.get(film.id) === date));
      const day = await buildDay({ db, source, date, candidates, neutrals, rng });
      const size = day.assets.reduce((sum, a) => sum + a.bytes.length, 0);
      const summary = `${day.film.title} · ${day.backdrop} · ${day.assets.length} images, ${Math.round(size / 1024)} KB`;
      if (args["dry-run"]) {
        console.log(`✓ ${date} validated: ${summary}`);
        continue;
      }

      if (existing) {
        const { error: deleteError } = await db.from("puzzles").delete().eq("game_id", colorGrade.id).eq("puzzle_date", date);
        if (deleteError) throw new Error(`Couldn't replace the old puzzle: ${deleteError.message}`);
      }
      const outcome = await insertPuzzleIfAbsent(db, {
        gameId: colorGrade.id,
        date,
        puzzle: day.puzzle,
        solution: day.solution,
        assets: day.assets.map(({ id, kind, bytes, mime, width, height }) => ({ id, kind, bytes, mime, width, height })),
      });
      if (outcome === "exists") {
        console.log(`· ${date} was written by someone else meanwhile; left alone`);
        continue;
      }
      used.set(day.film.id, date);
      console.log(`✓ ${date} ${existing ? "replaced" : "created"}: ${summary}`);
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} day(s) failed`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
