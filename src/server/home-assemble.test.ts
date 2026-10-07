import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parsePuzzleDate } from "@/core/day";
import { defineGame, type AnyGame, type BucketId, type GameHome } from "@/core/game";
import type { HomeGame } from "@/core/home-view";
import { BUCKETS } from "@/games/buckets";
import { FULL_SCREEN_IDS, liveGames, visibleGames } from "@/games/registry";
import type { ProfileRow } from "./database.types";
import {
  assembleHomeView,
  castOf,
  CAST_MAX,
  firstNameOf,
  homeDay,
  primaryAction,
  selectPresence,
  shortNames,
  type HomePlayRow,
  type HomeRows,
  type PresenceItem,
  type PresenceRow,
} from "./home-assemble";
import type { LeaderboardRow } from "./leaderboards";

// ---------------------------------------------------------------------------------------------
// Fixtures: stand-in games, so these rules don't depend on which games are registered today.
// ---------------------------------------------------------------------------------------------

function fakeGame(
  id: string,
  opts: { bucket: BucketId; availability?: "live" | "testing"; curated?: boolean; home?: GameHome | null },
): AnyGame {
  const any = z.any();
  return defineGame({
    id,
    name: `Game ${id}`,
    bucket: opts.bucket,
    tagline: `Tagline of ${id}`,
    rules: [],
    accent: "#000000",
    emoji: "🎲",
    availability: opts.availability ?? "live",
    puzzleSchema: any,
    solutionSchema: any,
    moveSchema: any,
    ...(opts.curated ? {} : { generate: () => ({ puzzle: {}, solution: {} }) }),
    initialState: () => ({}),
    applyMove: ({ state }) => ({ ok: true, state }),
    outcome: () => "in_progress",
    score: () => ({ score: 0, label: "" }),
    shareGrid: () => "",
    ...(opts.home === null ? {} : { home: opts.home ?? { form: { kind: "slots", count: 7 }, line: ({ marks }) => `Line of ${marks.length}` } }),
  });
}

const WORDS_A = fakeGame("words-a", { bucket: "words" });
const MOVIES_LIVE = fakeGame("movies-live", { bucket: "movies" });
const MOVIES_TEST = fakeGame("movies-test", { bucket: "movies", availability: "testing", curated: true });
const CHAIN = fakeGame("chain-game", {
  bucket: "movies",
  availability: "testing",
  curated: true,
  home: { form: { kind: "chain" }, line: ({ par }) => (par === null ? null : `par was ${par}`) },
});
const GEO_TEST = fakeGame("geo-test", { bucket: "geography", availability: "testing" });
const NO_HOME = fakeGame("no-home", { bucket: "words", home: null });

const ADMIN_GAMES = [WORDS_A, MOVIES_LIVE, MOVIES_TEST, CHAIN, GEO_TEST];
const PLAYER_GAMES = ADMIN_GAMES.filter((g) => g.availability === "live");

const NOW = new Date("2026-10-07T17:40:00Z"); // Wednesday 13:40 in New York
const DATE = "2026-10-07";

const profile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  id: "viewer",
  username: "ashwin",
  display_name: "Ashwin Daswani",
  is_admin: true,
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

const finishedPlay = (game_id: string, overrides: Partial<HomePlayRow> = {}): HomePlayRow => ({
  game_id,
  status: "won",
  score: 70,
  result_label: "4/7",
  share_grid: "⬆️⬇️⬆️✅",
  finished_at: "2026-10-07T16:02:11.123+00:00",
  ...overrides,
});
const startedPlay = (game_id: string): HomePlayRow => ({
  game_id,
  status: "in_progress",
  score: null,
  result_label: null,
  share_grid: null,
  finished_at: null,
});

const boardRow = (user_id: string, display_name: string, points: number, games_played: number, rank: number): LeaderboardRow => ({
  user_id,
  username: user_id,
  display_name,
  points,
  games_played,
  wins: games_played,
  avg_score: games_played ? points / games_played : null,
  rank,
});

function rows(overrides: Partial<HomeRows> = {}): HomeRows {
  return {
    profile: profile(),
    now: NOW,
    welcome: false,
    games: ADMIN_GAMES,
    plays: new Map(),
    finishedCounts: new Map(),
    streaks: new Map(),
    weekBoard: [],
    bucketBoards: new Map(),
    presence: [],
    ready: new Map(),
    ...overrides,
  };
}

const plays = (...list: HomePlayRow[]) => new Map(list.map((p) => [p.game_id, p]));
const ready = (...ids: string[]) => new Map(ids.map((id) => [id, { par: null }]));
const gameOf = (view: ReturnType<typeof assembleHomeView>, id: string) => view.buckets.flatMap((b) => b.games).find((g) => g.id === id)!;

// ---------------------------------------------------------------------------------------------

describe("assembleHomeView: shape", () => {
  it("always lists all four buckets in BUCKETS order, open or in production", () => {
    const view = assembleHomeView(rows({ profile: profile({ is_admin: false }), games: PLAYER_GAMES }));
    expect(view.buckets.map((b) => b.id)).toEqual(BUCKETS.map((b) => b.id));
    expect(view.buckets.map((b) => b.status)).toEqual(["open", "open", "in_production", "in_production"]);
    expect(view.buckets.find((b) => b.id === "chess")!.games).toEqual([]);
  });

  it("refuses to put a testing game in a player's view", () => {
    expect(() => assembleHomeView(rows({ profile: profile({ is_admin: false }), games: ADMIN_GAMES }))).toThrow(/not visible/);
  });

  it("marks testing-only buckets (admin) and keeps registry order inside a bucket", () => {
    const view = assembleHomeView(rows());
    const movies = view.buckets.find((b) => b.id === "movies")!;
    expect(movies.games.map((g) => g.id)).toEqual(["movies-live", "movies-test", "chain-game"]);
    expect(movies.testingOnly).toBe(false);
    expect(view.buckets.find((b) => b.id === "geography")!.testingOnly).toBe(true);
    expect(view.buckets.find((b) => b.id === "chess")!.testingOnly).toBe(false);
  });

  it("describes the day, the clock and the viewer", () => {
    const view = assembleHomeView(rows());
    expect(view.day).toEqual({ date: DATE, weekday: "Wednesday", month: "October", dayOfMonth: 7, nextWeekday: "Thursday" });
    expect(view.clock.timeZone).toBe("America/New_York");
    expect(view.clock.dayStartsAt).toBe("2026-10-07T04:00:00.000Z");
    expect(view.clock.rollsOverAt).toBe("2026-10-08T04:00:00.000Z");
    expect(Date.parse(view.clock.dawnAt)).toBeLessThan(Date.parse(view.clock.noonAt));
    expect(Date.parse(view.clock.noonAt)).toBeLessThan(Date.parse(view.clock.duskAt));
    expect(view.generatedAt).toBe(NOW.toISOString());
    expect(view.viewer).toMatchObject({ id: "viewer", username: "ashwin", displayName: "Ashwin Daswani", firstName: "Ashwin", isAdmin: true });
  });

  it("reads the day in New York, not UTC", () => {
    expect(homeDay(new Date("2026-10-08T03:30:00Z"))).toMatchObject({ date: "2026-10-07", weekday: "Wednesday", dayOfMonth: 7 });
    expect(homeDay(new Date("2026-12-31T05:00:00Z"))).toMatchObject({ month: "December", dayOfMonth: 31, nextWeekday: "Friday" });
  });

  it("is plain JSON (it crosses into a client component)", () => {
    const view = assembleHomeView(rows({ plays: plays(finishedPlay("words-a")), welcome: true }));
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("assembleHomeView: games", () => {
  it("maps plays and puzzle readiness to states", () => {
    const view = assembleHomeView(
      rows({ plays: plays(finishedPlay("words-a"), startedPlay("movies-live")), ready: ready("movies-test") }),
    );
    expect(gameOf(view, "words-a").state).toBe("finished");
    expect(gameOf(view, "movies-live").state).toBe("in_progress");
    expect(gameOf(view, "movies-test").state).toBe("not_started"); // curated, stored today
    expect(gameOf(view, "chain-game").state).toBe("unavailable"); // curated, nothing stored
    expect(gameOf(view, "geo-test").state).toBe("not_started"); // generated: always ready
  });

  it("builds the viewer's result from the stored play, with the game's own line", () => {
    const view = assembleHomeView(rows({ plays: plays(finishedPlay("words-a")) }));
    expect(gameOf(view, "words-a").result).toEqual({
      outcome: "won",
      score: 70,
      label: "4/7",
      line: "Line of 4",
      marks: ["up", "down", "up", "hit"],
      finishedAt: "2026-10-07T16:02:11.123Z",
    });
    expect(gameOf(view, "movies-live").result).toBeNull();
  });

  it("carries name, tagline, href, testing and finisher counts", () => {
    const view = assembleHomeView(rows({ finishedCounts: new Map([["words-a", 4]]) }));
    expect(gameOf(view, "words-a")).toMatchObject({
      id: "words-a",
      name: "Game words-a",
      tagline: "Tagline of words-a",
      href: "/play/words-a",
      testing: false,
      finishedCount: 4,
    });
    expect(gameOf(view, "movies-test")).toMatchObject({ testing: true, finishedCount: 0 });
  });

  it("flags full-screen games from FULL_SCREEN_IDS", () => {
    const fullId = [...FULL_SCREEN_IDS][0];
    const full = fakeGame(fullId, { bucket: "movies" });
    const view = assembleHomeView(rows({ games: [WORDS_A, full] }));
    expect(gameOf(view, fullId).fullScreen).toBe(true);
    expect(gameOf(view, "words-a").fullScreen).toBe(false);
  });

  it("fills a chain's par from today's puzzle, and passes it to the result line", () => {
    const parReady = new Map([["chain-game", { par: 2 }]]);
    const notStarted = assembleHomeView(rows({ ready: parReady }));
    expect(gameOf(notStarted, "chain-game").form).toEqual({ kind: "chain", par: 2 });

    const finished = assembleHomeView(
      rows({
        ready: parReady,
        plays: plays(finishedPlay("chain-game", { result_label: "3 links · par 2", share_grid: "🎞🎞🎞⭐", score: 85 })),
      }),
    );
    expect(gameOf(finished, "chain-game").result).toMatchObject({ label: "3 links · par 2", line: "par was 2", marks: ["link", "link", "link", "win"] });

    const unavailable = assembleHomeView(rows());
    expect(gameOf(unavailable, "chain-game").form).toEqual({ kind: "chain", par: null });
  });

  it("falls back to a generic row and no line for a game without a home entry", () => {
    const view = assembleHomeView(rows({ games: [NO_HOME], plays: plays(finishedPlay("no-home")) }));
    expect(gameOf(view, "no-home").form).toEqual({ kind: "row", count: null });
    expect(gameOf(view, "no-home").result!.line).toBeNull();
  });

  it("refuses a finished play missing its result columns", () => {
    expect(() => assembleHomeView(rows({ plays: plays(finishedPlay("words-a", { share_grid: null })) }))).toThrow(/missing/);
  });
});

describe("assembleHomeView: progress", () => {
  const somePlays = plays(finishedPlay("words-a"), finishedPlay("movies-test"), startedPlay("movies-live"));

  it("counts every visible game for an admin (testing included), live chips first", () => {
    const view = assembleHomeView(rows({ plays: somePlays }));
    expect(view.progress.done).toBe(2);
    expect(view.progress.total).toBe(5);
    expect(view.progress.chips).toEqual([
      { gameId: "words-a", bucket: "words", testing: false, state: "finished" },
      { gameId: "movies-live", bucket: "movies", testing: false, state: "in_progress" },
      { gameId: "movies-test", bucket: "movies", testing: true, state: "finished" },
      { gameId: "chain-game", bucket: "movies", testing: true, state: "unavailable" },
      { gameId: "geo-test", bucket: "geography", testing: true, state: "not_started" },
    ]);
  });

  it("counts only live games for a player", () => {
    const view = assembleHomeView(
      rows({ profile: profile({ is_admin: false }), games: PLAYER_GAMES, plays: plays(finishedPlay("words-a")) }),
    );
    expect(view.progress).toMatchObject({ done: 1, total: 2 });
    expect(view.progress.chips.map((c) => c.gameId)).toEqual(["words-a", "movies-live"]);
  });
});

describe("primaryAction", () => {
  const g = (id: string, state: HomeGame["state"]) => ({ id, href: `/play/${id}` as const, state }) as HomeGame;

  it("continues the first game in progress, before any unstarted one", () => {
    expect(primaryAction([g("a", "not_started"), g("b", "finished"), g("c", "in_progress"), g("d", "in_progress")])).toEqual({
      kind: "continue",
      gameId: "c",
      href: "/play/c",
    });
  });

  it("otherwise plays the first unstarted game, skipping games that aren't ready", () => {
    expect(primaryAction([g("a", "finished"), g("b", "unavailable"), g("c", "not_started")])).toEqual({ kind: "play", gameId: "c", href: "/play/c" });
  });

  it("offers today's standings when every game is finished", () => {
    expect(primaryAction([g("a", "finished"), g("b", "finished")])).toEqual({ kind: "standings", gameId: null, href: "/leaderboard" });
  });

  it("is null when the rest aren't ready, or there are no games", () => {
    expect(primaryAction([g("a", "finished"), g("b", "unavailable")])).toBeNull();
    expect(primaryAction([])).toBeNull();
  });

  it("follows bucket order, then registry order, in the assembled view", () => {
    // geo-test is not started, but words-a (Words comes first) wins.
    const view = assembleHomeView(rows({ ready: ready("movies-test") }));
    expect(view.primary).toEqual({ kind: "play", gameId: "words-a", href: "/play/words-a" });
    const allDone = assembleHomeView(
      rows({ games: [WORDS_A, MOVIES_LIVE], plays: plays(finishedPlay("words-a"), finishedPlay("movies-live")) }),
    );
    expect(allDone.primary?.kind).toBe("standings");
  });
});

describe("assembleHomeView: streak", () => {
  const streaks = new Map([["viewer", { current: 6, best: 9 }]]);

  it("is at risk while the viewer has no finished live game today", () => {
    expect(assembleHomeView(rows({ streaks })).viewer.streak).toEqual({ current: 6, best: 9, atRisk: true });
    // A finished testing game doesn't count: streaks are live-only.
    expect(assembleHomeView(rows({ streaks, plays: plays(finishedPlay("movies-test")) })).viewer.streak.atRisk).toBe(true);
    expect(assembleHomeView(rows({ streaks, plays: plays(finishedPlay("words-a")) })).viewer.streak.atRisk).toBe(false);
  });

  it("is never at risk at zero (a first-day player)", () => {
    expect(assembleHomeView(rows()).viewer.streak).toEqual({ current: 0, best: 0, atRisk: false });
  });
});

describe("assembleHomeView: billing, leaders, cast", () => {
  const week = [
    boardRow("priya", "Priya Shah", 240, 3, 1),
    boardRow("viewer", "Ashwin Daswani", 180, 3, 2),
    boardRow("marco", "Marco", 60, 1, 3),
    boardRow("sam", "Sam Lee", 0, 1, 4), // played, scored 0
    boardRow("dev", "Dev", 0, 0, 4),
  ];

  it("lists this week's scorers only, in board order, marking the viewer", () => {
    const { billing } = assembleHomeView(rows({ weekBoard: week }));
    expect(billing.week).toEqual([
      { userId: "priya", firstName: "Priya", points: 240, rank: 1, isViewer: false },
      { userId: "viewer", firstName: "Ashwin", points: 180, rank: 2, isViewer: true },
      { userId: "marco", firstName: "Marco", points: 60, rank: 3, isViewer: false },
    ]);
  });

  it("walls today's points until the viewer finishes the live game", () => {
    const games = [WORDS_A, MOVIES_TEST];
    expect(assembleHomeView(rows({ games })).billing).toMatchObject({ todayWalled: true, walledGames: ["Game words-a"] });
    // Testing games aren't on the boards, so finishing one changes nothing.
    expect(assembleHomeView(rows({ games, plays: plays(finishedPlay("movies-test")) })).billing.todayWalled).toBe(true);
    expect(assembleHomeView(rows({ games, plays: plays(finishedPlay("words-a")) })).billing).toMatchObject({ todayWalled: false, walledGames: [] });
  });

  it("walls each live game on its own: finishing one leaves the other's points hidden", () => {
    const games = [WORDS_A, MOVIES_LIVE, MOVIES_TEST];
    const view = (p: Map<string, HomePlayRow>) => assembleHomeView(rows({ games, plays: p, ready: ready("movies-test") })).billing;
    // Bucket order: Words, then Movies.
    expect(view(plays())).toMatchObject({ todayWalled: true, walledGames: ["Game words-a", "Game movies-live"] });
    expect(view(plays(finishedPlay("words-a")))).toMatchObject({ todayWalled: true, walledGames: ["Game movies-live"] });
    expect(view(plays(finishedPlay("words-a"), startedPlay("movies-live")))).toMatchObject({ walledGames: ["Game movies-live"] });
    expect(view(plays(finishedPlay("words-a"), finishedPlay("movies-live")))).toMatchObject({ todayWalled: false, walledGames: [] });
  });

  it("doesn't wall a live game with no puzzle today (there are no points to hide)", () => {
    const curated = fakeGame("curated-live", { bucket: "movies", curated: true });
    const billing = assembleHomeView(rows({ games: [WORDS_A, curated], plays: plays(finishedPlay("words-a")) })).billing;
    expect(billing).toMatchObject({ todayWalled: false, walledGames: [] });
  });

  it("keys the billing by player, so two players tied on points stay two", () => {
    const tied = [boardRow("sam-o", "Sam Okafor", 300, 3, 1), boardRow("sam-l", "Sam Lee", 300, 3, 1)];
    const { billing } = assembleHomeView(rows({ weekBoard: tied }));
    expect(billing.week.map((s) => [s.userId, s.firstName, s.rank])).toEqual([
      ["sam-o", "Sam O.", 1],
      ["sam-l", "Sam L.", 1],
    ]);
    expect(new Set(billing.week.map((s) => s.userId)).size).toBe(2);
  });

  it("names each live bucket's leader (first row with points), in bucket order", () => {
    const bucketBoards = new Map<BucketId, LeaderboardRow[]>([
      ["movies", [boardRow("viewer", "Ashwin Daswani", 90, 1, 1), boardRow("priya", "Priya Shah", 10, 1, 2)]],
      ["words", [boardRow("priya", "Priya Shah", 150, 2, 1), boardRow("viewer", "Ashwin Daswani", 90, 2, 2)]],
    ]);
    const view = assembleHomeView(rows({ bucketBoards, weekBoard: week }));
    expect(view.buckets.find((b) => b.id === "words")!.leader).toEqual({ firstName: "Priya", isViewer: false });
    expect(view.buckets.find((b) => b.id === "movies")!.leader).toEqual({ firstName: "Ashwin", isViewer: true });
    expect(view.buckets.find((b) => b.id === "geography")!.leader).toBeNull(); // no live games, no board
    expect(view.billing.leaders).toEqual([
      { bucketName: "Words", firstName: "Priya", isViewer: false },
      { bucketName: "Movies", firstName: "Ashwin", isViewer: true },
    ]);
  });

  it("has no leader when nobody scored this week", () => {
    const bucketBoards = new Map<BucketId, LeaderboardRow[]>([["words", [boardRow("priya", "Priya", 0, 1, 1)]]]);
    expect(assembleHomeView(rows({ bucketBoards })).buckets[0].leader).toBeNull();
  });

  it("casts everyone who finished a live game this week, alphabetically", () => {
    expect(castOf(week)).toEqual(["Ashwin", "Marco", "Priya", "Sam"]);
    expect(assembleHomeView(rows({ weekBoard: week })).cast).toEqual(["Ashwin", "Marco", "Priya", "Sam"]);
  });

  it("leaves the cast out above eight players", () => {
    const crowd = (n: number) => Array.from({ length: n }, (_, i) => boardRow(`p${i}`, `Player${String.fromCharCode(65 + i)}`, 10, 1, 1));
    expect(castOf(crowd(CAST_MAX))).toHaveLength(CAST_MAX);
    expect(castOf(crowd(CAST_MAX + 1))).toEqual([]);
  });
});

describe("assembleHomeView: welcome and presence", () => {
  it("welcomes a first sign-in only", () => {
    expect(assembleHomeView(rows()).welcome).toBeNull();
    expect(assembleHomeView(rows({ welcome: true, profile: profile({ display_name: "Zoë Park", username: "zoe" }) })).welcome).toEqual({
      firstName: "Zoë",
      displayName: "Zoë Park",
      username: "zoe",
    });
  });

  it("shows the newest presence item, or nothing", () => {
    const items: PresenceItem[] = [
      { kind: "playing", playerId: "marco", firstName: "Marco", gameId: "words-a", gameName: "Game words-a", at: "2026-10-07T17:39:00.000Z" },
      { kind: "finished", playerId: "sam", firstName: "Sam", gameId: "words-a", gameName: "Game words-a", at: "2026-10-07T17:20:00.000Z" },
    ];
    expect(assembleHomeView(rows({ presence: items })).presence).toEqual({
      kind: "playing",
      firstName: "Marco",
      gameName: "Game words-a",
      gameHref: "/play/words-a",
    });
    expect(assembleHomeView(rows()).presence).toBeNull();
  });
});

describe("selectPresence", () => {
  const names = new Map([
    ["marco", "Marco"],
    ["sam", "Sam"],
    ["viewer", "Ashwin"],
    ["jess", "Jess"],
  ]);
  const gameNames = new Map([
    ["words-a", "Number Hunt"],
    ["movies-live", "Degrees"],
  ]);
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const playing = (user_id: string, game_id: string, minutes: number): PresenceRow => ({ user_id, game_id, status: "in_progress", updated_at: ago(minutes), finished_at: null });
  const done = (user_id: string, game_id: string, minutes: number): PresenceRow => ({ user_id, game_id, status: "won", updated_at: ago(minutes), finished_at: ago(minutes) });
  const select = (rowsIn: PresenceRow[]) => selectPresence(rowsIn, { viewerId: "viewer", gameNames, now: NOW, names });

  it("keeps players active in the last 15 minutes and finishes in the last hour, newest first", () => {
    const out = select([playing("marco", "words-a", 3), done("sam", "words-a", 40), playing("jess", "words-a", 20), done("jess", "movies-live", 75)]);
    expect(out.map((i) => [i.kind, i.firstName, i.gameName])).toEqual([
      ["playing", "Marco", "Number Hunt"],
      ["finished", "Sam", "Number Hunt"],
    ]);
  });

  it("is one line per player (their newest), never the viewer, never an unknown game or player", () => {
    const out = select([
      done("marco", "words-a", 30),
      playing("marco", "movies-live", 2),
      playing("viewer", "words-a", 1),
      playing("sam", "secret-testing-game", 1),
      playing("stranger", "words-a", 1),
    ]);
    expect(out).toEqual([{ kind: "playing", playerId: "marco", firstName: "Marco", gameId: "movies-live", gameName: "Degrees", at: ago(2) }]);
  });

  it("leaves out activity stamped after the view's instant (beyond a minute's allowance)", () => {
    const out = select([playing("marco", "words-a", -30), done("sam", "words-a", -0.5), done("jess", "words-a", 10)]);
    expect(out.map((i) => i.firstName)).toEqual(["Sam", "Jess"]);
  });

  it("never carries a score, label or grid", () => {
    const [item] = select([done("sam", "words-a", 5)]);
    expect(Object.keys(item).sort()).toEqual(["at", "firstName", "gameId", "gameName", "kind", "playerId"]);
  });
});

describe("shortNames", () => {
  const named = (...list: [string, string][]) => shortNames(list.map(([username, display_name]) => ({ user_id: `id-${username}`, username, display_name })));

  it("keeps a first name nobody else on the board shares", () => {
    expect(named(["priya", "Priya Shah"], ["sam", "Sam Okafor"], ["dev", "Dev"])).toEqual(
      new Map([
        ["id-priya", "Priya"],
        ["id-sam", "Sam"],
        ["id-dev", "Dev"],
      ]),
    );
  });

  it("adds the last word's initial when a first name is shared", () => {
    expect(named(["samo", "Sam Okafor"], ["saml", "Sam Lee"])).toEqual(
      new Map([
        ["id-samo", "Sam O."],
        ["id-saml", "Sam L."],
      ]),
    );
    // Ignoring case, as display names are compared.
    expect(named(["samo", "Sam Okafor"], ["saml", "sam lee"])).toEqual(
      new Map([
        ["id-samo", "Sam O."],
        ["id-saml", "sam l."],
      ]),
    );
    expect(named(["a", "Zoë Park Ünal"], ["b", "Zoë Park"]).get("id-a")).toBe("Zoë Ü.");
  });

  it("falls back to @username when the initial can't tell them apart", () => {
    expect(named(["sam", "Sam"], ["saml", "Sam Lee"])).toEqual(
      new Map([
        ["id-sam", "@sam"],
        ["id-saml", "Sam L."],
      ]),
    );
    expect(named(["samlee", "Sam Lee"], ["samlin", "Sam Lin"], ["samo", "Sam Okafor"])).toEqual(
      new Map([
        ["id-samlee", "@samlee"],
        ["id-samlin", "@samlin"],
        ["id-samo", "Sam O."],
      ]),
    );
  });

  it("names a newcomer who copies a friend's first name apart from the friend, everywhere on the home", () => {
    const weekBoard = [boardRow("priya", "Priya Shah", 240, 3, 1), boardRow("impostor", "Priya X", 200, 3, 2)];
    const bucketBoards = new Map<BucketId, LeaderboardRow[]>([["words", [boardRow("impostor", "Priya X", 200, 3, 1)]]]);
    const view = assembleHomeView(rows({ weekBoard, bucketBoards }));
    expect(view.billing.week.map((s) => s.firstName)).toEqual(["Priya S.", "Priya X."]);
    expect(view.buckets.find((b) => b.id === "words")!.leader).toEqual({ firstName: "Priya X.", isViewer: false });
    expect(view.billing.leaders).toEqual([{ bucketName: "Words", firstName: "Priya X.", isViewer: false }]);
    expect(view.cast).toEqual(["Priya S.", "Priya X."]);
  });

  it("leaves the viewer's own first name alone (the strip, the welcome)", () => {
    const weekBoard = [boardRow("viewer", "Zoë Park", 10, 1, 1), boardRow("zoe2", "Zoë Lin", 5, 1, 2)];
    const view = assembleHomeView(rows({ weekBoard, welcome: true, profile: profile({ display_name: "Zoë Park", username: "zoe" }) }));
    expect(view.viewer.firstName).toBe("Zoë");
    expect(view.welcome?.firstName).toBe("Zoë");
    expect(view.billing.week[0]).toMatchObject({ firstName: "Zoë P.", isViewer: true });
  });
});

describe("firstNameOf", () => {
  it("takes the display name up to the first space", () => {
    expect(firstNameOf("Priya Shah")).toBe("Priya");
    expect(firstNameOf("  Zoë   Park ")).toBe("Zoë");
    expect(firstNameOf("Dev")).toBe("Dev");
  });
});

describe("assembleHomeView with the registered games", () => {
  // Whatever is registered today: a player's view holds no testing game anywhere, an admin's holds them all.
  const date = parsePuzzleDate(DATE);
  it("never shows a player a testing game, by name or id", () => {
    const view = assembleHomeView(rows({ profile: profile({ is_admin: false }), games: visibleGames(false) }));
    const json = JSON.stringify(view);
    for (const game of visibleGames(true).filter((g) => g.availability === "testing")) {
      expect(json).not.toContain(game.name);
      expect(json).not.toContain(`"${game.id}"`);
    }
    expect(view.progress.total).toBe(liveGames().length);
    expect(view.day.date).toBe(date);
  });

  it("gives an admin every registered game, each with a form", () => {
    const view = assembleHomeView(rows({ games: visibleGames(true) }));
    const games = view.buckets.flatMap((b) => b.games);
    expect(games.map((g) => g.id).sort()).toEqual(visibleGames(true).map((g) => g.id).sort());
    for (const game of games) expect(["slots", "frames", "chain", "row"]).toContain(game.form.kind);
  });
});
