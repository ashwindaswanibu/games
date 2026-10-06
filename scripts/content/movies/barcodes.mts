/**
 * Real color barcodes for Color Barcode, from the films' own video files.
 *
 * Needs ffmpeg and ffprobe on the PATH (macOS: `brew install ffmpeg`) and the videos, named after
 * the film, in content/barcodes/:
 *
 *   content/barcodes/<film-id>.<ext>     film-id: the Wikidata id (Q193815) or the catalog id (1234)
 *
 * Wikidata ids are preferred: they're the same in every database, catalog ids are not. Videos are
 * large and copyrighted, so content/barcodes/.gitignore keeps them out of git.
 *
 * 1. Extract (default): sample the video, average each sampled frame in linear light (leaving
 *    letterbox and pillarbox mattes out), group the frames into stripes, and save
 *    content/barcodes/<film-id>.barcode.json. Existing barcodes are kept unless --force.
 *
 *      npm run content:movies:barcodes --
 *        [--film <film-id>]...   only these films (default: every video in content/barcodes)
 *        [--stripes 360]         stripes per barcode (24–2000)
 *        [--sample-fps 1]        frames sampled per second of film (0.1–10)
 *        [--force]               re-extract even if the .barcode.json exists
 *
 * 2. Publish: turn one saved barcode into the puzzle for a day (only the .barcode.json is needed).
 *
 *      npm run content:movies:barcodes -- --publish --film <film-id> --date 2026-10-20 [--replace] [--allow-remote]
 *
 *    A day that already has a puzzle is left alone unless --replace, and a day someone has played
 *    is never replaced. Writes only to a local Supabase unless --allow-remote.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parsePuzzleDate, type PuzzleDate } from "@/core/day";
import { toFilmDetails } from "@/games/_movies/server";
import { barcodeFromFrames, hexColorSchema, type FrameGeometry } from "@/games/color-barcode/barcode";
import { colorBarcode, MAX_GUESSES, MAX_STRIPES, MIN_STRIPES } from "@/games/color-barcode/logic";
import type { Json } from "@/server/database.types";
import { createGameServices, type FilmRecord } from "@/server/game-services";
import { contentDb, type ContentDb } from "../lib/db.mjs";
import { isLocalSupabase, supabaseEnv } from "../lib/env.mjs";
import { decodeFrames, probeDuration, requireTool } from "./lib/barcode-video.mjs";

const BARCODE_DIR = fileURLToPath(new URL("../../../content/barcodes/", import.meta.url));
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mkv", "mov", "avi", "webm", "mpg", "mpeg", "ts", "wmv"]);
const FILM_ID = /^(?:Q[1-9]\d*|[1-9]\d*)$/;
/** Each sampled frame is scaled (area-averaged) to this grid before averaging and matte detection. */
const GRID: FrameGeometry = { width: 64, height: 36 };

const { values: args } = parseArgs({
  options: {
    film: { type: "string", multiple: true },
    stripes: { type: "string", default: "360" },
    "sample-fps": { type: "string", default: "1" },
    force: { type: "boolean", default: false },
    publish: { type: "boolean", default: false },
    date: { type: "string" },
    replace: { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

/** What extraction saves, and publishing reads back. */
const barcodeFileSchema = z.object({
  version: z.literal(1),
  /** As written; publishing resolves the film again in the target database. */
  film: z.object({ id: z.number().int().positive(), wikidataId: z.string().nullable(), title: z.string(), year: z.number().int().nullable() }),
  source: z.object({
    file: z.string(),
    sampleFps: z.number().positive(),
    frames: z.number().int().positive(),
    mattes: z.object({ top: z.number().int(), bottom: z.number().int(), left: z.number().int(), right: z.number().int() }),
  }),
  stripes: z.array(hexColorSchema).min(MIN_STRIPES).max(MAX_STRIPES),
  extractedAt: z.string(),
});
type BarcodeFile = z.infer<typeof barcodeFileSchema>;

const barcodePath = (filmId: string) => `${BARCODE_DIR}${filmId}.barcode.json`;

// ---------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------

async function findFilm(db: ContentDb, ref: { id?: number | null; wikidataId?: string | null }): Promise<FilmRecord | null> {
  let id = ref.id ?? null;
  if (ref.wikidataId) {
    const { data, error } = await db.from("movie_films").select("id").eq("wikidata_id", ref.wikidataId).maybeSingle();
    if (error) throw new Error(`Catalog lookup failed: ${error.message}`);
    id = data?.id ?? null;
  }
  if (id === null) return null;
  return (await createGameServices(db).films.get([id])).get(id) ?? null;
}

const filmRefFromId = (filmId: string) => (filmId.startsWith("Q") ? { wikidataId: filmId } : { id: Number(filmId) });
const notInCatalog = (filmId: string) =>
  `Film ${filmId} isn't in the catalog. Import the catalog first, and name files by Wikidata id (Q…) or catalog id.`;

// ---------------------------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------------------------

function videosIn(dir: string): Map<string, string> {
  if (!existsSync(dir)) {
    throw new Error(`${dir} doesn't exist. Create it and add the films' videos named <film-id>.<ext>, e.g. Q193815.mkv.`);
  }
  const videos = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const match = /^(.+)\.([a-z0-9]+)$/i.exec(name);
    if (!match || !VIDEO_EXTENSIONS.has(match[2].toLowerCase())) continue;
    const filmId = match[1];
    if (!FILM_ID.test(filmId)) {
      console.warn(`· skipping ${name}: name it <film-id>.${match[2]} (a Wikidata id like Q193815 or a catalog id)`);
      continue;
    }
    if (videos.has(filmId)) throw new Error(`Two videos for film ${filmId}: ${videos.get(filmId)} and ${name}. Keep one.`);
    videos.set(filmId, name);
  }
  return videos;
}

function intArg(name: string, value: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return n;
}

async function extract(db: ContentDb) {
  requireTool("ffmpeg");
  requireTool("ffprobe");
  const stripes = intArg("stripes", args.stripes, MIN_STRIPES, MAX_STRIPES);
  const fps = Number(args["sample-fps"]);
  if (!Number.isFinite(fps) || fps < 0.1 || fps > 10) throw new Error("--sample-fps must be a number from 0.1 to 10");

  const videos = videosIn(BARCODE_DIR);
  const wanted = args.film ?? [...videos.keys()];
  if (wanted.length === 0) {
    console.log(`No videos in ${BARCODE_DIR}. Add the films' videos named <film-id>.<ext>, e.g. Q193815.mkv.`);
    return 0;
  }

  let failures = 0;
  for (const filmId of wanted) {
    try {
      if (!FILM_ID.test(filmId)) throw new Error("not a Wikidata id (Q…) or catalog id");
      const file = videos.get(filmId);
      if (!file) throw new Error(`no video named ${filmId}.<ext> in ${BARCODE_DIR}`);
      const out = barcodePath(filmId);
      const path = `${BARCODE_DIR}${file}`;
      if (!args.force && existsSync(out) && statSync(out).mtimeMs >= statSync(path).mtimeMs) {
        console.log(`· ${filmId} already extracted (use --force to redo)`);
        continue;
      }
      const film = await findFilm(db, filmRefFromId(filmId));
      if (!film) throw new Error(notInCatalog(filmId));

      const duration = probeDuration(path);
      const expected = Math.floor(duration * fps);
      if (expected < stripes) {
        throw new Error(`${Math.round(duration)}s at ${fps} fps is only ~${expected} frames for ${stripes} stripes; raise --sample-fps or lower --stripes`);
      }
      console.log(`▸ ${filmId} ${film.title}${film.year ? ` (${film.year})` : ""}: ${Math.round(duration / 60)} min, ~${expected} frames`);
      const raw = await decodeFrames(path, { fps, geometry: GRID, expectedFrames: expected });
      const barcode = barcodeFromFrames(raw, GRID, stripes);
      const record: BarcodeFile = {
        version: 1,
        film: { id: film.id, wikidataId: film.wikidataId, title: film.title, year: film.year },
        source: { file, sampleFps: fps, frames: barcode.frames, mattes: barcode.mattes },
        stripes: barcode.stripes,
        extractedAt: new Date().toISOString(),
      };
      writeFileSync(out, `${JSON.stringify(barcodeFileSchema.parse(record), null, 1)}\n`);
      const { top, bottom, left, right } = barcode.mattes;
      console.log(`✓ ${filmId} ${barcode.frames} frames → ${stripes} stripes (mattes t${top} b${bottom} l${left} r${right} of ${GRID.width}×${GRID.height}) → ${out}`);
    } catch (error) {
      failures++;
      console.error(`✗ ${filmId} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------------------------

async function publish(db: ContentDb) {
  const [filmId, ...extra] = args.film ?? [];
  if (!filmId || extra.length > 0) throw new Error("--publish needs exactly one --film <film-id>");
  if (!args.date) throw new Error("--publish needs --date YYYY-MM-DD");
  const date: PuzzleDate = parsePuzzleDate(args.date);

  const path = barcodePath(filmId);
  if (!existsSync(path)) throw new Error(`No barcode for ${filmId} yet (${path}). Extract it first: --film ${filmId}`);
  const saved = barcodeFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));

  const film = await findFilm(db, saved.film.wikidataId ? { wikidataId: saved.film.wikidataId } : { id: saved.film.id });
  if (!film) throw new Error(notInCatalog(saved.film.wikidataId ?? String(saved.film.id)));
  if (film.year === null) throw new Error(`${film.title} has no release year in the catalog; the edge code needs one.`);

  const puzzle = colorBarcode.puzzleSchema.parse({ fixture: false, maxGuesses: MAX_GUESSES, stripes: saved.stripes });
  const solution = colorBarcode.solutionSchema.parse({ answer: { ...toFilmDetails(film), year: film.year } });

  const gameId = colorBarcode.id;
  const { data: existing, error: existingError } = await db.from("puzzles").select("game_id").eq("game_id", gameId).eq("puzzle_date", date).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    if (!args.replace) throw new Error(`${gameId} already has a puzzle on ${date}. Pass --replace to overwrite it.`);
    const { count, error } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", gameId).eq("puzzle_date", date);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) throw new Error(`${date} has already been played; its puzzle can't be replaced.`);
    const { error: deleteError } = await db.from("puzzles").delete().eq("game_id", gameId).eq("puzzle_date", date);
    if (deleteError) throw new Error(`Couldn't replace the old puzzle: ${deleteError.message}`);
  }
  const { error } = await db.from("puzzles").insert({ game_id: gameId, puzzle_date: date, payload: puzzle as Json, solution: solution as Json });
  if (error) throw new Error(`Couldn't save the puzzle: ${error.message}`);
  console.log(`✓ ${gameId} ${date}: ${film.title} (${film.year}), ${puzzle.stripes.length} stripes${existing ? " (replaced)" : ""}`);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const { url } = supabaseEnv();
  if (args.publish && !isLocalSupabase(url) && !args["allow-remote"]) {
    throw new Error(`Refusing to write puzzles to ${new URL(url).host}. Pass --allow-remote if you really mean it.`);
  }
  const db = contentDb();
  if (args.publish) await publish(db);
  else {
    const failures = await extract(db);
    if (failures) {
      console.error(`\n${failures} film(s) failed`);
      process.exitCode = 1;
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
