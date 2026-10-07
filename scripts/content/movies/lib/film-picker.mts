/**
 * The inputs of the Fade to Color film picker (`src/games/fade-to-color/picker.ts`, pure), loaded
 * at run time: the catalog from the database, the films that have frames from the
 * movie-screencaps.com directory, what rendering has learnt about galleries (`screencaps-cache.mts`)
 * and every stored puzzle's answer.
 *
 * - **Pool:** catalog films that have a movie-screencaps.com gallery (`matchGalleries`).
 * - **Scores:** percentiles over the pool by default (`--percentiles pool`): that is what the
 *   approved numbers in `design/barcode-film-selection.md` were computed over (Barbie and Avatar:
 *   The Way of Water 90, The Batman 85; ~130 Iconic films). `catalog` computes them over every
 *   catalog film with a year instead, which puts most films with frames in the top tier and drifts
 *   as the catalog grows. Scores depend only on the catalog and the directory, never on verdicts or
 *   stored puzzles.
 * - **Candidates:** pool films scoring at least `MIN_SCORE`, minus galleries too short to be a whole
 *   film; a gallery found to be black and white is marked so the picker skips it.
 * - **Answers:** every stored Fade to Color puzzle's answer, DEV FIXTURES included (the renderer
 *   counts them too), with its Wikidata series read from the catalog. "Used" is always read from
 *   the stored puzzles; the launch reset of the testing period will need a launch-date cutoff in
 *   `loadDayAnswers` (played puzzles are never deleted), not any state kept here.
 * - **Adult films** (`is_adult`) are never in the catalog the picker sees.
 *
 * For a pre-rendered library, the candidates would be the rendered films (with their measured
 * colour) instead of the directory's; `pickFilm`/`planDays` take candidates from either.
 */
import type { PuzzleDate } from "@/core/day";
import type { RngSeed } from "@/core/random";
import { fadeToColor } from "@/games/fade-to-color/logic";
import { MIN_SCORE, scoreFilms, type DayAnswer, type FilmScore, type PickCandidate } from "@/games/fade-to-color/picker";
import { z } from "zod";
import { chunk } from "./http.mjs";
import { contentSeed, selectAllPages, type ContentDb } from "./pipeline.mjs";
import { GalleryVerdicts, loadDirectory, type GalleryVerdict } from "./screencaps-cache.mjs";
import { DEFAULT_CACHE_DIR } from "./screencaps-cache.mjs";
import { matchGalleries, type DirectoryEntry } from "./screencaps.mjs";
import { knownBlackAndWhite } from "./wikidata-colour.mjs";

const GAME_ID = fadeToColor.id;

export const PERCENTILE_REFERENCES = ["pool", "catalog"] as const;
export type PercentileReference = (typeof PERCENTILE_REFERENCES)[number];
export const DEFAULT_PERCENTILE_REFERENCE: PercentileReference = "pool";

export interface CatalogFilm {
  id: number;
  title: string;
  year: number | null;
  directors: string[];
  popularity: number;
  /** Wikidata ids of the film series it is part of. */
  series_qids: string[];
  /** Its Wikidata id, used to ask whether it's black and white before any frames are fetched. */
  wikidata_id?: string | null;
}

/** The day's pick seed: the server's secret, the game and the date (its own domain, apart from the final pick's). */
export function pickSeed(date: PuzzleDate): RngSeed {
  return contentSeed(`${GAME_ID}:film`, date);
}

/** Every catalog film with a year (a film without one can't be scored by era), adult films left out. */
export async function loadCatalogFilms(db: ContentDb): Promise<CatalogFilm[]> {
  return selectAllPages((from, to) =>
    db
      .from("movie_films")
      .select("id, title, year, directors, popularity, series_qids, wikidata_id")
      .not("year", "is", null)
      .eq("is_adult", false)
      .order("id")
      .range(from, to),
  );
}

const storedAnswerSchema = z.object({ answer: z.object({ id: z.number(), title: z.string(), directors: z.array(z.string()) }) });

/**
 * The answer of every stored Fade to Color puzzle, any date (puzzles without a readable answer are
 * skipped), with the answer film's Wikidata series as the catalog has it now.
 */
export async function loadDayAnswers(db: ContentDb): Promise<DayAnswer[]> {
  const rows = await selectAllPages((from, to) => db.from("puzzles").select("puzzle_date, solution").eq("game_id", GAME_ID).order("puzzle_date").range(from, to));
  const answers = rows.flatMap((row) => {
    const answer = storedAnswerSchema.safeParse(row.solution).data?.answer;
    return answer ? [{ date: row.puzzle_date as PuzzleDate, filmId: answer.id, title: answer.title, directors: answer.directors }] : [];
  });
  const series = await seriesOf(db, answers.map((a) => a.filmId));
  return answers.map((answer) => ({ ...answer, series: series.get(answer.filmId) ?? [] }));
}

/** The Wikidata series of each of `filmIds` that is in the catalog. */
export async function seriesOf(db: ContentDb, filmIds: readonly number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  for (const part of chunk([...new Set(filmIds)], 200)) {
    const { data, error } = await db.from("movie_films").select("id, series_qids").in("id", part);
    if (error) throw new Error(`Couldn't read the answers' series: ${error.message}`);
    for (const row of data) out.set(row.id, row.series_qids);
  }
  return out;
}

export interface PoolFilm {
  film: CatalogFilm;
  gallery: DirectoryEntry;
  score: FilmScore;
  verdict: GalleryVerdict | undefined;
}

export interface PickerInputs {
  candidates: PickCandidate[];
  /** Every film with a gallery, whatever its score, by catalog id. */
  pool: Map<number, PoolFilm>;
  reference: PercentileReference;
  /** Films the percentiles were computed over. */
  referenceSize: number;
  /** Pool films left out of the candidates because their gallery is too short. */
  tooShort: number;
  /** Pool films Wikidata says are black and white (skipped, unless rendering measured them as colour). */
  knownGrey: number;
}

/**
 * Assembles the picker's inputs from loaded data (pure, so it is unit-tested). `verdictFor` gives
 * what rendering found about a gallery, if anything; `greyIds` are catalog films Wikidata says are
 * black and white. A rendering verdict wins over Wikidata (it measured the frames).
 */
export function buildPickerInputs(
  films: readonly CatalogFilm[],
  entries: readonly DirectoryEntry[],
  verdictFor: (galleryUrl: string) => GalleryVerdict | undefined,
  reference: PercentileReference = DEFAULT_PERCENTILE_REFERENCE,
  greyIds: ReadonlySet<number> = new Set(),
): PickerInputs {
  const matched = matchGalleries(entries, films);
  const referenceFilms = reference === "pool" ? [...matched.values()].map((m) => m.film) : films.filter((f) => f.year !== null);
  const scores = scoreFilms(referenceFilms);
  const pool = new Map<number, PoolFilm>();
  for (const [id, { film, gallery }] of matched) {
    const score = scores.get(id);
    if (score) pool.set(id, { film, gallery, score, verdict: verdictFor(gallery.url) });
  }
  const candidates: PickCandidate[] = [];
  let tooShort = 0;
  let knownGrey = 0;
  for (const { film, score, verdict } of pool.values()) {
    if (score.score < MIN_SCORE) continue;
    if (verdict?.verdict === "too-short") {
      tooShort++;
      continue;
    }
    const monochrome = verdict !== undefined ? verdict.verdict === "black-and-white" : greyIds.has(film.id) ? true : null;
    if (verdict === undefined && greyIds.has(film.id)) knownGrey++;
    candidates.push({ id: film.id, title: film.title, year: film.year, directors: film.directors, series: film.series_qids, score: score.score, monochrome });
  }
  return { candidates, pool, reference, referenceSize: scores.size, tooShort, knownGrey };
}

export interface LoadedPickerInputs extends PickerInputs {
  answers: DayAnswer[];
  verdicts: GalleryVerdicts;
  catalogSize: number;
  directory: { entries: number; fetchedAt: Date; fromCache: boolean };
}

/** Loads everything the picker needs, now: the database as it is at run time, the directory (cached), the verdicts. */
export async function loadPickerInputs(
  db: ContentDb,
  { cacheDir, refreshDirectory = false, reference = DEFAULT_PERCENTILE_REFERENCE }: { cacheDir?: string; refreshDirectory?: boolean; reference?: PercentileReference } = {},
): Promise<LoadedPickerInputs> {
  const [films, answers, directory] = await Promise.all([loadCatalogFilms(db), loadDayAnswers(db), loadDirectory({ cacheDir, refresh: refreshDirectory })]);
  const verdicts = new GalleryVerdicts(cacheDir);
  // Ask Wikidata which films with a gallery are black and white, so they're skipped before any download.
  const withGallery = [...matchGalleries(directory.entries, films).values()].map((m) => m.film);
  const greyQids = await knownBlackAndWhite(withGallery.flatMap((f) => (f.wikidata_id ? [f.wikidata_id] : [])), { cacheDir: cacheDir ?? DEFAULT_CACHE_DIR });
  const greyIds = new Set(withGallery.filter((f) => f.wikidata_id && greyQids.has(f.wikidata_id)).map((f) => f.id));
  const inputs = buildPickerInputs(films, directory.entries, (url) => verdicts.get(url), reference, greyIds);
  return {
    ...inputs,
    answers,
    verdicts,
    catalogSize: films.length,
    directory: { entries: directory.entries.length, fetchedAt: directory.fetchedAt, fromCache: directory.fromCache },
  };
}
