import "server-only";
import type { AnyGame, FinishedOutcome, Outcome } from "@/core/game";
import { isValidScore } from "@/core/scoring";
import type { RegisteredGameServer } from "./game-server";
import type { GameServices } from "./game-services";

/**
 * The game-facing half of applying a move, with no persistence:
 *
 *   raw move → moveSchema → resolveMove (games with a server module) → resolvedMoveSchema
 *            → game.applyMove → outcome → score / share grid when the play finishes
 *
 * `plays.applyMove` wraps this with loading, the version check and the save.
 */

export type ParsedMove = { ok: true; move: unknown } | { ok: false };

/** Untrusted input from the browser → the game's move type. */
export function parseMove(game: AnyGame, rawMove: unknown): ParsedMove {
  const parsed = game.moveSchema.safeParse(rawMove);
  return parsed.success ? { ok: true, move: parsed.data } : { ok: false };
}

export interface FinishedResult {
  score: number;
  label: string;
  shareGrid: string;
}

export type AdvanceResult =
  | { ok: true; state: unknown; outcome: Outcome; result: FinishedResult | null }
  | { ok: false; error: string };

/** A game and its server module disagree about whether moves are resolved. A deploy bug. */
export class GameConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameConfigurationError";
  }
}

export async function advancePlay(params: {
  game: AnyGame;
  /** The game's registered server module, if any. */
  server: RegisteredGameServer | undefined;
  services: GameServices;
  puzzle: unknown;
  solution: unknown;
  state: unknown;
  /** Output of `parseMove`. */
  move: unknown;
  /** Time since the play started, for games that score on time. */
  elapsedMs: number;
}): Promise<AdvanceResult> {
  const { game, server, services, puzzle, solution, state, move, elapsedMs } = params;

  let applied: unknown = move;
  if (server) {
    if (server.gameId !== game.id) throw new GameConfigurationError(`Server module for ${server.gameId} was given ${game.id}`);
    if (!game.resolvedMoveSchema) {
      throw new GameConfigurationError(`${game.id} has a server module but no resolvedMoveSchema`);
    }
    const resolved = await server.resolveMove({ move, puzzle, solution, state }, services);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const checked = game.resolvedMoveSchema.safeParse(resolved.move);
    if (!checked.success) {
      throw new GameConfigurationError(`${game.id}.resolveMove() returned a move that fails resolvedMoveSchema: ${checked.error.message}`);
    }
    applied = checked.data;
  } else if (game.resolvedMoveSchema) {
    throw new GameConfigurationError(`${game.id} expects resolved moves but has no server module in src/games/server-registry.ts`);
  }

  const result = game.applyMove({ puzzle, solution, state, move: applied });
  if (!result.ok) return { ok: false, error: result.error };

  const outcome = game.outcome({ puzzle, solution, state: result.state });
  if (outcome === "in_progress") return { ok: true, state: result.state, outcome, result: null };

  const finished: FinishedOutcome = outcome;
  const { score, label } = game.score({ puzzle, solution, state: result.state, outcome: finished, elapsedMs });
  if (!isValidScore(score)) throw new Error(`${game.id}.score() returned ${score}; expected an integer 0–100`);
  const shareGrid = game.shareGrid({ puzzle, state: result.state, outcome: finished });
  return { ok: true, state: result.state, outcome, result: { score, label, shareGrid } };
}
