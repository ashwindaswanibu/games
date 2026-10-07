/**
 * DEMO DATA for the home ("Day for Night"), on a LOCAL Supabase only. It writes the build spec's
 * scenarios (§7) so every state of `/` can be shot from the real app:
 *
 *   A  Jess (player) at 08:40: Number Hunt not started, a 6-day streak at risk, Marco playing, 2 finished.
 *   B  Ashwin (admin) at 13:40: Number Hunt 4/7, Fade to Color 3/10 (the set-in subject), Degrees in
 *      progress (Continue), Frame by Frame not started; Number Hunt has 4 finishers.
 *   C  Ashwin at 22:50: everything finished, including Frame by Frame lost X/6 and Degrees 3 links · par 2.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/seed-demo.mts --scenario B
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/seed-demo.mts --scenario A --at now
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/seed-demo.mts --clean
 *
 * `--at HH:MM` (New York time today) or `--at now` moves the scenario's clock; every timestamp keeps
 * its distance from it (the presence windows are relative). Default: the scenario's own time. View
 * it with the home's `?qa_t=HH:MM` so the page's clock agrees.
 *
 * What it writes (every account is `demo_`-prefixed; anything else is refused):
 *  - Six password accounts on the `.invalid` domain: demo_priya, demo_marco, demo_jess, demo_dev,
 *    demo_sam, demo_ashwin (admin). demo_jess and demo_ashwin are the viewers; they share one
 *    password, kept in .env.local as HOME_DEMO_PASSWORD (generated once, never printed). Passwords
 *    change through `allow_password_change`, like an admin reset.
 *  - Their plays, replaced on every run: 13 days of Number Hunt history (streaks, this week's
 *    billing, Priya leading), then the scenario's day. Every play is a real one: raw moves through
 *    the app's own move pipeline (`parseMove` → the game's server resolver on the local catalog →
 *    `applyMove`), so states, labels, scores and share grids are exactly what the app would store.
 *
 * Game-specific plans are keyed by game id: a plan for a game that isn't registered any more is
 * skipped with a note, and a registered game without a plan is reported (scenario C then isn't
 * "all finished"). It never reads or writes the E2E tester or any other account, never migrates
 * and never resets the database. Puzzles come from `getOrCreatePuzzle`, exactly as the app gets them.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { addDays, startOfDay, today, type PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import { createRng, type Rng } from "@/core/random";
import { getGame, visibleGames } from "@/games/registry";
import { getGameServer } from "@/games/server-registry";
import type { Json, PlayRow } from "@/server/database.types";
import { gameServices } from "@/server/game-services";
import { advancePlay, parseMove } from "@/server/move-pipeline";
import { getOrCreatePuzzle, PuzzleUnavailableError, type LoadedPuzzle } from "@/server/puzzles";
import { db } from "@/server/supabase/admin";
import { isLocalSupabase, supabaseEnv } from "./content/lib/env.mjs";

const PREFIX = "demo_";
/** Same synthetic domain as `emailForUsername` in src/server/auth.ts (password accounts). */
const PASSWORD_ACCOUNT_DOMAIN = "users.daily.invalid";
const ENV_FILE = new URL("../.env.local", import.meta.url);
const MINUTE = 60_000;
const NUMBER_HUNT = "number-hunt";

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string" },
    at: { type: "string" },
    clean: { type: "boolean", default: false },
  },
  strict: true,
});

// ---------------------------------------------------------------------------------------------
// The cast and the scenarios
// ---------------------------------------------------------------------------------------------

interface DemoPlayer {
  username: string;
  displayName: string;
  isAdmin: boolean;
  /**
   * Number Hunt on the days before today: index 0 is yesterday. A number is the guess it was found
   * on (Number Hunt scores 100 − 10 per extra guess); null is a day sat out.
   */
  history: readonly (number | null)[];
}

const CAST: readonly DemoPlayer[] = [
  { username: "demo_priya", displayName: "Priya", isAdmin: false, history: [3, 2, 3, 4, 3, 2, 3, null, 3, 3, 2, 3, 3] },
  { username: "demo_marco", displayName: "Marco", isAdmin: false, history: [4, 5, 6, null, 5, 5, 4, 6, 5, null, 5, 4, 6] },
  // Six days running, then a gap: a 6-day streak, at risk until Jess plays today (scenario A).
  { username: "demo_jess", displayName: "Jess", isAdmin: false, history: [5, 4, 4, 5, 4, 4, null, 5, 4, null, null, 6, 5] },
  { username: "demo_dev", displayName: "Dev", isAdmin: false, history: [6, null, 5, null, 6, null, 5, 6, null, null, 6, null, 5] },
  { username: "demo_sam", displayName: "Sam", isAdmin: false, history: [null, 3, 4, null, null, 3, 4, 3, null, 4, 3, null, 4] },
  // Eleven days running: with today's play, a 12-day streak (scenarios B and C).
  { username: "demo_ashwin", displayName: "Ashwin", isAdmin: true, history: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, null, null] },
];

/**
 * One play on the scenario's day. `steps` is a small script per game (see `PLANS`); `at` is the New
 * York wall-clock time of its last move on the scenario's own clock (shifted with `--at`).
 */
interface TodayPlay {
  player: string;
  gameId: string;
  steps: string;
  at: string;
}

interface Scenario {
  /** The scenario's New York time. */
  at: string;
  viewer: string;
  plays: readonly TodayPlay[];
  /** Expect every game the viewer can see to be finished (reported if a game has no plan). */
  allFinished?: boolean;
}

const SCENARIOS: Record<string, Scenario> = {
  A: {
    at: "08:40",
    viewer: "demo_jess",
    plays: [
      { player: "demo_priya", gameId: NUMBER_HUNT, steps: "3", at: "07:55" },
      { player: "demo_sam", gameId: NUMBER_HUNT, steps: "4", at: "08:10" },
      { player: "demo_marco", gameId: NUMBER_HUNT, steps: "UD", at: "08:38" }, // playing now
    ],
  },
  B: {
    at: "13:40",
    viewer: "demo_ashwin",
    plays: [
      { player: "demo_priya", gameId: NUMBER_HUNT, steps: "3", at: "07:55" },
      { player: "demo_ashwin", gameId: NUMBER_HUNT, steps: "UDU*", at: "09:12" }, // 4/7, 70
      { player: "demo_marco", gameId: NUMBER_HUNT, steps: "5", at: "12:30" },
      { player: "demo_sam", gameId: NUMBER_HUNT, steps: "4", at: "13:05" },
      { player: "demo_ashwin", gameId: "degrees", steps: "1", at: "13:20" }, // in progress: one link
      { player: "demo_ashwin", gameId: "fade-to-color", steps: "xx*", at: "13:31" }, // 3/10, 80: the set-in
      { player: "demo_jess", gameId: NUMBER_HUNT, steps: "UD", at: "13:37" }, // playing now
    ],
  },
  C: {
    at: "22:50",
    viewer: "demo_ashwin",
    allFinished: true,
    plays: [
      { player: "demo_priya", gameId: NUMBER_HUNT, steps: "3", at: "07:55" },
      { player: "demo_ashwin", gameId: NUMBER_HUNT, steps: "UDU*", at: "09:12" },
      { player: "demo_marco", gameId: NUMBER_HUNT, steps: "5", at: "12:30" },
      { player: "demo_sam", gameId: NUMBER_HUNT, steps: "4", at: "13:05" },
      { player: "demo_ashwin", gameId: "fade-to-color", steps: "xx*", at: "13:31" },
      { player: "demo_jess", gameId: NUMBER_HUNT, steps: "5", at: "19:30" },
      { player: "demo_ashwin", gameId: "color-grade", steps: "x*", at: "20:10" },
      { player: "demo_ashwin", gameId: "degrees", steps: "+1", at: "21:40" }, // 3 links · par 2, 85
      { player: "demo_dev", gameId: NUMBER_HUNT, steps: "6", at: "22:20" }, // finished in the last hour
      { player: "demo_ashwin", gameId: "frame-by-frame", steps: "xxsxxx", at: "22:30" }, // X/6, 0
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Plans: steps → raw moves, the way a player's browser would send them
// ---------------------------------------------------------------------------------------------

interface PlanContext {
  puzzle: unknown;
  solution: unknown;
  rng: Rng;
}

type Plan = (steps: string, ctx: PlanContext) => Promise<unknown[]>;

/**
 * Number Hunt: `U` a guess below the secret (⬆️), `D` above it (⬇️), `*` the secret. A bare number
 * `k` finds it on guess k, directions chosen by the rng. Guesses close in like a player's would.
 */
function numberHuntGuesses(steps: string, ctx: PlanContext): { guess: number }[] {
  const { min, max } = ctx.puzzle as { min: number; max: number };
  const { secret } = ctx.solution as { secret: number };
  let low = min;
  let high = max;
  const below = () => {
    if (low >= secret) throw new Error(`No room below ${secret} for another ⬆️`);
    const guess = Math.floor((low + secret) / 2);
    low = guess + 1;
    return guess;
  };
  const above = () => {
    if (high <= secret) throw new Error(`No room above ${secret} for another ⬇️`);
    const guess = Math.ceil((secret + high) / 2);
    high = guess - 1;
    return guess;
  };

  if (/^\d+$/.test(steps)) {
    // Found on guess k: k − 1 misses, each on a side that still has room, chosen by the rng.
    const guesses: number[] = [];
    for (let i = 1; i < Number(steps); i++) {
      const canUp = low < secret;
      const canDown = high > secret;
      guesses.push(canUp && (!canDown || ctx.rng.next() < 0.5) ? below() : above());
    }
    return [...guesses, secret].map((guess) => ({ guess }));
  }
  return steps.split("").map((step) => {
    if (step === "*") return { guess: secret };
    if (step === "U") return { guess: below() };
    if (step === "D") return { guess: above() };
    throw new Error(`Unknown Number Hunt step "${step}"`);
  });
}

/** Popular catalog films that aren't `exclude`: wrong guesses a player might make. */
async function wrongFilms(exclude: ReadonlySet<number>, count: number): Promise<number[]> {
  const { data, error } = await db().from("movie_films").select("id").order("popularity", { ascending: false }).limit(count + exclude.size + 10);
  if (error) throw new Error(`Failed to read the film catalog: ${error.message}`);
  const ids = data.map((f) => f.id).filter((id) => !exclude.has(id));
  if (ids.length < count) throw new Error(`The local film catalog has too few films for ${count} wrong guesses`);
  return ids.slice(0, count);
}

/**
 * Film-naming games (Fade to Color, Frame by Frame, Color Grade): `x` a wrong guess, `s` a skip,
 * `*` the right film, `p` / `q` the final pick right / wrong (Fade to Color). Fade to Color's wrong
 * guesses are its own look-alikes (the pick's other options).
 */
const filmGuesses: Plan = async (steps, ctx) => {
  const solution = ctx.solution as { answer: { id: number }; options?: { id: number }[] };
  const answer = solution.answer.id;
  const lookAlikes = (solution.options ?? []).map((f) => f.id).filter((id) => id !== answer);
  const misses = steps.split("").filter((c) => c === "x").length;
  const wrong = [...lookAlikes, ...(await wrongFilms(new Set([answer, ...lookAlikes]), Math.max(0, misses - lookAlikes.length)))];
  let w = 0;
  return steps.split("").map((step) => {
    switch (step) {
      case "x":
        return { type: "guess", filmId: wrong[w++] };
      case "s":
        return { type: "skip" };
      case "*":
        return { type: "guess", filmId: answer };
      case "p":
        return { type: "pick", filmId: answer };
      case "q":
        return { type: "pick", filmId: lookAlikes[0] };
      default:
        throw new Error(`Unknown film step "${step}"`);
    }
  });
};

interface DegreesLink {
  film: { id: number };
  person: { id: number };
}

/** Co-stars of `personId` in the local catalog, each with one film they shared. */
async function coStars(personId: number): Promise<Map<number, number>> {
  const { data: films, error } = await db().from("movie_credits").select("film_id").eq("person_id", personId);
  if (error) throw new Error(`Failed to read credits: ${error.message}`);
  const filmIds = films.map((f) => f.film_id);
  const out = new Map<number, number>();
  for (let i = 0; i < filmIds.length; i += 200) {
    const { data: cast, error: castError } = await db().from("movie_credits").select("film_id, person_id").in("film_id", filmIds.slice(i, i + 200));
    if (castError) throw new Error(`Failed to read casts: ${castError.message}`);
    for (const c of cast) if (c.person_id !== personId && !out.has(c.person_id)) out.set(c.person_id, c.film_id);
  }
  return out;
}

/**
 * Degrees: `*` the par chain (the solution's), `1`…`n` that many of its links (in progress), `+1`
 * a chain one link over par (a real detour through a co-star both neighbours share, found in the
 * local catalog), `g` give up.
 */
const degreesLinks: Plan = async (steps, ctx) => {
  const puzzle = ctx.puzzle as { start: { id: number }; end: { id: number } };
  const { path } = ctx.solution as { path: DegreesLink[] };
  const link = (l: DegreesLink) => ({ type: "link", filmId: l.film.id, personId: l.person.id });
  if (steps === "*") return path.map(link);
  if (steps === "g") return [{ type: "give-up" }];
  if (/^\d+$/.test(steps)) return path.slice(0, Number(steps)).map(link);
  if (steps !== "+1") throw new Error(`Unknown Degrees steps "${steps}"`);

  const chain = [puzzle.start.id, ...path.map((l) => l.person.id)];
  for (let i = 0; i < path.length; i++) {
    const [before, after] = await Promise.all([coStars(chain[i]), coStars(chain[i + 1])]);
    const detour = [...before.keys()].find((id) => after.has(id) && !chain.includes(id));
    if (detour === undefined) continue;
    return [
      ...path.slice(0, i).map(link),
      { type: "link", filmId: before.get(detour)!, personId: detour },
      { type: "link", filmId: after.get(detour)!, personId: chain[i + 1] },
      ...path.slice(i + 1).map(link),
    ];
  }
  throw new Error("No one-link detour in the local catalog for today's Degrees chain");
};

/** By game id. A game without a plan can't be played by the seed. */
const PLANS: Record<string, Plan> = {
  [NUMBER_HUNT]: async (steps, ctx) => numberHuntGuesses(steps, ctx),
  "fade-to-color": filmGuesses,
  "frame-by-frame": filmGuesses,
  "color-grade": filmGuesses,
  degrees: degreesLinks,
};

// ---------------------------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------------------------

/** Plays `moves` through the app's move pipeline. Returns the play row (finished or not). */
async function playRow(params: {
  userId: string;
  game: AnyGame;
  date: PuzzleDate;
  loaded: LoadedPuzzle;
  moves: readonly unknown[];
  lastMoveAt: Date;
  minutesTaken: number;
}): Promise<PlayRow> {
  const { userId, game, date, loaded, moves, lastMoveAt, minutesTaken } = params;
  const startedAt = clampToDay(lastMoveAt.getTime() - minutesTaken * MINUTE, date);
  let state = game.initialState(loaded.puzzle);
  let result: { score: number; label: string; shareGrid: string } | null = null;
  let outcome = "in_progress";
  for (const raw of moves) {
    if (result) throw new Error(`${game.id}: moves left after the play finished`);
    const parsed = parseMove(game, raw);
    if (!parsed.ok) throw new Error(`${game.id}: invalid move ${JSON.stringify(raw)}`);
    const step = await advancePlay({
      game,
      server: getGameServer(game.id),
      services: gameServices(),
      puzzle: loaded.puzzle,
      solution: loaded.solution,
      state,
      move: parsed.move,
      elapsedMs: lastMoveAt.getTime() - startedAt.getTime(),
    });
    if (!step.ok) throw new Error(`${game.id}: move ${JSON.stringify(raw)} refused: ${step.error}`);
    state = step.state;
    outcome = step.outcome;
    result = step.result;
  }
  return {
    user_id: userId,
    game_id: game.id,
    puzzle_date: date,
    state: state as Json,
    status: outcome as PlayRow["status"],
    score: result?.score ?? null,
    result_label: result?.label ?? null,
    share_grid: result?.shareGrid ?? null,
    version: moves.length,
    started_at: startedAt.toISOString(),
    finished_at: result ? lastMoveAt.toISOString() : null,
    updated_at: lastMoveAt.toISOString(),
  };
}

async function planAndPlay(params: { userId: string; gameId: string; date: PuzzleDate; steps: string; lastMoveAt: Date; seed: string }): Promise<PlayRow | null> {
  const { userId, gameId, date, steps, lastMoveAt, seed } = params;
  const game = getGame(gameId);
  if (!game) {
    console.log(`  (${gameId} isn't registered any more: skipped)`);
    return null;
  }
  const plan = PLANS[gameId];
  if (!plan) throw new Error(`No demo plan for ${gameId}`);
  let loaded: LoadedPuzzle;
  try {
    loaded = await getOrCreatePuzzle(game, date); // curated games: reads, never creates
  } catch (error) {
    if (!(error instanceof PuzzleUnavailableError)) throw error;
    console.log(`  (no ${gameId} puzzle on ${date}: ${seed} skipped)`);
    return null;
  }
  const rng = createRng(seedOf(seed));
  const moves = await plan(steps, { puzzle: loaded.puzzle, solution: loaded.solution, rng });
  return playRow({ userId, game, date, loaded, moves, lastMoveAt, minutesTaken: 2 + moves.length });
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/** New York wall-clock minutes of "HH:MM". */
function minutesOf(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Expected HH:MM, got "${hhmm}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The instant of New York wall-clock `minutes` on `date` (DST moves the clock at 2 AM). */
function wallClock(date: PuzzleDate, minutes: number): Date {
  const start = startOfDay(date).getTime();
  const shift = startOfDay(addDays(date, 1)).getTime() - start - 24 * 60 * MINUTE;
  return new Date(start + minutes * MINUTE + (minutes >= 180 ? shift : 0));
}

/** Never before the game day began, never after it ended. */
function clampToDay(instant: number, date: PuzzleDate): Date {
  const start = startOfDay(date).getTime();
  const end = startOfDay(addDays(date, 1)).getTime();
  return new Date(Math.min(Math.max(instant, start + MINUTE), end - MINUTE));
}

function seedOf(text: string): [number, number, number, number] {
  let h = 2166136261;
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    for (const ch of `${k}:${text}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    out.push(h >>> 0);
  }
  return out as [number, number, number, number];
}

// ---------------------------------------------------------------------------------------------
// Guards and accounts
// ---------------------------------------------------------------------------------------------

function assertLocal(): void {
  const { url } = supabaseEnv();
  if (!isLocalSupabase(url)) throw new Error(`Refusing to seed demo data into ${new URL(url).host}: local Supabase only.`);
}

function assertDemo(username: string): void {
  if (!username.startsWith(PREFIX)) throw new Error(`Refusing to write "${username}": demo usernames must start with ${PREFIX}`);
}

const emailFor = (username: string) => `${username}@${PASSWORD_ACCOUNT_DOMAIN}`;

async function findAuthUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    const match = data.users.find((u) => u.email === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
}

/** Display names are unique ignoring case: refuse rather than collide with a real player's. */
async function assertNamesFree(): Promise<void> {
  const { data, error } = await db().from("profiles").select("username, display_name");
  if (error) throw new Error(`Failed to read profiles: ${error.message}`);
  for (const player of CAST) {
    const clash = data.find((p) => !p.username.startsWith(PREFIX) && p.display_name.toLowerCase() === player.displayName.toLowerCase());
    if (clash) throw new Error(`"${player.displayName}" is already a real player's display name (@${clash.username}); rename the demo player`);
  }
}

/** Creates the account if needed and returns its id. `password` is set (an authorised change) when given. */
async function ensureAccount(player: DemoPlayer, password: string | null): Promise<string> {
  assertDemo(player.username);
  const email = emailFor(player.username);
  const { data: existing, error } = await db().from("profiles").select("id").eq("username", player.username).maybeSingle();
  if (error) throw new Error(`Failed to look up ${player.username}: ${error.message}`);

  let id = existing?.id ?? (await findAuthUserId(email));
  if (!id) {
    const { data, error: createError } = await db().auth.admin.createUser({
      email,
      password: password ?? randomBytes(24).toString("base64url"),
      email_confirm: true,
      user_metadata: { username: player.username },
    });
    if (createError || !data.user) throw new Error(`Failed to create ${player.username}: ${createError?.message}`);
    id = data.user.id;
  } else if (password) {
    // The password-change guard refuses any change the server didn't authorise a moment before.
    const { error: grantError } = await db().rpc("allow_password_change", { p_user_id: id });
    if (grantError) throw new Error(`Failed to authorise ${player.username}'s password change: ${grantError.message}`);
    const { error: updateError } = await db().auth.admin.updateUserById(id, { password });
    if (updateError) throw new Error(`Failed to set ${player.username}'s password: ${updateError.message}`);
  }

  const { error: upsertError } = await db()
    .from("profiles")
    .upsert({ id, username: player.username, display_name: player.displayName, is_admin: player.isAdmin }, { onConflict: "id" });
  if (upsertError) throw new Error(`Failed to save ${player.username}'s profile: ${upsertError.message}`);
  return id;
}

/** The viewers' shared password: reused from .env.local, or generated once and written there. Never printed. */
function viewerPassword(): { password: string; isNew: boolean } {
  const existing = process.env.HOME_DEMO_PASSWORD?.trim();
  if (existing) return { password: existing, isNew: false };

  const password = `${randomBytes(15).toString("base64url")}7a`; // letters and digits, like the hosted rule
  const lines = readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .filter((line) => !/^HOME_DEMO_(USERNAME|PASSWORD)=/.test(line) && !line.startsWith("# Demo viewers created by"));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(
    "",
    "# Demo viewers created by scripts/seed-demo.mts (local only): sign in as demo_jess (scenario A) or demo_ashwin (B, C)",
    `HOME_DEMO_PASSWORD=${password}`,
    "",
  );
  writeFileSync(ENV_FILE, lines.join("\n"));
  return { password, isNew: true };
}

async function demoProfiles(): Promise<{ id: string; username: string }[]> {
  const { data, error } = await db().from("profiles").select("id, username").like("username", `${PREFIX.replace("_", "\\_")}%`);
  if (error) throw new Error(`Failed to list demo profiles: ${error.message}`);
  for (const p of data) assertDemo(p.username);
  return data;
}

async function deletePlays(userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const { data, error } = await db().from("plays").delete().in("user_id", [...userIds]).select("user_id");
  if (error) throw new Error(`Failed to delete demo plays: ${error.message}`);
  return data.length;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function clean(): Promise<void> {
  const profiles = await demoProfiles();
  const plays = await deletePlays(profiles.map((p) => p.id));
  for (const p of profiles) {
    // Deleting the auth user cascades to the profile (profiles.id references auth.users).
    const { error } = await db().auth.admin.deleteUser(p.id);
    if (error) throw new Error(`Failed to delete ${p.username}: ${error.message}`);
  }
  for (const player of CAST) {
    const orphan = await findAuthUserId(emailFor(player.username));
    if (orphan) {
      const { error } = await db().auth.admin.deleteUser(orphan);
      if (error) throw new Error(`Failed to delete ${player.username}: ${error.message}`);
    }
  }
  console.log(`Removed ${profiles.length} demo accounts and ${plays} plays.`);
}

async function seed(name: string): Promise<void> {
  const scenario = SCENARIOS[name.toUpperCase()];
  if (!scenario) throw new Error(`--scenario must be one of ${Object.keys(SCENARIOS).join(", ")}`);
  const now = new Date();
  const date = today(now);
  const scenarioAt = wallClock(date, minutesOf(scenario.at));
  const at = args.at === undefined ? scenarioAt : args.at === "now" ? now : wallClock(date, minutesOf(args.at));
  const shift = at.getTime() - scenarioAt.getTime();

  await assertNamesFree();
  const { password, isNew } = viewerPassword();
  const viewers = new Set(Object.values(SCENARIOS).map((s) => s.viewer));
  const ids = new Map<string, string>();
  for (const player of CAST) ids.set(player.username, await ensureAccount(player, viewers.has(player.username) ? password : null));
  await deletePlays([...ids.values()]);

  const rows: PlayRow[] = [];
  const numberHunt = getGame(NUMBER_HUNT);
  for (const player of CAST) {
    const userId = ids.get(player.username)!;
    for (let back = player.history.length; back >= 1; back--) {
      const guesses = player.history[back - 1];
      if (guesses === null || !numberHunt) continue;
      const day = addDays(date, -back);
      const rng = createRng(seedOf(`${player.username}:${day}`));
      const lastMoveAt = wallClock(day, 7 * 60 + rng.int(0, 15 * 60));
      const row = await planAndPlay({ userId, gameId: NUMBER_HUNT, date: day, steps: String(guesses), lastMoveAt, seed: `${player.username}:${day}` });
      if (row) rows.push(row);
    }
  }
  for (const play of scenario.plays) {
    const userId = ids.get(play.player);
    if (!userId) throw new Error(`Unknown demo player ${play.player}`);
    const lastMoveAt = clampToDay(wallClock(date, minutesOf(play.at)).getTime() + shift, date);
    const row = await planAndPlay({ userId, gameId: play.gameId, date, steps: play.steps, lastMoveAt, seed: `${play.player}:${play.gameId}:${date}` });
    if (row) rows.push(row);
  }

  const { error } = await db().from("plays").insert(rows);
  if (error) throw new Error(`Failed to insert demo plays: ${error.message}`);

  const viewer = CAST.find((p) => p.username === scenario.viewer)!;
  const viewerId = ids.get(viewer.username)!;
  const todayRows = rows.filter((r) => r.puzzle_date === date);
  const nyTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  console.log(`Scenario ${name.toUpperCase()} for ${date} at ${nyTime.format(at)} New York: ${rows.length} plays (${todayRows.length} today).`);
  for (const r of todayRows.sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
    const who = [...ids].find(([, id]) => id === r.user_id)?.[0] ?? "?";
    const result = r.status === "in_progress" ? "in progress" : `${r.status} ${r.result_label} · ${r.score} · ${r.share_grid}`;
    console.log(`  ${nyTime.format(new Date(r.updated_at))}  ${who.padEnd(12)} ${r.game_id.padEnd(15)} ${result}`);
  }

  if (scenario.allFinished) {
    const finished = new Set(todayRows.filter((r) => r.user_id === viewerId && r.status !== "in_progress").map((r) => r.game_id));
    const open = visibleGames(viewer.isAdmin).filter((g) => !finished.has(g.id));
    if (open.length > 0) console.log(`  NOTE: ${viewer.username} hasn't finished ${open.map((g) => g.id).join(", ")} (no plan or no puzzle today).`);
  }
  console.log(`Sign in as ${viewer.username}${viewer.isAdmin ? " (admin)" : ""}; the password is HOME_DEMO_PASSWORD in .env.local${isNew ? " (new)" : ""}.`);
  console.log(`View it at /?qa_t=${nyTime.format(at)} so the page's clock matches.`);
}

async function main(): Promise<void> {
  assertLocal();
  if (args.clean) await clean();
  else if (args.scenario) await seed(args.scenario);
  else throw new Error("Pass --scenario A|B|C (optionally --at HH:MM or --at now), or --clean.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
