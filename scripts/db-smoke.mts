/**
 * Integration smoke test for the database contract the app relies on: auth with synthetic
 * username emails (including renames, which move the sign-in email), the lock-down of the public
 * API roles, what Supabase Auth's public sign-up can and can't do, the password-change guard,
 * display-name rules, puzzle upsert semantics, optimistic concurrency on plays, check constraints,
 * the leaderboard/streak functions (with the spoiler wall), puzzle assets, and the movie catalog
 * search.
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
/** Random, and always meets the hosted password rule (at least one letter and one digit). */
const randomPassword = () => `pw1-${randomBytes(12).toString("hex")}`;
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
const emailFor = (username: string) => `${username}@users.daily.invalid`;

interface Player {
  id: string;
  username: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

async function makePlayer(name: string): Promise<Player> {
  const username = `smoke_${name}_${tag}`;
  const email = emailFor(username);
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, username, display_name: displayNameFor(name) });
  if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);
  const client = createClient(url, publishableKey, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, username, email, password, client };
}

/** Username changes and first-sign-in provisioning (src/server/profiles.ts) rely on these. */
async function accountChecks(alice: Player, bob: Player) {
  const signsIn = async (username: string, password: string) => {
    const client = createClient(url, publishableKey, opts);
    const { error } = await client.auth.signInWithPassword({ email: emailFor(username), password });
    return !error;
  };

  const { error: takenRename } = await admin.from("profiles").update({ username: bob.username }).eq("id", alice.id);
  check("renaming a profile to a taken username is a unique violation (23505)", takenRename?.code === "23505", takenRename);

  // GoTrue's admin endpoint doesn't pre-check this; the unique index refuses it (as a 500).
  const { error: takenEmail } = await admin.auth.admin.updateUserById(alice.id, { email: emailFor(bob.username), email_confirm: true });
  check(
    "moving a sign-in email onto another account's is refused, and both still sign in",
    Boolean(takenEmail) && (await signsIn(alice.username, alice.password)) && (await signsIn(bob.username, bob.password)),
    takenEmail,
  );

  const renamed = `smoke_renamed_${tag}`;
  const { error: emailMove } = await admin.auth.admin.updateUserById(alice.id, { email: emailFor(renamed), email_confirm: true });
  check("the admin API moves a sign-in email without confirmation", !emailMove, emailMove);
  check("the new username signs in", await signsIn(renamed, alice.password));
  check("the old username no longer signs in", !(await signsIn(alice.username, alice.password)));
  const { data: stillSignedIn, error: sessionError } = await alice.client.auth.getUser();
  check("an existing session survives the email move", !sessionError && stillSignedIn.user?.id === alice.id, sessionError);
  const { error: moveBack } = await admin.auth.admin.updateUserById(alice.id, { email: emailFor(alice.username), email_confirm: true });
  check("the email moves back (the rename rollback path)", !moveBack && (await signsIn(alice.username, alice.password)), moveBack);

  const { data: collisions, error: matchError } = await admin
    .from("profiles")
    .select("username")
    .filter("username", "match", `^smoke_(alice|bob)_${tag}[0-9]*$`);
  check(
    "the regex filter used for username collisions works through PostgREST",
    !matchError && collisions?.map((r) => r.username).sort().join() === [alice.username, bob.username].sort().join(),
    { matchError, collisions },
  );

  const { error: duplicateProfile } = await admin.from("profiles").insert({ id: alice.id, username: `smoke_dup_${tag}`, display_name: displayNameFor("dup") });
  check("a second profile for the same account is a unique violation (23505)", duplicateProfile?.code === "23505", duplicateProfile);
  const { error: orphanProfile } = await admin
    .from("profiles")
    .insert({ id: "00000000-0000-4000-8000-000000000000", username: `smoke_orphan_${tag}`, display_name: displayNameFor("orphan") });
  check("a profile for a deleted account is a foreign-key violation (23503)", orphanProfile?.code === "23503", orphanProfile);
}

async function main() {
  // --- Auth with synthetic .invalid emails -----------------------------------------------
  const alice = await makePlayer("alice");
  const bob = await makePlayer("bob");
  check("password accounts on the .invalid domain can be created and sign in", true);
  await accountChecks(alice, bob);

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
  await publicSignUpChecks(alice);
  await profileChecks(alice);
  await assetChecks(alice.client);
  await catalogChecks(alice.client);
}

// --- Public roles: the publishable key and a user session reach nothing in `public` -----------
async function lockdownChecks(alice: Player) {
  const anon = createClient(url, publishableKey, opts);
  const tables = ["profiles", "plays", "puzzles", "puzzle_assets", "movie_films", "movie_people", "movie_credits", "rate_limits", "password_change_grants"];
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
  ] as const) {
    const { error: anonCall } = await anon.rpc(fn, args);
    const { error: userCall } = await alice.client.rpc(fn, args);
    check(`neither anon nor a player can call ${fn}()`, Boolean(anonCall) && Boolean(userCall), { anonCall, userCall });
  }
  const { data: key, error: keyError } = await admin.rpc("catalog_search_key", { value: "Amélie!" });
  check("the server can still call catalog_search_key()", !keyError && key === "amelie", { key, keyError });

}

// --- Passwords: only the server's admin reset can change one -------------------------------------
async function passwordChecks(alice: Player) {
  // What a stolen session would do: call Supabase Auth directly with the player's access token.
  const { data: session } = await alice.client.auth.getSession();
  const stolen = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishableKey, authorization: `Bearer ${session.session?.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ password: randomPassword() }),
  });
  check("a session can't change its own password through Supabase Auth", !stolen.ok, stolen.status);
  const { error: stillIn } = await alice.client.auth.refreshSession();
  check("…and the player's session survives the attempt", !stillIn, stillIn);
  const { error: oldPassword } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password: alice.password });
  check("…and their password is unchanged", !oldPassword, oldPassword);

  const newPassword = randomPassword();
  const { error: unauthorised } = await admin.auth.admin.updateUserById(alice.id, { password: newPassword });
  check("even the admin API can't change a password the server hasn't authorised", Boolean(unauthorised));

  const { error: allowError } = await admin.rpc("allow_password_change", { p_user_id: alice.id });
  const { error: authorised } = await admin.auth.admin.updateUserById(alice.id, { password: newPassword });
  check("an authorised admin reset changes the password", !allowError && !authorised, { allowError, authorised });
  const { error: newSignIn } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password: newPassword });
  check("…and the new password works", !newSignIn, newSignIn);
  const { error: reused } = await admin.auth.admin.updateUserById(alice.id, { password: randomPassword() });
  check("an authorisation is good for one change only", Boolean(reused));

  const { error: metadata } = await admin.auth.admin.updateUserById(alice.id, { user_metadata: { smoke: true } });
  check("other account updates aren't affected", !metadata, metadata);
  alice.password = newPassword;
}

// --- Supabase Auth's public sign-up: open (new Google players need it), but it can't make a player --
/**
 * Anyone can call Supabase Auth with the publishable key, so these check what that reaches without
 * the app. The settings half depends on how this Supabase is configured (supabase/config.toml
 * locally, the dashboard when hosted): with sign-up open, "Confirm email" must be on.
 */
async function publicSignUpChecks(alice: Player) {
  const settings = (await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } })).json()) as {
    disable_signup: boolean;
    mailer_autoconfirm: boolean;
    phone_autoconfirm: boolean;
  };
  const signUpOpen = !settings.disable_signup;
  const confirms = (autoconfirm: boolean) => (autoconfirm ? "off" : "on");
  console.log(
    `  · this Supabase: public sign-up ${signUpOpen ? "open" : "closed"}, Confirm email ${confirms(settings.mailer_autoconfirm)}, Confirm phone ${confirms(settings.phone_autoconfirm)}`,
  );
  check("public sign-up is closed, or open with Confirm email on (never a session for an unproven address)", !signUpOpen || !settings.mailer_autoconfirm, settings);
  // Supabase Auth answers a sign-up for an existing email like a new one only when neither email
  // nor phone sign-ups are auto-confirmed; otherwise it says "User already registered".
  check("public sign-up is closed, or open with Confirm phone on too (doesn't reveal who is registered)", !signUpOpen || !settings.phone_autoconfirm, settings);

  const outsider = createClient(url, publishableKey, opts);
  const password = randomPassword();

  // (a) Can't take over or sign in as an existing player by registering their sign-in email.
  const { data: copy, error: copyError } = await outsider.auth.signUp({ email: alice.email, password });
  check("signing up with a player's sign-in email gives no session", !copy?.session, { session: Boolean(copy?.session) });
  if (signUpOpen) {
    // A 422 `user_already_exists` here would make the endpoint an oracle for who is a member.
    check("…and is answered like any new sign-up, so it doesn't reveal that the player exists", !copyError && Boolean(copy?.user), copyError);
  }
  const { error: theirPassword } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password });
  check("…and the outsider's password doesn't open the player's account", Boolean(theirPassword));
  const { error: ownPassword } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password: alice.password });
  check("…and the player still signs in with their own password", !ownPassword, ownPassword);

  // (b) Can't get a usable account holding a free username's sign-in email; sign-up reclaims it.
  const squatEmail = emailFor(`smoke_squat_${tag}`);
  const { data: squat, error: squatError } = await outsider.auth.signUp({ email: squatEmail, password });
  if (squat?.user) userIds.push(squat.user.id);
  check("squatting a username's sign-in email gives no session", !squat?.session, { session: Boolean(squat?.session), squatError });
  if (signUpOpen && squat?.user) {
    const { error: squatSignIn } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: squatEmail, password });
    check("…and the squatter can't sign in with it (unconfirmed)", Boolean(squatSignIn), squatSignIn);
    const { data: profile } = await admin.from("profiles").select("id").eq("id", squat.user.id).maybeSingle();
    const { data: orphan } = await admin.rpc("orphan_auth_user_for_email", { p_email: squatEmail });
    check("…and it has no profile, so sign-up can find and remove it", !profile && orphan?.[0]?.id === squat.user.id, { profile, orphan });
  } else {
    check("…and with sign-up closed no auth user is created at all", !squat?.user && Boolean(squatError), { user: squat?.user?.id, squatError });
  }

  // (c) A session can't move itself onto another sign-in email without confirming it (undeliverable).
  if (settings.mailer_autoconfirm) {
    console.log("  · skipped the email-change check: Confirm email is off on this Supabase (config.toml turns it on; restart Supabase to apply)");
    return;
  }
  const { data: fresh, error: freshError } = await createClient(url, publishableKey, opts).auth.signInWithPassword({ email: alice.email, password: alice.password });
  if (freshError || !fresh.session) throw new Error(`signIn failed: ${freshError?.message}`);
  const move = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishableKey, authorization: `Bearer ${fresh.session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ email: emailFor(`smoke_moved_${tag}`) }),
  });
  console.log(`  · email change through Supabase Auth answered ${move.status}`);
  const { data: after } = await admin.auth.admin.getUserById(alice.id);
  check("a session can't move its account onto another username's sign-in email", after.user?.email === alice.email, after.user?.email);
}

// --- Profiles: visible display names, unique ignoring case; orphan auth users can be found ------
async function profileChecks(alice: Player) {
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
  const { data: orphan } = await admin.auth.admin.createUser({ email: orphanEmail, password: randomPassword(), email_confirm: true });
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
