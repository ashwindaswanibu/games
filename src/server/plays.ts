import "server-only";
import { parsePuzzleDate, type PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import type { MoveResponse, PlayView } from "@/core/view";
import { getGameServer } from "@/games/server-registry";
import { db } from "./supabase/admin";
import { gameServices, type GameServices } from "./game-services";
import { advancePlay, parseMove } from "./move-pipeline";
import { getOrCreatePuzzle, type LoadedPuzzle } from "./puzzles";
import type { Json, PlayRow, ProfileRow } from "./database.types";

const UNIQUE_VIOLATION = "23505";

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

/** All of a player's plays on one day, keyed by game id. */
export async function loadPlaysForDay(userId: string, date: PuzzleDate): Promise<Map<string, PlayRow>> {
  const { data, error } = await db().from("plays").select("*").eq("user_id", userId).eq("puzzle_date", date);
  if (error) throw new Error(`Failed to load plays: ${error.message}`);
  return new Map(data.map((p) => [p.game_id, p]));
}

/** The only place a play is turned into what the browser sees. The solution stays here. */
export function toView(game: AnyGame, row: PlayRow, loaded: LoadedPuzzle): PlayView {
  const finished = row.status !== "in_progress";
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
    reveal: finished && game.reveal ? game.reveal({ puzzle: loaded.puzzle, solution: loaded.solution }) : null,
  };
}

export async function getPlayView(userId: string, game: AnyGame, date: PuzzleDate): Promise<PlayView | null> {
  const row = await loadPlay(userId, game.id, date);
  if (!row) return null;
  return toView(game, row, await getOrCreatePuzzle(game, date));
}

/** Idempotent: starting a play that already exists returns it unchanged. */
export async function startPlay(userId: string, game: AnyGame, date: PuzzleDate): Promise<PlayView> {
  const loaded = await getOrCreatePuzzle(game, date);
  const { error } = await db()
    .from("plays")
    .insert({
      user_id: userId,
      game_id: game.id,
      puzzle_date: date,
      state: game.initialState(loaded.puzzle) as Json,
    });
  if (error && error.code !== UNIQUE_VIOLATION) throw new Error(`Failed to start play: ${error.message}`);

  const row = await loadPlay(userId, game.id, date);
  if (!row) throw new Error("Play vanished after insert");
  return toView(game, row, loaded);
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
  now?: Date;
  /** Injected in tests; defaults to the catalog-backed services. */
  services?: GameServices;
}): Promise<MoveResponse> {
  const { userId, game, date, expectedVersion, rawMove, now = new Date() } = params;

  const parsedMove = parseMove(game, rawMove);
  if (!parsedMove.ok) return { ok: false, reason: "invalid_move", message: "That move isn't valid." };

  const row = await loadPlay(userId, game.id, date);
  if (!row) return { ok: false, reason: "not_started", message: "Start the game first." };

  const loaded = await getOrCreatePuzzle(game, date);
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
  return { ok: true, view: toView(game, updated, loaded) };
}

// ---------------------------------------------------------------------------------------------
// Friends' results and the spoiler wall
// ---------------------------------------------------------------------------------------------

export interface FriendResult {
  profile: Pick<ProfileRow, "id" | "username" | "display_name">;
  status: "not_started" | PlayRow["status"];
  score: number | null;
  label: string | null;
  shareGrid: string | null;
}

/**
 * Everyone's result for one game on one day — but only once the viewer has finished it
 * themselves (returns null until then). Finished players first, best score first.
 */
export async function getFriendsResults(viewerId: string, gameId: string, date: PuzzleDate): Promise<FriendResult[] | null> {
  const [{ data: plays, error: playsError }, { data: profiles, error: profilesError }] = await Promise.all([
    db().from("plays").select("user_id, status, score, result_label, share_grid").eq("game_id", gameId).eq("puzzle_date", date),
    db().from("profiles").select("id, username, display_name"),
  ]);
  if (playsError) throw new Error(`Failed to load results: ${playsError.message}`);
  if (profilesError) throw new Error(`Failed to load profiles: ${profilesError.message}`);

  const byUser = new Map(plays.map((p) => [p.user_id, p]));
  const viewerPlay = byUser.get(viewerId);
  if (!viewerPlay || viewerPlay.status === "in_progress") return null;

  const statusRank = { won: 0, lost: 0, in_progress: 1, not_started: 2 } as const;
  return profiles
    .map((profile): FriendResult => {
      const play = byUser.get(profile.id);
      return {
        profile,
        status: play?.status ?? "not_started",
        score: play?.score ?? null,
        label: play?.result_label ?? null,
        shareGrid: play?.share_grid ?? null,
      };
    })
    .sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        (b.score ?? -1) - (a.score ?? -1) ||
        a.profile.display_name.localeCompare(b.profile.display_name),
    );
}

/** How many players have finished each game today (for the Today cards). */
export async function finishedCounts(date: PuzzleDate): Promise<Map<string, number>> {
  const { data, error } = await db().from("plays").select("game_id").eq("puzzle_date", date).neq("status", "in_progress");
  if (error) throw new Error(`Failed to count plays: ${error.message}`);
  const counts = new Map<string, number>();
  for (const { game_id } of data) counts.set(game_id, (counts.get(game_id) ?? 0) + 1);
  return counts;
}
