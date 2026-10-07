/**
 * Loads the catalog films the final pick's look-alikes are drawn from (see
 * `src/games/fade-to-color/decoys.ts` for how they're chosen).
 */
import type { PuzzleDate } from "@/core/day";
import { createRng } from "@/core/random";
import type { FilmRef } from "@/games/_movies/schemas";
import { pickOptions, type DecoyCandidate } from "@/games/fade-to-color/decoys";

type PoolFilm = DecoyCandidate & { wikidata_id: string | null };
const COLUMNS = "id, title, year, genres, directors, popularity, wikidata_id";
/** How many times a look-alike of the wrong kind is swapped out before giving up. */
const KIND_ATTEMPTS = 6;
import { contentSeed, selectAllPages, type ContentDb } from "./pipeline.mjs";
import { knownAnimated } from "./wikidata-kind.mjs";

/** Films below this many Wikipedia editions are too obscure to be anyone's guess. */
const MIN_POPULARITY = 25;

/** Known films (a year and some fame) that could pass for `answer`, the answer itself included. */
export async function decoyPool(db: ContentDb): Promise<PoolFilm[]> {
  return selectAllPages((from, to) =>
    db
      .from("movie_films")
      .select(COLUMNS)
      .not("year", "is", null)
      .gte("popularity", MIN_POPULARITY)
      .order("id")
      .range(from, to),
  );
}

/**
 * The four for `answerId` on `date`: the answer and three look-alikes, shuffled. Seeded with the
 * server's secret and the day (like every other content choice), so a dry run shows the same four
 * again but nobody can replay the shuffle from the public code to find the answer.
 *
 * The four are visible from reel 1 (the player may stop the film on any reel), so they must also
 * be the same kind of film: a look-alike Wikidata says is animated when the answer isn't (or the
 * other way round) is swapped out and the pick is made again, from the same seed.
 */
export async function finalPickOptions(db: ContentDb, answerId: number, date: PuzzleDate): Promise<FilmRef[]> {
  let pool = await decoyPool(db);
  const answer = pool.find((film) => film.id === answerId) ?? (await db.from("movie_films").select(COLUMNS).eq("id", answerId).single()).data;
  if (!answer) throw new Error(`Film ${answerId} isn't in the catalog`);
  for (let attempt = 0; attempt < KIND_ATTEMPTS; attempt++) {
    const options = pickOptions(answer, pool, createRng(contentSeed("fade-to-color:final-pick", date)));
    const films = options.map((o) => (o.id === answer.id ? answer : pool.find((f) => f.id === o.id)!));
    const animated = await knownAnimated(films.flatMap((f) => (f.wikidata_id ? [f.wikidata_id] : [])));
    const isAnimated = (f: PoolFilm) => f.wikidata_id !== null && animated.has(f.wikidata_id);
    const wrongKind = films.filter((f) => f.id !== answer.id && isAnimated(f) !== isAnimated(answer));
    if (wrongKind.length === 0) return options;
    const out = new Set(wrongKind.map((f) => f.id));
    pool = pool.filter((f) => !out.has(f.id));
  }
  throw new Error(`Couldn't find look-alikes of the same kind (animated or not) for ${answer.title}`);
}
