import "server-only";
import { addDays, startOfDay, type PuzzleDate } from "@/core/day";
import type { AnyGame, BucketId } from "@/core/game";
import type { HomeView } from "@/core/home-view";
import { GAMES } from "@/games/registry";
import type { ProfileRow } from "@/server/database.types";
import { assembleHomeView, type HomePlayRow, type PresenceItem } from "@/server/home-assemble";
import type { LeaderboardRow, Streak } from "@/server/leaderboards";
import type { PuzzleReadiness } from "@/server/puzzles";

/**
 * Dev-only scenarios for the home (spec §7, §13.2), so its UI can be built and reviewed without a
 * seeded database. Each is assembled by the real `assembleHomeView` from synthetic rows, so the
 * primary, progress, billing and every other rule are exactly the server's. Never imported by
 * production code; the page that renders them 404s unless HOME_QA=1 in development.
 */

export const SCENARIOS = ["A", "B", "C", "S3", "welcome", "not-ready", "last-hour"] as const;
export type Scenario = (typeof SCENARIOS)[number];

interface Play {
  status: "in_progress" | "won" | "lost";
  grid?: string;
  label?: string;
  score?: number;
  /** New York time it finished, "HH:MM". */
  at?: string;
}

interface ScenarioSpec {
  viewer: { id: string; username: string; displayName: string; isAdmin: boolean; streak: Streak };
  /** New York time of the scene, "HH:MM". */
  time: string;
  plays: Readonly<Record<string, Play>>;
  finished: Readonly<Record<string, number>>;
  presence: { firstName: string; gameId: string; kind: "playing" | "finished" } | null;
  welcome?: boolean;
  /** Curated games with no puzzle today. */
  notReady?: readonly string[];
  /** Placeholder games for the density check (S3 only). */
  extra?: boolean;
  /** Bucket leaders this week (first name). */
  leaders: Partial<Record<BucketId, string>>;
}

// Color Grade is being retired: the review stills leave it out (spec §15).
const HIDDEN = new Set(["color-grade"]);

const WEEK: readonly [string, string, number][] = [
  ["u-priya", "Priya Raman", 412],
  ["u-ashwin", "Ashwin Daswani", 380],
  ["u-dev", "Dev Kapoor", 301],
  ["u-jess", "Jess Moreau", 254],
  ["u-marco", "Marco Ruiz", 190],
  ["u-sam", "Sam Okafor", 120],
];

const ASHWIN = { id: "u-ashwin", username: "ashwin", displayName: "Ashwin Daswani", isAdmin: true, streak: { current: 12, best: 19 } };
const JESS = { id: "u-jess", username: "jess", displayName: "Jess Moreau", isAdmin: false, streak: { current: 6, best: 9 } };

const B_PLAYS: Record<string, Play> = {
  "number-hunt": { status: "won", grid: "⬆️⬇️⬆️✅", label: "4/7", score: 70, at: "09:12" },
  "fade-to-color": { status: "won", grid: "🟥🟥🟩", label: "3/10", score: 80, at: "13:36" },
  degrees: { status: "in_progress" },
};

const C_PLAYS: Record<string, Play> = {
  "number-hunt": { status: "won", grid: "⬆️⬇️⬆️✅", label: "4/7", score: 70, at: "09:12" },
  "fade-to-color": { status: "won", grid: "🟥🟥🟩", label: "3/10", score: 80, at: "13:36" },
  degrees: { status: "won", grid: "🎞🎞🎞⭐", label: "3 links · par 2", score: 85, at: "19:02" },
  "frame-by-frame": { status: "lost", grid: "🟥🟥⬛🟥🟥🟥", label: "X/6", score: 0, at: "22:41" },
};

const SPECS: Record<Scenario, ScenarioSpec> = {
  A: {
    viewer: JESS,
    time: "08:40",
    plays: {},
    finished: { "number-hunt": 2 },
    presence: { firstName: "Marco", gameId: "number-hunt", kind: "playing" },
    leaders: { words: "Priya" },
  },
  welcome: {
    viewer: { id: "u-zoe", username: "zoe", displayName: "Zoë Park", isAdmin: false, streak: { current: 0, best: 0 } },
    time: "08:40",
    plays: {},
    finished: { "number-hunt": 2 },
    presence: { firstName: "Marco", gameId: "number-hunt", kind: "playing" },
    welcome: true,
    leaders: { words: "Priya" },
  },
  B: {
    viewer: ASHWIN,
    time: "13:40",
    plays: B_PLAYS,
    finished: { "number-hunt": 4, "fade-to-color": 1 },
    presence: { firstName: "Sam", gameId: "number-hunt", kind: "playing" },
    leaders: { words: "Priya" },
  },
  "not-ready": {
    viewer: ASHWIN,
    time: "13:40",
    plays: B_PLAYS,
    finished: { "number-hunt": 4, "fade-to-color": 1 },
    presence: { firstName: "Sam", gameId: "number-hunt", kind: "playing" },
    notReady: ["frame-by-frame"],
    leaders: { words: "Priya" },
  },
  C: {
    viewer: ASHWIN,
    time: "22:50",
    plays: C_PLAYS,
    finished: { "number-hunt": 6, "fade-to-color": 1, degrees: 1, "frame-by-frame": 1 },
    presence: { firstName: "Sam", gameId: "number-hunt", kind: "finished" },
    leaders: { words: "Priya" },
  },
  "last-hour": {
    viewer: ASHWIN,
    time: "23:20",
    plays: C_PLAYS,
    finished: { "number-hunt": 6, "fade-to-color": 1, degrees: 1, "frame-by-frame": 1 },
    presence: null,
    leaders: { words: "Priya" },
  },
  S3: {
    viewer: ASHWIN,
    time: "16:05",
    plays: {
      ...B_PLAYS,
      "five-letters": { status: "won", grid: "🟥🟨🟩", label: "3/6", score: 80, at: "10:02" },
      "word-ladder": { status: "in_progress" },
      capitals: { status: "won", grid: "🟩🟩🟥🟩🟩", label: "4/5", score: 80, at: "11:40" },
    },
    finished: { "number-hunt": 5, "five-letters": 4, "fade-to-color": 1, capitals: 3 },
    presence: { firstName: "Priya", gameId: "distance", kind: "playing" },
    extra: true,
    leaders: { words: "Priya", geography: "Marco" },
  },
};

/** S3's placeholder games: plain definitions with no home form (they get the generic row). */
function placeholder(id: string, name: string, bucket: BucketId, tagline: string, count: number): AnyGame {
  return {
    id,
    name,
    bucket,
    tagline,
    rules: [],
    accent: "#000",
    emoji: "□",
    availability: "live",
    home: { form: { kind: "row", count }, line: () => null },
    generate: () => ({ puzzle: null, solution: null }),
  } as unknown as AnyGame;
}

const PLACEHOLDERS: readonly AnyGame[] = [
  placeholder("five-letters", "Five Letters", "words", "Placeholder: guess the word in six", 6),
  placeholder("word-ladder", "Word Ladder", "words", "Placeholder: one letter at a time", 5),
  placeholder("four-groups", "Four Groups", "words", "Placeholder: sixteen words, four sets", 4),
  placeholder("capitals", "Capitals", "geography", "Placeholder: five countries, five capitals", 5),
  placeholder("silhouette", "Silhouette", "geography", "Placeholder: name the country by its outline", 6),
  placeholder("distance", "Distance", "geography", "Placeholder: how far apart are they?", 5),
];

function at(date: PuzzleDate, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(startOfDay(date).getTime() + (h * 60 + m) * 60_000);
}

function board(names: readonly (readonly [string, string, number])[]): LeaderboardRow[] {
  return names.map(([id, name, points], i) => ({
    user_id: id,
    username: name.split(" ")[0].toLowerCase(),
    display_name: name,
    points,
    games_played: points > 0 ? 3 : 0,
    wins: 2,
    avg_score: 70,
    rank: i + 1,
  }));
}

/** A scenario's view, on `date` (default 2026-10-07), as the server would assemble it. */
export function fixtureView(scenario: Scenario, date: PuzzleDate = "2026-10-07" as PuzzleDate): { view: HomeView; sceneAt: number } {
  const spec = SPECS[scenario];
  const now = at(date, spec.time);
  const extra = spec.extra ? PLACEHOLDERS : [];
  const all = [...GAMES, ...extra].filter((g) => !HIDDEN.has(g.id));
  const games = spec.viewer.isAdmin ? all : all.filter((g) => g.availability === "live");
  // Keep registry order within each bucket: real games first, then the placeholders.
  const profile: ProfileRow = { id: spec.viewer.id, username: spec.viewer.username, display_name: spec.viewer.displayName, is_admin: spec.viewer.isAdmin, created_at: now.toISOString() };

  const plays = new Map<string, HomePlayRow>();
  for (const [id, p] of Object.entries(spec.plays)) {
    if (!games.some((g) => g.id === id)) continue;
    plays.set(id, {
      game_id: id,
      status: p.status,
      score: p.status === "in_progress" ? null : (p.score ?? 0),
      result_label: p.status === "in_progress" ? null : (p.label ?? ""),
      share_grid: p.status === "in_progress" ? null : (p.grid ?? ""),
      finished_at: p.status === "in_progress" ? null : at(date, p.at ?? spec.time).toISOString(),
    });
  }

  const ready = new Map<string, PuzzleReadiness>();
  for (const g of games) if (!g.generate && !spec.notReady?.includes(g.id)) ready.set(g.id, { par: g.id === "degrees" ? 2 : null });

  const week = board(WEEK);
  const bucketBoards = new Map<BucketId, LeaderboardRow[]>();
  for (const [bucket, first] of Object.entries(spec.leaders)) {
    const row = WEEK.find(([, name]) => name.startsWith(first));
    if (row) bucketBoards.set(bucket as BucketId, board([row]));
  }

  const presence: PresenceItem[] = spec.presence
    ? [
        {
          kind: spec.presence.kind,
          playerId: `u-${spec.presence.firstName.toLowerCase()}`,
          firstName: spec.presence.firstName,
          gameId: spec.presence.gameId,
          gameName: games.find((g) => g.id === spec.presence!.gameId)?.name ?? spec.presence.gameId,
          at: new Date(now.getTime() - 4 * 60_000).toISOString(),
        },
      ]
    : [];

  const view = assembleHomeView({
    profile,
    now,
    welcome: spec.welcome === true,
    games,
    plays,
    finishedCounts: new Map(Object.entries(spec.finished)),
    streaks: new Map([[spec.viewer.id, spec.viewer.streak]]),
    weekBoard: week,
    bucketBoards,
    presence,
    ready,
  });
  return { view, sceneAt: now.getTime() };
}

/** For a two-digit day or a long month: the same scenario on another date. */
export function isFixtureDate(value: string | undefined): value is PuzzleDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && addDays(value as PuzzleDate, 0) === value;
}
