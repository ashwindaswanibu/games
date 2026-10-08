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

async function selectPuzzle(game: AnyGame, date: PuzzleDate): Promise<LoadedPuzzle | null> {
  const { data, error } = await db()
    .from("puzzles")
    .select("payload, solution")
    .eq("game_id", game.id)
    .eq("puzzle_date", date)
    .maybeSingle();
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

  const { error } = await db()
    .from("puzzles")
    .upsert(
      { game_id: game.id, puzzle_date: date, payload: puzzle as Json, solution: solution as Json },
      { onConflict: "game_id,puzzle_date", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Failed to save puzzle: ${error.message}`);

  const saved = await selectPuzzle(game, date);
  if (!saved) throw new Error(`Puzzle for ${game.id} on ${date} vanished after insert`);
  return saved;
});

/** A curated game's puzzle for the day exists; `par` is set for puzzles that carry one (Degrees: "Par is public"). */
export interface PuzzleReadiness {
  par: number | null;
}

/**
 * Which of `gameIds` have a puzzle stored for `date` (the home's "Not ready yet." for curated
 * games; generated games are always ready, so callers pass curated ids only). Reads the game id and
 * the payload's public `par` only: never the solution, never the rest of the payload.
 */
export async function puzzlesReady(date: PuzzleDate, gameIds: readonly string[]): Promise<Map<string, PuzzleReadiness>> {
  if (gameIds.length === 0) return new Map();
  const { data, error } = await db()
    .from("puzzles")
    .select("game_id, par:payload->par")
    .eq("puzzle_date", date)
    .in("game_id", [...gameIds]);
  if (error) throw new Error(`Failed to check puzzles: ${error.message}`);
  return new Map(data.map((row) => [row.game_id, { par: parPart(row.par) }]));
}

function parPart(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
