import Link from "next/link";
import type { LeaderboardRow, Streak } from "@/server/leaderboards";
import { Avatar } from "./ui";

/** Ranked list of players. `labels` shows per-game native results (e.g. "4/7") when given. */
export function LeaderboardTable({
  rows,
  viewerId,
  streaks,
  labels,
  limit,
}: {
  rows: LeaderboardRow[];
  viewerId: string;
  streaks?: Map<string, Streak>;
  labels?: Map<string, string>;
  limit?: number;
}) {
  const visible = limit ? rows.slice(0, limit) : rows;
  if (visible.length === 0) return <p className="py-6 text-center text-sm text-muted">No players yet.</p>;

  return (
    <ol className="divide-y divide-border">
      {visible.map((row) => {
        const played = row.games_played > 0;
        const streak = streaks?.get(row.user_id)?.current ?? 0;
        const label = labels?.get(row.user_id);
        return (
          <li key={row.user_id} className={`flex items-center gap-3 px-4 py-3 ${row.user_id === viewerId ? "bg-accent/8" : ""}`}>
            <span className={`w-6 text-center text-sm font-semibold tabular-nums ${played ? "" : "text-muted"}`}>{played ? row.rank : "–"}</span>
            <Avatar name={row.display_name} />
            <Link href={`/u/${row.username}`} className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {row.display_name}
                {row.user_id === viewerId && <span className="ml-1.5 text-xs font-normal text-muted">you</span>}
              </span>
              <span className="block text-xs text-muted">
                {played ? `${row.games_played} played${row.avg_score !== null ? ` · avg ${row.avg_score}` : ""}` : "Hasn't played"}
                {streak > 1 && ` · 🔥 ${streak}`}
              </span>
            </Link>
            {label && <span className="text-sm text-muted tabular-nums">{label}</span>}
            <span className={`w-12 text-right font-semibold tabular-nums ${played ? "" : "text-muted"}`}>{row.points}</span>
          </li>
        );
      })}
    </ol>
  );
}
