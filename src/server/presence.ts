import "server-only";
import type { PuzzleDate } from "@/core/day";
import { getGame } from "@/games/registry";
import { PRESENCE_FINISHED_WINDOW_MS, PRESENCE_PLAYING_WINDOW_MS, selectPresence, type PresenceItem, type PresenceRow } from "./home-assemble";
import { db } from "./supabase/admin";

/**
 * Recent activity by other players for the home's presence line ("Marco is playing Number Hunt",
 * "Sam finished Number Hunt"), in two steps so the query runs alongside the home's others:
 * `loadPresenceRows` narrows to today's plays of the viewer's visible games (so a player never
 * learns a testing game's name) inside the two time windows; `presenceItems` applies the rule, one
 * line per player and spoiler safety (`selectPresence`, unit-tested). Only ids, status and
 * timestamps are read: never a score, label, grid or state.
 */
export async function loadPresenceRows(params: {
  viewerId: string;
  /** The viewer's visible games. */
  gameIds: readonly string[];
  date: PuzzleDate;
  now: Date;
}): Promise<PresenceRow[]> {
  const { viewerId, gameIds, date, now } = params;
  if (gameIds.length === 0) return [];

  const playingSince = new Date(now.getTime() - PRESENCE_PLAYING_WINDOW_MS).toISOString();
  const finishedSince = new Date(now.getTime() - PRESENCE_FINISHED_WINDOW_MS).toISOString();
  const { data, error } = await db()
    .from("plays")
    .select("user_id, game_id, status, updated_at, finished_at")
    .eq("puzzle_date", date)
    .in("game_id", [...gameIds])
    .neq("user_id", viewerId)
    .or(`and(status.eq.in_progress,updated_at.gte.${playingSince}),finished_at.gte.${finishedSince}`);
  if (error) throw new Error(`Failed to load recent activity: ${error.message}`);
  return data;
}

export function presenceItems(
  rows: readonly PresenceRow[],
  params: {
    viewerId: string;
    /** The viewer's visible games (only these are ever named). */
    gameIds: readonly string[];
    now: Date;
    /** Player id → the home's name for them (`shortNames` of the week board, which lists every player). */
    names: ReadonlyMap<string, string>;
  },
): PresenceItem[] {
  const { viewerId, gameIds, now, names } = params;
  const gameNames = new Map(
    gameIds.flatMap((id) => {
      const game = getGame(id);
      return game ? [[id, game.name] as const] : [];
    }),
  );
  return selectPresence(rows, { viewerId, gameNames, now, names });
}
