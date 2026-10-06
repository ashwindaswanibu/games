/**
 * DEV FIXTURE puzzles: runs the per-game generators in `scripts/content/fixtures/` for a date range
 * and stores each day's puzzle with its images. Local databases only (unless --allow-remote).
 *
 *   npm run content:fixtures                          every generator, today (New York) + 7 days
 *   npm run content:fixtures -- --game degrees        one game (repeatable)
 *   npm run content:fixtures -- --from 2026-10-06 --days 3
 *   npm run content:fixtures -- --replace             regenerate DEV FIXTURE days that have no plays yet
 *   npm run content:fixtures -- --dry-run             generate and validate, write nothing
 *
 * Days that already have a puzzle are skipped. With --replace, a day is regenerated only if its
 * stored puzzle is itself a DEV FIXTURE (payload `fixture: true`) that nobody has played. A real,
 * curated puzzle (from a `content:movies:*` pipeline or written by hand) is never replaced, and
 * neither is a day someone has played (a play never loses its puzzle).
 */
import { existsSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { referencedAssetIds } from "@/core/assets";
import { addDays, parsePuzzleDate, today, type PuzzleDate } from "@/core/day";
import { getGame } from "@/games/registry";
import type { Json } from "@/server/database.types";
import { createGameServices } from "@/server/game-services";
import { contentDb, toBytea, type ContentDb } from "./lib/db.mjs";
import { isLocalSupabase, supabaseEnv } from "./lib/env.mjs";
import { createFixtureContext, isFixturePayload, type FixtureGenerator, type PendingAsset } from "./lib/fixtures.mjs";

const GENERATOR_DIR = new URL("./fixtures/", import.meta.url);

const { values: args } = parseArgs({
  options: {
    game: { type: "string", multiple: true },
    from: { type: "string" },
    days: { type: "string", default: "8" },
    replace: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

async function loadGenerators(only: readonly string[] | undefined): Promise<FixtureGenerator[]> {
  const files = existsSync(GENERATOR_DIR) ? readdirSync(GENERATOR_DIR).filter((f) => f.endsWith(".mts") && !f.startsWith("_")) : [];
  const available = files.map((f) => f.replace(/\.mts$/, ""));
  const wanted = only ?? available;
  const unknown = wanted.filter((id) => !available.includes(id));
  if (unknown.length) throw new Error(`No fixture generator for ${unknown.join(", ")} (have: ${available.join(", ") || "none"})`);

  const generators: FixtureGenerator[] = [];
  for (const id of wanted) {
    const loaded = (await import(new URL(`${id}.mts`, GENERATOR_DIR).href)) as { default?: FixtureGenerator };
    const generator = loaded.default;
    if (!generator?.game || typeof generator.generate !== "function") {
      throw new Error(`fixtures/${id}.mts must default-export defineFixtureGenerator({ game, generate })`);
    }
    if (generator.game.id !== id) throw new Error(`fixtures/${id}.mts generates for "${generator.game.id}"; the file must be named after the game`);
    if (getGame(id) !== generator.game) throw new Error(`fixtures/${id}.mts uses a game that isn't the one registered in src/games/registry.ts`);
    if (generator.game.generate) throw new Error(`${id} generates its own puzzles; fixtures are only for curated games`);
    generators.push(generator);
  }
  return generators;
}

/** Schema-validates the output and enforces the asset visibility rules. Returns the parsed values. */
function validate(generator: FixtureGenerator, output: { puzzle: unknown; solution: unknown }, assets: PendingAsset[]) {
  const { game } = generator;
  const puzzle = game.puzzleSchema.parse(output.puzzle);
  const solution = game.solutionSchema.parse(output.solution);
  for (const [name, value] of [["puzzle", puzzle], ["solution", solution], ["initial state", game.initialState(puzzle)]] as const) {
    if (JSON.stringify(JSON.parse(JSON.stringify(value))) !== JSON.stringify(value)) throw new Error(`${name} doesn't survive JSON round-tripping`);
  }

  const inPuzzle = referencedAssetIds(puzzle);
  const inSolution = referencedAssetIds(solution);
  const known = new Set(assets.map((a) => a.id));
  for (const asset of assets) {
    if (asset.visibility === "secret" && inPuzzle.has(asset.id)) {
      throw new Error(`secret ${asset.kind} asset ${asset.id} is in the puzzle, which every player receives; keep it in the solution`);
    }
    if (!inPuzzle.has(asset.id) && !inSolution.has(asset.id)) {
      throw new Error(`${asset.kind} asset ${asset.id} isn't referenced by the puzzle or solution`);
    }
  }
  for (const id of [...inPuzzle, ...inSolution]) {
    if (!known.has(id)) throw new Error(`references asset ${id}, which this run didn't create (use ctx.addAsset)`);
  }
  return { puzzle, solution };
}

type DayOutcome = "created" | "replaced" | "exists" | "played" | "curated" | "validated";

async function runDay(db: ContentDb, generator: FixtureGenerator, date: PuzzleDate, dryRun: boolean, replace: boolean): Promise<{ outcome: DayOutcome; assets: PendingAsset[] }> {
  const gameId = generator.game.id;
  const { data: existing, error: existingError } = await db.from("puzzles").select("payload").eq("game_id", gameId).eq("puzzle_date", date).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && !replace) return { outcome: "exists", assets: [] };
  // Only a DEV FIXTURE may be replaced by another; real content is never overwritten from here.
  if (existing && !isFixturePayload(existing.payload)) return { outcome: "curated", assets: [] };
  if (existing) {
    const { count, error } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", gameId).eq("puzzle_date", date);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return { outcome: "played", assets: [] };
  }

  const { ctx, assets } = createFixtureContext({ gameId, date, services: createGameServices(db), db });
  const { puzzle, solution } = validate(generator, await generator.generate(ctx), assets);
  if (dryRun) return { outcome: "validated", assets };

  if (existing) {
    // No plays reference it (checked above; the plays FK would refuse otherwise). Cascades to assets.
    // The fixture check is repeated in the delete, so a puzzle curated meanwhile is left alone.
    const { data: deleted, error } = await db
      .from("puzzles")
      .delete()
      .eq("game_id", gameId)
      .eq("puzzle_date", date)
      .eq("payload->>fixture", "true")
      .select("puzzle_date");
    if (error) throw new Error(`Couldn't replace the old puzzle: ${error.message}`);
    if (!deleted || deleted.length !== 1) return { outcome: "curated", assets: [] };
  }
  const { error: puzzleError } = await db.from("puzzles").insert({ game_id: gameId, puzzle_date: date, payload: puzzle as Json, solution: solution as Json });
  if (puzzleError) throw new Error(`Couldn't save the puzzle: ${puzzleError.message}`);

  try {
    // One request per asset keeps each request well under PostgREST's body limit.
    for (const asset of assets) {
      const { error } = await db.from("puzzle_assets").insert({
        id: asset.id,
        game_id: gameId,
        puzzle_date: date,
        kind: asset.kind,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        bytes: toBytea(asset.bytes),
      });
      if (error) throw new Error(`Couldn't save ${asset.kind} asset: ${error.message}`);
    }
  } catch (error) {
    // Never leave a puzzle whose images are missing.
    await db.from("puzzles").delete().eq("game_id", gameId).eq("puzzle_date", date);
    throw error;
  }
  return { outcome: existing ? "replaced" : "created", assets };
}

async function main() {
  const { url } = supabaseEnv();
  if (!isLocalSupabase(url) && !args["allow-remote"]) {
    throw new Error(`Refusing to write DEV FIXTURE puzzles to ${new URL(url).host}. Pass --allow-remote if you really mean it.`);
  }
  const days = Number(args.days);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("--days must be an integer from 1 to 366");
  const from = args.from ? parsePuzzleDate(args.from) : today();
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));

  const generators = await loadGenerators(args.game);
  if (generators.length === 0) {
    console.log("No fixture generators yet. Add scripts/content/fixtures/<game-id>.mts (see src/games/_movies/README.md).");
    return;
  }

  const db = contentDb();
  let failures = 0;
  for (const generator of generators) {
    for (const date of dates) {
      const label = `${generator.game.id} ${date}`;
      try {
        const { outcome, assets } = await runDay(db, generator, date, args["dry-run"], args.replace);
        const size = assets.reduce((sum, a) => sum + a.bytes.length, 0);
        const detail = assets.length ? ` (${assets.length} asset${assets.length === 1 ? "" : "s"}, ${Math.round(size / 1024)} KB)` : "";
        const mark = outcome === "exists" || outcome === "played" || outcome === "curated" ? "·" : "✓";
        const notes: Partial<Record<DayOutcome, string>> = {
          played: "kept: already played",
          curated: "kept: curated puzzle",
          exists: "exists (use --replace)",
        };
        const note = notes[outcome] ?? outcome;
        console.log(`${mark} ${label} ${note}${detail}`);
      } catch (error) {
        failures++;
        console.error(`✗ ${label} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (failures) {
    console.error(`\n${failures} day(s) failed`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
