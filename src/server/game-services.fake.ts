import { MAX_NEXT_LINK_DEPTH, type ChainStep, type CreditRecord, type FilmRecord, type GameServices, type PersonRecord } from "./game-services";

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
      async nextLink(from, to, { avoid, maxLinks }) {
        calls.push(`credits.nextLink(${from},${to})`);
        return nextLink(credits, films, from, to, new Set(avoid), Math.min(MAX_NEXT_LINK_DEPTH, maxLinks));
      },
    },
  };
}

/**
 * Breadth-first from `from`, as the real search would answer: the first link of a shortest chain
 * to `to`, skipping adult films and anyone in `avoid`. Ties go to the lowest ids.
 */
function nextLink(
  credits: readonly CreditRecord[],
  films: ReadonlyMap<number, FilmRecord>,
  from: number,
  to: number,
  avoid: ReadonlySet<number>,
  maxLinks: number,
): ChainStep | null {
  if (from === to) return null;
  const usable = credits.filter((c) => films.get(c.filmId)?.isAdult !== true);
  const coStars = (person: number) =>
    usable
      .filter((c) => c.personId === person)
      .flatMap((own) => usable.filter((c) => c.filmId === own.filmId && c.personId !== person).map((c) => ({ filmId: c.filmId, personId: c.personId })))
      .sort((a, b) => a.personId - b.personId || a.filmId - b.filmId);
  // Each reached person keeps the first link of the chain that reached them.
  let frontier = new Map<number, { filmId: number; personId: number }>([[from, { filmId: 0, personId: 0 }]]);
  const seen = new Set([from]);
  for (let depth = 1; depth <= maxLinks; depth++) {
    const next = new Map<number, { filmId: number; personId: number }>();
    for (const [person, first] of frontier) {
      for (const step of coStars(person)) {
        if (seen.has(step.personId) || (avoid.has(step.personId) && step.personId !== to)) continue;
        const head = depth === 1 ? step : first;
        if (step.personId === to) return { ...head, links: depth };
        seen.add(step.personId);
        next.set(step.personId, head);
      }
    }
    frontier = next;
  }
  return null;
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
