import type { PuzzleDate } from "./day";
import type { BucketId } from "./game";

/**
 * The home page ("/", "Day for Night") as data: the contract between the server
 * (`src/server/home.ts` builds it, the rules live in `src/server/home-assemble.ts`) and the UI
 * (`src/components/home/*` renders it).
 *
 * Types only. Every value is plain JSON-safe data so it crosses the RSC boundary into the client
 * root unchanged. Change policy: additive changes only, announced to both engineers.
 *
 * Spoiler and secrecy rules held by the shape:
 *  - A result exists only on the viewer's own finished game (`HomeGame.result`). Friends' results
 *    never appear on the home; presence names a player and a game, never a score, label or grid.
 *  - A player's view never contains a testing game (`visibleGames(isAdmin)`), so no testing game's
 *    name reaches a player's RSC payload. Mark forms and result lines are computed on the server,
 *    so the home's client code never imports a game module.
 */

// ---------------------------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------------------------

export interface HomeView {
  viewer: HomeViewer;
  day: HomeDay;
  clock: HomeClock;
  progress: HomeProgress;
  /** Always all four, in `BUCKETS` order (open or in production). */
  buckets: readonly HomeBucket[];
  /** The one filled action on the page; null when there is nothing to do (e.g. the rest are not ready). */
  primary: HomePrimary | null;
  /** The most recent spoiler-safe activity by someone else; null when there is none. */
  presence: PresenceLine | null;
  billing: HomeBilling;
  /**
   * First names for the opening's "present" card: everyone with a finished live game this week (as
   * the viewer may see it), alphabetical, at most 8. Empty when more than 8 played (the card is left out).
   */
  cast: readonly string[];
  /** Present on a first sign-in (`?welcome=1`). */
  welcome: WelcomeNote | null;
  /** Server clock when the view was built (ISO 8601), for skew correction on the client. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Viewer, day, clock
// ---------------------------------------------------------------------------------------------

export interface HomeViewer {
  id: string;
  username: string;
  displayName: string;
  /** `displayName` up to the first space. */
  firstName: string;
  isAdmin: boolean;
  /** Over live games. `atRisk` = current > 0 and no finished live game today. */
  streak: { current: number; best: number; atRisk: boolean };
}

export interface HomeDay {
  /** Today's puzzle date; also the seed for every seeded visual. */
  date: PuzzleDate;
  /** "Wednesday". */
  weekday: string;
  /** "October" (title case; the UI upper-cases it). */
  month: string;
  /** 1–31. */
  dayOfMonth: number;
  /** Tomorrow's weekday, "Thursday" (the FIN card: "Thursday's puzzles are ready."). */
  nextWeekday: string;
}

/** The three lights of the room, by New York's daylight (see `cueAt` in `src/core/daylight.ts`). */
export type HomeCue = "morning" | "afternoon" | "night";

/** Every instant is ISO 8601 (UTC, "Z"). */
export interface HomeClock {
  /** The instant today began in New York: `startOfDay(date)`. */
  dayStartsAt: string;
  /** The instant the next puzzles unlock: `nextRollover()`. DST-safe. */
  rollsOverAt: string;
  /** Civil dawn, approximated: New York sunrise − 30 min. Night → morning. */
  dawnAt: string;
  /** 12:00 New York time. Morning → afternoon. */
  noonAt: string;
  /** Civil dusk, approximated: New York sunset + 30 min. Afternoon → night. */
  duskAt: string;
  timeZone: "America/New_York";
}

// ---------------------------------------------------------------------------------------------
// Progress band
// ---------------------------------------------------------------------------------------------

export interface HomeProgress {
  /** Finished visible games. */
  done: number;
  /** Visible games (testing games count for admins, decision 9). */
  total: number;
  /** One per visible game: live games first, then testing; each group in bucket, then registry order. */
  chips: readonly { gameId: string; bucket: BucketId; testing: boolean; state: HomeGameState }[];
}

// ---------------------------------------------------------------------------------------------
// Buckets and games
// ---------------------------------------------------------------------------------------------

export interface HomeBucket {
  id: BucketId;
  name: string;
  /** `open` = at least one visible game; otherwise the In production card. */
  status: "open" | "in_production";
  /** Every visible game is testing (admin only). False for a bucket with no visible games. */
  testingOnly: boolean;
  /** This week's leader on the bucket's live games (first row with points > 0); null if none or no live games. */
  leader: { firstName: string; isViewer: boolean } | null;
  /** Visible games, registry order. Empty when `status` is "in_production". */
  games: readonly HomeGame[];
}

/**
 * - `not_started`: no play yet, and today's puzzle is ready.
 * - `in_progress`: started, not finished.
 * - `finished`: won or lost (`result` is set).
 * - `unavailable`: a curated game with no puzzle stored for today and no play ("Not ready yet.").
 */
export type HomeGameState = "not_started" | "in_progress" | "finished" | "unavailable";

export interface HomeGame {
  id: string;
  name: string;
  tagline: string;
  href: `/play/${string}`;
  testing: boolean;
  /** The game's play route is full screen (the `(immersive)` group: Fade to Color). */
  fullScreen: boolean;
  state: HomeGameState;
  /** Players (the viewer included) who have finished this game today. */
  finishedCount: number;
  form: MarkForm;
  /** Present exactly when `state === "finished"`. */
  result: HomeResult | null;
}

/**
 * A game's mark, as a layout spec for the generic renderer (spec §6.2). `count` is the game's
 * maximum attempts; the chain's `par` comes from today's puzzle (null when it isn't ready).
 */
export type MarkForm =
  | { kind: "slots"; count: number }
  | { kind: "frames"; count: number; aspect: "3:2" | "4:3"; finalPick: boolean }
  | { kind: "chain"; par: number | null }
  | { kind: "row"; count: number | null };

/** What a game declares (`GameDefinition.home.form`): a `MarkForm`, except the chain's par, which the server fills in. */
export type MarkFormSpec = Exclude<MarkForm, { kind: "chain" }> | { kind: "chain" };

/**
 * What one share-grid symbol means, independent of the game's emoji (`shareMarks()` in
 * `src/core/share-marks.ts` maps them):
 *   hit 🟩 ✅ · near 🟨 · miss 🟥 · skip ⬛ · unused ⬜ · up ⬆️ · down ⬇️ · link 🎞 · win ⭐ · flag 🏳️ ·
 *   other: anything else (never dropped).
 */
export type ShareMarkKind = "hit" | "near" | "miss" | "skip" | "unused" | "up" | "down" | "link" | "win" | "flag" | "other";

export interface HomeResult {
  outcome: "won" | "lost";
  /** 0–100. */
  score: number;
  /** `result_label` as stored ("4/7", "X/6", "3 links · par 2", "Gave up", "Final pick"). */
  label: string;
  /** The game's result line ("Named on reel 3"); null for games without one (label only). */
  line: string | null;
  /** The share grid as marks, in order. */
  marks: readonly ShareMarkKind[];
  /** ISO 8601, for the set-in gate. */
  finishedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Primary, presence, billing, welcome
// ---------------------------------------------------------------------------------------------

/**
 * The first in-progress game (bucket, then registry order) → continue; else the first not-started
 * game → play (unavailable games are skipped); else, when every visible game is finished →
 * standings; else null.
 */
export interface HomePrimary {
  kind: "continue" | "play" | "standings";
  /** Null for standings. */
  gameId: string | null;
  /** `/play/<id>` or `/leaderboard`. */
  href: string;
}

/** "Marco is playing Number Hunt" / "Sam finished Number Hunt". Never the viewer, never a result. */
export interface PresenceLine {
  kind: "playing" | "finished";
  firstName: string;
  gameName: string;
  gameHref: `/play/${string}`;
}

export interface HomeBilling {
  /** This week's overall board (live games, spoiler-walled for today), points > 0 only, in rank order. */
  week: readonly { firstName: string; points: number; rank: number; isViewer: boolean }[];
  /** One per bucket with live games and a leader this week, in bucket order. */
  leaders: readonly { bucketName: string; firstName: string; isViewer: boolean }[];
  /** The viewer has no finished live game today, so today's points are hidden from them. */
  todayWalled: boolean;
}

export interface WelcomeNote {
  firstName: string;
  displayName: string;
  username: string;
}
