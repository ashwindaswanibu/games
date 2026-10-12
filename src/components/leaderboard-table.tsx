import Link from "next/link";
import { Fragment } from "react";
import type { LeaderboardRow, Streak } from "@/server/leaderboards";
import styles from "./leaderboard-table.module.css";

/**
 * Ranked list of players, set as a film's credits: rank, name, then the record in small type, the
 * points in the display face. The viewer's own line is in full ink. `labels` shows per-game native
 * results (e.g. "4/7") when given. Sits in the app's dark room (see `AppFrame`).
 */
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
  if (visible.length === 0) return <p className={styles.empty}>No players yet.</p>;

  return (
    <ol className={styles.list}>
      {visible.map((row) => {
        const played = row.games_played > 0;
        const streak = streaks?.get(row.user_id)?.current ?? 0;
        const label = labels?.get(row.user_id);
        const record = [
          `@${row.username}`,
          ...(played ? [`${row.games_played} played`, ...(row.avg_score !== null ? [`avg ${row.avg_score}`] : [])] : ["Hasn't played"]),
          ...(streak > 1 ? [`${streak}-day streak`] : []),
        ];
        return (
          <li key={row.user_id} className={styles.row} data-you={row.user_id === viewerId || undefined} data-idle={played ? undefined : true}>
            <span className={styles.rank}>{played ? row.rank : "–"}</span>
            <Link href={`/u/${row.username}`} className={styles.who}>
              <span className={styles.name}>
                {row.display_name}
                {row.user_id === viewerId && <span className={styles.you}>you</span>}
              </span>
              {/* Each part whole, so a phone wraps the record between them. */}
              <span className={styles.record}>
                {record.map((part, i) => (
                  <Fragment key={part}>
                    {i > 0 && " · "}
                    <span>{part}</span>
                  </Fragment>
                ))}
              </span>
            </Link>
            {label && <span className={styles.label}>{label}</span>}
            <span className={styles.points}>{row.points}</span>
          </li>
        );
      })}
    </ol>
  );
}
