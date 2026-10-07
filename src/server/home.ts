import "server-only";
import { today } from "@/core/day";
import type { BucketId } from "@/core/game";
import type { HomeView } from "@/core/home-view";
import { BUCKETS, gamesInBucket } from "@/games/buckets";
import { liveGameIds, liveGames, visibleGames } from "@/games/registry";
import type { ProfileRow } from "./database.types";
import { assembleHomeView, shortNames } from "./home-assemble";
import { getLeaderboard, getStreaks, type LeaderboardRow } from "./leaderboards";
import { finishedCounts, loadPlaysForDay } from "./plays";
import { loadPresenceRows, presenceItems } from "./presence";
import { puzzlesReady } from "./puzzles";

/**
 * Everything the home ("/") renders for `profile`, from the database. The caller authenticates
 * first (`requireProfile()`); everything here is scoped to that profile: its visible games only,
 * boards through the spoiler-walled `leaderboard` RPC as that viewer, and no one else's results.
 * The rules that turn rows into the view live in `home-assemble.ts`.
 *
 * One round of queries, all at once: the viewer's plays, finisher counts, streaks, the week board,
 * one board per bucket with live games, recent activity and today's curated puzzles. Presence is
 * named afterwards from the week board, which lists every player (the RPC left-joins profiles).
 */
export async function getHomeView(profile: ProfileRow, opts: { welcome: boolean; now?: Date }): Promise<HomeView> {
  const now = opts.now ?? new Date();
  const date = today(now);
  const games = visibleGames(profile.is_admin);
  const live = liveGameIds();
  const liveBuckets = BUCKETS.map((b) => ({ id: b.id, liveIds: gamesInBucket(liveGames(), b.id).map((g) => g.id) })).filter(
    (b) => b.liveIds.length > 0,
  );
  // Generated games are always ready; only curated ones can be missing today's puzzle.
  const curatedIds = games.filter((g) => !g.generate).map((g) => g.id);

  const gameIds = games.map((g) => g.id);
  const [plays, counts, streaks, weekBoard, bucketBoards, activity, ready] = await Promise.all([
    loadPlaysForDay(profile.id, date),
    finishedCounts(date),
    getStreaks(live, date),
    getLeaderboard(live, "week", date, profile.id),
    Promise.all(liveBuckets.map(async (b) => [b.id, await getLeaderboard(b.liveIds, "week", date, profile.id)] as const)),
    loadPresenceRows({ viewerId: profile.id, gameIds, date, now }),
    puzzlesReady(date, curatedIds),
  ]);
  const presence = presenceItems(activity, { viewerId: profile.id, gameIds, now, names: shortNames(weekBoard) });

  return assembleHomeView({
    profile,
    now,
    welcome: opts.welcome,
    games,
    plays,
    finishedCounts: counts,
    streaks,
    weekBoard,
    bucketBoards: new Map<BucketId, readonly LeaderboardRow[]>(bucketBoards),
    presence,
    ready,
  });
}
