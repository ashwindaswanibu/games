/**
 * Loads the catalog films the final pick's look-alikes are drawn from (see
 * `src/games/fade-to-color/decoys.ts` for how they're chosen).
 */
import type { PuzzleDate } from "@/core/day";
import { createRng } from "@/core/random";
import type { FilmRef } from "@/games/_movies/schemas";
import { pickOptions, relatedFilms, type DecoyCandidate } from "@/games/fade-to-color/decoys";
import { contentSeed, selectAllPages, type ContentDb } from "./pipeline.mjs";
import { filmKinds } from "./wikidata-kind.mjs";

type PoolFilm = DecoyCandidate & { wikidataId: string | null };
const COLUMNS = "id, title, year, genres, directors, popularity, series_qids, wikidata_id";
interface PoolRow {
  id: number;
  title: string;
  year: number | null;
  genres: string[];
  directors: string[];
  popularity: number;
  series_qids: string[];
  wikidata_id: string | null;
}
const toPoolFilm = ({ series_qids, wikidata_id, ...film }: PoolRow): PoolFilm => ({ ...film, series: series_qids, wikidataId: wikidata_id });

/** How many times a look-alike of the wrong kind is swapped out before giving up. */
const KIND_ATTEMPTS = 30;
/** Films below this many Wikipedia editions are too obscure to be anyone's guess. */
const MIN_POPULARITY = 25;

/** Known films (a year and some fame, not adult) that could pass for `answer`, the answer itself included. */
export async function decoyPool(db: ContentDb): Promise<PoolFilm[]> {
  const rows = await selectAllPages<PoolRow>((from, to) =>
    db
      .from("movie_films")
      .select(COLUMNS)
      .not("year", "is", null)
      .gte("popularity", MIN_POPULARITY)
      .eq("is_adult", false)
      .order("id")
      .range(from, to),
  );
  return rows.map(toPoolFilm);
}

/**
 * The four for `answerId` on `date`: the answer and three look-alikes, shuffled. Seeded with the
 * server's secret and the day (like every other content choice), so a dry run shows the same four
 * again but nobody can replay the shuffle from the public code to find the answer.
 *
 * The four are visible from reel 1 (the player may stop the film on any reel), so they must also
 * be the same kind of film (animated, live-action/animated hybrid, or live action, per Wikidata): a
 * look-alike of another kind is swapped out and the pick is made again, from the same seed.
 */
export async function finalPickOptions(db: ContentDb, answerId: number, date: PuzzleDate): Promise<FilmRef[]> {
  let pool = await decoyPool(db);
  const answer = pool.find((film) => film.id === answerId) ?? (await loadFilm(db, answerId));
  for (let attempt = 0; attempt < KIND_ATTEMPTS; attempt++) {
    const options = pickOptions(answer, pool, createRng(contentSeed("fade-to-color:final-pick", date)));
    const films = options.map((o) => (o.id === answer.id ? answer : pool.find((f) => f.id === o.id)!));
    const kinds = await filmKinds(films.flatMap((f) => (f.wikidataId ? [f.wikidataId] : [])));
    const kindOf = (f: PoolFilm) => (f.wikidataId ? (kinds.get(f.wikidataId) ?? "live") : "live");
    const wrongKind = films.filter((f) => f.id !== answer.id && kindOf(f) !== kindOf(answer));
    if (wrongKind.length === 0) return options;
    const out = new Set(wrongKind.map((f) => f.id));
    pool = pool.filter((f) => !out.has(f.id));
  }
  throw new Error(`Couldn't find look-alikes of the same kind (animated, hybrid or live action) for ${answer.title}`);
}

async function loadFilm(db: ContentDb, id: number): Promise<PoolFilm> {
  const { data, error } = await db.from("movie_films").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Couldn't read film ${id}: ${error.message}`);
  if (!data) throw new Error(`Film ${id} isn't in the catalog`);
  return toPoolFilm(data);
}

/** A film of a stored four, as `fourProblems` judges it. */
export type FourFilm = DecoyCandidate & { isAdult: boolean };

/**
 * Why a stored four breaks today's rules (empty when it doesn't): a film hidden as adult, a
 * look-alike of another kind than the answer (`kindOf`: animated, hybrid or live, per Wikidata),
 * or two films that can't share the four (`relatedFilms`: one series, Wikidata's or by title, or
 * one director). Pure; `recheck-fours.mts` re-picks the days it finds.
 */
export function fourProblems(films: readonly FourFilm[], answerId: number, kindOf: (film: FourFilm) => string): string[] {
  const answer = films.find((f) => f.id === answerId);
  if (!answer) return ["the answer isn't among the four"];
  const problems: string[] = [];
  for (const film of films) if (film.isAdult) problems.push(`${film.title} is hidden as adult`);
  for (const film of films) if (film.id !== answer.id && kindOf(film) !== kindOf(answer)) problems.push(`${film.title} is ${kindOf(film)}, the answer ${kindOf(answer)}`);
  for (let i = 0; i < films.length; i++) {
    for (let j = i + 1; j < films.length; j++) {
      if (relatedFilms(films[i]!, films[j]!)) problems.push(`${films[i]!.title} and ${films[j]!.title} are one series or by one director`);
    }
  }
  return problems;
}
