import "server-only";
import { rankByQuery } from "@/games/_movies/scoped-search";
import type { FilmSearchHit, PersonSearchHit } from "@/games/_movies/schemas";
import { searchFilms } from "./catalog";
import { gameServices } from "./game-services";

/**
 * Autocomplete within one person's filmography or one film's cast. Callers authorize the request
 * and validate params first. Unknown ids simply have no credits, so they return no results.
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
 * One film's cast matching `query`, matched in memory (see `src/games/_movies/scoped-search.ts`):
 * a cast is at most a few dozen people.
 */
export async function searchCast(filmId: number, query: string, limit: number): Promise<PersonSearchHit[]> {
  const services = gameServices();
  const credits = await services.credits.castOf(filmId);
  const people = await services.people.get(credits.map((credit) => credit.personId));
  const hits = rankByQuery([...people.values()], query, { text: (person) => person.name, popularity: (person) => person.popularity, limit });
  // Everyone here shares the film being searched, so namesakes are unlikely; skip the per-person lookup.
  return hits.map((person) => ({ id: person.id, name: person.name, knownFor: null }));
}
