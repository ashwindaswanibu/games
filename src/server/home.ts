import "server-only";
import { today } from "@/core/day";
import type { BucketId } from "@/core/game";
import type { HomeView } from "@/core/home-view";
import { BUCKETS, gamesInBucket } from "@/games/buckets";
import { liveGameIds, liveGames, visibleGames } from "@/games/registry";
import type { ProfileRow } from "./database.types";
import { assembleHomeView, firstNameOf } from "./home-assemble";
import { getLeaderboard, getStreaks, type LeaderboardRow } from "./leaderboards";
import { finishedCounts, loadPlaysForDay } from "./plays";
import { getPresence } from "./presence";
import { puzzlesReady } from "./puzzles";

/**
 * Everything the home ("/") renders for `profile`, from the database. The caller authenticates
 * first (`requireProfile()`); everything here is scoped to that profile: its visible games only,
 * boards through the spoiler-walled `leaderboard` RPC as that viewer, and no one else's results.
 * The rules that turn rows into the view live in `home-assemble.ts`.
 *
 * One round of queries: the viewer's plays, finisher counts, streaks, the week board, one board per
 * bucket with live games, presence (after the week board, for names) and today's curated puzzles.
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

  // The week board lists every player (the RPC left-joins profiles), so it doubles as the name list.
  const weekQuery = getLeaderboard(live, "week", date, profile.id);
  const [plays, counts, streaks, weekBoard, bucketBoards, presence, ready] = await Promise.all([
    loadPlaysForDay(profile.id, date),
    finishedCounts(date),
    getStreaks(live, date),
    weekQuery,
    Promise.all(liveBuckets.map(async (b) => [b.id, await getLeaderboard(b.liveIds, "week", date, profile.id)] as const)),
    weekQuery.then((rows) =>
      getPresence({ viewerId: profile.id, gameIds: games.map((g) => g.id), date, now, names: firstNames(rows) }),
    ),
    puzzlesReady(date, curatedIds),
  ]);

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

function firstNames(rows: readonly LeaderboardRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.user_id, firstNameOf(r.display_name)]));
}
