import "server-only";
import { weekStart, type PuzzleDate } from "@/core/day";
import { db } from "./supabase/admin";
import type { Database, PlayRow } from "./database.types";

export const PERIODS = ["today", "week", "all"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "This week", all: "All time" };

// Comfortably before the first ever puzzle.
const EPOCH = "2000-01-01" as PuzzleDate;

export function periodRange(period: Period, today: PuzzleDate): { from: PuzzleDate; to: PuzzleDate } {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "all":
      return { from: EPOCH, to: today };
  }
}

export type LeaderboardRow = Database["public"]["Functions"]["leaderboard"]["Returns"][number];

/**
 * Totals for every player over `period`, as `viewerId` may see them; pass all live game ids for the
 * overall board. Spoiler wall: another player's play of today's puzzle only counts once the viewer
 * has finished that game today (enforced in SQL).
 */
export async function getLeaderboard(gameIds: string[], period: Period, today: PuzzleDate, viewerId: string): Promise<LeaderboardRow[]> {
  const { from, to } = periodRange(period, today);
  const { data, error } = await db().rpc("leaderboard", { p_from: from, p_to: to, p_game_ids: gameIds, p_viewer: viewerId, p_today: today });
  if (error) throw new Error(`Failed to load leaderboard: ${error.message}`);
  return data;
}

export interface Streak {
  current: number;
  best: number;
}

export async function getStreaks(gameIds: string[], today: PuzzleDate): Promise<Map<string, Streak>> {
  const { data, error } = await db().rpc("streaks", { p_today: today, p_game_ids: gameIds });
  if (error) throw new Error(`Failed to load streaks: ${error.message}`);
  return new Map(data.map((s) => [s.user_id, { current: s.current_streak, best: s.best_streak }]));
}

/** The games `userId` has finished on `date`. */
export async function finishedGameIds(userId: string, date: PuzzleDate): Promise<Set<string>> {
  const { data, error } = await db().from("plays").select("game_id").eq("user_id", userId).eq("puzzle_date", date).neq("status", "in_progress");
  if (error) throw new Error(`Failed to load plays: ${error.message}`);
  return new Set(data.map((p) => p.game_id));
}

/**
 * Native result labels ("4/7") for one game on one day, keyed by user id, as `viewerId` may see
 * them: none until the viewer has finished that game that day (spoiler wall).
 */
export async function getDayLabels(gameId: string, date: PuzzleDate, viewerId: string): Promise<Map<string, string>> {
  if (!(await finishedGameIds(viewerId, date)).has(gameId)) return new Map();
  const { data, error } = await db()
    .from("plays")
    .select("user_id, result_label")
    .eq("game_id", gameId)
    .eq("puzzle_date", date)
    .not("result_label", "is", null);
  if (error) throw new Error(`Failed to load results: ${error.message}`);
  return new Map(data.map((p) => [p.user_id, p.result_label as string]));
}

export type FinishedPlay = Pick<PlayRow, "game_id" | "puzzle_date" | "status" | "score" | "result_label">;

/**
 * The spoiler wall for another player's plays: anything from `today` on is hidden unless the viewer
 * has finished that game today (`viewerFinishedToday`). Earlier days are always visible.
 */
export function hideUnfinishedToday<P extends Pick<PlayRow, "game_id" | "puzzle_date">>(
  plays: readonly P[],
  today: PuzzleDate,
  viewerFinishedToday: ReadonlySet<string>,
): P[] {
  return plays.filter((p) => p.puzzle_date < today || (p.puzzle_date === today && viewerFinishedToday.has(p.game_id)));
}

/** A player's finished plays, newest first (for the profile page), as `viewerId` may see them. */
export async function getPlayerHistory(userId: string, gameIds: string[], viewerId: string, today: PuzzleDate): Promise<FinishedPlay[]> {
  const [{ data, error }, viewerFinished] = await Promise.all([
    db()
      .from("plays")
      .select("game_id, puzzle_date, status, score, result_label")
      .eq("user_id", userId)
      .in("game_id", gameIds)
      .neq("status", "in_progress")
      .order("puzzle_date", { ascending: false }),
    userId === viewerId ? Promise.resolve(null) : finishedGameIds(viewerId, today),
  ]);
  if (error) throw new Error(`Failed to load history: ${error.message}`);
  return viewerFinished ? hideUnfinishedToday(data, today, viewerFinished) : data;
}
