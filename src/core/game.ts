import type { z } from "zod";
import type { PuzzleDate } from "./day";
import type { MarkFormSpec, ShareMarkKind } from "./home-view";
import type { Rng } from "./random";

/**
 * The contract every daily game implements. A game is pure logic over four types:
 *
 *   Puzzle   – what the player is shown (sent to the browser).
 *   Solution – what only the server knows (never sent to the browser before the play ends).
 *   State    – the player's progress. Persisted as JSON and sent to its owner, so it must not
 *              contain anything derived from the solution that the player shouldn't see yet.
 *   Move     – one player action. Arrives from the browser, so it is untrusted and validated
 *              with `moveSchema` before `applyMove` ever sees it.
 *
 * Optionally a fifth, `Resolved`: some moves need facts that aren't in the puzzle ("was this actor
 * in this film?"). Such a game registers a server module (`src/games/<id>/server.ts`, listed in
 * `src/games/server-registry.ts`) whose `resolveMove` turns the validated `Move` into a
 * `Resolved` move using read-only server lookups. `applyMove` then receives the `Resolved` move, so
 * it stays pure and is unit-tested with plain resolved moves. Games without a server module have
 * `Resolved = Move`.
 *
 * The platform handles everything else: auth, persistence, the daily seed, concurrency,
 * leaderboards, streaks, sharing and the spoiler wall.
 *
 * All functions must be pure and deterministic (no Date.now(), no Math.random()); use the
 * provided `rng` and `elapsedMs` instead. That keeps games trivially unit-testable.
 *
 * Note: members are declared with method syntax on purpose — it lets a concrete
 * `GameDefinition<MyPuzzle, ...>` be stored in the registry as an `AnyGame`.
 */
export interface GameDefinition<Puzzle, Solution, State, Move, Reveal = never, Resolved = Move> {
  /** Stable slug stored in the database. Never rename once people have played. */
  readonly id: string;
  readonly name: string;
  /** The bucket (world) the game belongs to: groups it on Today and gives it a bucket board. */
  readonly bucket: BucketId;
  /** One line on the Today screen. */
  readonly tagline: string;
  /** Short bullet points shown before the player starts. */
  readonly rules: readonly string[];
  /** Theme color for the game's card and accents (any CSS color). */
  readonly accent: string;
  readonly emoji: string;
  /**
   * `live` games appear for everyone and count on leaderboards. `testing` games are only visible
   * to admins and never count — use it while designing a new game.
   */
  readonly availability: "live" | "testing";

  readonly puzzleSchema: z.ZodType<Puzzle>;
  readonly solutionSchema: z.ZodType<Solution>;
  readonly moveSchema: z.ZodType<Move>;
  /**
   * Present exactly when the game has a server module that resolves moves. The platform validates
   * every `resolveMove` result against it before `applyMove` sees it, so a resolver bug fails loudly
   * instead of corrupting a play. A registry test enforces that this and the server module agree.
   */
  readonly resolvedMoveSchema?: z.ZodType<Resolved>;

  /**
   * Build the day's puzzle. Omit this for curated games whose puzzles are loaded into the
   * `puzzles` table ahead of time; the platform then requires a stored puzzle for the day.
   */
  generate?(ctx: { date: PuzzleDate; rng: Rng }): { puzzle: Puzzle; solution: Solution };

  initialState(puzzle: Puzzle): State;

  /**
   * Apply a validated (and, for games with a server module, resolved) move. Return `{ ok: false }`
   * to reject it without consuming a turn.
   */
  applyMove(ctx: { puzzle: Puzzle; solution: Solution; state: State; move: Resolved }): MoveResult<State>;

  outcome(ctx: { puzzle: Puzzle; solution: Solution; state: State }): Outcome;

  /** Called once, when the play finishes. */
  score(ctx: {
    puzzle: Puzzle;
    solution: Solution;
    state: State;
    outcome: FinishedOutcome;
    elapsedMs: number;
  }): ScoreResult;

  /** Spoiler-free emoji summary for the group chat, e.g. "⬇️⬆️✅". */
  shareGrid(ctx: { puzzle: Puzzle; state: State; outcome: FinishedOutcome }): string;

  /**
   * How the home draws this game: the empty form of its result mark and the line under a finished
   * result. Optional: without it the home draws a generic row of marks and the label alone. Runs on
   * the server only (the home's client code never imports a game).
   */
  readonly home?: GameHome;

  /** What to show the player about the solution once they've finished. */
  reveal?(ctx: { puzzle: Puzzle; solution: Solution }): Reveal;

  /**
   * What friends may see of a finished play beyond its score, label and share grid (for example,
   * which of a game's options the player picked). It goes to the browser of everyone who has
   * finished the same puzzle, so keep it small and share only what the results need: never a
   * player's own guesses. The platform calls it only for finished plays, and only once the viewer
   * has finished the puzzle too (the spoiler wall); a play's state never leaves the server otherwise.
   */
  friendDetail?(state: State): FriendDetail;
}

/** A value that crosses from the server to the browser as it is. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** What a game shares of one finished play with friends (see `GameDefinition.friendDetail`). */
export type FriendDetail = { readonly [key: string]: JsonValue };

/**
 * Buckets are the app's worlds. Every game lives in exactly one; bucket metadata (names, order,
 * colors) is in `src/games/buckets.ts`.
 */
export const BUCKET_IDS = ["words", "movies", "geography", "chess"] as const;
export type BucketId = (typeof BUCKET_IDS)[number];

/** A game's home entry (`GameDefinition.home`). */
export interface GameHome {
  /** The mark's layout: one slot per attempt (`count` = the game's maximum attempts). */
  readonly form: MarkFormSpec;
  /**
   * The share grid as the mark's pieces, for a game that reads its own grids (Fade to Color: a pick
   * sits in the frame it was made on, and grids from before a rule change still read). Without it,
   * `shareMarkRow(grid)`.
   */
  marks?(grid: string): ShareMarkKind[];
  /** The result in words ("Found on guess 4", "Named on reel 3"), or null to show the label alone. */
  line(result: HomeLineInput): string | null;
}

/** What a result line is written from: the viewer's finished play, as stored, plus today's puzzle facts. */
export interface HomeLineInput {
  outcome: FinishedOutcome;
  /** `result_label` as stored. */
  label: string;
  /** `share_grid` as stored. */
  grid: string;
  /** The share grid as marks (the game's own `marks`, or `shareMarkRow`). */
  marks: readonly ShareMarkKind[];
  /** Today's par, for games whose puzzle has one (Degrees); null otherwise or when unknown. */
  par: number | null;
}

export type Outcome = "in_progress" | "won" | "lost";
export type FinishedOutcome = Exclude<Outcome, "in_progress">;

export type MoveResult<State> = { ok: true; state: State } | { ok: false; error: string };

export interface ScoreResult {
  /** Normalized integer 0–100; summed across games for the overall leaderboard. */
  score: number;
  /** The game's native result, e.g. "4/7" or "1:32". Shown on per-game leaderboards. */
  label: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased registry entry
export type AnyGame = GameDefinition<any, any, any, any, any, any>;

export type PuzzleOf<G> = G extends GameDefinition<infer P, unknown, unknown, unknown, unknown, unknown> ? P : never;
export type SolutionOf<G> = G extends GameDefinition<unknown, infer S, unknown, unknown, unknown, unknown> ? S : never;
export type StateOf<G> = G extends GameDefinition<unknown, unknown, infer S, unknown, unknown, unknown> ? S : never;
/** The move the browser submits (validated by `moveSchema`). */
export type MoveOf<G> = G extends GameDefinition<unknown, unknown, unknown, infer M, unknown, unknown> ? M : never;
export type RevealOf<G> = G extends GameDefinition<unknown, unknown, unknown, unknown, infer R, unknown> ? R : never;
/** The move `applyMove` receives: the resolved move for games with a server module, else `MoveOf`. */
export type ResolvedMoveOf<G> = G extends GameDefinition<unknown, unknown, unknown, unknown, unknown, infer R> ? R : never;

/** Identity helper that gives full type inference when defining a game. */
export function defineGame<Puzzle, Solution, State, Move, Reveal = never, Resolved = Move>(
  game: GameDefinition<Puzzle, Solution, State, Move, Reveal, Resolved>,
): GameDefinition<Puzzle, Solution, State, Move, Reveal, Resolved> {
  return game;
}

export const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
