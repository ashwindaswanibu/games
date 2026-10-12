import Link from "next/link";
import type { ReactNode } from "react";
import { LeaderboardTable } from "@/components/leaderboard-table";
import type { AnyGame } from "@/core/game";
import type { Bucket } from "@/games/buckets";
import { PERIOD_LABEL, PERIODS, type LeaderboardRow, type Period, type Streak } from "@/server/leaderboards";
import frame from "../app-frame.module.css";
import styles from "./scores.module.css";

type BoardBucket = Pick<Bucket, "id" | "name">;
type BoardGame = Pick<AnyGame, "id" | "name">;

/** Which board is showing: everything, one bucket's games, or one game. */
export type Scope =
  | { kind: "overall" }
  | { kind: "bucket"; bucket: BoardBucket; games: BoardGame[] }
  | { kind: "game"; bucket: BoardBucket; games: BoardGame[]; game: BoardGame };

/** One of the page's switches, in the edge's hand: the one showing in ink, underlined. */
function Toggle({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? "page" : undefined} className={styles.toggle}>
      {children}
    </Link>
  );
}

/**
 * Scores: the title, which board (overall, a bucket, one game) over which period, the board as a
 * film's credits and what its points mean. Everything it shows comes in as props (see page.tsx).
 */
export function LeaderboardView({
  groups,
  scope,
  period,
  rows,
  viewerId,
  streaks,
  labels,
}: {
  /** The buckets with a live game, each with its live games. */
  groups: { bucket: BoardBucket; games: BoardGame[] }[];
  scope: Scope;
  period: Period;
  rows: LeaderboardRow[];
  viewerId: string;
  streaks: Map<string, Streak>;
  /** Each player's native result today, on a single game's board. */
  labels?: Map<string, string>;
}) {
  const href = (target: { bucket?: string; game?: string }, p: Period) => {
    const q = new URLSearchParams();
    if (target.game) q.set("game", target.game);
    else if (target.bucket) q.set("bucket", target.bucket);
    if (p !== "today") q.set("period", p);
    const qs = q.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };
  const current = scope.kind === "game" ? { game: scope.game.id } : scope.kind === "bucket" ? { bucket: scope.bucket.id } : {};

  return (
    <div className={styles.page}>
      <h1 className={frame.title}>Scores</h1>

      <div className={styles.switches}>
        <nav aria-label="Board" className={styles.boards}>
          <Toggle href={href({}, period)} active={scope.kind === "overall"}>
            Overall
          </Toggle>
          {groups.map(({ bucket }) => (
            <Toggle key={bucket.id} href={href({ bucket: bucket.id }, period)} active={scope.kind !== "overall" && scope.bucket.id === bucket.id}>
              {bucket.name}
            </Toggle>
          ))}
        </nav>

        {scope.kind !== "overall" && (
          <nav aria-label={`${scope.bucket.name} games`} className={styles.games}>
            <Toggle href={href({ bucket: scope.bucket.id }, period)} active={scope.kind === "bucket"}>
              All {scope.bucket.name}
            </Toggle>
            {scope.games.map((g) => (
              <Toggle key={g.id} href={href({ game: g.id }, period)} active={scope.kind === "game" && scope.game.id === g.id}>
                {g.name}
              </Toggle>
            ))}
          </nav>
        )}

        <nav aria-label="Period" className={styles.periods}>
          {PERIODS.map((p) => (
            <Toggle key={p} href={href(current, p)} active={p === period}>
              {PERIOD_LABEL[p]}
            </Toggle>
          ))}
        </nav>
      </div>

      <LeaderboardTable rows={rows} viewerId={viewerId} streaks={streaks} labels={labels} />

      <p className={styles.note}>
        {scope.kind === "game"
          ? "Points are this game's 0–100 score per day."
          : scope.kind === "bucket"
            ? `Every ${scope.bucket.name} game scores 0–100 per day; this board is their sum.`
            : "Every game scores 0–100 per day; overall is the sum. Days roll over at midnight New York time."}
      </p>
    </div>
  );
}
