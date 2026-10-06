import "server-only";
import { rankByQuery } from "@/games/_movies/scoped-search";
import type { FilmSearchHit, PersonSearchHit } from "@/games/_movies/schemas";
import { gameServices } from "./game-services";

/**
 * Autocomplete within one person's filmography or one film's cast (see
 * `src/games/_movies/scoped-search.ts`). Callers authorize the request and validate params first.
 * Unknown ids simply have no credits, so they return no results.
 */

export async function searchFilmography(personId: number, query: string, limit: number): Promise<FilmSearchHit[]> {
  const services = gameServices();
  const credits = await services.credits.filmsOf(personId);
  const films = await services.films.get(credits.map((credit) => credit.filmId));
  const hits = rankByQuery([...films.values()], query, { text: (film) => film.title, popularity: (film) => film.popularity, limit });
  return hits.map((film) => ({ id: film.id, title: film.title, year: film.year, directors: film.directors.slice(0, 2) }));
}

export async function searchCast(filmId: number, query: string, limit: number): Promise<PersonSearchHit[]> {
  const services = gameServices();
  const credits = await services.credits.castOf(filmId);
  const people = await services.people.get(credits.map((credit) => credit.personId));
  const hits = rankByQuery([...people.values()], query, { text: (person) => person.name, popularity: (person) => person.popularity, limit });
  // Everyone here shares the film being searched, so namesakes are unlikely; skip the per-person lookup.
  return hits.map((person) => ({ id: person.id, name: person.name, knownFor: null }));
}
