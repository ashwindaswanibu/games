import "server-only";
import type { ResolveResult } from "@/server/game-server";
import type { FilmRecord, GameServices, PersonRecord } from "@/server/game-services";
import type { FilmDetails, PersonRef } from "./schemas";

/**
 * Building blocks for Movies games' `resolveMove`. They only look things up; the pure `applyMove`
 * decides what a guess means.
 */

export const FILM_NOT_FOUND = "We couldn't find that film. Pick one from the list.";
export const PERSON_NOT_FOUND = "We couldn't find that person. Pick one from the list.";

/** Limits of `filmDetailsSchema` / `personRefSchema`, which every snapshot must pass. */
const MAX_TITLE = 300;
const MAX_NAME = 200;
const MAX_GENRE = 60;
const MAX_GENRES = 20;
const MAX_DIRECTORS = 10;

/** Trimmed, and cut to at most `max` UTF-16 units without splitting a character. */
function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  let out = "";
  for (const char of trimmed) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out.trimEnd();
}

/** Trimmed entries of 1..max characters, at most `count` of them; anything else is dropped. */
function cleanList(items: readonly string[], max: number, count: number): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item.length >= 1 && item.length <= max)
    .slice(0, count);
}

/**
 * Catalog record → the snapshot games store and compare. Always `filmDetailsSchema`-valid, even for
 * a row that slipped past the catalog's own checks, so one odd film can't fail every guess of it.
 */
export function toFilmDetails(record: FilmRecord): FilmDetails {
  return {
    id: record.id,
    title: clip(record.title, MAX_TITLE),
    year: record.year,
    genres: cleanList(record.genres, MAX_GENRE, MAX_GENRES),
    directors: cleanList(record.directors, MAX_NAME, MAX_DIRECTORS),
  };
}

export function toPersonRef(record: PersonRecord): PersonRef {
  return { id: record.id, name: clip(record.name, MAX_NAME) };
}

/** A guessed film id → its details, or a player-facing rejection if it isn't in the catalog. */
export async function resolveFilm(services: GameServices, filmId: number): Promise<ResolveResult<FilmDetails>> {
  const record = (await services.films.get([filmId])).get(filmId);
  return record ? { ok: true, move: toFilmDetails(record) } : { ok: false, error: FILM_NOT_FOUND };
}

/** A picked person id → their ref, or a player-facing rejection if they aren't in the catalog. */
export async function resolvePerson(services: GameServices, personId: number): Promise<ResolveResult<PersonRef>> {
  const record = (await services.people.get([personId])).get(personId);
  return record ? { ok: true, move: toPersonRef(record) } : { ok: false, error: PERSON_NOT_FOUND };
}
