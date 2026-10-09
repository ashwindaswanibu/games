import "server-only";
import type { FilmSearchHit, PersonSearchHit } from "@/games/_movies/schemas";
import { visibleGames } from "@/games/registry";
import type { ProfileRow } from "./database.types";
import { db } from "./supabase/admin";
import { portraitSrcs } from "./portraits";

/**
 * Movie catalog autocomplete. Ranking lives in the `search_films` / `search_people` SQL functions
 * (exact, prefix, substring, then typo-tolerant trigram matches; films by fame and people by
 * popularity within each tier). Films match by any name they are known by (`movie_film_titles`).
 * Callers authorize the request and validate `query`/`limit` first.
 */

/**
 * The catalog serves the Movies games only: a player may search it while they can open at least
 * one Movies game (admins only, while those games are in testing).
 */
export function canUseMoviesCatalog(profile: Pick<ProfileRow, "is_admin">): boolean {
  return visibleGames(profile.is_admin).some((game) => game.bucket === "movies");
}

/** Films matching `query`, best first; with `personId`, only films that person is credited in. */
export async function searchFilms(query: string, limit: number, personId?: number): Promise<FilmSearchHit[]> {
  const { data, error } = await db().rpc("search_films", { p_query: query, p_limit: limit, ...(personId === undefined ? {} : { p_person: personId }) });
  if (error) throw new Error(`Film search failed: ${error.message}`);
  return data.map((row) => ({ id: row.id, title: row.title, year: row.year, directors: row.directors.slice(0, 2), aka: row.aka }));
}

export async function searchPeople(query: string, limit: number): Promise<PersonSearchHit[]> {
  const { data, error } = await db().rpc("search_people", { p_query: query, p_limit: limit });
  if (error) throw new Error(`People search failed: ${error.message}`);
  const faces = await portraitSrcs(data.map((row) => row.id));
  return data.map((row) => ({ id: row.id, name: row.name, knownFor: row.known_for, portrait: faces.get(row.id) ?? null }));
}
