import { createHash, randomUUID } from "node:crypto";
import { addDays, parsePuzzleDate, today, type PuzzleDate } from "@/core/day";
import type { RngSeed } from "@/core/random";
import type { Json } from "@/server/database.types";
import { contentDb, toBytea, type ContentDb } from "../../lib/db.mjs";
import { isLocalSupabase, requireEnv, supabaseEnv } from "../../lib/env.mjs";
import { isFixturePayload } from "../../lib/fixtures.mjs";
import type { EncodedImage } from "../../lib/images.mjs";

/**
 * Shared plumbing for the Movies content pipeline (`scripts/content/movies/*.mts`): the database
 * guard, date ranges in the game timezone, seeds, paginated reads and the one way puzzles and their
 * assets are written.
 */

export { contentDb, type ContentDb };

/**
 * The service-role client, after refusing a non-local database unless `allowRemote` was passed.
 * Pipeline scripts write curated content; pointing one at production must be a deliberate act.
 */
export function pipelineDb({ allowRemote }: { allowRemote: boolean }): ContentDb {
  const { url } = supabaseEnv();
  if (!isLocalSupabase(url) && !allowRemote) {
    throw new Error(`Refusing to write to ${new URL(url).host}: it isn't a local Supabase. Pass --allow-remote if you really mean it.`);
  }
  return contentDb();
}

/**
 * `days` consecutive puzzle dates starting at `from` (default: today in the game timezone,
 * America/New_York, via `@/core/day`).
 */
export function puzzleDateRange(days: number, from?: string, now: Date = new Date()): PuzzleDate[] {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("--days must be an integer from 1 to 366");
  const start = from ? parsePuzzleDate(from) : today(now);
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

/**
 * Rng seed for a curated puzzle, derived from PUZZLE_SEED_SECRET like the platform's daily seed (but
 * in its own domain), so the schedule can't be predicted from the source and the catalog. Rerunning
 * a date with the same catalog reproduces the same choice.
 */
export function contentSeed(gameId: string, date: PuzzleDate): RngSeed {
  const secret = requireEnv("PUZZLE_SEED_SECRET", "It's in .env.local (the same secret the app uses for daily seeds).");
  const digest = createHash("sha256").update(`content\u0000${secret}\u0000${gameId}\u0000${date}`).digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4), digest.readUInt32BE(8), digest.readUInt32BE(12)];
}

/** PostgREST caps each response at `max_rows` (1000 locally); read every row in stable pages. */
export async function selectAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** Puzzle dates that already have a puzzle for `gameId` within [first, last]. */
export async function existingPuzzleDates(db: ContentDb, gameId: string, dates: readonly PuzzleDate[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const sorted = [...dates].sort();
  const { data, error } = await db
    .from("puzzles")
    .select("puzzle_date")
    .eq("game_id", gameId)
    .gte("puzzle_date", sorted[0]!)
    .lte("puzzle_date", sorted[sorted.length - 1]!);
  if (error) throw new Error(`Couldn't read existing puzzles: ${error.message}`);
  return new Set((data ?? []).map((row) => row.puzzle_date));
}

/**
 * Days in `dates` whose stored puzzle for `gameId` is a DEV FIXTURE nobody has played yet: the only
 * puzzles a real pipeline run may replace (`--replace-fixtures`). Curated puzzles and played days
 * are never in it.
 */
export async function replaceableFixtureDates(db: ContentDb, gameId: string, dates: readonly PuzzleDate[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const sorted = [...dates].sort();
  const [first, last] = [sorted[0]!, sorted[sorted.length - 1]!];
  const puzzles = await selectAllPages((from, to) =>
    db.from("puzzles").select("puzzle_date, payload").eq("game_id", gameId).gte("puzzle_date", first).lte("puzzle_date", last).order("puzzle_date").range(from, to),
  );
  const plays = await selectAllPages((from, to) =>
    db.from("plays").select("puzzle_date, user_id").eq("game_id", gameId).gte("puzzle_date", first).lte("puzzle_date", last).order("puzzle_date").order("user_id").range(from, to),
  );
  const played = new Set(plays.map((row) => row.puzzle_date));
  const wanted = new Set<string>(dates);
  return new Set(puzzles.filter((row) => wanted.has(row.puzzle_date) && isFixturePayload(row.payload) && !played.has(row.puzzle_date)).map((row) => row.puzzle_date));
}

/**
 * Deletes one day's DEV FIXTURE puzzle (its assets cascade) so real content can take the day.
 * Re-checks in the delete itself that the stored payload is still a fixture; a play still blocks it
 * (the plays foreign key refuses the delete).
 */
export async function deleteFixturePuzzle(db: ContentDb, gameId: string, date: PuzzleDate): Promise<void> {
  const { data, error } = await db.from("puzzles").delete().eq("game_id", gameId).eq("puzzle_date", date).eq("payload->>fixture", "true").select("puzzle_date");
  if (error) throw new Error(`Couldn't remove the DEV FIXTURE puzzle for ${date}: ${error.message}`);
  if (!data || data.length !== 1) throw new Error(`The ${gameId} puzzle for ${date} is no longer a DEV FIXTURE; left alone`);
}

/** An encoded image waiting to be stored with its puzzle. */
export interface AssetToInsert extends EncodedImage {
  /** Lowercase slug, e.g. "frame", "still". */
  kind: string;
  /** Pre-assigned so the puzzle/solution can embed `{ id, width, height }` before the insert. */
  id: string;
}

export function newAsset(kind: string, image: EncodedImage): AssetToInsert {
  return { ...image, kind, id: randomUUID() };
}

export type InsertOutcome = "created" | "exists";

/**
 * Writes one day's puzzle and its assets. **Never overwrites**: if the day already has a puzzle for
 * this game (written earlier, by a fixture run, or by hand) it returns "exists" and touches nothing.
 * If an asset fails to save, the new puzzle is deleted again (assets cascade) so no day is left
 * half-written. Callers validate puzzle/solution against the game's schemas before calling.
 */
export async function insertPuzzleIfAbsent(
  db: ContentDb,
  input: { gameId: string; date: PuzzleDate; puzzle: unknown; solution: unknown; assets?: readonly AssetToInsert[] },
): Promise<InsertOutcome> {
  const { gameId, date, puzzle, solution, assets = [] } = input;
  const { error } = await db.from("puzzles").insert({ game_id: gameId, puzzle_date: date, payload: puzzle as Json, solution: solution as Json });
  if (error) {
    if (error.code === "23505") return "exists"; // primary key (game_id, puzzle_date)
    throw new Error(`Couldn't save the ${gameId} puzzle for ${date}: ${error.message}`);
  }
  try {
    // One request per asset keeps each request well under PostgREST's body limit.
    for (const asset of assets) {
      const { error: assetError } = await db.from("puzzle_assets").insert({
        id: asset.id,
        game_id: gameId,
        puzzle_date: date,
        kind: asset.kind,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        bytes: toBytea(asset.bytes),
      });
      if (assetError) throw new Error(`Couldn't save ${asset.kind} asset: ${assetError.message}`);
    }
  } catch (cause) {
    // Just created, so nothing can have played it yet; deleting cascades to any saved assets.
    await db.from("puzzles").delete().eq("game_id", gameId).eq("puzzle_date", date);
    throw cause;
  }
  return "created";
}

/** `--name value` flags shared by the pipeline scripts, as positive integers. */
export function positiveInt(value: string | undefined, name: string, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return n;
}
