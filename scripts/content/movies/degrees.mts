/**
 * Daily Degrees of Separation puzzles from the movie catalog.
 *
 *   npm run content:movies:degrees                          today (New York) + the next 30 days
 *   npm run content:movies:degrees -- --from 2026-11-01 --days 7
 *   npm run content:movies:degrees -- --replace-fixtures    also take over DEV FIXTURE days nobody has played
 *   npm run content:movies:degrees -- --dry-run             pick and print, write nothing
 *
 * Builds the bipartite actor–film graph from every catalog credit, then for each date picks a
 * start and an end actor among the best-known actors so that the shortest chain between them is
 * 2 or 3 links. Par is that length; the solution is the most recognisable shortest chain (famous
 * films, famous co-stars, top-billed credits). Needs the catalog (`content:movies:catalog`).
 *
 * Never overwrites a real puzzle: a date that already has one is skipped, whoever wrote it. The one
 * exception is `--replace-fixtures`, which replaces a DEV FIXTURE puzzle (payload `fixture: true`)
 * that nobody has played; curated and played days are always kept. Picks are
 * seeded from PUZZLE_SEED_SECRET and the date, and nobody is a start or end actor twice within
 * --spacing days (default 45), counting puzzles already stored around the range.
 */
import { parseArgs } from "node:util";
import { addDays, type PuzzleDate } from "@/core/day";
import { createRng } from "@/core/random";
import type { FilmRef, PersonRef } from "@/games/_movies/schemas";
import {
  DEGREES_MAX_PAR,
  DEGREES_MIN_PAR,
  degreesPuzzleSchema,
  degreesSolutionSchema,
  isConsistentSolution,
  type DegreesPuzzle,
  type DegreesSolution,
} from "@/games/degrees/schema";
import {
  actorPool,
  buildGraph,
  pickPuzzle,
  popularityLinkScore,
  type CastGraph,
  type Credit,
  type FilmInfo,
  type PersonInfo,
} from "./lib/degrees-graph.mjs";
import {
  contentSeed,
  deleteFixturePuzzle,
  existingPuzzleDates,
  insertPuzzleIfAbsent,
  pipelineDb,
  positiveInt,
  puzzleDateRange,
  replaceableFixtureDates,
  selectAllPages,
  type ContentDb,
} from "./lib/pipeline.mjs";

const GAME_ID = "degrees";

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    days: { type: "string", default: "31" },
    "pool-size": { type: "string", default: "300" },
    spacing: { type: "string", default: "45" },
    "replace-fixtures": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

/** Share of days aiming for a 2-link puzzle; the rest aim for 3 (falling back if none exists). */
const TWO_LINK_SHARE = 0.55;

async function loadCatalog(db: ContentDb) {
  const [creditRows, filmRows, personRows] = await Promise.all([
    selectAllPages<{ film_id: number; person_id: number; billing: number | null }>((from, to) =>
      db.from("movie_credits").select("film_id, person_id, billing").order("film_id").order("person_id").range(from, to),
    ),
    selectAllPages<{ id: number; title: string; year: number | null; popularity: number }>((from, to) =>
      db.from("movie_films").select("id, title, year, popularity").order("id").range(from, to),
    ),
    selectAllPages<{ id: number; name: string; popularity: number }>((from, to) =>
      db.from("movie_people").select("id, name, popularity").order("id").range(from, to),
    ),
  ]);
  if (creditRows.length === 0) throw new Error("The movie catalog has no credits. Run `npm run content:movies:catalog` first.");
  const credits: Credit[] = creditRows.map((r) => ({ filmId: r.film_id, personId: r.person_id, billing: r.billing }));
  const films = new Map<number, FilmInfo>(filmRows.map((f) => [f.id, f]));
  const people = new Map<number, PersonInfo>(personRows.map((p) => [p.id, p]));
  return { graph: buildGraph(credits), films, people, creditCount: credits.length };
}

/** Start and end actors of degrees puzzles stored within `spacing` days of the range. */
async function recentlyFeatured(db: ContentDb, dates: readonly PuzzleDate[], spacing: number): Promise<Map<PuzzleDate, Set<number>>> {
  const first = addDays(dates[0]!, -spacing);
  const last = addDays(dates[dates.length - 1]!, spacing);
  const { data, error } = await db.from("puzzles").select("puzzle_date, payload").eq("game_id", GAME_ID).gte("puzzle_date", first).lte("puzzle_date", last);
  if (error) throw new Error(`Couldn't read stored puzzles: ${error.message}`);
  const out = new Map<PuzzleDate, Set<number>>();
  for (const row of data ?? []) {
    // Stored puzzles may predate this schema (or be fixtures); only well-formed ones constrain picks.
    const parsed = degreesPuzzleSchema.safeParse(row.payload);
    if (parsed.success) out.set(row.puzzle_date as PuzzleDate, new Set([parsed.data.start.id, parsed.data.end.id]));
  }
  return out;
}

function excludedFor(date: PuzzleDate, featured: ReadonlyMap<PuzzleDate, Set<number>>, spacing: number): Set<number> {
  const out = new Set<number>();
  for (const [other, ids] of featured) {
    if (other === date) continue;
    const gap = Math.abs(Date.parse(`${other}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
    if (gap <= spacing) for (const id of ids) out.add(id);
  }
  return out;
}

function toPuzzle(
  picked: { start: number; end: number; par: number; path: { filmId: number; personId: number }[] },
  films: ReadonlyMap<number, FilmInfo>,
  people: ReadonlyMap<number, PersonInfo>,
): { puzzle: DegreesPuzzle; solution: DegreesSolution } {
  const person = (id: number): PersonRef => {
    const p = people.get(id);
    if (!p) throw new Error(`Person ${id} is in the graph but not in movie_people`);
    return { id: p.id, name: p.name };
  };
  const film = (id: number): FilmRef => {
    const f = films.get(id);
    if (!f) throw new Error(`Film ${id} is in the graph but not in movie_films`);
    return { id: f.id, title: f.title, year: f.year };
  };
  const puzzle = degreesPuzzleSchema.parse({ start: person(picked.start), end: person(picked.end), par: picked.par });
  const solution = degreesSolutionSchema.parse({ path: picked.path.map((link) => ({ film: film(link.filmId), person: person(link.personId) })) });
  if (!isConsistentSolution(puzzle, solution)) throw new Error("Generated solution doesn't match its puzzle (generator bug)");
  return { puzzle, solution };
}

/** Every link of the chain is a real credit pair (both people in the film). */
function verifyAgainstGraph(graph: CastGraph, puzzle: DegreesPuzzle, solution: DegreesSolution): void {
  let from = puzzle.start.id;
  for (const { film, person } of solution.path) {
    const cast = graph.castOf.get(film.id) ?? [];
    if (!cast.includes(from) || !cast.includes(person.id)) throw new Error(`Link ${from} → ${film.id} → ${person.id} isn't in the catalog`);
    from = person.id;
  }
}

/**
 * The registered game, when the degrees game module exists, so puzzles are also checked against
 * the exact schemas the app will parse them with.
 */
async function registeredGameSchemas() {
  const { getGame } = await import("@/games/registry");
  const game = getGame(GAME_ID);
  return game ? { puzzle: game.puzzleSchema, solution: game.solutionSchema } : null;
}

async function main() {
  const days = positiveInt(args.days, "days", { max: 366 });
  const poolSize = positiveInt(args["pool-size"], "pool-size", { min: 20, max: 5000 });
  const spacing = positiveInt(args.spacing, "spacing", { min: 0, max: 365 });
  const dates = puzzleDateRange(days, args.from);
  const dryRun = args["dry-run"];
  const db = pipelineDb({ allowRemote: args["allow-remote"] });

  const { graph, films, people, creditCount } = await loadCatalog(db);
  const pool = actorPool(graph, people, { size: poolSize, minFilms: 6, minLeads: 3, leadBilling: 5 });
  console.log(`Graph: ${graph.filmsOf.size} people, ${graph.castOf.size} films, ${creditCount} credits. Actor pool: ${pool.length}.`);
  if (pool.length < 20) throw new Error("Too few well-known actors in the catalog to make puzzles. Import a larger catalog.");

  const registered = await registeredGameSchemas();
  if (!registered) console.warn("  (the degrees game isn't registered yet; validating against src/games/degrees/schema.ts only)");

  const linkScore = popularityLinkScore(graph, films, people);
  const existing = await existingPuzzleDates(db, GAME_ID, dates);
  const replaceable = args["replace-fixtures"] ? await replaceableFixtureDates(db, GAME_ID, dates) : new Set<string>();
  const featured = await recentlyFeatured(db, dates, spacing);
  const pars = [DEGREES_MIN_PAR, DEGREES_MAX_PAR] as const;
  let created = 0;
  let failures = 0;

  for (const date of dates) {
    const replacing = replaceable.has(date);
    if (existing.has(date) && !replacing) {
      console.log(`· ${date} exists (never overwritten${args["replace-fixtures"] ? "; curated or already played" : ""})`);
      continue;
    }
    try {
      const rng = createRng(contentSeed(GAME_ID, date));
      const targetPar = rng.next() < TWO_LINK_SHARE ? 2 : 3;
      const picked = pickPuzzle({ graph, pool, rng, pars, targetPar, exclude: excludedFor(date, featured, spacing), linkScore });
      if (!picked) throw new Error("no pair of pool actors is 2–3 links apart (pool exhausted by --spacing?)");
      const { puzzle, solution } = toPuzzle(picked, films, people);
      verifyAgainstGraph(graph, puzzle, solution);
      registered?.puzzle.parse(puzzle);
      registered?.solution.parse(solution);

      const chain = [puzzle.start.name, ...solution.path.map((l) => `[${l.film.title}${l.film.year ? ` (${l.film.year})` : ""}] ${l.person.name}`)].join(" → ");
      if (dryRun) {
        console.log(`✓ ${date} par ${puzzle.par}: ${chain} (dry run)`);
      } else {
        if (replacing) await deleteFixturePuzzle(db, GAME_ID, date);
        const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date, puzzle, solution });
        if (outcome === "exists") {
          console.log(`· ${date} exists (written concurrently; kept)`);
          continue;
        }
        created++;
        console.log(`✓ ${date} par ${puzzle.par}${replacing ? " (replaced DEV FIXTURE)" : ""}: ${chain}`);
      }
      featured.set(date, new Set([puzzle.start.id, puzzle.end.id]));
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n${dryRun ? "Dry run: nothing written." : `${created} puzzle(s) created.`}${failures ? ` ${failures} day(s) failed.` : ""}`);
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
