import type { Rng } from "@/core/random";

/**
 * The actor–film graph behind Degrees of Separation, and the daily puzzle picker. Pure (the caller
 * loads the catalog and supplies a seeded rng), so every rule here is unit-tested.
 *
 * The graph is bipartite: people on one side, films on the other, an edge per cast credit. A *link*
 * is person → film → co-star, so the distance between two people in links is half their distance
 * in the bipartite graph. The game accepts any catalog credit as a link, so par is computed over
 * **all** credits: a player can never beat par by finding a credit the generator ignored.
 */

export interface Credit {
  filmId: number;
  personId: number;
  /** Cast-list position, 0 = top billed; null when unknown. */
  billing: number | null;
}

export interface FilmInfo {
  id: number;
  title: string;
  year: number | null;
  popularity: number;
  /**
   * A documentary or a concert film (see `isNonFictionFilm`): its cast appear as themselves, so a
   * credit there doesn't show that someone acts. Still a link like any other credit.
   */
  nonFiction: boolean;
}

export interface PersonInfo {
  id: number;
  name: string;
  popularity: number;
  /** IMDb or Wikidata says they act (`movie_people.is_actor`). Only actors start or end a puzzle. */
  isActor: boolean;
  /**
   * Wikidata says they're a human (`movie_people.is_human`); false for a group (the Marx Brothers)
   * or an animal, null without a Wikidata item. Only people who aren't false start or end a puzzle.
   */
  isHuman: boolean | null;
}

/**
 * Whether a film's genres (catalog display names, `movie_films.genres`) make it a documentary or a
 * concert film: "Documentary", any "… documentary" ("Music documentary", "Nature documentary") or
 * "Documentary …" ("Documentary television"), or "Concert". Fiction that borrows the form
 * (Mockumentary, Pseudo-documentary, Docudrama, Docufiction) has actors and doesn't count. Pure.
 */
export function isNonFictionFilm(genres: readonly string[]): boolean {
  return genres.some((genre) => /^(?:.+ )?documentary(?: .+)?$/i.test(genre) || /^concert$/i.test(genre));
}

export interface CastGraph {
  /** personId → films they're credited in (ascending ids). */
  readonly filmsOf: ReadonlyMap<number, readonly number[]>;
  /** filmId → its cast (ascending ids). */
  readonly castOf: ReadonlyMap<number, readonly number[]>;
  billing(filmId: number, personId: number): number | null;
}

export function buildGraph(credits: Iterable<Credit>): CastGraph {
  const filmsOf = new Map<number, number[]>();
  const castOf = new Map<number, number[]>();
  const billing = new Map<string, number | null>();
  for (const { filmId, personId, billing: position } of credits) {
    const key = `${filmId}:${personId}`;
    if (billing.has(key)) continue;
    billing.set(key, position);
    (filmsOf.get(personId) ?? filmsOf.set(personId, []).get(personId)!).push(filmId);
    (castOf.get(filmId) ?? castOf.set(filmId, []).get(filmId)!).push(personId);
  }
  for (const list of filmsOf.values()) list.sort((a, b) => a - b);
  for (const list of castOf.values()) list.sort((a, b) => a - b);
  return { filmsOf, castOf, billing: (filmId, personId) => billing.get(`${filmId}:${personId}`) ?? null };
}

/** Breadth-first search from `from`: link distance to every person within `maxLinks`. */
export function linkDistances(graph: CastGraph, from: number, maxLinks: number): Map<number, number> {
  const distance = new Map<number, number>([[from, 0]]);
  const seenFilms = new Set<number>();
  let frontier = [from];
  for (let depth = 1; depth <= maxLinks && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const person of frontier) {
      for (const film of graph.filmsOf.get(person) ?? []) {
        if (seenFilms.has(film)) continue; // every co-star of this film is already at ≤ depth
        seenFilms.add(film);
        for (const costar of graph.castOf.get(film) ?? []) {
          if (!distance.has(costar)) {
            distance.set(costar, depth);
            next.push(costar);
          }
        }
      }
    }
    frontier = next;
  }
  return distance;
}

export interface PathLink {
  filmId: number;
  personId: number;
}

/** Scores one link (person → film → co-star); the stored solution is the shortest chain scoring highest. */
export type LinkScore = (from: number, filmId: number, to: number) => number;

/** Prefers famous films, famous intermediate co-stars, and credits near the top of the bill. */
export function popularityLinkScore(graph: CastGraph, films: ReadonlyMap<number, FilmInfo>, people: ReadonlyMap<number, PersonInfo>): LinkScore {
  const fame = (popularity: number | undefined) => Math.log1p(popularity ?? 0);
  const billingPenalty = (filmId: number, personId: number) => Math.min(graph.billing(filmId, personId) ?? 20, 20) * 0.12;
  return (from, filmId, to) =>
    fame(films.get(filmId)?.popularity) + 0.5 * fame(people.get(to)?.popularity) - billingPenalty(filmId, from) - billingPenalty(filmId, to);
}

/**
 * The best-scoring shortest chain from `start` to `end`, or null if they're more than `maxLinks`
 * apart (or the same person). Ties break on ids, so the result is deterministic.
 */
export function bestShortestPath(
  graph: CastGraph,
  start: number,
  end: number,
  maxLinks: number,
  linkScore: LinkScore,
): PathLink[] | null {
  if (start === end) return null;
  const fromStart = linkDistances(graph, start, maxLinks);
  const length = fromStart.get(end);
  if (length === undefined) return null;
  const toEnd = linkDistances(graph, end, length);

  // best[p] = best score of a shortest chain from p to `end`, and its first link. Walk the layers of
  // the shortest-path DAG backwards from `end`.
  const best = new Map<number, { score: number; next: PathLink | null }>([[end, { score: 0, next: null }]]);
  for (let depth = length - 1; depth >= 0; depth--) {
    const layer = depth === 0 ? [start] : [...fromStart].filter(([p, d]) => d === depth && toEnd.get(p) === length - depth).map(([p]) => p);
    for (const person of layer.sort((a, b) => a - b)) {
      let choice: { score: number; next: PathLink } | null = null;
      for (const filmId of graph.filmsOf.get(person) ?? []) {
        for (const costar of graph.castOf.get(filmId) ?? []) {
          if (costar === person || fromStart.get(costar) !== depth + 1) continue;
          const rest = best.get(costar);
          if (!rest) continue;
          const score = linkScore(person, filmId, costar) + rest.score;
          if (!choice || score > choice.score + 1e-9) choice = { score, next: { filmId, personId: costar } };
        }
      }
      if (choice) best.set(person, choice);
    }
  }

  const path: PathLink[] = [];
  for (let at = best.get(start); at?.next; at = best.get(at.next.personId)) path.push(at.next);
  return path.length === length ? path : null;
}

/**
 * People eligible as start or end: actors (IMDb or Wikidata says so: famous singers, politicians and
 * documentary subjects credited in films can be links, never endpoints) who are people (not a
 * group or an animal: `isHuman` isn't false), well known (top `size` by popularity) *and* genuinely
 * acting in this catalog, with at least `minFilms` credits of which `minLeads` are
 * top-`leadBilling` billed, counting only fiction: documentaries and concert films (`nonFiction`)
 * don't count, so a singer's concert films and tour documentaries don't make them an actor. The
 * film minimum also guarantees the player has real choices at every step.
 *
 * Interim rule (2026-10-07); the owner chooses the final one (TODO.md, "Degrees with the bigger
 * catalog").
 */
export function actorPool(
  graph: CastGraph,
  people: ReadonlyMap<number, PersonInfo>,
  films: ReadonlyMap<number, FilmInfo>,
  options: { size: number; minFilms: number; minLeads: number; leadBilling: number },
): number[] {
  const eligible: PersonInfo[] = [];
  for (const [personId, credited] of graph.filmsOf) {
    const person = people.get(personId);
    if (!person?.isActor || person.isHuman === false) continue;
    const acting = credited.filter((filmId) => films.get(filmId)?.nonFiction !== true);
    if (acting.length < options.minFilms) continue;
    const leads = acting.filter((filmId) => (graph.billing(filmId, personId) ?? Infinity) < options.leadBilling).length;
    if (leads >= options.minLeads) eligible.push(person);
  }
  return eligible
    .sort((a, b) => b.popularity - a.popularity || a.id - b.id)
    .slice(0, options.size)
    .map((p) => p.id)
    .sort((a, b) => a - b);
}

export interface PickedPuzzle {
  start: number;
  end: number;
  par: number;
  path: PathLink[];
}

/**
 * Picks one day's puzzle: a start and an end from `pool` whose shortest chain is `targetPar` links
 * (falling back to the other allowed pars), neither of them in `exclude` (recent and scheduled
 * puzzles). The rng drives every choice, so a seeded rng reproduces the day.
 */
export function pickPuzzle(params: {
  graph: CastGraph;
  pool: readonly number[];
  rng: Rng;
  pars: readonly number[];
  targetPar: number;
  exclude: ReadonlySet<number>;
  linkScore: LinkScore;
  maxStarts?: number;
}): PickedPuzzle | null {
  const { graph, rng, pars, targetPar, exclude, linkScore, maxStarts = 60 } = params;
  const pool = params.pool.filter((p) => !exclude.has(p));
  const poolSet = new Set(pool);
  const maxPar = Math.max(...pars);
  const order = [targetPar, ...pars.filter((p) => p !== targetPar)];
  const starts = rng.shuffle(pool).slice(0, maxStarts);
  for (const par of order) {
    for (const start of starts) {
      const distances = linkDistances(graph, start, maxPar);
      const ends = [...distances].filter(([p, d]) => d === par && p !== start && poolSet.has(p)).map(([p]) => p).sort((a, b) => a - b);
      if (ends.length === 0) continue;
      const end = rng.pick(ends);
      const path = bestShortestPath(graph, start, end, maxPar, linkScore);
      if (path && path.length === par) return { start, end, par, path };
    }
  }
  return null;
}

/** What `degrees --repar-unplayed` does with one stored day (see `reparDecision`). */
export type ReparDecision =
  | { action: "keep" }
  | { action: "repar"; par: number }
  | { action: "regenerate" }
  | { action: "skip"; reason: "played" | "fixture" | "broken" };

/**
 * A stored Degrees day against today's credit graph. `shortest` is the length of the shortest
 * chain between its start and end now (null if none within its par).
 *
 *  - played: never touched (someone's result already counts against this par).
 *  - DEV FIXTURE: left to the fixture tooling (`--replace-fixtures` replaces it with a real puzzle).
 *  - no chain within par: the stored solution's credits are gone; catalog-check reports it.
 *  - shortest = par: kept.
 *  - shorter, but still at least `minPar` links: same start and end, the shorter par and a new
 *    solution.
 *  - shorter than `minPar` (the pair are now co-stars): too easy to keep, so the day gets a new
 *    puzzle, generated by the same rules as any other day.
 *
 * Pure.
 */
export function reparDecision(day: { par: number; shortest: number | null; played: boolean; fixture: boolean }, minPar: number): ReparDecision {
  if (day.played) return { action: "skip", reason: "played" };
  if (day.fixture) return { action: "skip", reason: "fixture" };
  if (day.shortest === null || day.shortest > day.par) return { action: "skip", reason: "broken" };
  if (day.shortest === day.par) return { action: "keep" };
  return day.shortest >= minPar ? { action: "repar", par: day.shortest } : { action: "regenerate" };
}
