/**
 * Shortest chains over the co-star graph, for whoever writes Degrees puzzles (the content pipeline
 * and the DEV FIXTURE generator). Pure: build the graph from credit rows, then search it.
 *
 * People are nodes; two people are adjacent when they share a film. A chain of `n` links is a path
 * of `n` person-to-person steps, each labelled with one shared film.
 */

export interface GraphCredit {
  filmId: number;
  personId: number;
}

export interface CoStarGraph {
  /** person → films they're credited in, most popular film first. */
  readonly filmsOf: ReadonlyMap<number, readonly number[]>;
  /** film → its cast, most popular person first. */
  readonly castOf: ReadonlyMap<number, readonly number[]>;
}

export interface GraphLink {
  filmId: number;
  personId: number;
}

/**
 * Builds the graph. `filmRank`/`personRank` (higher = better known) order the adjacency lists, so
 * searches prefer famous films and people when several chains are equally short; ties break on id,
 * keeping results deterministic.
 */
export function buildCoStarGraph(
  credits: Iterable<GraphCredit>,
  rank: { film?: (filmId: number) => number; person?: (personId: number) => number } = {},
): CoStarGraph {
  const filmsOf = new Map<number, number[]>();
  const castOf = new Map<number, number[]>();
  for (const { filmId, personId } of credits) {
    pushUnique(filmsOf, personId, filmId);
    pushUnique(castOf, filmId, personId);
  }
  const order = (score: (id: number) => number) => (a: number, b: number) => score(b) - score(a) || a - b;
  const filmOrder = order(rank.film ?? (() => 0));
  const personOrder = order(rank.person ?? (() => 0));
  for (const films of filmsOf.values()) films.sort(filmOrder);
  for (const cast of castOf.values()) cast.sort(personOrder);
  return { filmsOf, castOf };
}

function pushUnique(map: Map<number, number[]>, key: number, value: number) {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

/**
 * Breadth-first search from `start`, up to `maxDepth` links. Returns each reached person's distance
 * (in links) and the link that first reached them, which `chainTo` follows back.
 */
export function searchFrom(graph: CoStarGraph, start: number, maxDepth: number): ChainSearch {
  const distance = new Map<number, number>([[start, 0]]);
  const via = new Map<number, { from: number; filmId: number }>();
  const expanded = new Set<number>();
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const person of frontier) {
      for (const filmId of graph.filmsOf.get(person) ?? []) {
        // A film's whole cast is reached the first time the film is expanded; later visits add nothing.
        if (expanded.has(filmId)) continue;
        expanded.add(filmId);
        for (const coStar of graph.castOf.get(filmId) ?? []) {
          if (distance.has(coStar)) continue;
          distance.set(coStar, depth);
          via.set(coStar, { from: person, filmId });
          next.push(coStar);
        }
      }
    }
    frontier = next;
  }
  return { start, distance, via };
}

export interface ChainSearch {
  readonly start: number;
  readonly distance: ReadonlyMap<number, number>;
  readonly via: ReadonlyMap<number, { from: number; filmId: number }>;
}

/** The shortest chain from the search's start to `end`, or null if `end` wasn't reached. */
export function chainTo(search: ChainSearch, end: number): GraphLink[] | null {
  if (!search.distance.has(end)) return null;
  const links: GraphLink[] = [];
  let person = end;
  while (person !== search.start) {
    const step = search.via.get(person)!;
    links.push({ filmId: step.filmId, personId: person });
    person = step.from;
  }
  return links.reverse();
}

/** Convenience: the shortest chain between two people within `maxDepth` links, or null. */
export function shortestChain(graph: CoStarGraph, start: number, end: number, maxDepth: number): GraphLink[] | null {
  return chainTo(searchFrom(graph, start, maxDepth), end);
}
