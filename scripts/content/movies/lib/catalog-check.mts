import { today as todayInGameTimezone } from "@/core/day";
import type { Json } from "@/server/database.types";
import { isFixturePayload } from "../../lib/fixtures.mjs";
import { buildGraph, linkDistances, reparDecision, type CastGraph, type Credit, type ReparDecision } from "./degrees-graph.mjs";
import { chunk } from "./http.mjs";
import { selectAllById, selectAllPages, type ContentDb } from "./pipeline.mjs";

/** Ids per `in (...)` filter, keeping request URLs short. */
const ID_CHUNK = 200;

/**
 * The catalog's id contract, checked: stored puzzles, solutions and plays reference films and
 * people by catalog id (as JSON, which no foreign key protects), so an import must never change or
 * drop an id. Run by the apply step after every import and on its own by
 * `npm run content:movies:catalog-check`.
 *
 *  1. Every film and person in the baseline (the ids taken just before an import) still exists,
 *     with the same non-empty Wikidata, IMDb and TMDB ids.
 *  2. Every catalog id any stored puzzle, solution or play references still exists.
 *  3. Every link of a stored Degrees solution is still a credit pair, so the chain replays.
 *
 * And one warning (not a failure: the import is right, the puzzles need catching up): unplayed
 * Degrees days from today on whose start and end now have a chain shorter than their par. More
 * credits make shorter chains; `degrees --repar-unplayed` fixes those days.
 */

export interface FilmIds {
  id: number;
  wikidataId: string | null;
  imdbId: string | null;
  tmdbId: number | null;
}

export interface PersonIds {
  id: number;
  wikidataId: string | null;
  imdbId: string | null;
}

export interface IdBaseline {
  takenAt: string;
  films: FilmIds[];
  people: PersonIds[];
}

/** Current ids of every film and person (keyset-paged reads). */
export async function readCatalogIds(db: ContentDb): Promise<IdBaseline> {
  const [films, people] = await Promise.all([
    selectAllById((after, limit) => db.from("movie_films").select("id, wikidata_id, imdb_id, tmdb_id").gt("id", after).order("id").limit(limit)),
    selectAllById((after, limit) => db.from("movie_people").select("id, wikidata_id, imdb_id").gt("id", after).order("id").limit(limit)),
  ]);
  return {
    takenAt: new Date().toISOString(),
    films: films.map((f) => ({ id: f.id, wikidataId: f.wikidata_id, imdbId: f.imdb_id, tmdbId: f.tmdb_id })),
    people: people.map((p) => ({ id: p.id, wikidataId: p.wikidata_id, imdbId: p.imdb_id })),
  };
}

/** Problems with `current` against `baseline`: a missing id, or a non-empty external id that changed. Pure. */
export function compareIdBaseline(baseline: IdBaseline, current: IdBaseline): string[] {
  const problems: string[] = [];
  const check = <T extends { id: number }>(label: string, before: readonly T[], after: readonly T[], fields: readonly (keyof T & string)[]) => {
    const now = new Map(after.map((row) => [row.id, row]));
    for (const row of before) {
      const later = now.get(row.id);
      if (!later) {
        problems.push(`${label} ${row.id} is gone`);
        continue;
      }
      for (const field of fields) {
        if (row[field] !== null && row[field] !== later[field]) problems.push(`${label} ${row.id}: ${field} changed from ${String(row[field])} to ${String(later[field])}`);
      }
    }
  };
  check("film", baseline.films, current.films, ["wikidataId", "imdbId", "tmdbId"]);
  check("person", baseline.people, current.people, ["wikidataId", "imdbId"]);
  return problems;
}

export interface CatalogRefs {
  films: Set<number>;
  people: Set<number>;
}

/**
 * Catalog ids referenced anywhere in a stored JSON value: every object with a numeric `id` and a
 * string `title` is a film ref (FilmRef, FilmDetails, guesses, decoys), and with a string `name` a
 * person ref (PersonRef). Schema-agnostic on purpose, so a game added later is covered too. Pure.
 */
export function collectCatalogRefs(value: unknown, into: CatalogRefs = { films: new Set(), people: new Set() }): CatalogRefs {
  if (Array.isArray(value)) {
    for (const item of value) collectCatalogRefs(item, into);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "number" && Number.isInteger(record.id)) {
      if (typeof record.title === "string") into.films.add(record.id);
      else if (typeof record.name === "string") into.people.add(record.id);
    }
    for (const child of Object.values(record)) collectCatalogRefs(child, into);
  }
  return into;
}

/** A Degrees chain's credit pairs: each link's film with the actor it leaves and the co-star it reaches. Pure. */
export function chainCreditPairs(startId: number, links: ReadonlyArray<{ film: { id: number }; person: { id: number } }>): [filmId: number, personId: number][] {
  const pairs: [number, number][] = [];
  let from = startId;
  for (const link of links) {
    pairs.push([link.film.id, from], [link.film.id, link.person.id]);
    from = link.person.id;
  }
  return pairs;
}

const pairKey = (filmId: number, personId: number) => `${filmId}:${personId}`;

/** A stored Degrees day, as far as par is concerned. */
export interface StoredDegreesDay {
  date: string;
  start: { id: number; name: string };
  end: { id: number; name: string };
  par: number;
  fixture: boolean;
  /** Someone has started it. */
  played: boolean;
}

export interface StoredReferences {
  refs: CatalogRefs;
  /** Every stored Degrees day whose payload parses. */
  degreesDays: StoredDegreesDay[];
  /** Credit pairs of stored Degrees solutions: they must stay credits. */
  solutionPairs: [number, number][];
  /** Credit pairs of Degrees chains players built. Never removed either (their history replays). */
  playPairs: [number, number][];
  /** Rows a game's own schemas couldn't read (informational; their refs are still collected). */
  unreadable: string[];
  puzzles: number;
  plays: number;
}

interface DegreesShapes {
  puzzle: { start: { id: number } };
  links: { film: { id: number }; person: { id: number } }[];
}

/** Reads every stored puzzle and play and collects what they reference. */
export async function loadStoredReferences(db: ContentDb): Promise<StoredReferences> {
  const { getGame } = await import("@/games/registry");
  const { degreesPuzzleSchema, degreesSolutionSchema } = await import("@/games/degrees/schema");
  const puzzles = await selectAllPages<{ game_id: string; puzzle_date: string; payload: Json; solution: Json }>((from, to) =>
    db.from("puzzles").select("game_id, puzzle_date, payload, solution").order("game_id").order("puzzle_date").range(from, to),
  );
  const plays = await selectAllPages<{ game_id: string; puzzle_date: string; user_id: string; state: Json }>((from, to) =>
    db.from("plays").select("game_id, puzzle_date, user_id, state").order("game_id").order("puzzle_date").order("user_id").range(from, to),
  );

  const refs: CatalogRefs = { films: new Set(), people: new Set() };
  const unreadable: string[] = [];
  const solutionPairs: [number, number][] = [];
  const playPairs: [number, number][] = [];
  const degreesStart = new Map<string, number>();
  const degreesDays: StoredDegreesDay[] = [];

  for (const row of puzzles) {
    collectCatalogRefs(row.payload, refs);
    collectCatalogRefs(row.solution, refs);
    const game = getGame(row.game_id);
    if (!game) {
      unreadable.push(`${row.game_id} ${row.puzzle_date}: no such game in this checkout`);
    } else if (!game.puzzleSchema.safeParse(row.payload).success || !game.solutionSchema.safeParse(row.solution).success) {
      unreadable.push(`${row.game_id} ${row.puzzle_date}: doesn't match the game's puzzle/solution schema`);
    }
    if (row.game_id === "degrees") {
      const puzzle = degreesPuzzleSchema.safeParse(row.payload);
      const solution = degreesSolutionSchema.safeParse(row.solution);
      if (puzzle.success) {
        degreesStart.set(row.puzzle_date, puzzle.data.start.id);
        const { start, end, par } = puzzle.data;
        degreesDays.push({ date: row.puzzle_date, start, end, par, fixture: isFixturePayload(row.payload), played: false });
      }
      if (puzzle.success && solution.success) solutionPairs.push(...chainCreditPairs(puzzle.data.start.id, solution.data.path));
    }
  }
  const playedDegrees = new Set(plays.filter((row) => row.game_id === "degrees").map((row) => row.puzzle_date));
  for (const day of degreesDays) day.played = playedDegrees.has(day.date);
  for (const row of plays) {
    collectCatalogRefs(row.state, refs);
    if (row.game_id !== "degrees") continue;
    const start = degreesStart.get(row.puzzle_date);
    const links = (row.state as unknown as Partial<DegreesShapes>)?.links;
    if (start !== undefined && Array.isArray(links)) {
      playPairs.push(...chainCreditPairs(start, links.filter((l) => typeof l?.film?.id === "number" && typeof l?.person?.id === "number")));
    }
  }
  return { refs, degreesDays, solutionPairs, playPairs, unreadable, puzzles: puzzles.length, plays: plays.length };
}

/** An unplayed Degrees day whose pair is now closer than its par. */
export interface StaleDegreesDay extends StoredDegreesDay {
  shortest: number;
  /** What `degrees --repar-unplayed` will do with it. */
  decision: ReparDecision;
}

/**
 * Unplayed days from `today` on whose start and end are now fewer than `par` links apart in
 * `graph`. `graph` needs every credit a chain of up to par − 1 links between them could use (see
 * `chainNeighbourhood`). Pure.
 */
export function staleDegreesDays(days: readonly StoredDegreesDay[], graph: CastGraph, today: string, minPar: number): StaleDegreesDay[] {
  return days.flatMap((day) => {
    if (day.played || day.date < today) return [];
    const shortest = linkDistances(graph, day.start.id, day.par - 1).get(day.end.id);
    if (shortest === undefined) return [];
    return [{ ...day, shortest, decision: reparDecision({ par: day.par, shortest, played: false, fixture: day.fixture }, minPar) }];
  });
}

/**
 * Every credit that a chain of at most `maxLinks` links between two of `people` can use, read from
 * the database without loading the whole graph. Each film of such a chain is at most
 * ⌊(maxLinks − 1) / 2⌋ co-star hops from one end, so: expand that many hops from `people`, then
 * take every film of everyone reached, with its whole cast. (For par 3, a shorter chain has at most
 * 2 links: the films of the start and the end, and their casts.)
 */
export async function chainNeighbourhood(db: ContentDb, people: Iterable<number>, maxLinks: number): Promise<Credit[]> {
  const credits: Credit[] = [];
  let frontier = [...new Set(people)];
  const seenPeople = new Set(frontier);
  const seenFilms = new Set<number>();
  const hops = Math.max(0, Math.floor((maxLinks - 1) / 2));
  for (let hop = 0; hop <= hops && frontier.length > 0; hop++) {
    const films: number[] = [];
    for (const part of chunk(frontier, ID_CHUNK)) {
      const rows = await selectAllPages<{ film_id: number; person_id: number }>((from, to) =>
        db.from("movie_credits").select("film_id, person_id").in("person_id", part).order("person_id").order("film_id").range(from, to),
      );
      for (const row of rows) {
        if (seenFilms.has(row.film_id)) continue;
        seenFilms.add(row.film_id);
        films.push(row.film_id);
      }
    }
    const next = new Set<number>();
    for (const part of chunk(films, ID_CHUNK)) {
      const rows = await selectAllPages<{ film_id: number; person_id: number; billing: number | null }>((from, to) =>
        db.from("movie_credits").select("film_id, person_id, billing").in("film_id", part).order("film_id").order("person_id").range(from, to),
      );
      for (const row of rows) {
        credits.push({ filmId: row.film_id, personId: row.person_id, billing: row.billing });
        if (!seenPeople.has(row.person_id)) next.add(row.person_id);
      }
    }
    for (const id of next) seenPeople.add(id);
    frontier = [...next];
  }
  return credits;
}

/** Unplayed Degrees days from `today` on with a stale par, read from the database (read-only). */
export async function findStaleDegreesDays(db: ContentDb, days: readonly StoredDegreesDay[], today: string, minPar: number): Promise<StaleDegreesDay[]> {
  const open = days.filter((day) => !day.played && day.date >= today && day.par > 1);
  if (open.length === 0) return [];
  const maxLinks = Math.max(...open.map((day) => day.par)) - 1;
  const graph = buildGraph(await chainNeighbourhood(db, open.flatMap((day) => [day.start.id, day.end.id]), maxLinks));
  return staleDegreesDays(open, graph, today, minPar);
}

/** Ids among `ids` that `table` doesn't have. */
async function missingIds(db: ContentDb, table: "movie_films" | "movie_people", ids: ReadonlySet<number>): Promise<number[]> {
  const found = new Set<number>();
  for (const part of chunk([...ids], ID_CHUNK)) {
    const { data, error } = await db.from(table).select("id").in("id", part);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    for (const row of data ?? []) found.add(row.id);
  }
  return [...ids].filter((id) => !found.has(id)).sort((a, b) => a - b);
}

/** Pairs among `pairs` that aren't credits. */
async function missingCredits(db: ContentDb, pairs: readonly [number, number][]): Promise<string[]> {
  const byFilm = new Map<number, Set<number>>();
  for (const [filmId, personId] of pairs) (byFilm.get(filmId) ?? byFilm.set(filmId, new Set()).get(filmId)!).add(personId);
  const present = new Set<string>();
  for (const part of chunk([...byFilm.keys()], 100)) {
    const rows = await selectAllPages<{ film_id: number; person_id: number }>((from, to) =>
      db.from("movie_credits").select("film_id, person_id").in("film_id", part).order("film_id").order("person_id").range(from, to),
    );
    for (const row of rows) present.add(pairKey(row.film_id, row.person_id));
  }
  return [...new Set(pairs.map(([f, p]) => pairKey(f, p)))].filter((key) => !present.has(key)).sort();
}

export interface CheckReport {
  problems: string[];
  /** Not failures: things to follow up (stale Degrees pars). */
  warnings: string[];
  notes: string[];
}


/** Runs every check; `problems` empty means the contract holds. */
export async function runCatalogChecks(db: ContentDb, options: { baseline?: IdBaseline; stored?: StoredReferences; today?: string } = {}): Promise<CheckReport> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  if (options.baseline) {
    const current = await readCatalogIds(db);
    const changed = compareIdBaseline(options.baseline, current);
    problems.push(...changed);
    notes.push(
      `baseline (${options.baseline.takenAt}): ${options.baseline.films.length} films and ${options.baseline.people.length} people checked; ` +
        `catalog now has ${current.films.length} films and ${current.people.length} people`,
    );
  }
  const stored = options.stored ?? (await loadStoredReferences(db));
  const [films, people] = await Promise.all([missingIds(db, "movie_films", stored.refs.films), missingIds(db, "movie_people", stored.refs.people)]);
  for (const id of films) problems.push(`film ${id} is referenced by a stored puzzle or play but isn't in the catalog`);
  for (const id of people) problems.push(`person ${id} is referenced by a stored puzzle or play but isn't in the catalog`);
  for (const pair of await missingCredits(db, stored.solutionPairs)) problems.push(`stored Degrees solution link ${pair} (film:person) is no longer a credit`);
  notes.push(
    `${stored.puzzles} puzzles and ${stored.plays} plays reference ${stored.refs.films.size} films and ${stored.refs.people.size} people; ` +
      `${new Set(stored.solutionPairs.map(([f, p]) => pairKey(f, p))).size} Degrees solution credit pairs`,
  );
  if (stored.unreadable.length) notes.push(`${stored.unreadable.length} stored puzzles this checkout's game schemas can't read (refs still checked): ${stored.unreadable.slice(0, 5).join("; ")}${stored.unreadable.length > 5 ? "; …" : ""}`);

  const { DEGREES_MIN_PAR } = await import("@/games/degrees/schema");
  const today = options.today ?? todayInGameTimezone();
  const stale = await findStaleDegreesDays(db, stored.degreesDays, today, DEGREES_MIN_PAR);
  const open = stored.degreesDays.filter((day) => !day.played && day.date >= today).length;
  notes.push(`${open} unplayed Degrees days from ${today} on checked for a chain shorter than par: ${stale.length} found`);
  if (stale.length) {
    warnings.push(`${stale.length} unplayed Degrees day(s) now have a chain shorter than par. Fix: npm run content:movies:degrees -- --repar-unplayed (--dry-run first)`);
    for (const day of stale) {
      const what =
        day.decision.action === "repar" ? `par becomes ${day.decision.par}` : day.decision.action === "regenerate" ? "the day will be regenerated" : "DEV FIXTURE, left alone";
      warnings.push(`  Degrees ${day.date} ${day.start.name} → ${day.end.name}: par ${day.par}, but ${day.shortest} link${day.shortest === 1 ? "" : "s"} now (${what})`);
    }
  }
  return { problems, warnings, notes };
}
