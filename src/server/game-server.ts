import "server-only";
import type { AnyGame, MoveOf, PuzzleOf, ResolvedMoveOf, SolutionOf, StateOf } from "@/core/game";
import type { GameServices } from "./game-services";

/**
 * Server-side half of a game, for moves that need facts the puzzle doesn't carry ("was this actor
 * in this film?"). Lives in `src/games/<id>/server.ts` (which imports "server-only") and is listed
 * in `src/games/server-registry.ts`.
 *
 * The platform runs: raw move → `moveSchema` → `resolveMove` → `resolvedMoveSchema` → pure
 * `applyMove`. Keep resolvers thin: look facts up and attach them to the move. Decisions (is it
 * correct, which clue, is the game over) belong in the pure `applyMove`, where they're unit-tested.
 */
export interface GameServer<G extends AnyGame> {
  resolveMove(ctx: ResolveContext<G>, services: GameServices): Promise<ResolveResult<ResolvedMoveOf<G>>>;
}

export interface ResolveContext<G extends AnyGame> {
  /** Already validated by the game's `moveSchema`. */
  move: MoveOf<G>;
  puzzle: PuzzleOf<G>;
  solution: SolutionOf<G>;
  state: StateOf<G>;
}

/** `{ ok: false }` rejects the move without consuming a turn; `error` is shown to the player. */
export type ResolveResult<Resolved> = { ok: true; move: Resolved } | { ok: false; error: string };

/** A type-erased server module as stored in the registry. */
export interface RegisteredGameServer {
  readonly gameId: string;
  resolveMove(
    ctx: { move: unknown; puzzle: unknown; solution: unknown; state: unknown },
    services: GameServices,
  ): Promise<ResolveResult<unknown>>;
}

/**
 * Ties a server module to its game with full type inference, then erases it for the registry.
 * `G` is inferred from `game` alone (`NoInfer`), so the resolver is contextually typed by it and
 * literal move types like `{ type: "guess" }` don't widen to `string`.
 */
export function defineGameServer<G extends AnyGame>(game: G, server: NoInfer<GameServer<G>>): RegisteredGameServer {
  return {
    gameId: game.id,
    resolveMove: (ctx, services) => server.resolveMove(ctx as ResolveContext<G>, services),
  };
}
