/**
 * Integration smoke test for the database contract the app relies on: auth with synthetic
 * username emails, RLS, the password-change guard, single-use invites, puzzle upsert semantics, optimistic concurrency on plays, check
 * constraints, the leaderboard/streak functions, puzzle assets, and the movie catalog search.
 *
 * Runs against a live Supabase (local by default) and cleans up after itself.
 *   npm run db:start && npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

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

/** Display names are unique (ignoring case), so tag them like usernames. */
const displayNameFor = (name: string) => `${name} ${tag}`;

async function makePlayer(name: string): Promise<{ id: string; client: SupabaseClient; email: string; password: string }> {
  const username = `smoke_${name}_${tag}`;
  const email = `${username}@users.daily.invalid`;
  const password = randomBytes(12).toString("hex");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, username, display_name: displayNameFor(name) });
  if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);
  const client = createClient(url, publishableKey, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, client, email, password };
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

  const { data: aliceSees, error: aliceSeesError } = await alice.client.from("plays").select("user_id").eq("game_id", GAME);
  check("players cannot read plays directly, not even their own (42501)", aliceSeesError?.code === "42501" && !aliceSees, { aliceSees, aliceSeesError });

  // --- Leaderboard & streaks --------------------------------------------------------------
  const board_ = (from: number, to: number, viewer: string, today: number) =>
    admin.rpc("leaderboard", { p_from: day(from), p_to: day(to), p_game_ids: [GAME], p_viewer: viewer, p_today: day(today) });
  const { data: board, error: boardError } = await board_(1, 5, alice.id, 5);
  const a = board?.find((r: { user_id: string }) => r.user_id === alice.id);
  const b = board?.find((r: { user_id: string }) => r.user_id === bob.id);
  check("leaderboard sums points and counts plays/wins", !boardError && a?.points === 260 && a?.games_played === 4 && a?.wins === 4 && b?.points === 90 && b?.wins === 1, { boardError, a, b });
  check("leaderboard ranks by points", Boolean(a && b && a.rank < b.rank), { a, b });

  const { data: weekBoard } = await board_(4, 5, alice.id, 5);
  const aw = weekBoard?.find((r: { user_id: string }) => r.user_id === alice.id);
  check("leaderboard respects the date range", aw?.points === 150, aw);

  // Spoiler wall: on day 5 Bob hasn't played, so Alice's day-5 result (80, a win) is hidden from
  // him, on every board that includes that day; earlier days and his own plays still count.
  type BoardRow = { user_id: string; points: number; games_played: number; wins: number };
  const { data: bobsView } = await board_(1, 5, bob.id, 5);
  const aliceForBob = (bobsView as BoardRow[] | null)?.find((r) => r.user_id === alice.id);
  const bobForBob = (bobsView as BoardRow[] | null)?.find((r) => r.user_id === bob.id);
  check(
    "leaderboard hides others' results for today until the viewer finishes that game",
    aliceForBob?.points === 180 && aliceForBob.games_played === 3 && aliceForBob.wins === 3 && bobForBob?.points === 90,
    { aliceForBob, bobForBob },
  );
  const { data: todayForBob } = await board_(5, 5, bob.id, 5);
  check("today's board shows nothing of others' unfinished-for-viewer plays", (todayForBob as BoardRow[] | null)?.find((r) => r.user_id === alice.id)?.points === 0, todayForBob);
  const { data: aliceDay4 } = await board_(4, 4, alice.id, 4);
  check(
    "once the viewer has finished today's game, others' results for it show",
    (aliceDay4 as BoardRow[] | null)?.find((r) => r.user_id === bob.id)?.games_played === 1,
    aliceDay4,
  );

  const { error: rpcDenied } = await alice.client.rpc("leaderboard", { p_from: day(1), p_to: day(5), p_game_ids: [GAME], p_viewer: alice.id, p_today: day(5) });
  check("players cannot call leaderboard() directly", Boolean(rpcDenied));

  const { data: streaks } = await admin.rpc("streaks", { p_today: day(5), p_game_ids: [GAME] });
  const sa = streaks?.find((s: { user_id: string }) => s.user_id === alice.id);
  const sb = streaks?.find((s: { user_id: string }) => s.user_id === bob.id);
  check("current streak counts back from today; best streak across gaps", sa?.current_streak === 2 && sa?.best_streak === 2, sa);
  check("a streak ending yesterday is still current", sb?.current_streak === 2, sb);
  const { data: later } = await admin.rpc("streaks", { p_today: day(7), p_game_ids: [GAME] });
  check("a streak broken by a missed day resets to 0", later?.find((s: { user_id: string }) => s.user_id === alice.id)?.current_streak === 0, later);
  await lockdownChecks(alice);
  await passwordChecks(alice);
  await inviteChecks(alice);
  await profileChecks(alice);
  await assetChecks(alice.client);
  await catalogChecks(alice.client);
}

// --- Public roles: the publishable key and a user session reach nothing in `public` -----------
async function lockdownChecks(alice: { id: string; client: SupabaseClient }) {
  const anon = createClient(url, publishableKey, opts);
  const tables = ["profiles", "plays", "puzzles", "puzzle_assets", "movie_films", "movie_people", "movie_credits", "rate_limits", "invites", "password_change_grants"];
  for (const table of tables) {
    const { error: userRead } = await alice.client.from(table).select("*").limit(1);
    const { error: anonRead } = await anon.from(table).select("*").limit(1);
    check(`neither a signed-in user nor anon can read ${table} (42501)`, userRead?.code === "42501" && anonRead?.code === "42501", { userRead, anonRead });
  }
  const { error: profileWrite } = await alice.client.from("profiles").update({ is_admin: true }).eq("id", alice.id);
  check("a player cannot make themselves admin through the API", Boolean(profileWrite), profileWrite);
  const { data: me } = await admin.from("profiles").select("is_admin").eq("id", alice.id).single();
  check("…and the admin flag is unchanged", me?.is_admin === false, me);

  for (const [fn, args] of [
    ["catalog_search_key", { value: "Amélie" }],
    ["orphan_auth_user_for_email", { p_email: `smoke_alice_${tag}@users.daily.invalid` }],
    ["take_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 1 }],
    ["allow_password_change", { p_user_id: alice.id }],
    ["redeem_invite", { p_token_hash: "0".repeat(64), p_user_id: alice.id, p_username: "x", p_display_name: "x" }],
  ] as const) {
    const { error: anonCall } = await anon.rpc(fn, args);
    const { error: userCall } = await alice.client.rpc(fn, args);
    check(`neither anon nor a player can call ${fn}()`, Boolean(anonCall) && Boolean(userCall), { anonCall, userCall });
  }
  const { data: key, error: keyError } = await admin.rpc("catalog_search_key", { value: "Amélie!" });
  check("the server can still call catalog_search_key()", !keyError && key === "amelie", { key, keyError });

  // The app creates players with the admin API; public sign-up would hand outsiders a session and
  // let them squat <username>@users.daily.invalid. (supabase/config.toml: [auth] enable_signup.)
  const { data: signup, error: signupError } = await anon.auth.signUp({ email: `smoke_squat_${tag}@users.daily.invalid`, password: randomBytes(12).toString("hex") });
  if (signup?.user) userIds.push(signup.user.id);
  check("public sign-up through Supabase Auth is disabled", Boolean(signupError) && !signup?.user, { signupError, user: signup?.user?.id });
}

// --- Passwords: only the server's admin reset can change one -------------------------------------
async function passwordChecks(alice: { id: string; client: SupabaseClient; email: string; password: string }) {
  // What a stolen session would do: call Supabase Auth directly with the player's access token.
  const { data: session } = await alice.client.auth.getSession();
  const stolen = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishableKey, authorization: `Bearer ${session.session?.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ password: randomBytes(12).toString("hex") }),
  });
  check("a session can't change its own password through Supabase Auth", !stolen.ok, stolen.status);
  const { error: stillIn } = await alice.client.auth.refreshSession();
  check("…and the player's session survives the attempt", !stillIn, stillIn);
  const { error: oldPassword } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password: alice.password });
  check("…and their password is unchanged", !oldPassword, oldPassword);

  const newPassword = randomBytes(12).toString("hex");
  const { error: unauthorised } = await admin.auth.admin.updateUserById(alice.id, { password: newPassword });
  check("even the admin API can't change a password the server hasn't authorised", Boolean(unauthorised));

  const { error: allowError } = await admin.rpc("allow_password_change", { p_user_id: alice.id });
  const { error: authorised } = await admin.auth.admin.updateUserById(alice.id, { password: newPassword });
  check("an authorised admin reset changes the password", !allowError && !authorised, { allowError, authorised });
  const { error: newSignIn } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password: newPassword });
  check("…and the new password works", !newSignIn, newSignIn);
  const { error: reused } = await admin.auth.admin.updateUserById(alice.id, { password: randomBytes(12).toString("hex") });
  check("an authorisation is good for one change only", Boolean(reused));

  const { error: metadata } = await admin.auth.admin.updateUserById(alice.id, { user_metadata: { smoke: true } });
  check("other account updates aren't affected", !metadata, metadata);
  alice.password = newPassword;
}

// --- Invites: single use, expiring, and they create the profile atomically ---------------------
async function inviteChecks(alice: { id: string }) {
  const hash = (code: string) => createHash("sha256").update(code).digest("hex");
  const newAuthUser = async (name: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email: `smoke_${name}_${tag}@users.daily.invalid`, password: randomBytes(12).toString("hex"), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userIds.push(data.user.id);
    return data.user.id;
  };
  const inviteFor = async (code: string, expiresInMs: number) => {
    const now = Date.now();
    const { error } = await admin.from("invites").insert({
      token_hash: hash(code),
      note: `smoke ${tag}`,
      created_by: alice.id,
      created_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + expiresInMs).toISOString(),
    });
    if (error) throw new Error(`invite insert failed: ${error.message}`);
  };
  const redeem = (code: string, userId: string, name: string) =>
    admin.rpc("redeem_invite", { p_token_hash: hash(code), p_user_id: userId, p_username: `smoke_${name}_${tag}`, p_display_name: displayNameFor(name) });

  const code = `smoke-invite-${tag}`;
  await inviteFor(code, 3_600_000);
  const carol = await newAuthUser("carol");
  const { data: first, error: firstError } = await redeem(code, carol, "carol");
  const { data: carolProfile } = await admin.from("profiles").select("id").eq("id", carol).maybeSingle();
  const { data: spent } = await admin.from("invites").select("used_by, used_at").eq("token_hash", hash(code)).single();
  check("an invite creates its player's profile and records who used it", first === true && !firstError && Boolean(carolProfile) && spent?.used_by === carol && Boolean(spent.used_at), { first, firstError, spent });

  const dave = await newAuthUser("dave");
  const { data: second } = await redeem(code, dave, "dave");
  const { data: daveProfile } = await admin.from("profiles").select("id").eq("id", dave).maybeSingle();
  check("an invite works only once", second === false && !daveProfile, { second, daveProfile });

  const expired = `smoke-expired-${tag}`;
  await inviteFor(expired, -1_000);
  const { data: late } = await redeem(expired, dave, "dave");
  check("an expired invite doesn't work", late === false, late);

  const taken = `smoke-taken-${tag}`;
  await inviteFor(taken, 3_600_000);
  const { error: dupName } = await admin.rpc("redeem_invite", { p_token_hash: hash(taken), p_user_id: dave, p_username: `smoke_carol_${tag}`, p_display_name: displayNameFor("dave") });
  const { data: stillOpen } = await admin.from("invites").select("used_at").eq("token_hash", hash(taken)).single();
  check("a taken username fails the redeem (23505) and leaves the invite unused", dupName?.code === "23505" && stillOpen?.used_at === null, { dupName, stillOpen });
  await admin.from("invites").delete().eq("note", `smoke ${tag}`);
}

// --- Profiles: visible display names, unique ignoring case; orphan auth users can be found ------
async function profileChecks(alice: { id: string }) {
  const { error: hidden } = await admin.from("profiles").update({ display_name: "\u200B" }).eq("id", alice.id);
  check("a display name can't be invisible (23514)", hidden?.code === "23514", hidden);
  const { error: bidi } = await admin.from("profiles").update({ display_name: "\u202Enimda" }).eq("id", alice.id);
  check("a display name can't contain a bidi override (23514)", bidi?.code === "23514", bidi);
  const { error: emoji } = await admin.from("profiles").update({ display_name: `${displayNameFor("alice")} \u{1F469}\u200D\u{1F4BB}` }).eq("id", alice.id);
  check("emoji (with joiners) are fine in display names", !emoji, emoji);
  const { error: dupBob } = await admin.from("profiles").update({ display_name: displayNameFor("BOB") }).eq("id", alice.id);
  check("display names are unique ignoring case (23505)", dupBob?.code === "23505" && dupBob.message.includes("profiles_display_name_lower_key"), dupBob);
  await admin.from("profiles").update({ display_name: displayNameFor("alice") }).eq("id", alice.id);

  const orphanEmail = `smoke_orphan_${tag}@users.daily.invalid`;
  const { data: orphan } = await admin.auth.admin.createUser({ email: orphanEmail, password: randomBytes(12).toString("hex"), email_confirm: true });
  if (orphan.user) userIds.push(orphan.user.id);
  const { data: found } = await admin.rpc("orphan_auth_user_for_email", { p_email: orphanEmail.toUpperCase() });
  check("an auth user without a profile is found by email", found?.length === 1 && found[0].id === orphan.user?.id, found);
  const { data: notOrphan } = await admin.rpc("orphan_auth_user_for_email", { p_email: `smoke_alice_${tag}@users.daily.invalid` });
  check("a player with a profile is never reported as an orphan", notOrphan?.length === 0, notOrphan);
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
