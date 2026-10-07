/**
 * Real Color Barcode puzzles: renders a film's ten levels from movie-screencaps.com frames and
 * stores them as the day's puzzle.
 *
 *   npm run content:movies:barcode-levels -- --film <catalog id> --date <YYYY-MM-DD | next-free>
 *     [--url <gallery>]          the film's movie-screencaps.com gallery (default: found in the site's directory)
 *     [--pace normal|slower|faster]   how fast the strips widen and move to the centre (default normal)
 *     [--width 2400 --height 800]     level size in pixels
 *     [--samples <n>]            frames squeezed into level 1 (default: the width, kept within 1,600–3,000)
 *     [--head 0.05 --tail 0.015] fractions of the film strips never come from: opening titles and
 *                                credits (often over the first scenes) and closing cards. Review the
 *                                first and last strips (--dry-run --out) and raise --head for a film
 *                                whose credits run longer (Barbie: 0.065)
 *     [--quality 88]             WebP quality
 *     [--concurrency 6]          requests in flight (1–6)
 *     [--replace-fixtures]       let the film take a day that holds a DEV FIXTURE nobody has played
 *     [--replace-unplayed]       let the film take a day whose curated puzzle nobody has played
 *     [--allow-repeat]           allow a film that is already another day's answer
 *     [--allow-same-director]    allow a director who has another answer within 30 days
 *     [--allow-monochrome]       allow a black-and-white film
 *     [--allow-few-caps]         allow a gallery of one page or under 1,000 caps (a short film)
 *     [--dry-run [--out <dir>]]  render and validate, write nothing to the database; with --out,
 *                                save the levels (level-01.webp …) and levels.json there for review
 *     [--allow-remote]           write to a non-local Supabase (refused otherwise)
 *
 * How the levels are made is in `lib/barcode-levels.mts` (the maths) and `lib/barcode-render.mts`;
 * where frames come from is `lib/screencaps.mts`. Frames are cached in a temp directory during the
 * run and deleted at the end; only the rendered levels are kept.
 *
 * Stored as: ten `puzzle_assets` (kinds `barcode-level-1` … `barcode-level-10`); the public payload
 * holds only level 1 (plus `maxGuesses` and the film's colourfulness), the solution holds the
 * answer and all ten levels. A day that already has a puzzle is never overwritten (only an unplayed
 * DEV FIXTURE with --replace-fixtures, or an unplayed curated puzzle with --replace-unplayed), and a
 * day someone has played is never touched: not by this script, and never by deleting plays by hand.
 *
 * The approved selection rules (design/barcode-film-selection.md) are enforced here: no film twice
 * (any date), no director twice within 30 days either side, and no black-and-white film. The
 * director check runs before any download; the colour check runs on the thumbnails, before the
 * full-quality frames. Franchises can't be checked yet: the catalog has no franchise data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { addDays, parsePuzzleDate, today, type PuzzleDate } from "@/core/day";
import { toFilmDetails } from "@/games/_movies/server";
import { colorBarcode, LEVEL_COUNT, MAX_GUESSES, type LevelRef, type Puzzle, type Solution } from "@/games/color-barcode/logic";
import { createGameServices } from "@/server/game-services";
import { encodeImage, type EncodedImage } from "../lib/images.mjs";
import { DEFAULT_STORY_TRIM, MAX_TRIM, PACE_NAMES, PACES, type PaceName } from "./lib/barcode-levels.mjs";
import { DEFAULT_LEVEL_HEIGHT, DEFAULT_LEVEL_WIDTH, renderLevels } from "./lib/barcode-render.mjs";
import {
  deleteFixturePuzzle,
  deleteUnplayedPuzzle,
  insertPuzzleIfAbsent,
  newAsset,
  pipelineDb,
  positiveInt,
  replaceableFixtureDates,
  selectAllPages,
  type ContentDb,
} from "./lib/pipeline.mjs";
import { MAX_CONCURRENCY, openGallery, resolveGallery, ScreencapsSource } from "./lib/screencaps.mjs";

const { values: args } = parseArgs({
  options: {
    film: { type: "string" },
    url: { type: "string" },
    date: { type: "string" },
    pace: { type: "string", default: "normal" },
    width: { type: "string", default: String(DEFAULT_LEVEL_WIDTH) },
    height: { type: "string", default: String(DEFAULT_LEVEL_HEIGHT) },
    samples: { type: "string" },
    quality: { type: "string", default: "88" },
    concurrency: { type: "string", default: String(MAX_CONCURRENCY) },
    head: { type: "string", default: String(DEFAULT_STORY_TRIM.head) },
    tail: { type: "string", default: String(DEFAULT_STORY_TRIM.tail) },
    "replace-fixtures": { type: "boolean", default: false },
    "replace-unplayed": { type: "boolean", default: false },
    "allow-repeat": { type: "boolean", default: false },
    "allow-same-director": { type: "boolean", default: false },
    "allow-monochrome": { type: "boolean", default: false },
    "allow-few-caps": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    out: { type: "string" },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

const GAME_ID = colorBarcode.id;
const CREDIT_SOURCE = "movie-screencaps.com";
/** No director may be the answer twice within this many days either side (approved selection rule). */
const DIRECTOR_GAP_DAYS = 30;

// ---------------------------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------------------------

async function playCount(db: ContentDb, date: PuzzleDate): Promise<number> {
  const { count, error } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", GAME_ID).eq("puzzle_date", date);
  if (error) throw new Error(`Couldn't count plays: ${error.message}`);
  return count ?? 0;
}

async function hasPuzzle(db: ContentDb, date: PuzzleDate): Promise<boolean> {
  const { data, error } = await db.from("puzzles").select("puzzle_date").eq("game_id", GAME_ID).eq("puzzle_date", date).maybeSingle();
  if (error) throw new Error(`Couldn't read the ${date} puzzle: ${error.message}`);
  return data !== null;
}

type DayStatus = "free" | "fixture" | "unplayed";
const usable = (status: string): status is DayStatus => status === "free" || status === "fixture" || status === "unplayed";

/**
 * Whether the film may take `date`: free, an unplayed DEV FIXTURE (--replace-fixtures) or an
 * unplayed curated puzzle (--replace-unplayed). Otherwise, why not. A played day never qualifies.
 */
async function dayStatus(db: ContentDb, date: PuzzleDate): Promise<DayStatus | string> {
  if ((await playCount(db, date)) > 0) return `${date} has been played; its puzzle is never replaced (pick another day; never delete plays to free one)`;
  if (!(await hasPuzzle(db, date))) return "free";
  const fixture = (await replaceableFixtureDates(db, GAME_ID, [date])).has(date);
  if (fixture && args["replace-fixtures"]) return "fixture";
  if (!fixture && args["replace-unplayed"]) return "unplayed";
  const hint = fixture ? "pass --replace-fixtures to replace an unplayed DEV FIXTURE" : "pass --replace-unplayed to replace a curated puzzle nobody has played";
  return `${GAME_ID} already has a puzzle on ${date} (${hint})`;
}

async function pickDate(db: ContentDb): Promise<PuzzleDate> {
  if (!args.date) throw new Error("--date YYYY-MM-DD (or next-free) is required, except with --dry-run");
  if (args.date !== "next-free") {
    const date = parsePuzzleDate(args.date);
    const status = await dayStatus(db, date);
    if (!usable(status)) throw new Error(status);
    return date;
  }
  const start = today();
  for (let i = 0; i < 366; i++) {
    const date = addDays(start, i);
    if (usable(await dayStatus(db, date))) return date;
  }
  throw new Error("No free day in the next year");
}

/** Dates on which `filmId` is already the answer (any shape of stored solution with an answer id). */
async function datesWithAnswer(db: ContentDb, filmId: number): Promise<string[]> {
  const rows = await selectAllPages((from, to) => db.from("puzzles").select("puzzle_date, solution").eq("game_id", GAME_ID).order("puzzle_date").range(from, to));
  const answerId = z.object({ answer: z.object({ id: z.number() }) });
  return rows.filter((row) => answerId.safeParse(row.solution).data?.answer.id === filmId).map((row) => row.puzzle_date);
}

/**
 * Answers within `DIRECTOR_GAP_DAYS` of `date` (either side, not `date` itself) that share a
 * director with the film, as "date: title (director)".
 */
async function directorClashes(db: ContentDb, date: PuzzleDate, directors: readonly string[]): Promise<string[]> {
  const wanted = new Set(directors.map((d) => d.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return [];
  const rows = await selectAllPages((from, to) =>
    db
      .from("puzzles")
      .select("puzzle_date, solution")
      .eq("game_id", GAME_ID)
      .gte("puzzle_date", addDays(date, -DIRECTOR_GAP_DAYS))
      .lte("puzzle_date", addDays(date, DIRECTOR_GAP_DAYS))
      .neq("puzzle_date", date)
      .order("puzzle_date")
      .range(from, to),
  );
  const answer = z.object({ answer: z.object({ title: z.string(), directors: z.array(z.string()) }) });
  return rows.flatMap((row) => {
    const parsed = answer.safeParse(row.solution).data;
    const shared = parsed?.answer.directors.filter((d) => wanted.has(d.trim().toLowerCase())) ?? [];
    return shared.length > 0 ? [`${row.puzzle_date}: ${parsed!.answer.title} (${shared.join(" & ")})`] : [];
  });
}

/** A `--head`/`--tail` fraction. */
function trimArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_TRIM) throw new Error(`--${name} must be a fraction of the film from 0 to ${MAX_TRIM}`);
  return n;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const filmId = positiveInt(args.film, "film");
  const pace = args.pace as PaceName;
  if (!PACE_NAMES.includes(pace)) throw new Error(`--pace must be one of ${PACE_NAMES.join(", ")}`);
  const width = positiveInt(args.width, "width", { min: 320, max: 4096 });
  const height = positiveInt(args.height, "height", { min: 120, max: 2048 });
  const samples = args.samples === undefined ? undefined : positiveInt(args.samples, "samples", { min: 100, max: 6000 });
  const quality = positiveInt(args.quality, "quality", { min: 40, max: 100 });
  const concurrency = positiveInt(args.concurrency, "concurrency", { min: 1, max: MAX_CONCURRENCY });
  const trim = { head: trimArg(args.head, "head"), tail: trimArg(args.tail, "tail") };
  const dryRun = args["dry-run"];
  if (args.out && !dryRun) throw new Error("--out is for --dry-run reviews; drop it to store the puzzle");

  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const film = (await createGameServices(db).films.get([filmId])).get(filmId);
  if (!film) throw new Error(`Film ${filmId} isn't in the catalog`);
  console.log(`▸ ${film.title}${film.year ? ` (${film.year})` : ""}, catalog id ${film.id}`);

  const used = (await datesWithAnswer(db, film.id)).filter((d) => d !== args.date);
  if (used.length > 0 && !args["allow-repeat"]) {
    const message = `${film.title} is already the answer on ${used.join(", ")}`;
    if (!dryRun) throw new Error(`${message} (pass --allow-repeat to use it again)`);
    console.warn(`  ⚠ ${message}`);
  }

  let date: PuzzleDate | null = null;
  if (!dryRun || args.date) date = await pickDate(db);
  if (date) console.log(`  day: ${date}`);

  // Selection rules that need no frames, checked before anything is downloaded.
  const clashes = await directorClashes(db, date ?? today(), film.directors);
  if (clashes.length > 0) {
    const message = `${film.directors.join(" & ")} already directed an answer within ${DIRECTOR_GAP_DAYS} days of ${date ?? "today"}: ${clashes.join("; ")}`;
    if (!dryRun && !args["allow-same-director"]) throw new Error(`${message} (pass --allow-same-director to use the film anyway)`);
    console.warn(`  ⚠ ${message}`);
  }

  const galleryUrl = args.url ?? (await resolveGallery(film)).url;
  const gallery = await openGallery(galleryUrl, { allowFewCaps: args["allow-few-caps"] });
  console.log(`  frames: ${gallery.url} (${gallery.frameCount} caps), pace ${pace}, ${width}×${height}`);

  const source = new ScreencapsSource(gallery, concurrency);
  // Ctrl-C mid-run must not leave frames behind either.
  const interrupted = () => {
    source.close();
    console.error("\n✗ interrupted; frame cache deleted");
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  let rendered;
  try {
    rendered = await renderLevels(source, {
      width,
      height,
      pace: PACES[pace],
      samples,
      trim,
      log: (m) => console.log(m),
      // Black-and-white films make grey, dull levels: refused on the thumbnails, before the long part.
      checkLook: (look) => {
        if (!look.monochrome) return;
        const message = `${film.title} looks black and white (only ${(look.chromaticShare * 100).toFixed(1)}% of its pixels carry colour)`;
        if (!args["allow-monochrome"]) throw new Error(`${message}; black-and-white films are skipped (pass --allow-monochrome to use it anyway)`);
        console.warn(`  ⚠ ${message}`);
      },
    });
  } finally {
    source.close();
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
  console.log(`  downloaded ${(source.bytesDownloaded / 1048576).toFixed(1)} MB in ${source.requests} requests; frame cache deleted`);
  if (rendered.levels.length !== LEVEL_COUNT) throw new Error(`Rendered ${rendered.levels.length} levels, expected ${LEVEL_COUNT}`);

  const encoded: EncodedImage[] = [];
  for (const level of rendered.levels) encoded.push(await encodeImage(level.image, { format: "webp", quality, smartSubsample: true, maxWidth: width, maxHeight: height }));
  const assets = encoded.map((image, i) => newAsset(`barcode-level-${i + 1}`, image));
  const levels: LevelRef[] = assets.map((asset, i) => ({
    id: asset.id,
    width: asset.width,
    height: asset.height,
    average: rendered.levels[i]!.average,
    dominant: rendered.levels[i]!.dominant,
  }));

  const puzzle: Puzzle = colorBarcode.puzzleSchema.parse({
    fixture: false,
    maxGuesses: MAX_GUESSES,
    first: levels[0],
    look: { saturation: Number(rendered.look.saturation.toFixed(4)), monochrome: rendered.look.monochrome },
  });
  const solution: Solution = colorBarcode.solutionSchema.parse({ answer: toFilmDetails(film), levels, pace, credit: { source: CREDIT_SOURCE, url: gallery.url } });
  if (puzzle.first.id !== solution.levels[0]!.id) throw new Error("Level 1 must be the puzzle's first level");

  const atPercent = (n: number) => `${((n / gallery.frameCount) * 100).toFixed(1)}%`;
  rendered.levels.forEach((level, i) => {
    const kb = (encoded[i]!.bytes.length / 1024).toFixed(0);
    const span = level.frames.length > 0 ? `  strips from ${atPercent(level.frames[0]!)} to ${atPercent(level.frames.at(-1)!)}` : "";
    console.log(`  level ${String(level.level).padStart(2)}: ${String(level.strips).padStart(4)} ${level.level === 1 ? "frames" : "strips"}  ${kb.padStart(5)} KB  avg ${level.average}  dominant ${level.dominant}${span}`);
  });
  console.log(`  check the first and last strips for titles or credits; raise --head or --tail if any show`);

  if (dryRun) {
    if (args.out) {
      const dir = path.resolve(args.out);
      mkdirSync(dir, { recursive: true });
      encoded.forEach((image, i) => writeFileSync(path.join(dir, `level-${String(i + 1).padStart(2, "0")}.webp`), image.bytes));
      const summary = {
        film: { id: film.id, title: film.title, year: film.year, directors: film.directors },
        gallery: gallery.url,
        caps: gallery.frameCount,
        pace,
        size: { width, height },
        sampledFrames: rendered.sampled,
        stripFrames: rendered.fetched,
        mattes: rendered.mattes,
        trim,
        story: rendered.story,
        look: rendered.look,
        levels: rendered.levels.map((l, i) => ({
          level: l.level,
          strips: l.strips,
          crop: l.crop,
          average: l.average,
          dominant: l.dominant,
          bytes: encoded[i]!.bytes.length,
          frames: l.frames,
        })),
      };
      writeFileSync(path.join(dir, "levels.json"), `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`✓ dry run: levels written to ${dir}`);
    } else {
      console.log("✓ dry run: nothing written");
    }
  } else {
    if (!date) throw new Error("No date");
    // Re-check: the day may have changed while the levels rendered.
    const status = await dayStatus(db, date);
    if (!usable(status)) throw new Error(status);
    if (status === "fixture") await deleteFixturePuzzle(db, GAME_ID, date);
    if (status === "unplayed") await deleteUnplayedPuzzle(db, GAME_ID, date);
    const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date, puzzle, solution, assets });
    if (outcome === "exists") throw new Error(`${date} got a puzzle while the levels rendered; nothing written`);
    const replaced = { free: "", fixture: " (replaced a DEV FIXTURE)", unplayed: " (replaced an unplayed curated puzzle)" }[status];
    console.log(`✓ ${GAME_ID} ${date}: ${film.title}${replaced}`);
  }
  console.log(`  took ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
