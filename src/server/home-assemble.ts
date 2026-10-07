import "server-only";
import { addDays, formatPuzzleDate, today } from "@/core/day";
import { homeClock } from "@/core/daylight";
import type { AnyGame, BucketId } from "@/core/game";
import type {
  HomeBilling,
  HomeBucket,
  HomeDay,
  HomeGame,
  HomeGameState,
  HomePrimary,
  HomeProgress,
  HomeResult,
  HomeView,
  HomeViewer,
  MarkForm,
  PresenceLine,
} from "@/core/home-view";
import { shareMarkRow } from "@/core/share-marks";
import { BUCKETS, gamesInBucket } from "@/games/buckets";
import { canPlay, FULL_SCREEN_IDS } from "@/games/registry";
import type { PlayRow, ProfileRow } from "./database.types";
import type { LeaderboardRow, Streak } from "./leaderboards";
import type { PuzzleReadiness } from "./puzzles";

/**
 * Database rows in, `HomeView` out. Pure (no IO, no clock: `now` is an input), so every rule of
 * the home's data is unit-tested here; `home.ts` only fetches and calls in.
 *
 * Rules held here:
 *  - Only the viewer's visible games appear (a testing game reaching a player throws).
 *  - A result is only ever the viewer's own finished play. Presence names a player and a game,
 *    never a score, label or grid. Boards come from the spoiler-walled `leaderboard` RPC.
 *  - Progress counts every visible game (decision 9); streak and boards are live games only.
 *  - Other players are named so the viewer can tell them apart (`shortNames`).
 */

/** A play still in progress counts as "playing" if it moved this recently. */
export const PRESENCE_PLAYING_WINDOW_MS = 15 * 60 * 1000;
/** A finished play counts as "finished" for this long. */
export const PRESENCE_FINISHED_WINDOW_MS = 60 * 60 * 1000;
/**
 * Activity stamped after `now` by more than this is not mentioned: it hasn't happened at the instant
 * the view describes (a view built for another time of day in development). The allowance covers
 * plays that move while the view is being read.
 */
export const PRESENCE_FUTURE_ALLOWANCE_MS = 60 * 1000;
/** The opening's "present" card names at most this many players; above it the card is left out. */
export const CAST_MAX = 8;

/** The display name up to the first space: the viewer's own name on the home ("Hey Zoë"). */
export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

/**
 * What the home calls other people, by user id: the first name when no one else on the board
 * shares it; when some do, the first name and the last word's initial ("Sam O."), if that tells
 * them apart; otherwise "@username". Display names are unique but first names are not, and sign-up
 * is open, so a name the viewer can't tell apart from a friend's never reaches the page (the
 * boards show "@username" beside names for the same reason). Compared ignoring case, like display
 * names. `rows`: the week board, which lists every player.
 */
export function shortNames(rows: readonly Pick<LeaderboardRow, "user_id" | "username" | "display_name">[]): Map<string, string> {
  const fold = (s: string) => s.toLowerCase();
  const groups = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const key = fold(firstNameOf(row.display_name));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const names = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      names.set(group[0].user_id, firstNameOf(group[0].display_name));
      continue;
    }
    const initialed = new Map(group.map((r) => [r.user_id, withInitial(r.display_name)]));
    const count = new Map<string, number>();
    for (const name of initialed.values()) if (name) count.set(fold(name), (count.get(fold(name)) ?? 0) + 1);
    for (const r of group) {
      const name = initialed.get(r.user_id);
      names.set(r.user_id, name && count.get(fold(name)) === 1 ? name : `@${r.username}`);
    }
  }
  return names;
}

/** "Sam Okafor" → "Sam O."; null for a one-word name. */
function withInitial(displayName: string): string | null {
  const words = displayName.trim().split(/\s+/);
  if (words.length < 2) return null;
  const [initial] = Array.from(words[words.length - 1]);
  return `${words[0]} ${initial}.`;
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** The columns of the viewer's own plays the home reads (never `state`). */
export type HomePlayRow = Pick<PlayRow, "game_id" | "status" | "score" | "result_label" | "share_grid" | "finished_at">;

/** One line of recent activity by someone else (`selectPresence`), newest first. */
export interface PresenceItem {
  kind: "playing" | "finished";
  playerId: string;
  /** The home's name for the player (`shortNames`). */
  firstName: string;
  gameId: string;
  gameName: string;
  /** ISO 8601: `updated_at` for playing, `finished_at` for finished. */
  at: string;
}

export interface HomeRows {
  profile: ProfileRow;
  now: Date;
  /** `?welcome=1`: a first sign-in. */
  welcome: boolean;
  /** `visibleGames(profile.is_admin)`, registry order. */
  games: readonly AnyGame[];
  /** The viewer's plays today, by game id (`loadPlaysForDay`). */
  plays: ReadonlyMap<string, HomePlayRow>;
  /** Finished plays per game today, everyone included (`finishedCounts`). */
  finishedCounts: ReadonlyMap<string, number>;
  /** Streaks over live games (`getStreaks`). */
  streaks: ReadonlyMap<string, Streak>;
  /** This week's overall board, live games, as the viewer may see it. Lists every player. */
  weekBoard: readonly LeaderboardRow[];
  /** This week's board for each bucket with live games (its live ids only). */
  bucketBoards: ReadonlyMap<BucketId, readonly LeaderboardRow[]>;
  /** `selectPresence` output, newest first. */
  presence: readonly PresenceItem[];
  /** Curated visible games with a puzzle stored today (`puzzlesReady`). Generated games are always ready. */
  ready: ReadonlyMap<string, PuzzleReadiness>;
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export function assembleHomeView(rows: HomeRows): HomeView {
  const { profile, now } = rows;
  for (const game of rows.games) {
    // Visible games are filtered upstream; a testing game reaching a player would leak its name.
    if (!canPlay(game, profile.is_admin)) throw new Error(`${game.id} is not visible to ${profile.username}`);
  }

  const names = shortNames(rows.weekBoard);
  const buckets = BUCKETS.map((bucket): HomeBucket => {
    const games = gamesInBucket(rows.games, bucket.id).map((game) => homeGame(rows, game));
    return {
      id: bucket.id,
      name: bucket.name,
      status: games.length > 0 ? "open" : "in_production",
      testingOnly: games.length > 0 && games.every((g) => g.testing),
      leader: bucketLeader(rows.bucketBoards.get(bucket.id), profile.id, names),
      games,
    };
  });
  const ordered = buckets.flatMap((b) => b.games);
  const finishedLive = ordered.some((g) => !g.testing && g.state === "finished");
  // The spoiler wall is per game: friends' points today stay hidden on each live game the viewer
  // hasn't finished. (A game with no puzzle today has no points to hide.)
  const walled = ordered.filter((g) => !g.testing && g.state !== "finished" && g.state !== "unavailable");

  return {
    viewer: homeViewer(rows, finishedLive),
    day: homeDay(now),
    clock: homeClock(now),
    progress: homeProgress(ordered, buckets),
    buckets,
    primary: primaryAction(ordered),
    presence: presenceLine(rows.presence),
    billing: homeBilling(rows, buckets, walled, names),
    cast: castOf(rows.weekBoard, names),
    welcome: rows.welcome
      ? { firstName: firstNameOf(profile.display_name), displayName: profile.display_name, username: profile.username }
      : null,
    generatedAt: now.toISOString(),
  };
}

function homeViewer({ profile, streaks }: HomeRows, finishedLive: boolean): HomeViewer {
  const streak = streaks.get(profile.id) ?? { current: 0, best: 0 };
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    firstName: firstNameOf(profile.display_name),
    isAdmin: profile.is_admin,
    streak: { current: streak.current, best: streak.best, atRisk: streak.current > 0 && !finishedLive },
  };
}

export function homeDay(now: Date): HomeDay {
  const date = today(now);
  return {
    date,
    weekday: formatPuzzleDate(date, { weekday: "long" }),
    month: formatPuzzleDate(date, { month: "long" }),
    dayOfMonth: Number(date.slice(8, 10)),
    nextWeekday: formatPuzzleDate(addDays(date, 1), { weekday: "long" }),
  };
}

// ---------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------

function homeGame(rows: HomeRows, game: AnyGame): HomeGame {
  const play = rows.plays.get(game.id);
  const readiness = rows.ready.get(game.id);
  const par = readiness?.par ?? null;
  const state = gameState(game, play, readiness !== undefined);
  return {
    id: game.id,
    name: game.name,
    tagline: game.tagline,
    href: `/play/${game.id}`,
    testing: game.availability === "testing",
    fullScreen: FULL_SCREEN_IDS.has(game.id),
    state,
    finishedCount: rows.finishedCounts.get(game.id) ?? 0,
    form: markForm(game, par),
    result: play && state === "finished" ? homeResult(game, play, par) : null,
  };
}

function gameState(game: AnyGame, play: HomePlayRow | undefined, stored: boolean): HomeGameState {
  if (play) return play.status === "in_progress" ? "in_progress" : "finished";
  // Generated games make today's puzzle on first open; curated ones need it stored ahead of time.
  return game.generate || stored ? "not_started" : "unavailable";
}

/** The game's declared form, with today's par filled in for a chain; a generic row for games that declare none. */
export function markForm(game: AnyGame, par: number | null): MarkForm {
  const form = game.home?.form ?? { kind: "row", count: null };
  return form.kind === "chain" ? { kind: "chain", par } : form;
}

function homeResult(game: AnyGame, play: HomePlayRow, par: number | null): HomeResult {
  const { status, score, result_label: label, share_grid: grid, finished_at: finishedAt } = play;
  // The plays check constraint guarantees these on a finished play; a gap is corruption.
  if (status === "in_progress" || score === null || label === null || grid === null || finishedAt === null) {
    throw new Error(`Finished ${game.id} play is missing its score, label, grid or finish time`);
  }
  const marks = shareMarkRow(grid);
  return {
    outcome: status,
    score,
    label,
    line: game.home?.line({ outcome: status, label, marks, par }) ?? null,
    marks,
    finishedAt: iso(finishedAt),
  };
}

function homeProgress(ordered: readonly HomeGame[], buckets: readonly HomeBucket[]): HomeProgress {
  const bucketOf = new Map(buckets.flatMap((b) => b.games.map((g) => [g.id, b.id] as const)));
  const chip = (g: HomeGame) => ({ gameId: g.id, bucket: bucketOf.get(g.id)!, testing: g.testing, state: g.state });
  return {
    done: ordered.filter((g) => g.state === "finished").length,
    total: ordered.length,
    chips: [...ordered.filter((g) => !g.testing), ...ordered.filter((g) => g.testing)].map(chip),
  };
}

/** `ordered`: visible games in bucket, then registry order. */
export function primaryAction(ordered: readonly HomeGame[]): HomePrimary | null {
  const continuing = ordered.find((g) => g.state === "in_progress");
  if (continuing) return { kind: "continue", gameId: continuing.id, href: continuing.href };
  const next = ordered.find((g) => g.state === "not_started");
  if (next) return { kind: "play", gameId: next.id, href: next.href };
  if (ordered.length > 0 && ordered.every((g) => g.state === "finished")) return { kind: "standings", gameId: null, href: "/leaderboard" };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Boards, billing, cast, presence
// ---------------------------------------------------------------------------------------------

/**
 * The bucket board's leader, named from the week board's names (a bucket board is a subset of it).
 * A player missing from the week board (signed up between the two reads) is named by username.
 */
function bucketLeader(board: readonly LeaderboardRow[] | undefined, viewerId: string, names: ReadonlyMap<string, string>): HomeBucket["leader"] {
  const top = board?.find((r) => r.points > 0);
  return top ? { firstName: names.get(top.user_id) ?? `@${top.username}`, isViewer: top.user_id === viewerId } : null;
}

function homeBilling(
  { weekBoard, profile }: HomeRows,
  buckets: readonly HomeBucket[],
  walled: readonly HomeGame[],
  names: ReadonlyMap<string, string>,
): HomeBilling {
  return {
    week: weekBoard
      .filter((r) => r.points > 0)
      .map((r) => ({
        userId: r.user_id,
        firstName: names.get(r.user_id) ?? `@${r.username}`,
        points: r.points,
        rank: r.rank,
        isViewer: r.user_id === profile.id,
      })),
    leaders: buckets.flatMap((b) => (b.leader ? [{ bucketName: b.name, firstName: b.leader.firstName, isViewer: b.leader.isViewer }] : [])),
    todayWalled: walled.length > 0,
    walledGames: walled.map((g) => g.name),
  };
}

/**
 * Everyone with a finished live game this week (as the viewer may see it), by the home's names
 * (`shortNames` of the same board), alphabetical; none above `CAST_MAX`.
 */
export function castOf(weekBoard: readonly LeaderboardRow[], names: ReadonlyMap<string, string> = shortNames(weekBoard)): string[] {
  const cast = weekBoard
    .filter((r) => r.games_played > 0)
    .map((r) => names.get(r.user_id) ?? `@${r.username}`)
    .sort((a, b) => a.localeCompare(b, "en"));
  return cast.length > CAST_MAX ? [] : cast;
}

function presenceLine(items: readonly PresenceItem[]): PresenceLine | null {
  const item = items[0];
  return item ? { kind: item.kind, firstName: item.firstName, gameName: item.gameName, gameHref: `/play/${item.gameId}` } : null;
}

export type PresenceRow = Pick<PlayRow, "user_id" | "game_id" | "status" | "updated_at" | "finished_at">;

/**
 * Spoiler-safe recent activity: plays by anyone but the viewer, in games the viewer can see, that
 * are in progress and moved in the last 15 minutes ("playing") or finished in the last hour
 * ("finished"). One line per player (their newest), newest first. Players or games without a name
 * are left out rather than shown half-named.
 */
export function selectPresence(
  rows: readonly PresenceRow[],
  params: {
    viewerId: string;
    /** Visible game id → name. Anything else is never mentioned. */
    gameNames: ReadonlyMap<string, string>;
    now: Date;
    /** Player id → the home's name for them (`shortNames`). */
    names: ReadonlyMap<string, string>;
  },
): PresenceItem[] {
  const { viewerId, gameNames, now, names } = params;
  const playingSince = now.getTime() - PRESENCE_PLAYING_WINDOW_MS;
  const finishedSince = now.getTime() - PRESENCE_FINISHED_WINDOW_MS;
  const until = now.getTime() + PRESENCE_FUTURE_ALLOWANCE_MS;

  const newestByPlayer = new Map<string, PresenceItem>();
  for (const row of rows) {
    if (row.user_id === viewerId) continue;
    const gameName = gameNames.get(row.game_id);
    const firstName = names.get(row.user_id);
    if (gameName === undefined || firstName === undefined) continue;

    let item: PresenceItem | null = null;
    const base = { playerId: row.user_id, firstName, gameId: row.game_id, gameName };
    if (row.status === "in_progress") {
      if (Date.parse(row.updated_at) >= playingSince) item = { kind: "playing", ...base, at: iso(row.updated_at) };
    } else if (row.finished_at !== null && Date.parse(row.finished_at) >= finishedSince) {
      item = { kind: "finished", ...base, at: iso(row.finished_at) };
    }
    if (!item || Date.parse(item.at) > until) continue;

    const current = newestByPlayer.get(row.user_id);
    if (!current || Date.parse(item.at) > Date.parse(current.at)) newestByPlayer.set(row.user_id, item);
  }

  return [...newestByPlayer.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.playerId.localeCompare(b.playerId));
}

/** Postgres timestamps come back as "2026-10-06T14:02:11.123+00:00"; the contract says ISO 8601 (Z). */
function iso(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp from the database: ${timestamp}`);
  return new Date(ms).toISOString();
}
