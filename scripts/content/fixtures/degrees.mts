/**
 * DEV FIXTURE puzzles for Degrees of Separation: `npm run content:fixtures -- --game degrees`.
 *
 * Picks a well-known start actor and a well-known end actor whose shortest chain over the local
 * catalog's credits is 2–3 links, and stores that chain as the solution (par = its length). Uses the
 * real catalog when it has credits; otherwise it first upserts the small embedded set of real films
 * in `./_degrees-seed.mts`, so the game is playable before the Wikidata import has run.
 *
 * Par must be the true shortest chain over everything a player could pick, so the search runs over
 * the whole credits table, loaded once per run.
 */
import { DEGREES_MAX_PAR, DEGREES_MIN_PAR, isConsistentSolution, type DegreesLink, type DegreesPuzzle } from "@/games/degrees/schema";
import { degrees } from "@/games/degrees/logic";
import { buildCoStarGraph, chainTo, searchFrom, type CoStarGraph } from "@/games/degrees/path";
import type { ContentDb } from "../lib/db.mjs";
import { defineFixtureGenerator, type FixtureContext } from "../lib/fixtures.mjs";
import { SEED_FILMS, SEED_PEOPLE } from "./_degrees-seed.mjs";

/** Start actors come from the best-known people with enough films to explore. */
const START_POOL = 25;
const MIN_START_FILMS = 3;
/** End actors come from a wider pool of well-known people. */
const END_POOL = 80;
const ATTEMPTS = 40;
const PAGE = 1000;

interface Catalog {
  graph: CoStarGraph;
  /** People with credits, best known first. */
  people: { id: number; popularity: number }[];
}

let loading: Promise<Catalog> | undefined;

export default defineFixtureGenerator({
  game: degrees,
  async generate(ctx) {
    loading ??= loadCatalog(ctx.db);
    const catalog = await loading;
    const { puzzle, solution } = await pickPuzzle(ctx, catalog);
    if (!isConsistentSolution(puzzle, solution)) throw new Error("Generated an inconsistent solution (a bug in the generator)");
    return { puzzle, solution };
  },
});

async function pickPuzzle(ctx: FixtureContext, { graph, people }: Catalog) {
  const filmCount = (id: number) => graph.filmsOf.get(id)?.length ?? 0;
  // The best-known people who have films to explore; in a small catalog, whoever has the most films.
  const explorable = people.filter((p) => filmCount(p.id) >= MIN_START_FILMS);
  const famous = explorable.filter((p) => people.indexOf(p) < START_POOL);
  const starts = famous.length >= 3 ? famous : explorable.slice(0, START_POOL);
  const ends = people.slice(0, END_POOL);
  if (starts.length < 2) throw new Error("The catalog has too few actors with several films to build a Degrees puzzle.");

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const start = ctx.rng.pick(starts).id;
    const search = searchFrom(graph, start, DEGREES_MAX_PAR);
    const byPar = new Map<number, number[]>();
    for (const { id } of ends) {
      const distance = search.distance.get(id);
      if (distance !== undefined && distance >= DEGREES_MIN_PAR && distance <= DEGREES_MAX_PAR) {
        byPar.set(distance, [...(byPar.get(distance) ?? []), id]);
      }
    }
    if (byPar.size === 0) continue;
    const par = ctx.rng.pick([...byPar.keys()].sort());
    const end = ctx.rng.pick(byPar.get(par)!);
    const chain = chainTo(search, end)!;

    const [films, persons] = await Promise.all([
      ctx.services.films.get(chain.map((link) => link.filmId)),
      ctx.services.people.get([start, ...chain.map((link) => link.personId)]),
    ]);
    const personRef = (id: number) => {
      const person = persons.get(id);
      if (!person) throw new Error(`Person ${id} vanished from the catalog mid-run`);
      return { id, name: person.name };
    };
    const path: DegreesLink[] = chain.map((link) => {
      const film = films.get(link.filmId);
      if (!film) throw new Error(`Film ${link.filmId} vanished from the catalog mid-run`);
      return { film: { id: film.id, title: film.title, year: film.year }, person: personRef(link.personId) };
    });
    const puzzle: DegreesPuzzle = { start: personRef(start), end: personRef(end), par, fixture: true };
    return { puzzle, solution: { path } };
  }
  throw new Error(`No pair of well-known actors ${DEGREES_MIN_PAR}–${DEGREES_MAX_PAR} links apart after ${ATTEMPTS} tries.`);
}

async function loadCatalog(db: ContentDb): Promise<Catalog> {
  const { count, error } = await db.from("movie_credits").select("film_id", { count: "exact", head: true });
  if (error) throw new Error(`Couldn't read the catalog: ${error.message}`);
  if (!count) await seedCatalog(db);

  const credits = await loadPages("credits", (from, to) =>
    db.from("movie_credits").select("film_id, person_id").order("film_id").order("person_id").range(from, to),
  );
  const films = await loadPages("films", (from, to) => db.from("movie_films").select("id, popularity").order("id").range(from, to));
  const filmPopularity = new Map(films.map((f) => [f.id, f.popularity]));
  const credited = new Set(credits.map((c) => c.person_id));
  const people = (await loadPages("people", (from, to) => db.from("movie_people").select("id, popularity").order("id").range(from, to)))
    .filter((p) => credited.has(p.id))
    .sort((a, b) => b.popularity - a.popularity || a.id - b.id);
  const personPopularity = new Map(people.map((p) => [p.id, p.popularity]));

  const graph = buildCoStarGraph(
    credits.map((c) => ({ filmId: c.film_id, personId: c.person_id })),
    { film: (id) => filmPopularity.get(id) ?? 0, person: (id) => personPopularity.get(id) ?? 0 },
  );
  console.log(`  degrees: searching ${credits.length} credits across ${films.length} films and ${people.length} credited people`);
  return { graph, people };
}

/** Every row of a query, a page at a time (PostgREST caps each response at max_rows). */
async function loadPages<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error || !data) throw new Error(`Couldn't load catalog ${what}: ${error?.message ?? "no data"}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** Upserts the embedded starter catalog, keyed on Wikidata ids so a later import merges with it. */
async function seedCatalog(db: ContentDb) {
  const people = SEED_PEOPLE.map((p) => ({ wikidata_id: p.wikidataId, name: p.name, popularity: p.sitelinks }));
  const { data: personRows, error: personError } = await db
    .from("movie_people")
    .upsert(people, { onConflict: "wikidata_id" })
    .select("id, wikidata_id");
  if (personError) throw new Error(`Couldn't seed people: ${personError.message}`);

  const films = SEED_FILMS.map((f) => ({
    wikidata_id: f.wikidataId,
    title: f.title,
    year: f.year,
    imdb_id: f.imdbId,
    popularity: f.sitelinks,
    genres: [...f.genres],
    directors: [...f.directors],
  }));
  const { data: filmRows, error: filmError } = await db.from("movie_films").upsert(films, { onConflict: "wikidata_id" }).select("id, wikidata_id");
  if (filmError) throw new Error(`Couldn't seed films: ${filmError.message}`);

  const personId = new Map(personRows.map((r) => [r.wikidata_id, r.id]));
  const filmId = new Map(filmRows.map((r) => [r.wikidata_id, r.id]));
  const credits = SEED_FILMS.flatMap((f) =>
    f.cast.map((qid) => {
      const film = filmId.get(f.wikidataId);
      const person = personId.get(qid);
      if (film === undefined || person === undefined) throw new Error(`Seed data refers to ${film === undefined ? f.wikidataId : qid}, which wasn't saved`);
      return { film_id: film, person_id: person, billing: null };
    }),
  );
  const { error: creditError } = await db.from("movie_credits").upsert(credits, { onConflict: "film_id,person_id", ignoreDuplicates: true });
  if (creditError) throw new Error(`Couldn't seed credits: ${creditError.message}`);
  console.log(`  degrees: the catalog was empty, so seeded ${films.length} films, ${people.length} people and ${credits.length} credits from Wikidata ids`);
}
