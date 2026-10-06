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

/** Totals for every player over `period`; pass all live game ids for the overall board. */
export async function getLeaderboard(gameIds: string[], period: Period, today: PuzzleDate): Promise<LeaderboardRow[]> {
  const { from, to } = periodRange(period, today);
  const { data, error } = await db().rpc("leaderboard", { p_from: from, p_to: to, p_game_ids: gameIds });
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

/** Native result labels ("4/7") for one game on one day, keyed by user id. */
export async function getDayLabels(gameId: string, date: PuzzleDate): Promise<Map<string, string>> {
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

/** A player's finished plays, newest first (for the profile page). */
export async function getPlayerHistory(userId: string, gameIds: string[]): Promise<FinishedPlay[]> {
  const { data, error } = await db()
    .from("plays")
    .select("game_id, puzzle_date, status, score, result_label")
    .eq("user_id", userId)
    .in("game_id", gameIds)
    .neq("status", "in_progress")
    .order("puzzle_date", { ascending: false });
  if (error) throw new Error(`Failed to load history: ${error.message}`);
  return data;
}
