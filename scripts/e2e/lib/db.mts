import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AnyGame } from "@/core/game";
import type { PuzzleDate } from "@/core/day";
import { filmDetailsSchema, type FilmDetails, type PersonRef } from "@/games/_movies/schemas";
import type { Database, PlayRow } from "@/server/database.types";

/**
 * Service-role access for the E2E suites. The suites use it for two things only: to know the right
 * answers (they read the stored solution, exactly as a player never can) and to reset the test
 * account's plays before a run. Nothing here is reachable from the app.
 */
export type E2eDb = SupabaseClient<Database>;

export function e2eDb(url: string, secretKey: string): E2eDb {
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function profileByUsername(db: E2eDb, username: string) {
  const { data, error } = await db.from("profiles").select("id, username, display_name, is_admin").eq("username", username).maybeSingle();
  if (error) throw new Error(`Failed to load the test profile: ${error.message}`);
  if (!data) throw new Error(`No profile for E2E_TEST_USERNAME "${username}". Sign up that account locally first.`);
  return data;
}

/** A stored puzzle, validated with the game's own schemas so the suite plays exactly what the app serves. */
export async function loadPuzzle<G extends AnyGame>(
  db: E2eDb,
  game: G,
  date: PuzzleDate,
): Promise<{ puzzle: ReturnType<G["puzzleSchema"]["parse"]>; solution: ReturnType<G["solutionSchema"]["parse"]> }> {
  const { data, error } = await db.from("puzzles").select("payload, solution").eq("game_id", game.id).eq("puzzle_date", date).maybeSingle();
  if (error) throw new Error(`Failed to load the ${game.id} puzzle: ${error.message}`);
  if (!data) throw new Error(`No ${game.id} puzzle for ${date}. Run \`npm run content:movies:fixtures\` first.`);
  return { puzzle: game.puzzleSchema.parse(data.payload), solution: game.solutionSchema.parse(data.solution) };
}

/** Every asset stored for one game's puzzle on one day (lowercased ids). */
export async function assetIdsFor(db: E2eDb, gameId: string, date: PuzzleDate): Promise<Set<string>> {
  const { data, error } = await db.from("puzzle_assets").select("id").eq("game_id", gameId).eq("puzzle_date", date);
  if (error) throw new Error(`Failed to list ${gameId} assets: ${error.message}`);
  return new Set(data.map((row) => row.id.toLowerCase()));
}

export async function loadPlay(db: E2eDb, userId: string, gameId: string, date: PuzzleDate): Promise<PlayRow | null> {
  const { data, error } = await db.from("plays").select("*").eq("user_id", userId).eq("game_id", gameId).eq("puzzle_date", date).maybeSingle();
  if (error) throw new Error(`Failed to load the ${gameId} play: ${error.message}`);
  return data;
}

/** Polls until the play has reached `version` (each applied move bumps it by one). */
export async function waitForPlayVersion(
  db: E2eDb,
  params: { userId: string; gameId: string; date: PuzzleDate; version: number; timeoutMs?: number },
): Promise<PlayRow> {
  const deadline = Date.now() + (params.timeoutMs ?? 30_000);
  let last: PlayRow | null = null;
  while (Date.now() < deadline) {
    last = await loadPlay(db, params.userId, params.gameId, params.date);
    if (last && last.version >= params.version) {
      if (last.version !== params.version) throw new Error(`${params.gameId} play jumped to version ${last.version}, expected ${params.version}`);
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${params.gameId} play never reached version ${params.version} (last seen: ${last ? last.version : "no play"})`);
}

/** Deletes the test account's plays of these games on `date`, so every run starts from Start. */
export async function resetPlays(db: E2eDb, userId: string, gameIds: readonly string[], date: PuzzleDate): Promise<number> {
  const { data, error } = await db.from("plays").delete().eq("user_id", userId).eq("puzzle_date", date).in("game_id", [...gameIds]).select("game_id");
  if (error) throw new Error(`Failed to reset the test account's plays: ${error.message}`);
  return data.length;
}

/**
 * Clears the test account's per-burst image counter (local database only). The suite fetches every
 * stored asset of a puzzle on top of what the page itself loads, to prove which ones are refused;
 * that is far more than a player's browser asks for, so without this the burst limit (correctly)
 * starts answering 429 partway through a game.
 */
export async function resetAssetBurst(db: E2eDb, userId: string): Promise<void> {
  const { error } = await db.from("rate_limits").delete().eq("key", `assets:${userId}`);
  if (error) throw new Error(`Failed to reset the test account's image rate limit: ${error.message}`);
}

/**
 * Popular films to guess wrong with: a known year (so the year clue is meaningful and the search
 * hit can be told apart by it), none of `excludeIds`, and a title no other catalog film shares.
 */
export async function decoyFilms(db: E2eDb, count: number, excludeIds: readonly number[]): Promise<FilmDetails[]> {
  const { data, error } = await db
    .from("movie_films")
    .select("id, title, year, genres, directors")
    .not("year", "is", null)
    .order("popularity", { ascending: false })
    .order("id")
    .limit(count + excludeIds.length + 40);
  if (error) throw new Error(`Failed to pick decoy films: ${error.message}`);
  const picked: FilmDetails[] = [];
  for (const row of data) {
    if (picked.length === count) break;
    if (excludeIds.includes(row.id) || picked.some((film) => film.title === row.title)) continue;
    const { count: namesakes, error: countError } = await db.from("movie_films").select("id", { count: "exact", head: true }).eq("title", row.title);
    if (countError) throw new Error(`Failed to check decoy titles: ${countError.message}`);
    if (namesakes === 1) picked.push(filmDetailsSchema.parse(row));
  }
  if (picked.length < count) throw new Error(`Only found ${picked.length} of ${count} decoy films`);
  return picked;
}

/**
 * A detour for Degrees: one of `from`'s films that isn't on the optimal path, and a co-star in it
 * who is nobody in `avoidPeople`. Linking it is a legal but off-route move (it costs a link).
 */
export async function degreesDetour(
  db: E2eDb,
  from: PersonRef,
  avoidFilms: readonly number[],
  avoidPeople: readonly number[],
): Promise<{ film: { id: number; title: string; year: number | null }; person: PersonRef }> {
  const { data: credits, error } = await db.from("movie_credits").select("film_id, movie_films(id, title, year, popularity)").eq("person_id", from.id);
  if (error) throw new Error(`Failed to load ${from.name}'s films: ${error.message}`);
  const films = credits
    .flatMap((credit) => (credit.movie_films ? [credit.movie_films] : []))
    .filter((film) => !avoidFilms.includes(film.id))
    .sort((a, b) => b.popularity - a.popularity || a.id - b.id);

  for (const film of films) {
    // Two of the same title in one filmography (a remake) would make the search pick ambiguous.
    if (films.filter((other) => other.title === film.title && other.year === film.year).length > 1) continue;
    const { data: cast, error: castError } = await db
      .from("movie_credits")
      .select("person_id, billing, movie_people(id, name)")
      .eq("film_id", film.id)
      .order("billing", { ascending: true, nullsFirst: false });
    if (castError) throw new Error(`Failed to load the cast of ${film.title}: ${castError.message}`);
    const people = cast.flatMap((credit) => (credit.movie_people ? [credit.movie_people] : []));
    const coStar = people.find(
      (person) => person.id !== from.id && !avoidPeople.includes(person.id) && people.filter((p) => p.name === person.name).length === 1,
    );
    if (coStar) return { film: { id: film.id, title: film.title, year: film.year }, person: { id: coStar.id, name: coStar.name } };
  }
  throw new Error(`No off-route film with a usable co-star for ${from.name}`);
}
