import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import type { PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import { createRng, type RngSeed } from "@/core/random";
import { serverEnv } from "./env";
import { db } from "./supabase/admin";
import type { Json } from "./database.types";

export class PuzzleUnavailableError extends Error {
  constructor(gameId: string, date: PuzzleDate) {
    super(`No puzzle is scheduled for ${gameId} on ${date}.`);
    this.name = "PuzzleUnavailableError";
  }
}

export interface LoadedPuzzle {
  puzzle: unknown;
  solution: unknown;
}

/** Seed derived from (secret, game, date): reproducible for us, unpredictable for players. */
export function dailySeed(gameId: string, date: PuzzleDate): RngSeed {
  const digest = createHash("sha256")
    .update(`${serverEnv().PUZZLE_SEED_SECRET}\u0000${gameId}\u0000${date}`)
    .digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4), digest.readUInt32BE(8), digest.readUInt32BE(12)];
}

function parseStored(game: AnyGame, payload: unknown, solution: unknown): LoadedPuzzle {
  return { puzzle: game.puzzleSchema.parse(payload), solution: game.solutionSchema.parse(solution) };
}

/**
 * The stored puzzle, or null. `fresh` reads it with a request of its own: during a page render,
 * Next memoizes identical GET fetches, so reading back a puzzle just inserted with the same query
 * would return the memoized "none" from before the insert.
 */
async function selectPuzzle(game: AnyGame, date: PuzzleDate, options: { fresh?: boolean } = {}): Promise<LoadedPuzzle | null> {
  let query = db().from("puzzles").select("payload, solution").eq("game_id", game.id).eq("puzzle_date", date);
  if (options.fresh) query = query.limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load puzzle: ${error.message}`);
  return data ? parseStored(game, data.payload, data.solution) : null;
}

/**
 * The puzzle for a game on a date. Stored puzzles always win (that's how curated puzzles and
 * past days stay stable across code changes); otherwise it is generated and persisted. Concurrent
 * first requests are safe: generation is deterministic and the insert ignores duplicates. Read once
 * per request (React `cache`): a play page asks for it for the view and for its images.
 */
export const getOrCreatePuzzle = cache(async (game: AnyGame, date: PuzzleDate): Promise<LoadedPuzzle> => {
  const stored = await selectPuzzle(game, date);
  if (stored) return stored;
  if (!game.generate) throw new PuzzleUnavailableError(game.id, date);

  const generated = game.generate({ date, rng: createRng(dailySeed(game.id, date)) });
  // Validate our own output too: a generator bug should fail here, not in front of players.
  const { puzzle, solution } = parseStored(game, generated.puzzle, generated.solution);

  const { data: inserted, error } = await db()
    .from("puzzles")
    .upsert(
      { game_id: game.id, puzzle_date: date, payload: puzzle as Json, solution: solution as Json },
      { onConflict: "game_id,puzzle_date", ignoreDuplicates: true },
    )
    .select("payload, solution");
  if (error) throw new Error(`Failed to save puzzle: ${error.message}`);
  // Ours went in: that's the puzzle. Someone else's won the race: read theirs.
  if (inserted?.[0]) return parseStored(game, inserted[0].payload, inserted[0].solution);

  const saved = await selectPuzzle(game, date, { fresh: true });
  if (!saved) throw new Error(`Puzzle for ${game.id} on ${date} vanished after insert`);
  return saved;
});
