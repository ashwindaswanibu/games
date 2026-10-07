/**
 * One Fade to Color day, end to end: checks the film against the selection rules, renders its ten
 * levels from movie-screencaps.com frames and stores them as the day's puzzle. Both
 * `barcode-levels.mts` (one film, one day) and `plan-barcode.mts` (the planner) render through
 * `renderBarcodeDay`, so a planned day is made exactly like a hand-picked one.
 *
 * Rules (`design/barcode-film-selection.md`), each refused with a `FilmRefusedError` unless allowed;
 * a dry run only warns about the first three:
 * - `repeat`: the film is another day's answer within 365 days either side;
 * - `director`: a director of the film has another answer within 30 days either side;
 * - `series`: the film looks like the same series as another answer within 30 days either side;
 * - `black-and-white`: checked on the thumbnails, before the full-quality frames;
 * - `too-short`: a gallery under 1,000 caps can't be a whole film.
 * The first three are checked before anything is downloaded. What the last two find is recorded in
 * the gallery verdicts (`screencaps-cache.mts`) so the picker doesn't choose that film again.
 *
 * A day that already has a puzzle is never overwritten (only an unplayed DEV FIXTURE with
 * `replace.fixtures`, or an unplayed curated puzzle with `replace.unplayed`), and a day someone has
 * played is never touched.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, parsePuzzleDate, today, type PuzzleDate } from "@/core/day";
import { toFilmDetails } from "@/games/_movies/server";
import { fadeToColor, LEVEL_COUNT, MAX_GUESSES, type LevelRef, type Puzzle, type Solution } from "@/games/fade-to-color/logic";
import { clashes, DIRECTOR_GAP_DAYS, REPEAT_GAP_DAYS, SERIES_GAP_DAYS, type Clash } from "@/games/fade-to-color/picker";
import { createGameServices } from "@/server/game-services";
import { encodeImage, type EncodedImage } from "../../lib/images.mjs";
import { DEFAULT_STORY_TRIM, PACES, type PaceName, type StoryTrim } from "./barcode-levels.mjs";
import { DEFAULT_LEVEL_HEIGHT, DEFAULT_LEVEL_WIDTH, renderLevels, type RenderedFilm } from "./barcode-render.mjs";
import { finalPickOptions } from "./decoys.mjs";
import { loadDayAnswers } from "./film-picker.mjs";
import {
  deleteFixturePuzzle,
  deleteUnplayedPuzzle,
  insertPuzzleIfAbsent,
  newAsset,
  replaceableFixtureDates,
  type ContentDb,
} from "./pipeline.mjs";
import type { GalleryVerdicts } from "./screencaps-cache.mjs";
import { canonicalGalleryUrl, GallerySizeError, MAX_CONCURRENCY, openGallery, resolveGallery, ScreencapsSource, type DirectoryEntry, type Gallery } from "./screencaps.mjs";

export const GAME_ID = fadeToColor.id;
const CREDIT_SOURCE = "movie-screencaps.com";

export type RefusalRule = Clash["rule"] | "black-and-white" | "too-short";

/** The film breaks a selection rule (and the rule wasn't allowed). */
export class FilmRefusedError extends Error {
  override readonly name = "FilmRefusedError";
  constructor(
    readonly rule: RefusalRule,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------------------------

export interface ReplaceOptions {
  /** Take a day that holds a DEV FIXTURE nobody has played. */
  fixtures?: boolean;
  /** Take a day whose curated puzzle nobody has played (to re-render it). */
  unplayed?: boolean;
}

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

export type DayStatus = "free" | "fixture" | "unplayed";
const usable = (status: string): status is DayStatus => status === "free" || status === "fixture" || status === "unplayed";

/**
 * Whether a film may take `date`: free, an unplayed DEV FIXTURE (`replace.fixtures`) or an unplayed
 * curated puzzle (`replace.unplayed`). Otherwise, why not. A played day never qualifies.
 */
export async function dayStatus(db: ContentDb, date: PuzzleDate, replace: ReplaceOptions = {}): Promise<DayStatus | string> {
  if ((await playCount(db, date)) > 0) return `${date} has been played; its puzzle is never replaced (pick another day; never delete plays to free one)`;
  if (!(await hasPuzzle(db, date))) return "free";
  const fixture = (await replaceableFixtureDates(db, GAME_ID, [date])).has(date);
  if (fixture && replace.fixtures) return "fixture";
  if (!fixture && replace.unplayed) return "unplayed";
  const hint = fixture ? "pass --replace-fixtures to replace an unplayed DEV FIXTURE" : "pass --replace-unplayed to replace a curated puzzle nobody has played";
  return `${GAME_ID} already has a puzzle on ${date} (${hint})`;
}

/** `date` as given (`YYYY-MM-DD`, refused unless usable) or `next-free`: the first usable day from today (New York). */
export async function resolveDay(db: ContentDb, date: string, replace: ReplaceOptions = {}): Promise<PuzzleDate> {
  if (date !== "next-free") {
    const day = parsePuzzleDate(date);
    const status = await dayStatus(db, day, replace);
    if (!usable(status)) throw new Error(status);
    return day;
  }
  const start = today();
  for (let i = 0; i < 366; i++) {
    const day = addDays(start, i);
    if (usable(await dayStatus(db, day, replace))) return day;
  }
  throw new Error("No free day in the next year");
}

function describeClash(clash: Clash, title: string): string {
  switch (clash.rule) {
    case "repeat":
      return `${title} is already the answer on ${clash.date} (within ${REPEAT_GAP_DAYS} days)`;
    case "director":
      return `${clash.directors.join(" & ")} already directed an answer within ${DIRECTOR_GAP_DAYS} days: ${clash.date}: ${clash.title}`;
    case "series":
      return `${title} looks like the same series as an answer within ${SERIES_GAP_DAYS} days: ${clash.date}: ${clash.title}`;
  }
}

const CLASH_FLAG: Record<Clash["rule"], string> = { repeat: "--allow-repeat", director: "--allow-same-director", series: "--allow-same-series" };

// ---------------------------------------------------------------------------------------------
// Rendering a day
// ---------------------------------------------------------------------------------------------

export interface AllowOptions {
  repeat?: boolean;
  sameDirector?: boolean;
  sameSeries?: boolean;
  monochrome?: boolean;
  /** A gallery of one page or under 1,000 caps (a short film). */
  fewCaps?: boolean;
}

export interface BarcodeDayOptions {
  filmId: number;
  /** The day: a resolved date (see `resolveDay`), or null for a dry run checked against today. */
  date: PuzzleDate | null;
  /** The film's gallery; default: found in `directory`, or in the site's directory (one request). */
  galleryUrl?: string;
  directory?: readonly DirectoryEntry[];
  pace?: PaceName;
  width?: number;
  height?: number;
  samples?: number;
  quality?: number;
  concurrency?: number;
  trim?: StoryTrim;
  replace?: ReplaceOptions;
  allow?: AllowOptions;
  /** Render and validate, write nothing to the database; with `out`, save the levels there for review. */
  dryRun?: boolean;
  out?: string;
  /** Where to record what the frames show (black and white, colour, too short). */
  verdicts?: GalleryVerdicts;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface BarcodeDayResult {
  date: PuzzleDate | null;
  film: { id: number; title: string; year: number | null };
  galleryUrl: string;
  /** False for a dry run. */
  stored: boolean;
  /** What the stored puzzle replaced. */
  replaced: DayStatus | null;
}

export async function renderBarcodeDay(db: ContentDb, options: BarcodeDayOptions): Promise<BarcodeDayResult> {
  const {
    filmId,
    date,
    pace = "normal",
    width = DEFAULT_LEVEL_WIDTH,
    height = DEFAULT_LEVEL_HEIGHT,
    samples,
    quality = 88,
    concurrency = MAX_CONCURRENCY,
    trim = DEFAULT_STORY_TRIM,
    replace = {},
    allow = {},
    dryRun = false,
    out,
    verdicts,
    log = (m) => console.log(m),
    warn = (m) => console.warn(m),
  } = options;
  if (out && !dryRun) throw new Error("--out is for --dry-run reviews; drop it to store the puzzle");
  if (!date && !dryRun) throw new Error("A day is needed to store the puzzle");
  const started = Date.now();

  const film = (await createGameServices(db).films.get([filmId])).get(filmId);
  if (!film) throw new Error(`Film ${filmId} isn't in the catalog`);
  log(`▸ ${film.title}${film.year ? ` (${film.year})` : ""}, catalog id ${film.id}`);
  if (date) {
    log(`  day: ${date}`);
    const status = await dayStatus(db, date, replace);
    if (!usable(status)) throw new Error(status);
  }

  // Selection rules that need no frames, checked before anything is downloaded.
  const allowed: Record<Clash["rule"], boolean> = { repeat: !!allow.repeat, director: !!allow.sameDirector, series: !!allow.sameSeries };
  for (const clash of clashes(film, date ?? today(), await loadDayAnswers(db))) {
    const message = describeClash(clash, film.title);
    if (!dryRun && !allowed[clash.rule]) throw new FilmRefusedError(clash.rule, `${message} (pass ${CLASH_FLAG[clash.rule]} to use the film anyway)`);
    warn(`  ⚠ ${message}`);
  }

  const galleryUrl = options.galleryUrl ?? (await resolveGallery(film, options.directory)).url;
  let gallery: Gallery;
  try {
    gallery = await openGallery(galleryUrl, { allowFewCaps: allow.fewCaps });
  } catch (error) {
    // A short gallery is a fact about the gallery; "only one page" may be the site's markup
    // changing, so that one is left for a human to look at.
    if (error instanceof GallerySizeError && error.kind !== "one-page") {
      verdicts?.set(canonicalGalleryUrl(galleryUrl), { verdict: "too-short", detail: error.message, film: { title: film.title, year: film.year } });
      throw new FilmRefusedError("too-short", error.message);
    }
    throw error;
  }
  log(`  frames: ${gallery.url} (${gallery.frameCount} caps), pace ${pace}, ${width}×${height}`);

  const source = new ScreencapsSource(gallery, concurrency);
  // Ctrl-C mid-run must not leave frames behind either.
  const interrupted = () => {
    source.close();
    console.error("\n✗ interrupted; frame cache deleted");
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  let rendered: RenderedFilm;
  try {
    rendered = await renderLevels(source, {
      width,
      height,
      pace: PACES[pace],
      samples,
      trim,
      log,
      // Black-and-white films make grey, dull levels: refused on the thumbnails, before the long part.
      checkLook: (look) => {
        const share = `${(look.chromaticShare * 100).toFixed(1)}% of its pixels carry colour`;
        verdicts?.set(gallery.url, { verdict: look.monochrome ? "black-and-white" : "colour", detail: share, film: { title: film.title, year: film.year } });
        if (!look.monochrome) return;
        const message = `${film.title} looks black and white (only ${share})`;
        if (!allow.monochrome) throw new FilmRefusedError("black-and-white", `${message}; black-and-white films are skipped (pass --allow-monochrome to use it anyway)`);
        warn(`  ⚠ ${message}`);
      },
    });
  } finally {
    source.close();
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
  log(`  downloaded ${(source.bytesDownloaded / 1048576).toFixed(1)} MB in ${source.requests} requests; frame cache deleted`);
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

  const puzzle: Puzzle = fadeToColor.puzzleSchema.parse({
    fixture: false,
    maxGuesses: MAX_GUESSES,
    first: levels[0],
    look: { saturation: Number(rendered.look.saturation.toFixed(4)), monochrome: rendered.look.monochrome },
  });
  const pickOptions = await finalPickOptions(db, film.id, date ?? today());
  const solution: Solution = fadeToColor.solutionSchema.parse({
    answer: toFilmDetails(film),
    levels,
    pace,
    credit: { source: CREDIT_SOURCE, url: gallery.url },
    options: pickOptions,
  });
  if (puzzle.first.id !== solution.levels[0]!.id) throw new Error("Level 1 must be the puzzle's first level");

  const atPercent = (n: number) => `${((n / gallery.frameCount) * 100).toFixed(1)}%`;
  rendered.levels.forEach((level, i) => {
    const kb = (encoded[i]!.bytes.length / 1024).toFixed(0);
    const span = level.frames.length > 0 ? `  strips from ${atPercent(level.frames[0]!)} to ${atPercent(level.frames.at(-1)!)}` : "";
    log(`  level ${String(level.level).padStart(2)}: ${String(level.strips).padStart(4)} ${level.level === 1 ? "frames" : "strips"}  ${kb.padStart(5)} KB  avg ${level.average}  dominant ${level.dominant}${span}`);
  });
  log(`  check the first and last strips for titles or credits; raise --head or --tail if any show`);
  log(`  final pick: ${pickOptions.map((o) => `${o.title}${o.year ? ` (${o.year})` : ""}${o.id === film.id ? " ✓" : ""}`).join(" · ")}`);

  const result = { date, film: { id: film.id, title: film.title, year: film.year }, galleryUrl: gallery.url };
  if (dryRun) {
    if (out) {
      const dir = path.resolve(out);
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
      log(`✓ dry run: levels written to ${dir}`);
    } else {
      log("✓ dry run: nothing written");
    }
    log(`  took ${((Date.now() - started) / 1000).toFixed(0)} s`);
    return { ...result, stored: false, replaced: null };
  }

  const day = date!;
  // Re-check: the day may have changed while the levels rendered.
  const status = await dayStatus(db, day, replace);
  if (!usable(status)) throw new Error(status);
  if (status === "fixture") await deleteFixturePuzzle(db, GAME_ID, day);
  if (status === "unplayed") await deleteUnplayedPuzzle(db, GAME_ID, day);
  const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date: day, puzzle, solution, assets });
  if (outcome === "exists") throw new Error(`${day} got a puzzle while the levels rendered; nothing written`);
  const replaced = { free: "", fixture: " (replaced a DEV FIXTURE)", unplayed: " (replaced an unplayed curated puzzle)" }[status];
  log(`✓ ${GAME_ID} ${day}: ${film.title}${replaced}`);
  log(`  took ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return { ...result, stored: true, replaced: status === "free" ? null : status };
}
