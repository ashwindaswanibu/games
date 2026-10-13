import "server-only";
import { rankByQuery } from "@/games/_movies/scoped-search";
import { SCOPED_LIST_MAX, type CastList, type FilmographyList, type FilmSearchHit, type PersonSearchHit } from "@/games/_movies/schemas";
import { searchFilms } from "./catalog";
import { portraitSrc } from "./portraits";
import { db } from "./supabase/admin";

/**
 * Autocomplete within one person's filmography or one film's cast, and each whole, for searching
 * in the browser. Callers authorize the request and validate params first. Unknown ids simply have
 * no credits, so they return no results.
 */

/**
 * One person's films matching `query`: the catalog's film search limited to their credits, so a
 * filmography finds a film by any name it is known by ("K3G") and ranks by fame, like the global
 * film search. A prolific actor has 150+ films, too many to match in memory by title alone.
 */
export async function searchFilmography(personId: number, query: string, limit: number): Promise<FilmSearchHit[]> {
  return searchFilms(query, limit, personId);
}

/**
 * One person's whole filmography as film-list rows (see `filmographyListSchema`), in one query:
 * the films they're credited in, each with every name it's known by (display title first). Adult
 * films are left out, as film search leaves them out.
 */
export async function filmographyList(personId: number): Promise<FilmographyList["films"]> {
  const { data, error } = await db()
    .from("movie_credits")
    .select("film:movie_films!inner(id, title, year, directors, fame, titles:movie_film_titles(title, kind))")
    .eq("person_id", personId)
    .eq("film.is_adult", false)
    .limit(SCOPED_LIST_MAX);
  if (error) throw new Error(`Failed to load filmography: ${error.message}`);
  return data
    .map(({ film }) => {
      const others = film.titles.filter((t) => t.kind !== "display").map((t) => t.title);
      const display = film.titles.find((t) => t.kind === "display")?.title ?? film.title;
      return [film.id, film.year, film.directors.slice(0, 2), film.fame, [display, ...others.sort()]] as FilmographyList["films"][number];
    })
    .sort((a, b) => a[0] - b[0]);
}

/**
 * One film's whole cast, top billed first, with each person's fame and face, in one query (the
 * credits, their people and the people's portraits).
 */
export async function castList(filmId: number): Promise<CastList["people"]> {
  const { data, error } = await db()
    .from("movie_credits")
    .select("billing, person:movie_people!inner(id, name, popularity, portrait:movie_person_portraits(version))")
    .eq("film_id", filmId)
    .limit(SCOPED_LIST_MAX);
  if (error) throw new Error(`Failed to load cast: ${error.message}`);
  return data
    .sort((a, b) => (a.billing ?? Number.MAX_SAFE_INTEGER) - (b.billing ?? Number.MAX_SAFE_INTEGER) || a.person.id - b.person.id)
    .map(({ person }) => ({ id: person.id, name: person.name, popularity: person.popularity, portrait: person.portrait ? portraitSrc(person.id, person.portrait.version) : null }));
}

/**
 * One film's cast matching `query`, matched in memory (see `src/games/_movies/scoped-search.ts`):
 * a cast is at most a few dozen people. Everyone here shares the film being searched, so namesakes
 * are unlikely and no one needs a "known for".
 */
export async function searchCast(filmId: number, query: string, limit: number): Promise<PersonSearchHit[]> {
  const hits = rankByQuery(await castList(filmId), query, { text: (person) => person.name, popularity: (person) => person.popularity, limit });
  return hits.map((person) => ({ id: person.id, name: person.name, knownFor: null, portrait: person.portrait }));
}
