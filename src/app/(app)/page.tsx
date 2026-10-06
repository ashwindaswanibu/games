import Link from "next/link";
import type { CSSProperties } from "react";
import { Countdown } from "@/components/countdown";
import { GameCard } from "@/components/game-card";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { Card, SectionTitle } from "@/components/ui";
import { formatPuzzleDate, nextRollover, today } from "@/core/day";
import { groupByBucket } from "@/games/buckets";
import { liveGameIds, visibleGames } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { getLeaderboard, getStreaks } from "@/server/leaderboards";
import { finishedCounts, loadPlaysForDay } from "@/server/plays";

export default async function TodayPage() {
  const profile = await requireProfile();
  const date = today();
  const games = visibleGames(profile.is_admin);
  const liveIds = liveGameIds();

  const [plays, counts, board, streaks] = await Promise.all([
    loadPlaysForDay(profile.id, date),
    finishedCounts(date),
    getLeaderboard(liveIds, "today", date),
    getStreaks(liveIds, date),
  ]);

  const finishedToday = liveIds.filter((id) => {
    const p = plays.get(id);
    return p && p.status !== "in_progress";
  }).length;
  const myStreak = streaks.get(profile.id)?.current ?? 0;

  return (
    <div className="grid gap-8">
      <section className="grid gap-1 pt-2">
        <p className="text-sm text-muted">{formatPuzzleDate(date, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="text-3xl font-bold tracking-tight">Hey {profile.display_name.split(" ")[0]} 👋</h1>
        <p className="text-sm text-muted">
          {finishedToday} of {liveIds.length} done today
          {myStreak > 0 && ` · 🔥 ${myStreak}-day streak`}
          {" · "}next puzzles in <Countdown target={nextRollover().toISOString()} />
        </p>
      </section>

      {games.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">No games yet — they&apos;re being designed.</Card>
      ) : (
        groupByBucket(games).map(({ bucket, games: bucketGames }) => (
          <section key={bucket.id} aria-labelledby={`bucket-${bucket.id}`} style={{ "--accent": bucket.accent } as CSSProperties}>
            <SectionTitle
              id={`bucket-${bucket.id}`}
              action={<span className="text-xs text-muted">{bucket.tagline}</span>}
            >
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm bg-accent" aria-hidden />
                {bucket.name}
              </span>
            </SectionTitle>
            <div className="grid gap-3">
              {bucketGames.map((game) => (
                <GameCard key={game.id} game={game} play={plays.get(game.id)} finishedCount={counts.get(game.id) ?? 0} />
              ))}
            </div>
          </section>
        ))
      )}

      <section>
        <SectionTitle
          action={
            <Link href="/leaderboard" className="text-xs font-medium text-muted hover:text-fg">
              Full board →
            </Link>
          }
        >
          Today&apos;s standings
        </SectionTitle>
        <Card className="overflow-hidden">
          <LeaderboardTable rows={board} viewerId={profile.id} streaks={streaks} limit={5} />
        </Card>
      </section>
    </div>
  );
}
