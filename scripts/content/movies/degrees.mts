/**
 * Daily Degrees of Separation puzzles from the movie catalog.
 *
 *   npm run content:movies:degrees                          today (New York) + the next 30 days
 *   npm run content:movies:degrees -- --from 2026-11-01 --days 7
 *   npm run content:movies:degrees -- --replace-fixtures    also take over DEV FIXTURE days nobody has played
 *   npm run content:movies:degrees -- --dry-run             pick and print, write nothing
 *   npm run content:movies:degrees -- --repar-unplayed      fix stored days a catalog import changed (below)
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
 *
 * `--repar-unplayed` (instead of generating new days): a catalog import that adds credits can give
 * a stored day's pair a chain shorter than its par, and one that drops credits (archive footage)
 * can take away its stored chain (imports keep the credits of played days' and today's solutions,
 * not of days still to come). For every stored day from --from (default today) on that nobody has
 * played, it recomputes the shortest chain over the current credits; when that differs from par,
 * it rewrites par and the solution (same start and end) if the new par is still 2 or 3 links, and
 * otherwise (the pair are now co-stars, or further apart) regenerates the day by the rules above.
 * A played day is never touched: the write goes through `replace_unplayed_puzzle`, which refuses a
 * day with a play (even one started mid-run). DEV FIXTURE days are left alone.
 *
 * A non-local database needs `--allow-remote` to write, or `--allow-remote-read` for a dry run.
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
import type { Json } from "@/server/database.types";
import { isFixturePayload } from "../lib/fixtures.mjs";
import {
  actorPool,
  bestShortestPath,
  buildGraph,
  chainIntact,
  isNonFictionFilm,
  linkDistances,
  pickPuzzle,
  popularityLinkScore,
  reparDecision,
  type CastGraph,
  type Credit,
  type FilmInfo,
  type LinkScore,
  type PathLink,
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
    days: { type: "string" },
    "pool-size": { type: "string", default: "300" },
    spacing: { type: "string", default: "45" },
    "replace-fixtures": { type: "boolean", default: false },
    "repar-unplayed": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
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
    selectAllPages<{ id: number; title: string; year: number | null; popularity: number; genres: string[]; is_adult: boolean }>((from, to) =>
      db.from("movie_films").select("id, title, year, popularity, genres, is_adult").order("id").range(from, to),
    ),
    selectAllPages<{ id: number; name: string; popularity: number; is_actor: boolean; is_human: boolean | null }>((from, to) =>
      db.from("movie_people").select("id, name, popularity, is_actor, is_human").order("id").range(from, to),
    ),
  ]);
  if (creditRows.length === 0) throw new Error("The movie catalog has no credits. Run `npm run content:movies:catalog` first.");
  // Players can't find an adult film in search, so no chain (or par) goes through one.
  const hidden = new Set(filmRows.filter((f) => f.is_adult).map((f) => f.id));
  const credits: Credit[] = creditRows.filter((r) => !hidden.has(r.film_id)).map((r) => ({ filmId: r.film_id, personId: r.person_id, billing: r.billing }));
  const films = new Map<number, FilmInfo>(
    filmRows.map((f) => [f.id, { id: f.id, title: f.title, year: f.year, popularity: f.popularity, nonFiction: isNonFictionFilm(f.genres) }]),
  );
  const people = new Map<number, PersonInfo>(
    personRows.map((p) => [p.id, { id: p.id, name: p.name, popularity: p.popularity, isActor: p.is_actor, isHuman: p.is_human }]),
  );
  // is_human comes from the catalog import; a database that hasn't had one since it was added
  // can't tell groups from people yet (nobody is excluded then).
  if (personRows.every((p) => p.is_human === null)) {
    console.warn("  ! No person has movie_people.is_human set: groups (the Marx Brothers) can still start or end a puzzle. Run content:movies:catalog.");
  }
  return { graph: buildGraph(credits), films, people, creditCount: credits.length };
}

/** Start and end actors of degrees puzzles stored within `spacing` days of the range. */
async function recentlyFeatured(db: ContentDb, dates: readonly PuzzleDate[], spacing: number): Promise<Map<PuzzleDate, Set<number>>> {
  const sorted = [...dates].sort();
  const first = addDays(sorted[0]!, -spacing);
  const last = addDays(sorted[sorted.length - 1]!, spacing);
  const rows = await selectAllPages<{ puzzle_date: string; payload: Json }>((from, to) =>
    db.from("puzzles").select("puzzle_date, payload").eq("game_id", GAME_ID).gte("puzzle_date", first).lte("puzzle_date", last).order("puzzle_date").range(from, to),
  );
  const out = new Map<PuzzleDate, Set<number>>();
  for (const row of rows) {
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

/** Everything that makes and checks a day's puzzle. */
interface Generator {
  graph: CastGraph;
  films: ReadonlyMap<number, FilmInfo>;
  people: ReadonlyMap<number, PersonInfo>;
  pool: readonly number[];
  linkScore: LinkScore;
  spacing: number;
  /** Start and end actors by date, for --spacing; updated as days are written. */
  featured: Map<PuzzleDate, Set<number>>;
  /** The registered game's own schemas, when the degrees game module exists. */
  registered: Awaited<ReturnType<typeof registeredGameSchemas>>;
}

function personRef(people: ReadonlyMap<number, PersonInfo>, id: number): PersonRef {
  const p = people.get(id);
  if (!p) throw new Error(`Person ${id} is in the graph but not in movie_people`);
  return { id: p.id, name: p.name };
}

function filmRef(films: ReadonlyMap<number, FilmInfo>, id: number): FilmRef {
  const f = films.get(id);
  if (!f) throw new Error(`Film ${id} is in the graph but not in movie_films`);
  return { id: f.id, title: f.title, year: f.year };
}

/**
 * Puzzle and solution for a chain, checked against the schemas, the registered game's schemas and
 * the graph (every link a real pair of credits). `start` and `end` are given as refs so a reworked
 * day keeps exactly the names its players were shown.
 */
function checkedPuzzle(gen: Generator, start: PersonRef, end: PersonRef, path: readonly PathLink[]): { puzzle: DegreesPuzzle; solution: DegreesSolution } {
  const puzzle = degreesPuzzleSchema.parse({ start, end, par: path.length });
  const solution = degreesSolutionSchema.parse({
    path: path.map((link) => ({ film: filmRef(gen.films, link.filmId), person: link.personId === end.id ? end : personRef(gen.people, link.personId) })),
  });
  if (!isConsistentSolution(puzzle, solution)) throw new Error("Generated solution doesn't match its puzzle (generator bug)");
  let from = puzzle.start.id;
  for (const { film, person } of solution.path) {
    const cast = gen.graph.castOf.get(film.id) ?? [];
    if (!cast.includes(from) || !cast.includes(person.id)) throw new Error(`Link ${from} → ${film.id} → ${person.id} isn't in the catalog`);
    from = person.id;
  }
  gen.registered?.puzzle.parse(puzzle);
  gen.registered?.solution.parse(solution);
  return { puzzle, solution };
}

/** A new puzzle for `date` by the daily rules: seeded by the date, a 2- or 3-link pair from the pool, --spacing respected. */
function generateDay(gen: Generator, date: PuzzleDate): { puzzle: DegreesPuzzle; solution: DegreesSolution } {
  const rng = createRng(contentSeed(GAME_ID, date));
  const targetPar = rng.next() < TWO_LINK_SHARE ? 2 : 3;
  const picked = pickPuzzle({
    graph: gen.graph,
    pool: gen.pool,
    rng,
    pars: [DEGREES_MIN_PAR, DEGREES_MAX_PAR],
    targetPar,
    exclude: excludedFor(date, gen.featured, gen.spacing),
    linkScore: gen.linkScore,
  });
  if (!picked) throw new Error("no pair of pool actors is 2–3 links apart (pool exhausted by --spacing?)");
  return checkedPuzzle(gen, personRef(gen.people, picked.start), personRef(gen.people, picked.end), picked.path);
}

const describeChain = (puzzle: DegreesPuzzle, solution: DegreesSolution) =>
  [puzzle.start.name, ...solution.path.map((l) => `[${l.film.title}${l.film.year ? ` (${l.film.year})` : ""}] ${l.person.name}`)].join(" → ");

/**
 * The registered game, when the degrees game module exists, so puzzles are also checked against
 * the exact schemas the app will parse them with.
 */
async function registeredGameSchemas() {
  const { getGame } = await import("@/games/registry");
  const game = getGame(GAME_ID);
  return game ? { puzzle: game.puzzleSchema, solution: game.solutionSchema } : null;
}

/** The default mode: a puzzle for every date in the range that has none. */
async function generateRange(db: ContentDb, gen: Generator, dates: readonly PuzzleDate[], dryRun: boolean): Promise<{ written: number; failures: number }> {
  const existing = await existingPuzzleDates(db, GAME_ID, dates);
  const replaceable = args["replace-fixtures"] ? await replaceableFixtureDates(db, GAME_ID, dates) : new Set<string>();
  let written = 0;
  let failures = 0;
  for (const date of dates) {
    const replacing = replaceable.has(date);
    if (existing.has(date) && !replacing) {
      console.log(`· ${date} exists (never overwritten${args["replace-fixtures"] ? "; curated or already played" : ""})`);
      continue;
    }
    try {
      const { puzzle, solution } = generateDay(gen, date);
      const chain = describeChain(puzzle, solution);
      if (dryRun) {
        console.log(`✓ ${date} par ${puzzle.par}: ${chain} (dry run)`);
      } else {
        if (replacing) await deleteFixturePuzzle(db, GAME_ID, date);
        const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date, puzzle, solution });
        if (outcome === "exists") {
          console.log(`· ${date} exists (written concurrently; kept)`);
          continue;
        }
        written++;
        console.log(`✓ ${date} par ${puzzle.par}${replacing ? " (replaced DEV FIXTURE)" : ""}: ${chain}`);
      }
      gen.featured.set(date, new Set([puzzle.start.id, puzzle.end.id]));
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { written, failures };
}

/** `--repar-unplayed`: every stored day from `from` on, against today's credits (see the header). */
async function reparUnplayed(db: ContentDb, gen: Generator, from: PuzzleDate, dryRun: boolean): Promise<{ written: number; failures: number }> {
  const rows = await selectAllPages<{ puzzle_date: string; payload: Json; solution: Json }>((first, last) =>
    db.from("puzzles").select("puzzle_date, payload, solution").eq("game_id", GAME_ID).gte("puzzle_date", from).order("puzzle_date").range(first, last),
  );
  const plays = await selectAllPages<{ puzzle_date: string; user_id: string }>((first, last) =>
    db.from("plays").select("puzzle_date, user_id").eq("game_id", GAME_ID).gte("puzzle_date", from).order("puzzle_date").order("user_id").range(first, last),
  );
  const played = new Set(plays.map((row) => row.puzzle_date));
  console.log(`${rows.length} stored Degrees days from ${from} on; ${played.size} of them played.`);
  if (rows.length === 0) return { written: 0, failures: 0 };
  for (const [date, ids] of await recentlyFeatured(db, rows.map((row) => row.puzzle_date as PuzzleDate), gen.spacing)) gen.featured.set(date, ids);

  const counts = { kept: 0, repar: 0, regenerated: 0, played: 0, fixtures: 0 };
  let written = 0;
  let failures = 0;
  for (const row of rows) {
    const date = row.puzzle_date as PuzzleDate;
    const parsed = degreesPuzzleSchema.safeParse(row.payload);
    if (!parsed.success) {
      failures++;
      console.error(`✗ ${date} the stored payload isn't a Degrees puzzle; left alone`);
      continue;
    }
    const { start, end, par } = parsed.data;
    const shortest = linkDistances(gen.graph, start.id, DEGREES_MAX_PAR).get(end.id) ?? null;
    const stored = degreesSolutionSchema.safeParse(row.solution);
    const intact = stored.success && chainIntact(gen.graph, start.id, stored.data.path);
    const decision = reparDecision({ par, shortest, intact, played: played.has(date), fixture: isFixturePayload(row.payload) }, DEGREES_MIN_PAR, DEGREES_MAX_PAR);
    const pair = `${start.name} → ${end.name}`;
    if (decision.action === "keep") {
      counts.kept++;
      console.log(`· ${date} ${pair}: par ${par} is still the shortest chain`);
      continue;
    }
    const now = shortest === null ? `no chain within ${DEGREES_MAX_PAR} links` : `${shortest} link${shortest === 1 ? "" : "s"}`;
    if (decision.action === "skip") {
      counts[decision.reason === "played" ? "played" : "fixtures"]++;
      console.log(`· ${date} ${pair}: par ${par}, ${now} now; ${decision.reason === "played" ? "played, never touched" : "DEV FIXTURE, left alone"}`);
      continue;
    }
    try {
      let next: { puzzle: DegreesPuzzle; solution: DegreesSolution };
      if (decision.action === "repar") {
        const path = bestShortestPath(gen.graph, start.id, end.id, decision.par, gen.linkScore);
        if (!path) throw new Error(`no ${decision.par}-link chain found (generator bug)`);
        next = checkedPuzzle(gen, start, end, path);
      } else {
        next = generateDay(gen, date);
      }
      const what =
        decision.action === "repar"
          ? next.puzzle.par === par
            ? `par ${par}, a new solution (a credit of the old chain is gone)`
            : `par ${par} → ${next.puzzle.par} (${next.puzzle.par < par ? "a shorter chain exists" : "a credit of the old chain is gone"})`
          : `${pair}: ${now} apart now (par ${par}): regenerated`;
      const chain = describeChain(next.puzzle, next.solution);
      if (dryRun) {
        console.log(`✓ ${date} ${what}: ${chain} (dry run)`);
      } else {
        const { data: outcome, error } = await db.rpc("replace_unplayed_puzzle", {
          p_game_id: GAME_ID,
          p_date: date,
          p_expected_payload: row.payload,
          p_payload: next.puzzle as unknown as Json,
          p_solution: next.solution as unknown as Json,
        });
        if (error) throw new Error(`Couldn't rewrite the puzzle: ${error.message}`);
        if (outcome !== "replaced") {
          const why = { played: "someone started it meanwhile", changed: "it was rewritten meanwhile", missing: "it was deleted meanwhile" }[outcome ?? "missing"];
          console.log(`· ${date} left alone: ${why}`);
          continue;
        }
        written++;
        console.log(`✓ ${date} ${what}: ${chain}`);
      }
      counts[decision.action === "repar" ? "repar" : "regenerated"]++;
      gen.featured.set(date, new Set([next.puzzle.start.id, next.puzzle.end.id]));
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${pair}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(
    `\n${counts.repar} re-parred, ${counts.regenerated} regenerated, ${counts.kept} still right, ` +
      `${counts.played} played (never touched), ${counts.fixtures} DEV FIXTURE (left alone).`,
  );
  return { written, failures };
}

async function main() {
  const repar = args["repar-unplayed"];
  const dryRun = args["dry-run"];
  if (repar && (args.days !== undefined || args["replace-fixtures"])) {
    throw new Error("--repar-unplayed works on every stored day from --from on; it takes neither --days nor --replace-fixtures");
  }
  if (args["allow-remote-read"] && !args["allow-remote"] && !dryRun) {
    throw new Error("--allow-remote-read is for a --dry-run; writing to a non-local database needs --allow-remote (owner only)");
  }
  const days = positiveInt(args.days ?? "31", "days", { max: 366 });
  const poolSize = positiveInt(args["pool-size"], "pool-size", { min: 20, max: 5000 });
  const spacing = positiveInt(args["spacing"], "spacing", { min: 0, max: 365 });
  const dates = puzzleDateRange(repar ? 1 : days, args.from);
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });

  const { graph, films, people, creditCount } = await loadCatalog(db);
  const pool = actorPool(graph, people, films, { size: poolSize, minFilms: 6, minLeads: 3, leadBilling: 5 });
  console.log(`Graph: ${graph.filmsOf.size} people, ${graph.castOf.size} films, ${creditCount} credits. Actor pool: ${pool.length}.`);
  if (pool.length < 20) throw new Error("Too few well-known actors in the catalog to make puzzles. Import a larger catalog.");

  const registered = await registeredGameSchemas();
  if (!registered) console.warn("  (the degrees game isn't registered yet; validating against src/games/degrees/schema.ts only)");
  const gen: Generator = {
    graph,
    films,
    people,
    pool,
    linkScore: popularityLinkScore(graph, films, people),
    spacing,
    featured: repar ? new Map() : await recentlyFeatured(db, dates, spacing),
    registered,
  };

  const { written, failures } = repar ? await reparUnplayed(db, gen, dates[0]!, dryRun) : await generateRange(db, gen, dates, dryRun);
  console.log(`\n${dryRun ? "Dry run: nothing written." : `${written} puzzle(s) ${repar ? "rewritten" : "created"}.`}${failures ? ` ${failures} day(s) failed.` : ""}`);
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
