import type { Metadata } from "next";
import { today } from "@/core/day";
import { groupByBucket } from "@/games/buckets";
import { liveGameIds, liveGames } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { getDayLabels, getLeaderboard, getStreaks, PERIODS, type Period } from "@/server/leaderboards";
import { LeaderboardView, type Scope } from "./leaderboard-view";

export const metadata: Metadata = { title: "Scores" };

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const profile = await requireProfile();
  const params = await searchParams;
  const period: Period = PERIODS.find((p) => p === params.period) ?? "today";

  // Only live games count, so only buckets with a live game get a board.
  const groups = groupByBucket(liveGames());
  const game = liveGames().find((g) => g.id === params.game);
  const group = groups.find((g) => (game ? g.bucket.id === game.bucket : g.bucket.id === params.bucket));
  const scope: Scope = !group ? { kind: "overall" } : game ? { kind: "game", ...group, game } : { kind: "bucket", ...group };

  const date = today();
  const gameIds = scope.kind === "game" ? [scope.game.id] : scope.kind === "bucket" ? scope.games.map((g) => g.id) : liveGameIds();
  const [rows, streaks, labels] = await Promise.all([
    getLeaderboard(gameIds, period, date, profile.id),
    getStreaks(gameIds, date),
    scope.kind === "game" && period === "today" ? getDayLabels(scope.game.id, date, profile.id) : Promise.resolve(undefined),
  ]);

  return <LeaderboardView groups={groups} scope={scope} period={period} rows={rows} viewerId={profile.id} streaks={streaks} labels={labels} />;
}
