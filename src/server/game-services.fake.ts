import type { CreditRecord, FilmRecord, GameServices, PersonRecord } from "./game-services";

/**
 * In-memory `GameServices` for unit tests of resolvers and the move pipeline. Same contract as the
 * real one: unknown ids are absent, never errors.
 *
 *   const services = createFakeGameServices({
 *     films: [film({ id: 1, title: "Heat", year: 1995 })],
 *     people: [{ id: 10, name: "Al Pacino" }],
 *     credits: [{ filmId: 1, personId: 10, billing: 0 }],
 *   });
 */
export function createFakeGameServices(data: {
  films?: readonly FilmRecord[];
  people?: readonly (Pick<PersonRecord, "id" | "name"> & Partial<PersonRecord>)[];
  credits?: readonly (Pick<CreditRecord, "filmId" | "personId"> & Partial<CreditRecord>)[];
}): GameServices & { calls: string[] } {
  const films = new Map((data.films ?? []).map((f) => [f.id, f]));
  const people = new Map(
    (data.people ?? []).map((p): [number, PersonRecord] => [p.id, { popularity: 0, wikidataId: null, ...p }]),
  );
  const credits: CreditRecord[] = (data.credits ?? []).map((c) => ({ billing: null, ...c }));
  const calls: string[] = [];

  const pick = <T>(source: Map<number, T>, ids: readonly number[]) =>
    new Map(ids.flatMap((id) => (source.has(id) ? [[id, source.get(id)!] as const] : [])));
  const byBilling = (a: CreditRecord, b: CreditRecord) =>
    (a.billing ?? Number.MAX_SAFE_INTEGER) - (b.billing ?? Number.MAX_SAFE_INTEGER) || a.personId - b.personId;

  return {
    calls,
    films: {
      async get(ids) {
        calls.push(`films.get(${ids.join(",")})`);
        return pick(films, ids);
      },
    },
    people: {
      async get(ids) {
        calls.push(`people.get(${ids.join(",")})`);
        return pick(people, ids);
      },
    },
    credits: {
      async filmsOf(personId) {
        calls.push(`credits.filmsOf(${personId})`);
        return credits.filter((c) => c.personId === personId).sort((a, b) => a.filmId - b.filmId);
      },
      async castOf(filmId) {
        calls.push(`credits.castOf(${filmId})`);
        return credits.filter((c) => c.filmId === filmId).sort(byBilling);
      },
      async together(personId, filmId) {
        calls.push(`credits.together(${personId},${filmId})`);
        return credits.find((c) => c.personId === personId && c.filmId === filmId) ?? null;
      },
    },
  };
}

/** A complete `FilmRecord` with sensible defaults for tests. */
export function film(partial: Pick<FilmRecord, "id" | "title"> & Partial<FilmRecord>): FilmRecord {
  return {
    year: null,
    genres: [],
    directors: [],
    popularity: 0,
    tmdbId: null,
    imdbId: null,
    wikidataId: null,
    isAdult: false,
    ...partial,
  };
}
