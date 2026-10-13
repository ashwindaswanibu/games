import "server-only";
import { parsePuzzleDate, type PuzzleDate } from "@/core/day";
import type { AnyGame, JsonValue } from "@/core/game";
import type { FriendResult, MoveResponse, PlayView } from "@/core/view";
import { getGameServer } from "@/games/server-registry";
import { db } from "./supabase/admin";
import { gameServices, type GameServices } from "./game-services";
import { sealedAssets } from "./asset-seal";
import { advancePlay, parseMove } from "./move-pipeline";
import { getOrCreatePuzzle, type LoadedPuzzle } from "./puzzles";
import type { Json, PlayRow } from "./database.types";

export async function loadPlay(userId: string, gameId: string, date: PuzzleDate): Promise<PlayRow | null> {
  const { data, error } = await db()
    .from("plays")
    .select("*")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .eq("puzzle_date", date)
    .maybeSingle();
  if (error) throw new Error(`Failed to load play: ${error.message}`);
  return data;
}

/**
 * Every player's plays on one day (Today reads them once: the viewer's own, how many finished
 * each game, and the friends' results a finished game shows). Their `state` stays on the server.
 */
export async function loadDayPlays(date: PuzzleDate): Promise<PlayRow[]> {
  const { data, error } = await db().from("plays").select("*").eq("puzzle_date", date);
  if (error) throw new Error(`Failed to load plays: ${error.message}`);
  return data;
}

/** Everyone who plays, as friends' results name them. */
export async function loadPlayers(): Promise<FriendResult["profile"][]> {
  const { data, error } = await db().from("profiles").select("id, username, display_name");
  if (error) throw new Error(`Failed to load profiles: ${error.message}`);
  return data;
}

/** The only place a play is turned into what the browser sees. The solution stays here. */
export function toView(game: AnyGame, row: PlayRow, loaded: LoadedPuzzle): PlayView {
  const finished = row.status !== "in_progress";
  const reveal = finished && game.reveal ? game.reveal({ puzzle: loaded.puzzle, solution: loaded.solution }) : null;
  return {
    gameId: game.id,
    date: parsePuzzleDate(row.puzzle_date),
    version: row.version,
    status: row.status,
    puzzle: loaded.puzzle,
    state: row.state,
    result:
      finished && row.score !== null && row.result_label !== null && row.share_grid !== null
        ? { score: row.score, label: row.result_label, shareGrid: row.share_grid }
        : null,
    reveal,
    sealed: sealedAssets({ puzzle: loaded.puzzle, solution: loaded.solution, visible: [loaded.puzzle, row.state, reveal] }),
  };
}

/**
 * What the game's server module sends with `view` for its screen (`viewExtras`; Degrees' faces), or
 * undefined. Never fails: extras only save the screen asking for them itself, which it still can.
 */
async function extrasFor(game: AnyGame, view: PlayView): Promise<JsonValue | undefined> {
  const viewExtras = getGameServer(game.id)?.viewExtras;
  if (!viewExtras) return undefined;
  try {
    return await viewExtras({ puzzle: view.puzzle, state: view.state, reveal: view.reveal });
  } catch (error) {
    console.error(`${game.id}: the view's extras failed`, error);
    return undefined;
  }
}

const withExtras = (view: PlayView, extras: JsonValue | undefined): PlayView => (extras === undefined ? view : { ...view, extras });

/** A new play as the database will hold it (the table's defaults), before it's saved. */
function newPlay(userId: string, game: AnyGame, date: PuzzleDate, loaded: LoadedPuzzle): PlayRow {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    game_id: game.id,
    puzzle_date: date,
    state: game.initialState(loaded.puzzle) as Json,
    status: "in_progress",
    score: null,
    result_label: null,
    share_grid: null,
    version: 0,
    started_at: now,
    finished_at: null,
    updated_at: now,
  };
}

/**
 * The view `startPlay` returns for a play that doesn't exist yet, so a start screen can show the
 * board the moment Start is pressed while the server makes the play. It shows nothing a started
 * play wouldn't (it's built by `toView` from the same row), and nothing Today doesn't already
 * show: each game's opening (`describe` in home.ts).
 */
export async function getStartingView(userId: string, game: AnyGame, date: PuzzleDate): Promise<PlayView> {
  const loaded = await getOrCreatePuzzle(game, date);
  const view = toView(game, newPlay(userId, game, date, loaded), loaded);
  return withExtras(view, await extrasFor(game, view));
}

/** A player's play of a puzzle and the puzzle, read at once; no puzzle without a play. */
export interface PlayRead {
  row: PlayRow | null;
  loaded: LoadedPuzzle | null;
}

export async function readPlay(userId: string, game: AnyGame, date: PuzzleDate): Promise<PlayRead> {
  // Both at once: the puzzle is needed whenever there's a play.
  const puzzle = getOrCreatePuzzle(game, date);
  puzzle.catch(() => {}); // without a play, a missing puzzle is only the start screen's problem
  const row = await loadPlay(userId, game.id, date);
  return { row, loaded: row ? await puzzle : null };
}

export async function getPlayView(userId: string, game: AnyGame, date: PuzzleDate): Promise<PlayView | null> {
  const { row, loaded } = await readPlay(userId, game, date);
  if (!row || !loaded) return null;
  const view = toView(game, row, loaded);
  return withExtras(view, await extrasFor(game, view));
}

/** Idempotent: starting a play that already exists returns it unchanged. */
export async function startPlay(userId: string, game: AnyGame, date: PuzzleDate): Promise<PlayView> {
  const loaded = await getOrCreatePuzzle(game, date);
  const { data: inserted, error } = await db()
    .from("plays")
    .upsert(
      { user_id: userId, game_id: game.id, puzzle_date: date, state: game.initialState(loaded.puzzle) as Json },
      { onConflict: "user_id,game_id,puzzle_date", ignoreDuplicates: true },
    )
    .select("*");
  if (error) throw new Error(`Failed to start play: ${error.message}`);

  // Ours went in: that's the play. One was already there (another tab or device): read it.
  const row = inserted?.[0] ?? (await loadPlay(userId, game.id, date));
  if (!row) throw new Error("Play vanished after insert");
  const view = toView(game, row, loaded);
  return withExtras(view, await extrasFor(game, view));
}

/**
 * Validate, resolve and apply one move (the game-facing steps are in `move-pipeline.ts`). Moves are
 * checked against the version the client last saw, so a double-submit or a second device can't
 * apply a move twice or interleave out of order.
 */
export async function applyMove(params: {
  userId: string;
  game: AnyGame;
  date: PuzzleDate;
  expectedVersion: number;
  rawMove: unknown;
  /** The play and puzzle (`readPlay`), when the caller read them already (alongside its own checks). */
  read?: PlayRead;
  now?: Date;
  /** Injected in tests; defaults to the catalog-backed services. */
  services?: GameServices;
}): Promise<MoveResponse> {
  const { userId, game, date, expectedVersion, rawMove, now = new Date() } = params;

  const parsedMove = parseMove(game, rawMove);
  if (!parsedMove.ok) return { ok: false, reason: "invalid_move", message: "That move isn't valid." };

  const { row, loaded } = params.read ?? (await readPlay(userId, game, date));
  if (!row || !loaded) return { ok: false, reason: "not_started", message: "Start the game first." };

  const current = toView(game, row, loaded);
  if (row.status !== "in_progress") {
    return { ok: false, reason: "finished", message: "You've already finished this one.", view: current };
  }
  if (row.version !== expectedVersion) {
    return { ok: false, reason: "stale", message: "Updated from another session.", view: current };
  }

  const step = await advancePlay({
    game,
    server: getGameServer(game.id),
    services: params.services ?? gameServices(),
    puzzle: loaded.puzzle,
    solution: loaded.solution,
    state: row.state,
    move: parsedMove.move,
    elapsedMs: Math.max(0, now.getTime() - Date.parse(row.started_at)),
  });
  if (!step.ok) return { ok: false, reason: "invalid_move", message: step.error, view: current };

  const patch: Partial<PlayRow> = { state: step.state as Json, status: step.outcome, version: row.version + 1 };
  if (step.result) {
    patch.score = step.result.score;
    patch.result_label = step.result.label;
    patch.share_grid = step.result.shareGrid;
    patch.finished_at = now.toISOString();
  }

  // The new view's extras are looked up while the move saves (it's the view the save will make).
  const extras = extrasFor(game, toView(game, { ...row, ...patch }, loaded));
  const { data: updated, error } = await db()
    .from("plays")
    .update(patch)
    .eq("user_id", userId)
    .eq("game_id", game.id)
    .eq("puzzle_date", date)
    .eq("version", expectedVersion)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to save move: ${error.message}`);

  if (!updated) {
    // Lost a race with a concurrent move: hand back whatever won.
    const latest = await loadPlay(userId, game.id, date);
    return {
      ok: false,
      reason: "stale",
      message: "Updated from another session.",
      view: latest ? toView(game, latest, loaded) : undefined,
    };
  }
  return { ok: true, view: withExtras(toView(game, updated, loaded), await extras) };
}

// ---------------------------------------------------------------------------------------------
// Friends' results and the spoiler wall
// ---------------------------------------------------------------------------------------------

export type { FriendResult };

/** One player's play of a puzzle, as the friends' results load it. Its `state` stays on the server. */
export type FriendPlay = Pick<PlayRow, "user_id" | "status" | "score" | "result_label" | "share_grid" | "state">;

/**
 * Everyone's result for one game on one day — but only once the viewer has finished it
 * themselves (returns null until then). Finished players first, best score first.
 */
export async function getFriendsResults(viewerId: string, game: AnyGame, date: PuzzleDate): Promise<FriendResult[] | null> {
  const [{ data: plays, error }, profiles] = await Promise.all([
    db().from("plays").select("user_id, status, score, result_label, share_grid, state").eq("game_id", game.id).eq("puzzle_date", date),
    loadPlayers(),
  ]);
  if (error) throw new Error(`Failed to load results: ${error.message}`);
  return friendsResultsFrom({ game, viewerId, plays, profiles });
}

/**
 * The spoiler wall and what it guards (pure, for tests): null unless the viewer has finished the
 * puzzle; then everyone's result, with the game's `friendDetail` of each finished play. Nothing
 * else of a play's state is passed on.
 */
export function friendsResultsFrom(params: {
  game: Pick<AnyGame, "friendDetail">;
  viewerId: string;
  plays: readonly FriendPlay[];
  profiles: readonly FriendResult["profile"][];
}): FriendResult[] | null {
  const { game, viewerId, plays, profiles } = params;
  const byUser = new Map(plays.map((p) => [p.user_id, p]));
  const viewerPlay = byUser.get(viewerId);
  if (!viewerPlay || viewerPlay.status === "in_progress") return null;

  const statusRank = { won: 0, lost: 0, in_progress: 1, not_started: 2 } as const;
  return profiles
    .map((profile): FriendResult => {
      const play = byUser.get(profile.id);
      const detail = play && play.status !== "in_progress" ? game.friendDetail?.(play.state) : undefined;
      return {
        profile,
        status: play?.status ?? "not_started",
        score: play?.score ?? null,
        label: play?.result_label ?? null,
        shareGrid: play?.share_grid ?? null,
        ...(detail !== undefined && { detail }),
      };
    })
    .sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        (b.score ?? -1) - (a.score ?? -1) ||
        a.profile.display_name.localeCompare(b.profile.display_name),
    );
}
