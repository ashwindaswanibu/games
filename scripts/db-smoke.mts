/**
 * Integration smoke test for the database contract the app relies on: auth with synthetic
 * username emails, RLS, puzzle upsert semantics, optimistic concurrency on plays, check
 * constraints, the leaderboard/streak functions, puzzle assets, and the movie catalog search.
 *
 * Runs against a live Supabase (local by default) and cleans up after itself.
 *   npm run db:start && npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
if (!url || !publishableKey || !secretKey) throw new Error("Missing Supabase env vars (use --env-file=.env.local)");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, opts);
const GAME = "smoke-test";
const tag = randomBytes(3).toString("hex");
const userIds: string[] = [];
const filmIds: number[] = [];
const personIds: number[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

async function makePlayer(name: string): Promise<{ id: string; client: SupabaseClient }> {
  const username = `smoke_${name}_${tag}`;
  const email = `${username}@users.daily.invalid`;
  const password = randomBytes(12).toString("hex");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, username, display_name: name });
  if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);
  const client = createClient(url, publishableKey, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, client };
}

async function main() {
  // --- Auth with synthetic .invalid emails -----------------------------------------------
  const alice = await makePlayer("alice");
  const bob = await makePlayer("bob");
  check("password accounts on the .invalid domain can be created and sign in", true);

  // --- Puzzles: upsert ignores duplicates, RLS hides them ----------------------------------
  const day = (n: number) => `2001-01-${String(n).padStart(2, "0")}`;
  for (const n of [1, 2, 3, 4, 5]) {
    await admin.from("puzzles").upsert(
      { game_id: GAME, puzzle_date: day(n), payload: { n }, solution: { secret: n } },
      { onConflict: "game_id,puzzle_date", ignoreDuplicates: true },
    );
  }
  const { error: dupError } = await admin
    .from("puzzles")
    .upsert({ game_id: GAME, puzzle_date: day(1), payload: { n: 999 }, solution: { secret: 999 } }, { onConflict: "game_id,puzzle_date", ignoreDuplicates: true });
  const { data: p1 } = await admin.from("puzzles").select("payload").eq("game_id", GAME).eq("puzzle_date", day(1)).single();
  check("duplicate puzzle upsert is ignored (first write wins)", !dupError && (p1?.payload as { n: number }).n === 1, { dupError, p1 });

  const { data: leaked } = await alice.client.from("puzzles").select("*").eq("game_id", GAME);
  check("players cannot read puzzles/solutions directly", (leaked ?? []).length === 0, leaked);

  // --- Plays: RLS, optimistic concurrency, constraints ------------------------------------
  const { error: insertDenied } = await alice.client.from("plays").insert({ user_id: alice.id, game_id: GAME, puzzle_date: day(5), state: {} });
  check("players cannot write plays directly", Boolean(insertDenied));

  const { error: playError } = await admin.from("plays").insert({ user_id: alice.id, game_id: GAME, puzzle_date: day(5), state: { guesses: [] } });
  check("server can start a play", !playError, playError);
  const { error: dupPlay } = await admin.from("plays").insert({ user_id: alice.id, game_id: GAME, puzzle_date: day(5), state: { guesses: [] } });
  check("starting the same play twice is a unique violation (23505)", dupPlay?.code === "23505", dupPlay);

  const move = (expected: number, next: number) =>
    admin
      .from("plays")
      .update({ state: { guesses: [next] }, version: expected + 1 })
      .eq("user_id", alice.id)
      .eq("game_id", GAME)
      .eq("puzzle_date", day(5))
      .eq("version", expected)
      .select("*")
      .maybeSingle();
  const first = await move(0, 1);
  const replay = await move(0, 2);
  check("move with current version applies", first.data?.version === 1, first);
  check("replayed move with stale version is rejected", replay.data === null && !replay.error, replay);

  const { error: badFinish } = await admin.from("plays").update({ status: "won" }).eq("user_id", alice.id).eq("game_id", GAME).eq("puzzle_date", day(5));
  check("finishing without a score violates the consistency check (23514)", badFinish?.code === "23514", badFinish);

  const finish = (userId: string, n: number, score: number) =>
    admin.from("plays").upsert({
      user_id: userId,
      game_id: GAME,
      puzzle_date: day(n),
      state: {},
      status: score > 0 ? "won" : "lost",
      score,
      result_label: `${score}`,
      share_grid: "x",
      finished_at: new Date().toISOString(),
    });
  await admin.from("plays").delete().eq("user_id", alice.id).eq("game_id", GAME).eq("puzzle_date", day(5));
  // Alice: days 1,2 then 4,5 (gap on 3). Bob: days 3,4.
  for (const [n, s] of [[1, 50], [2, 60], [4, 70], [5, 80]] as const) await finish(alice.id, n, s);
  for (const [n, s] of [[3, 90], [4, 0]] as const) await finish(bob.id, n, s);

  const { data: aliceSees } = await alice.client.from("plays").select("user_id").eq("game_id", GAME);
  check("players can only see their own plays via the public key", (aliceSees ?? []).every((p) => p.user_id === alice.id) && (aliceSees ?? []).length === 4, aliceSees);

  // --- Leaderboard & streaks --------------------------------------------------------------
  const { data: board, error: boardError } = await admin.rpc("leaderboard", { p_from: day(1), p_to: day(5), p_game_ids: [GAME] });
  const a = board?.find((r: { user_id: string }) => r.user_id === alice.id);
  const b = board?.find((r: { user_id: string }) => r.user_id === bob.id);
  check("leaderboard sums points and counts plays/wins", !boardError && a?.points === 260 && a?.games_played === 4 && a?.wins === 4 && b?.points === 90 && b?.wins === 1, { boardError, a, b });
  check("leaderboard ranks by points", Boolean(a && b && a.rank < b.rank), { a, b });

  const { data: weekBoard } = await admin.rpc("leaderboard", { p_from: day(4), p_to: day(5), p_game_ids: [GAME] });
  const aw = weekBoard?.find((r: { user_id: string }) => r.user_id === alice.id);
  check("leaderboard respects the date range", aw?.points === 150, aw);

  const { error: rpcDenied } = await alice.client.rpc("leaderboard", { p_from: day(1), p_to: day(5), p_game_ids: [GAME] });
  check("players cannot call leaderboard() directly", Boolean(rpcDenied));

  const { data: streaks } = await admin.rpc("streaks", { p_today: day(5), p_game_ids: [GAME] });
  const sa = streaks?.find((s: { user_id: string }) => s.user_id === alice.id);
  const sb = streaks?.find((s: { user_id: string }) => s.user_id === bob.id);
  check("current streak counts back from today; best streak across gaps", sa?.current_streak === 2 && sa?.best_streak === 2, sa);
  check("a streak ending yesterday is still current", sb?.current_streak === 2, sb);
  const { data: later } = await admin.rpc("streaks", { p_today: day(7), p_game_ids: [GAME] });
  check("a streak broken by a missed day resets to 0", later?.find((s: { user_id: string }) => s.user_id === alice.id)?.current_streak === 0, later);
  await assetChecks(alice.client);
  await catalogChecks(alice.client);
}

// --- Puzzle assets: service-role only, bytes round-trip, tied to their puzzle -------------------
async function assetChecks(player: SupabaseClient) {
  const day = (n: number) => `2001-02-${String(n).padStart(2, "0")}`;
  // A 1×1 PNG.
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8cfc0f01f0005000201a1c3bd5c0000000049454e44ae426082", "hex");
  const hex = `\\x${png.toString("hex")}`;
  const asset = (n: number, extra: Record<string, unknown> = {}) => ({
    game_id: GAME,
    puzzle_date: day(n),
    kind: "frame",
    mime: "image/png",
    width: 1,
    height: 1,
    bytes: hex,
    ...extra,
  });

  for (const n of [1, 2]) await admin.from("puzzles").insert({ game_id: GAME, puzzle_date: day(n), payload: {}, solution: {} });

  const { data: stored, error: storeError } = await admin.from("puzzle_assets").insert(asset(1)).select("id").single();
  check("server can store an asset for a puzzle", !storeError && Boolean(stored?.id), storeError);
  const { data: readBack } = await admin.from("puzzle_assets").select("bytes, mime").eq("id", stored?.id ?? "").single();
  check("asset bytes round-trip exactly through bytea", readBack?.bytes === `\\x${png.toString("hex")}`, readBack?.bytes?.slice(0, 20));

  const { data: leaked, error: leakError } = await player.from("puzzle_assets").select("*").eq("game_id", GAME);
  check("players cannot read puzzle assets directly", Boolean(leakError) || (leaked ?? []).length === 0, leaked);
  const { error: playerInsert } = await player.from("puzzle_assets").insert(asset(1));
  check("players cannot write puzzle assets", Boolean(playerInsert));

  const { error: orphan } = await admin.from("puzzle_assets").insert(asset(28));
  check("an asset needs its puzzle to exist (23503)", orphan?.code === "23503", orphan);
  const { error: badMime } = await admin.from("puzzle_assets").insert(asset(1, { mime: "text/html" }));
  check("only image types are accepted (23514)", badMime?.code === "23514", badMime);
  const { error: badKind } = await admin.from("puzzle_assets").insert(asset(1, { kind: "Not A Slug" }));
  check("asset kinds are slugs (23514)", badKind?.code === "23514", badKind);

  const { data: doomed } = await admin.from("puzzle_assets").insert(asset(2)).select("id").single();
  await admin.from("puzzles").delete().eq("game_id", GAME).eq("puzzle_date", day(2));
  const { data: gone } = await admin.from("puzzle_assets").select("id").eq("id", doomed?.id ?? "");
  check("deleting a puzzle deletes its assets", Boolean(doomed) && (gone ?? []).length === 0, gone);
}

// --- Movie catalog: RLS, constraints, ranked accent- and typo-tolerant search -------------------
async function catalogChecks(player: SupabaseClient) {
  // A token no real title contains, so the catalog's own rows can't disturb the ranking checks.
  const W = `smk${tag}q`;
  const films = [
    { title: W, year: 2001, popularity: 1 },
    { title: `${W} Returns`, year: 2003, popularity: 90 },
    { title: `The ${W} Story`, year: 1999, popularity: 50 },
    { title: `Amélie and the ${W}`, year: 2001, popularity: 5 },
    { title: `Cinematography of ${W}`, year: 1980, popularity: 5 },
    { title: `Unrelated ${W.slice(0, 4)}`, year: 1980, popularity: 99 },
  ];
  const { data: inserted, error: filmError } = await admin.from("movie_films").insert(films).select("id, title, search_key");
  check("server can write the catalog", !filmError && inserted?.length === films.length, filmError);
  filmIds.push(...(inserted ?? []).map((f) => f.id));
  const idOf = (title: string) => inserted?.find((f) => f.title === title)?.id;
  check("titles get an accent-free search key", inserted?.find((f) => f.title.startsWith("Amélie"))?.search_key === `amelie and the ${W}`, inserted);

  const search = async (q: string) => {
    const { data, error } = await admin.rpc("search_films", { p_query: q, p_limit: 10 });
    if (error) throw new Error(`search_films failed: ${error.message}`);
    return (data as { title: string }[]).map((r) => r.title);
  };
  const ranked = await search(W);
  check(
    "film search ranks exact, then prefix/word-prefix by popularity, then substring",
    JSON.stringify(ranked) === JSON.stringify([W, `${W} Returns`, `The ${W} Story`, `Amélie and the ${W}`, `Cinematography of ${W}`]),
    ranked,
  );
  check("film search ignores accents and case", (await search(`AMELIE AND THE ${W}`))[0] === `Amélie and the ${W}`);
  check("film search tolerates typos", (await search(`cinematograhy of ${W}`))[0] === `Cinematography of ${W}`);
  check("film search ignores blank queries", (await search("  ¿? ")).length === 0);

  const { data: person } = await admin.from("movie_people").insert({ name: `Ana ${W}`, popularity: 10 }).select("id").single();
  if (person) personIds.push(person.id);
  const { error: creditError } = await admin.from("movie_credits").insert([
    { film_id: idOf(`${W} Returns`)!, person_id: person!.id, billing: 0 },
    { film_id: idOf(W)!, person_id: person!.id, billing: 2 },
  ]);
  check("server can write credits", !creditError, creditError);
  const { data: people } = await admin.rpc("search_people", { p_query: `ana ${W}`, p_limit: 5 });
  const hit = (people as { name: string; known_for: string | null }[] | null)?.[0];
  check("people search finds a person with their best-known film", hit?.name === `Ana ${W}` && hit.known_for === `${W} Returns`, people);

  const { error: dupCredit } = await admin.from("movie_credits").insert({ film_id: idOf(W)!, person_id: person!.id });
  check("a person is credited once per film (23505)", dupCredit?.code === "23505", dupCredit);
  const { error: badWikidata } = await admin.from("movie_films").insert({ title: `Bad ${W}`, wikidata_id: "X12" });
  check("external ids are validated (23514)", badWikidata?.code === "23514", badWikidata);
  const { error: longGenre } = await admin.from("movie_films").insert({ title: `Bad ${W}`, genres: ["Drama", "x".repeat(61)] });
  check("genres must be 1–60 characters (23514)", longGenre?.code === "23514", longGenre);
  const { error: blankDirector } = await admin.from("movie_films").insert({ title: `Bad ${W}`, directors: ["  "] });
  check("directors must not be blank (23514)", blankDirector?.code === "23514", blankDirector);
  const { error: tooManyGenres } = await admin.from("movie_films").insert({ title: `Bad ${W}`, genres: Array.from({ length: 21 }, (_, i) => `G${i}`) });
  check("a film has at most 20 genres (23514)", tooManyGenres?.code === "23514", tooManyGenres);

  const { data: playerFilms, error: playerFilmsError } = await player.from("movie_films").select("id").in("id", filmIds);
  check("players cannot read the catalog tables directly", Boolean(playerFilmsError) || (playerFilms ?? []).length === 0, playerFilms);
  const { error: playerCredits } = await player.from("movie_credits").insert({ film_id: idOf(W)!, person_id: person!.id });
  check("players cannot write the catalog", Boolean(playerCredits));
  const { error: rpcDenied } = await player.rpc("search_films", { p_query: W });
  check("players cannot call search_films() directly", Boolean(rpcDenied));

  // Rate limits: a fixed-window counter per key, server-only.
  const limitKey = `smoke:${W}`;
  const takes: (boolean | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const { data } = await admin.rpc("take_rate_limit", { p_key: limitKey, p_limit: 2, p_window_seconds: 3600 });
    takes.push(data);
  }
  check("take_rate_limit allows up to the limit, then refuses", JSON.stringify(takes) === "[true,true,false]", takes);
  const { error: badLimit } = await admin.rpc("take_rate_limit", { p_key: limitKey, p_limit: 0, p_window_seconds: 10 });
  check("take_rate_limit rejects a zero limit (22023)", badLimit?.code === "22023", badLimit);
  const { error: playerLimit } = await player.rpc("take_rate_limit", { p_key: limitKey, p_limit: 1000, p_window_seconds: 10 });
  check("players cannot call take_rate_limit() directly", Boolean(playerLimit));
  const { data: playerCounters } = await player.from("rate_limits").select("key");
  check("players cannot read rate-limit counters", (playerCounters ?? []).length === 0, playerCounters);
  await admin.from("rate_limits").delete().eq("key", limitKey);

  await admin.from("movie_films").delete().eq("id", idOf(W)!);
  const { data: orphanCredits } = await admin.from("movie_credits").select("film_id").eq("film_id", idOf(W)!);
  check("deleting a film deletes its credits", (orphanCredits ?? []).length === 0, orphanCredits);
}

async function cleanup() {
  await admin.from("plays").delete().eq("game_id", GAME);
  await admin.from("puzzles").delete().eq("game_id", GAME); // cascades to puzzle_assets
  if (filmIds.length) await admin.from("movie_films").delete().in("id", filmIds); // cascades to credits
  if (personIds.length) await admin.from("movie_people").delete().in("id", personIds);
  for (const id of userIds) await admin.auth.admin.deleteUser(id); // cascades to profiles
}

try {
  await main();
} catch (error) {
  failures++;
  console.error("✗ smoke test crashed:", error);
} finally {
  await cleanup();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll database checks passed");
process.exit(failures ? 1 : 0);
