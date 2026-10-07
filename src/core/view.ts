import type { ComponentType } from "react";
import type { PuzzleDate } from "./day";
import type { AnyGame, MoveOf, Outcome, PuzzleOf, RevealOf, StateOf } from "./game";

/** Everything the browser receives about one player's play of one puzzle. */
export interface PlayView<Puzzle = unknown, State = unknown, Reveal = unknown> {
  gameId: string;
  date: PuzzleDate;
  /** Optimistic-concurrency token; every move must echo the version it was made against. */
  version: number;
  status: Outcome;
  puzzle: Puzzle;
  state: State;
  result: { score: number; label: string; shareGrid: string } | null;
  /** Populated only after the play has finished. */
  reveal: Reveal | null;
}

export type MoveFailureReason =
  | "invalid_move" // rejected by the game (or malformed); nothing changed
  | "stale" // another tab/device moved first; `view` carries the latest state
  | "finished" // the play is already over
  | "not_started"
  | "day_over" // the puzzle rolled over while the player was on the page
  | "rate_limited"; // too many moves too fast; nothing changed

export type MoveResponse =
  | { ok: true; view: PlayView }
  | { ok: false; reason: MoveFailureReason; message: string; view?: PlayView };

/** Props every game's UI component receives from the platform's game host. */
export interface GameUiProps<G extends AnyGame> {
  view: PlayView<PuzzleOf<G>, StateOf<G>, RevealOf<G>>;
  /** Resolves once the server has applied (or rejected) the move; the host updates `view`. */
  submitMove(move: MoveOf<G>): Promise<{ ok: true } | { ok: false; message: string }>;
  /** True while a move is in flight; disable inputs. */
  pending: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased registry entry
export type AnyGameUi = ComponentType<GameUiProps<any>>;

/** One player's result for a puzzle, as friends see it once they have finished it themselves. */
export interface FriendResult {
  profile: { id: string; username: string; display_name: string };
  status: "not_started" | Outcome;
  score: number | null;
  label: string | null;
  shareGrid: string | null;
}

/**
 * Props for a game that owns the whole screen (no app header, nav or start card). It draws every
 * state itself, including the one before the play has started (`view` is null until `start`).
 */
export interface ImmersiveGameUiProps<G extends AnyGame> extends Omit<GameUiProps<G>, "view"> {
  view: PlayView<PuzzleOf<G>, StateOf<G>, RevealOf<G>> | null;
  start(): Promise<{ ok: true } | { ok: false; message: string }>;
  /** A platform-level problem to show (connection, rate limit, the day rolling over). */
  notice: string | null;
  date: PuzzleDate;
  viewerId: string;
  /** Everyone's results for this puzzle; null until the viewer has finished it (the spoiler wall). */
  friends: readonly FriendResult[] | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased, like AnyGameUi
export type AnyImmersiveGameUi = ComponentType<ImmersiveGameUiProps<any>>;
