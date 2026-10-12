/**
 * The catalog as Degrees of Separation sees it, loaded from the database: the actor–film graph over
 * every credit (adult films left out: players can't find them in search, so no chain or par goes
 * through one), the films and the people, with how well players know each person
 * (`movie_person_fame`, see `fame.mts`). Shared by the puzzle generator (`degrees.mts`) and the
 * fame measurer, so both see the same actors.
 */
import { buildGraph, isNonFictionFilm, type CastGraph, type Credit, type FilmInfo, type PersonInfo } from "./degrees-graph.mjs";
import { selectAllPages, type ContentDb } from "./pipeline.mjs";

export interface DegreesCatalog {
  graph: CastGraph;
  films: Map<number, FilmInfo>;
  people: Map<number, PersonInfo>;
  creditCount: number;
}

export async function loadDegreesCatalog(db: ContentDb): Promise<DegreesCatalog> {
  const [creditRows, filmRows, personRows, fameRows] = await Promise.all([
    selectAllPages<{ film_id: number; person_id: number; billing: number | null }>((from, to) =>
      db.from("movie_credits").select("film_id, person_id, billing").order("film_id").order("person_id").range(from, to),
    ),
    selectAllPages<{ id: number; title: string; year: number | null; popularity: number; imdb_votes: number | null; genres: string[]; is_adult: boolean }>((from, to) =>
      db.from("movie_films").select("id, title, year, popularity, imdb_votes, genres, is_adult").order("id").range(from, to),
    ),
    selectAllPages<{ id: number; name: string; popularity: number; is_actor: boolean; is_human: boolean | null }>((from, to) =>
      db.from("movie_people").select("id, name, popularity, is_actor, is_human").order("id").range(from, to),
    ),
    selectAllPages<{ person_id: number; daily_views: number }>((from, to) => db.from("movie_person_fame").select("person_id, daily_views").order("person_id").range(from, to)),
  ]);
  const views = new Map(fameRows.map((row) => [row.person_id, row.daily_views]));
  if (creditRows.length === 0) throw new Error("The movie catalog has no credits. Run `npm run content:movies:catalog` first.");
  // Players can't find an adult film in search, so no chain (or par) goes through one.
  const hidden = new Set(filmRows.filter((f) => f.is_adult).map((f) => f.id));
  const credits: Credit[] = creditRows.filter((r) => !hidden.has(r.film_id)).map((r) => ({ filmId: r.film_id, personId: r.person_id, billing: r.billing }));
  const films = new Map<number, FilmInfo>(
    filmRows.map((f) => [f.id, { id: f.id, title: f.title, year: f.year, popularity: f.popularity, votes: f.imdb_votes ?? 0, nonFiction: isNonFictionFilm(f.genres) }]),
  );
  const people = new Map<number, PersonInfo>(
    personRows.map((p) => [p.id, { id: p.id, name: p.name, popularity: p.popularity, isActor: p.is_actor, isHuman: p.is_human, views: views.get(p.id) ?? null }]),
  );
  // is_human comes from the catalog import; a database that hasn't had one since it was added
  // can't tell groups from people yet (nobody is excluded then).
  if (personRows.every((p) => p.is_human === null)) {
    console.warn("  ! No person has movie_people.is_human set: groups (the Marx Brothers) can still start or end a puzzle. Run content:movies:catalog.");
  }
  return { graph: buildGraph(credits), films, people, creditCount: credits.length };
}

