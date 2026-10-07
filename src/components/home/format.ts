import type { HomeDay } from "@/core/home-view";

/** "End of Wednesday, October 7" (the FIN card sets it in mono caps). */
export function formatEndOf(day: Pick<HomeDay, "weekday" | "month" | "dayOfMonth">): string {
  return `End of ${day.weekday}, ${day.month} ${day.dayOfMonth}`;
}

/**
 * The billing's note on the spoiler wall. The wall is per game (friends' points today stay hidden
 * on each live game you haven't finished), so the note stays true however many games are live.
 */
export function walledNote(walledGames: readonly string[], liveGames: number): string | null {
  if (walledGames.length === 0) return null;
  if (liveGames <= 1) return "Today's points show once you finish a game.";
  if (walledGames.length === 1) return `Today's ${walledGames[0]} points show once you finish it.`;
  return "Today's points for each game show once you finish it.";
}
