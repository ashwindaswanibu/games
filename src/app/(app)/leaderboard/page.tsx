import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { Card } from "@/components/ui";
import { today } from "@/core/day";
import type { AnyGame } from "@/core/game";
import { groupByBucket, type Bucket } from "@/games/buckets";
import { liveGameIds, liveGames } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { getDayLabels, getLeaderboard, getStreaks, PERIOD_LABEL, PERIODS, type Period } from "@/server/leaderboards";

export const metadata: Metadata = { title: "Leaderboard" };

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${
        active ? "bg-fg text-bg" : "bg-surface text-muted hover:text-fg"
      }`}
    >
      {children}
    </Link>
  );
}

/** Which board is showing: everything, one bucket's games, or one game. */
type Scope = { kind: "overall" } | { kind: "bucket"; bucket: Bucket; games: AnyGame[] } | { kind: "game"; bucket: Bucket; games: AnyGame[]; game: AnyGame };

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

  const href = (target: { bucket?: string; game?: string }, p: Period) => {
    const q = new URLSearchParams();
    if (target.game) q.set("game", target.game);
    else if (target.bucket) q.set("bucket", target.bucket);
    if (p !== "today") q.set("period", p);
    const qs = q.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };
  const current = scope.kind === "game" ? { game: scope.game.id } : scope.kind === "bucket" ? { bucket: scope.bucket.id } : {};
  const accent = scope.kind === "game" ? scope.game.accent : scope.kind === "bucket" ? scope.bucket.accent : undefined;

  return (
    <div className="grid gap-5" style={accent ? ({ "--accent": accent } as CSSProperties) : undefined}>
      <h1 className="pt-2 text-3xl font-bold tracking-tight">Leaderboard</h1>

      <div className="grid gap-2">
        <nav aria-label="Board" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Tab href={href({}, period)} active={scope.kind === "overall"}>
            Overall
          </Tab>
          {groups.map(({ bucket }) => (
            <Tab key={bucket.id} href={href({ bucket: bucket.id }, period)} active={scope.kind !== "overall" && scope.bucket.id === bucket.id}>
              <span className="mr-1.5 inline-block size-2 rounded-sm align-[1px]" style={{ background: bucket.accent }} aria-hidden />
              {bucket.name}
            </Tab>
          ))}
        </nav>

        {scope.kind !== "overall" && (
          <nav aria-label={`${scope.bucket.name} games`} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Tab href={href({ bucket: scope.bucket.id }, period)} active={scope.kind === "bucket"}>
              All {scope.bucket.name}
            </Tab>
            {scope.games.map((g) => (
              <Tab key={g.id} href={href({ game: g.id }, period)} active={scope.kind === "game" && scope.game.id === g.id}>
                {g.emoji} {g.name}
              </Tab>
            ))}
          </nav>
        )}
      </div>

      <nav aria-label="Period" className="grid grid-cols-3 rounded-xl bg-surface-2 p-1 text-sm">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={href(current, p)}
            scroll={false}
            aria-current={p === period ? "page" : undefined}
            className={`rounded-lg py-1.5 text-center font-medium transition ${p === period ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </nav>

      <Card className="overflow-hidden">
        <LeaderboardTable rows={rows} viewerId={profile.id} streaks={streaks} labels={labels} />
      </Card>

      <p className="text-center text-xs text-muted">
        {scope.kind === "game"
          ? "Points are this game's 0–100 score per day."
          : scope.kind === "bucket"
            ? `Every ${scope.bucket.name} game scores 0–100 per day; this board is their sum.`
            : "Every game scores 0–100 per day; overall is the sum. Days roll over at midnight New York time."}
      </p>
    </div>
  );
}
