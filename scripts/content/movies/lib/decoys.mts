/**
 * Loads the catalog films the final pick's look-alikes are drawn from (see
 * `src/games/fade-to-color/decoys.ts` for how they're chosen).
 */
import type { PuzzleDate } from "@/core/day";
import { createRng } from "@/core/random";
import type { FilmRef } from "@/games/_movies/schemas";
import { pickOptions, type DecoyCandidate } from "@/games/fade-to-color/decoys";
import { selectAllPages, type ContentDb } from "./pipeline.mjs";

/** Films below this many Wikipedia editions are too obscure to be anyone's guess. */
const MIN_POPULARITY = 25;

/** Known films (a year and some fame) that could pass for `answer`, the answer itself included. */
export async function decoyPool(db: ContentDb): Promise<DecoyCandidate[]> {
  return selectAllPages((from, to) =>
    db
      .from("movie_films")
      .select("id, title, year, genres, directors, popularity")
      .not("year", "is", null)
      .gte("popularity", MIN_POPULARITY)
      .order("id")
      .range(from, to),
  );
}

/**
 * The final pick for `answerId` on `date`: the answer and three look-alikes, shuffled. Seeded by
 * the film and the day, so re-running a dry run shows the same options.
 */
export async function finalPickOptions(db: ContentDb, answerId: number, date: PuzzleDate): Promise<FilmRef[]> {
  const pool = await decoyPool(db);
  const answer =
    pool.find((film) => film.id === answerId) ??
    (await db.from("movie_films").select("id, title, year, genres, directors, popularity").eq("id", answerId).single()).data;
  if (!answer) throw new Error(`Film ${answerId} isn't in the catalog`);
  const rng = createRng([answerId, Number(date.replaceAll("-", "")), 0x0f1c, 0xdec0]);
  return pickOptions(answer, pool, rng);
}
