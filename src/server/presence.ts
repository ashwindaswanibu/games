import "server-only";
import type { PuzzleDate } from "@/core/day";
import { getGame } from "@/games/registry";
import { PRESENCE_FINISHED_WINDOW_MS, PRESENCE_PLAYING_WINDOW_MS, selectPresence, type PresenceItem } from "./home-assemble";
import { db } from "./supabase/admin";

/**
 * Recent activity by other players for the home's presence line ("Marco is playing Number Hunt",
 * "Sam finished Number Hunt"). The query narrows to today's plays of the viewer's visible games (so
 * a player never learns a testing game's name) inside the two time windows; the rule itself, one
 * line per player and spoiler safety, lives in `selectPresence` (unit-tested). Only ids, status and
 * timestamps are read: never a score, label, grid or state.
 */
export async function getPresence(params: {
  viewerId: string;
  /** The viewer's visible games. */
  gameIds: readonly string[];
  date: PuzzleDate;
  now: Date;
  /** Player id → first name (from the week board the home already loads, which lists every player). */
  names: ReadonlyMap<string, string>;
}): Promise<PresenceItem[]> {
  const { viewerId, gameIds, date, now, names } = params;
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

  const gameNames = new Map(
    gameIds.flatMap((id) => {
      const game = getGame(id);
      return game ? [[id, game.name] as const] : [];
    }),
  );
  return selectPresence(data, { viewerId, gameNames, now, names });
}
