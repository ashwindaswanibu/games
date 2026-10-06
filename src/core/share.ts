import { formatPuzzleDate, type PuzzleDate } from "./day";

/** The text a player pastes into the group chat. Must never contain spoilers. */
export function shareText(params: {
  appName: string;
  gameName: string;
  emoji: string;
  date: PuzzleDate;
  label: string;
  score: number;
  grid: string;
}): string {
  const { appName, gameName, emoji, date, label, score, grid } = params;
  return [`${emoji} ${gameName} · ${formatPuzzleDate(date, { month: "short", day: "numeric" })}`, `${label} · ${score} pts`, grid, `— ${appName}`]
    .filter(Boolean)
    .join("\n");
}
