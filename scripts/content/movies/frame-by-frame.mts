/**
 * Frame by Frame content pipeline: real daily puzzles from TMDB backdrops.
 *
 *   npm run content:movies:frame-by-frame                      today (New York) + 7 days
 *   npm run content:movies:frame-by-frame -- --from 2026-11-01 --days 30
 *   npm run content:movies:frame-by-frame -- --replace-fixtures  also take over DEV FIXTURE days nobody has played
 *   npm run content:movies:frame-by-frame -- --dry-run         pick and order frames, write nothing
 *
 * (Or directly: tsx --conditions=react-server --env-file=.env.local scripts/content/movies/frame-by-frame.mts)
 *
 * Needs an imported catalog, and stills: from the local cache (`npm run content:movies:stills`)
 * where a film has been fetched, else from TMDB, which needs TMDB_API_KEY (a v3 key or a v4 read
 * token; without it only cached films are used). For each date without a puzzle it picks a popular
 * catalog film it hasn't used before, takes up to `MAX_STILLS` of its textless backdrops, orders six
 * of them hardest to easiest with the heuristic documented in `src/games/frame-by-frame/frame-order.ts`,
 * and writes them (already re-encoded, metadata stripped) into `puzzle_assets` with the puzzle.
 * Frame 1 goes in the puzzle; frames 2–6 stay in the solution until the game earns them.
 *
 * A day that already has a puzzle is never overwritten, with one exception: `--replace-fixtures`
 * replaces a DEV FIXTURE puzzle (payload `fixture: true`) that nobody has played. Curated puzzles
 * and played days are always kept.
 *
 * TMDB terms: once these images ship, the app must show "This product uses the TMDB API but is not
 * endorsed or certified by TMDB" (plan §4).
 */
import { parseArgs } from "node:util";
import sharp from "sharp";
import type { AssetRef } from "@/core/assets";
import { createRng, type Rng } from "@/core/random";
import { FRAME_COUNT, frameByFrame } from "@/games/frame-by-frame/logic";
import { differenceHash, imageStats, orderFrames, type FrameCandidate } from "@/games/frame-by-frame/frame-order";
import { toFilmDetails } from "@/games/_movies/server";
import { createGameServices } from "@/server/game-services";
import type { FilmRecord } from "@/server/game-services";
import { stillsSource, StillsUnavailableError, type SourcedStill, type StillsSource } from "./lib/film-stills.mjs";
import { mapPool } from "./lib/http.mjs";
import {
  contentSeed,
  deleteFixturePuzzle,
  existingPuzzleDates,
  insertPuzzleIfAbsent,
  newAsset,
  pipelineDb,
  positiveInt,
  puzzleDateRange,
  replaceableFixtureDates,
  selectAllPages,
  type AssetToInsert,
  type ContentDb,
} from "./lib/pipeline.mjs";

const GAME_ID = frameByFrame.id;
/** Stills considered per film (the best-voted ones). */
const MAX_STILLS = 24;
/** Candidate answers: this many of the most popular catalog films with directors. */
const CANDIDATE_FILMS = 400;
/** Films tried per day before giving up on that day. */
const ATTEMPTS_PER_DAY = 12;

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    days: { type: "string", default: "8" },
    "min-year": { type: "string" },
    "replace-fixtures": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

// ---------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------

async function describeStill(still: SourcedStill): Promise<FrameCandidate> {
  const image = sharp(still.bytes, { failOn: "error" }).rotate().removeAlpha().toColorspace("srgb");
  const thumb = await image.clone().resize(96, 54, { fit: "fill" }).raw().toBuffer();
  const hashThumb = await image.clone().resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
  return {
    key: still.source,
    width: still.width,
    height: still.height,
    // The stills source only serves textless backdrops (no language tag).
    language: null,
    voteAverage: still.voteAverage,
    voteCount: still.voteCount,
    hash: differenceHash(new Uint8Array(hashThumb)),
    stats: imageStats(new Uint8Array(thumb), 3),
  };
}

/**
 * Six ordered frames for the film, stored as they come from the stills source (already re-encoded
 * for `puzzle_assets`), or null if it lacks enough usable stills.
 */
async function framesFor(source: StillsSource, film: FilmRecord): Promise<AssetToInsert[] | null> {
  const found = await source.stillsFor(film, MAX_STILLS);
  if (!found || found.stills.length < FRAME_COUNT) return null;
  const candidates = await mapPool(found.stills, 4, async (still) => ({ still, candidate: await describeStill(still) }));
  const order = orderFrames(candidates.map((c) => c.candidate));
  if (!order) return null;
  const byKey = new Map(candidates.map((c) => [c.candidate.key, c.still]));
  return order.map((frame) => {
    const { bytes, mime, width, height } = byKey.get(frame.key)!;
    return newAsset("frame", { bytes, mime, width, height });
  });
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

async function candidateFilms(db: ContentDb, minYear: number | undefined): Promise<FilmRecord[]> {
  let query = db
    .from("movie_films")
    .select("id")
    .eq("is_adult", false)
    .filter("directors", "neq", "{}")
    .or("tmdb_id.not.is.null,imdb_id.not.is.null")
    .order("popularity", { ascending: false })
    .order("id")
    .limit(CANDIDATE_FILMS);
  if (minYear !== undefined) query = query.gte("year", minYear);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to read the catalog: ${error.message}`);
  if (data.length === 0) throw new Error("No catalog films with a TMDB or IMDb id. Run the catalog import first (scripts/content/movies/catalog.mts).");
  const records = await createGameServices(db).films.get(data.map((r) => r.id));
  return data.flatMap((r) => (records.has(r.id) ? [records.get(r.id)!] : []));
}

/** Film ids already used as a Frame by Frame answer, so no film repeats (DEV FIXTURE days included). */
async function usedAnswers(db: ContentDb): Promise<Set<number>> {
  const rows = await selectAllPages((from, to) =>
    db.from("puzzles").select("puzzle_date, solution").eq("game_id", GAME_ID).order("puzzle_date").range(from, to),
  );
  const used = new Set<number>();
  for (const row of rows) {
    const parsed = frameByFrame.solutionSchema.safeParse(row.solution);
    if (parsed.success) used.add(parsed.data.answer.id);
  }
  return used;
}

/** Popularity-weighted pick without replacement: earlier (more popular) films are likelier. */
function weightedOrder(films: readonly FilmRecord[], rng: Rng): FilmRecord[] {
  return films
    // Efraimidis–Spirakis: key = u^(1/weight), weight 1/sqrt(rank + 1).
    .map((film, rank) => ({ film, key: rng.next() ** Math.sqrt(rank + 1) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.film);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  // Fails here, before any other work, when there's neither a key nor a stills cache.
  const source = stillsSource();
  if (!source.online) console.log("TMDB_API_KEY isn't set: using cached stills only (npm run content:movies:stills).");
  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const dates = puzzleDateRange(positiveInt(args.days, "days", { max: 366 }), args.from);
  const minYear = args["min-year"] === undefined ? undefined : positiveInt(args["min-year"], "min-year", { min: 1870, max: 2100 });

  const existing = await existingPuzzleDates(db, GAME_ID, dates);
  const replaceable = args["replace-fixtures"] ? await replaceableFixtureDates(db, GAME_ID, dates) : new Set<string>();
  const todo = dates.filter((d) => !existing.has(d) || replaceable.has(d));
  for (const d of dates.filter((d) => existing.has(d) && !replaceable.has(d))) {
    console.log(`· ${GAME_ID} ${d} exists${args["replace-fixtures"] ? " (curated or already played: kept)" : ""}`);
  }
  if (todo.length === 0) return;

  const films = await candidateFilms(db, minYear);
  const used = await usedAnswers(db);
  let failures = 0;

  for (const date of todo) {
    const rng = createRng(contentSeed(GAME_ID, date));
    const order = weightedOrder(films.filter((f) => !used.has(f.id)), rng).slice(0, ATTEMPTS_PER_DAY);
    let done = false;
    let unavailable = 0;
    for (const film of order) {
      const assets = await framesFor(source, film).catch((error: unknown) => {
        if (error instanceof StillsUnavailableError) unavailable++;
        else console.warn(`  ${film.title}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (!assets) continue;

      const refs: AssetRef[] = assets.map((a) => ({ id: a.id, width: a.width, height: a.height }));
      const [first, ...later] = refs;
      const puzzle = frameByFrame.puzzleSchema.parse({ fixture: false, first });
      const solution = frameByFrame.solutionSchema.parse({ answer: toFilmDetails(film), later });
      const kb = Math.round(assets.reduce((sum, a) => sum + a.bytes.length, 0) / 1024);
      if (args["dry-run"]) {
        console.log(`✓ ${GAME_ID} ${date} validated: ${film.title} (${film.year ?? "?"}), ${assets.length} frames, ${kb} KB`);
      } else {
        const replacing = replaceable.has(date);
        if (replacing) await deleteFixturePuzzle(db, GAME_ID, date);
        const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date, puzzle, solution, assets });
        const verb = outcome === "created" && replacing ? "replaced DEV FIXTURE" : outcome;
        console.log(`${outcome === "created" ? "✓" : "·"} ${GAME_ID} ${date} ${verb}: ${film.title} (${film.year ?? "?"}), ${kb} KB`);
      }
      used.add(film.id);
      done = true;
      break;
    }
    if (!done) {
      failures++;
      const skipped = unavailable ? ` (${unavailable} skipped: not in the stills cache and no TMDB_API_KEY)` : "";
      console.error(`✗ ${GAME_ID} ${date}: none of ${order.length} films had ${FRAME_COUNT} distinct language-free backdrops${skipped}`);
    }
  }
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
