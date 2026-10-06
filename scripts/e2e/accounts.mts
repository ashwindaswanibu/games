/**
 * End-to-end suite for accounts: drives the installed Chrome at phone size against a local dev
 * server and checks that nobody is asked for anything on the way in, and that players can rename
 * themselves later.
 *
 *   npx next dev -p 3300            (in another terminal; set E2E_BASE_URL for another port)
 *   npm run test:e2e:accounts
 *
 *   1. Password sign-up (no invite code, display name left blank) lands on Today.
 *   2. A first sign-in without a profile (a Google-like account: Google provider, real email,
 *      `full_name`) gets a profile named from its identity and lands on Today with a welcome note;
 *      a second account with the same name gets the next free username; with no name, the email
 *      is used; two tabs at once still make exactly one profile. A profile-less account that isn't
 *      from Google (as Supabase's own sign-up endpoint would make) gets no profile and is signed
 *      out.
 *   3. Edit profile: a password account's rename moves its sign-in (the new username signs in, the
 *      old one doesn't); a Google-like account's rename only touches the profile; taken and invalid
 *      usernames get friendly errors; old profile URLs 404.
 *   4. /admin still lists both accounts with how they sign in.
 *
 * Every account it creates carries a random tag and is deleted at the end (local database only).
 */
import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import type { Browser, BrowserContext, Page } from "puppeteer-core";
import type { Database } from "@/server/database.types";
import { clickButton, collectPageErrors, cookieHeader, launchChrome, newPhonePage, pageSays, signIn, WAIT_MS } from "./lib/browser.mjs";
import { e2eDb, type E2eDb } from "./lib/db.mjs";
import { e2eAccountsEnv, type E2eAccountsEnv } from "./lib/env.mjs";
import { Report } from "./lib/report.mjs";

const PASSWORD_DOMAIN = "users.daily.invalid";
const tag = randomBytes(3).toString("hex");
/** Random, and always meets the hosted password rule (at least one letter and one digit). */
const randomPassword = () => `pw1-${randomBytes(12).toString("hex")}`;

interface Ctx {
  env: E2eAccountsEnv;
  db: E2eDb;
  browser: Browser;
  report: Report;
  errors: string[];
  /** Auth user ids to delete at the end. */
  created: Set<string>;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function profileById(db: E2eDb, id: string) {
  const { data, error } = await db.from("profiles").select("id, username, display_name").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load profile ${id}: ${error.message}`);
  return data;
}

async function authEmail(db: E2eDb, id: string): Promise<string | undefined> {
  const { data, error } = await db.auth.admin.getUserById(id);
  if (error) throw new Error(`Failed to load auth user ${id}: ${error.message}`);
  return data.user.email;
}

/** A phone page in `context` whose console errors count against the run. */
async function trackedPage(ctx: Ctx, context: BrowserContext): Promise<Page> {
  const page = await newPhonePage(context);
  const pageErrors = collectPageErrors(page);
  page.on("close", () => ctx.errors.push(...pageErrors));
  return page;
}

/** An isolated browser profile (its own cookies, so its own account) with one phone page. */
async function freshPage(ctx: Ctx): Promise<{ context: BrowserContext; page: Page }> {
  const context = await ctx.browser.createBrowserContext();
  return { context, page: await trackedPage(ctx, context) };
}

async function waitForPath(page: Page, pathname: string): Promise<void> {
  await page.waitForFunction((want) => window.location.pathname === want, { timeout: WAIT_MS }, pathname);
}

/**
 * A confirmed account with a real (non-username) email and Google-style metadata, but no profile.
 * `google: false` makes a plain email account instead, like one from Supabase's public sign-up
 * endpoint. (The admin API keeps the `provider`/`providers` it's given, which is what the session's
 * claims carry; it's the one part of a Google account this can't make for real.)
 */
async function createGoogleLikeUser(ctx: Ctx, email: string, fullName: string, google = true): Promise<{ id: string; password: string }> {
  const password = randomPassword();
  const { data, error } = await ctx.db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, name: fullName, email },
    ...(google && { app_metadata: { provider: "google", providers: ["google"] } }),
  });
  if (error || !data.user) throw new Error(`createUser(${email}) failed: ${error?.message}`);
  ctx.created.add(data.user.id);
  return { id: data.user.id, password };
}

/**
 * Signs `context` in as an account the login form can't reach (it only takes usernames): signs in
 * with the same cookie-based client the app uses, then hands its session cookies to the browser.
 */
async function signInWithEmail(ctx: Ctx, context: BrowserContext, email: string, password: string): Promise<void> {
  const jar = new Map<string, string>();
  const supabase = createServerClient<Database>(ctx.env.NEXT_PUBLIC_SUPABASE_URL, ctx.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(cookies) {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword(${email}) failed: ${error.message}`);
  for (let i = 0; jar.size === 0 && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  if (jar.size === 0) throw new Error("The session client never wrote its cookies");
  const domain = new URL(ctx.env.E2E_BASE_URL).hostname;
  await context.setCookie(...[...jar].map(([name, value]) => ({ name, value, domain, path: "/", sameSite: "Lax" as const })));
}

/** Opens the owner's "Edit profile" panel and submits new values. */
async function submitProfileEdit(page: Page, values: { username?: string; displayName?: string }): Promise<void> {
  await page.waitForSelector("details summary");
  const open = await page.$eval("details", (el) => (el as HTMLDetailsElement).open);
  if (!open) await page.click("details summary");
  for (const [name, value] of Object.entries({ username: values.username, displayName: values.displayName })) {
    if (value === undefined) continue;
    const input = await page.waitForSelector(`details input[name="${name}"]`, { visible: true });
    if (!input) throw new Error(`No ${name} field in Edit profile`);
    await input.evaluate((el) => ((el as HTMLInputElement).value = ""));
    await input.type(value);
  }
  await clickButton(page, "Save");
}

async function signOutFromProfile(page: Page): Promise<void> {
  await clickButton(page, "Sign out");
  await waitForPath(page, "/login");
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

interface PasswordAccount {
  id: string;
  username: string;
  password: string;
}

async function passwordSignUp(ctx: Ctx): Promise<PasswordAccount> {
  const { report, env } = ctx;
  const username = `e2e_pw_${tag}`;
  const password = randomPassword();
  const { context, page } = await freshPage(ctx);

  await page.goto(`${env.E2E_BASE_URL}/signup`, { waitUntil: "networkidle0" });
  report.check("the sign-up form has no invite code field", (await page.$('input[name="inviteCode"]')) === null);
  report.check("the sign-up page doesn't mention an invite code", !(await pageSays(page, "nvite")));
  await page.type('input[name="username"]', username);
  await page.type('input[name="password"]', password);
  await clickButton(page, "Create account");
  await waitForPath(page, "/");
  report.check("password sign-up lands on Today", true);
  const onboarding = await fetch(`${env.E2E_BASE_URL}/onboarding`, { headers: { Cookie: await cookieHeader(context, env.E2E_BASE_URL) }, redirect: "manual" });
  report.equal("there is no onboarding page any more (signed in: 404)", onboarding.status, 404);

  const { data: profile, error } = await ctx.db.from("profiles").select("id, username, display_name").eq("username", username).maybeSingle();
  if (error || !profile) throw new Error(`No profile after sign-up: ${error?.message ?? "missing"}`);
  ctx.created.add(profile.id);
  report.equal("a blank display name defaults to the username", profile.display_name, username);
  report.equal("the account signs in with its synthetic email", await authEmail(ctx.db, profile.id), `${username}@${PASSWORD_DOMAIN}`);
  await page.close();
  return { id: profile.id, username, password };
}

interface GoogleLikeAccount {
  id: string;
  email: string;
  password: string;
  fullName: string;
}

async function autoProvision(ctx: Ctx): Promise<GoogleLikeAccount> {
  const { report, env, db } = ctx;
  const handle = `e2e.g${tag}`;
  const fullName = `Zoë ${tag} Ångström-Lee`;
  const base = `zoe_${tag}_angs`; // folded, separators → _, cut to 15

  // First account: lands on "/" through requireProfile → /auth/welcome → "/".
  const first = { email: `${handle}+daily@example.com`, fullName };
  const firstUser = await createGoogleLikeUser(ctx, first.email, first.fullName);
  const one = await freshPage(ctx);
  await signInWithEmail(ctx, one.context, first.email, firstUser.password);
  const response = await one.page.goto(`${env.E2E_BASE_URL}/`, { waitUntil: "networkidle0" });
  report.equal("a profile-less account opening the app ends up on Today", new URL(one.page.url()).pathname, "/");
  report.check("…via the welcome handler", response?.request().redirectChain().some((r) => new URL(r.url()).pathname === "/auth/welcome") ?? false);
  const firstProfile = await profileById(db, firstUser.id);
  report.equal("the username comes from Google's name, not the email", firstProfile?.username, base);
  report.equal("the display name comes from Google's full name", firstProfile?.display_name, fullName);
  report.check("Today greets the new player by name", await pageSays(one.page, "Hey Zoë"));
  report.check("…and says where to change their name", await pageSays(one.page, `@${base}`) && (await pageSays(one.page, "Change either on your profile")));

  // Visiting the handler again is harmless.
  await one.page.goto(`${env.E2E_BASE_URL}/auth/welcome`, { waitUntil: "networkidle0" });
  report.equal("the welcome handler sends an existing player to Today", new URL(one.page.url()).pathname, "/");
  report.equal("…without touching their profile", (await profileById(db, firstUser.id))?.username, base);
  await one.page.close();

  // Second account, same name: next free username and display name (display names are unique).
  const second = await createGoogleLikeUser(ctx, `${handle}@example.org`, fullName);
  const two = await freshPage(ctx);
  await signInWithEmail(ctx, two.context, `${handle}@example.org`, second.password);
  await two.page.goto(`${env.E2E_BASE_URL}/auth/welcome`, { waitUntil: "networkidle0" });
  report.equal("the second account lands on Today", new URL(two.page.url()).pathname, "/");
  const secondProfile = await profileById(db, second.id);
  report.equal("a username collision gets the next number", secondProfile?.username, `${base}2`);
  report.equal("a display name someone already goes by gets the next number", secondProfile?.display_name, `${fullName} 2`);
  await two.page.close();

  // No name from Google: the username comes from the email, and the display name is the username.
  const nameless = await createGoogleLikeUser(ctx, `e2e.n${tag}+x@example.org`, "");
  const three = await freshPage(ctx);
  await signInWithEmail(ctx, three.context, `e2e.n${tag}+x@example.org`, nameless.password);
  await three.page.goto(`${env.E2E_BASE_URL}/`, { waitUntil: "networkidle0" });
  report.equal("a nameless account lands on Today", new URL(three.page.url()).pathname, "/");
  report.equal(
    "…named from the email's local-part (dots → _, +tag dropped), display name = username",
    await profileById(db, nameless.id).then((p) => [p?.username, p?.display_name]),
    [`e2e_n${tag}`, `e2e_n${tag}`],
  );
  await three.page.close();

  // Not from Google: no profile, signed out, told why.
  const outsider = await createGoogleLikeUser(ctx, `e2e_x${tag}@${PASSWORD_DOMAIN}`, "Outsider", false);
  const four = await freshPage(ctx);
  await signInWithEmail(ctx, four.context, `e2e_x${tag}@${PASSWORD_DOMAIN}`, outsider.password);
  await four.page.goto(`${env.E2E_BASE_URL}/`, { waitUntil: "networkidle0" });
  report.equal("a profile-less non-Google account ends up on /login", new URL(four.page.url()).pathname, "/login");
  report.check("…with an explanation", await pageSays(four.page, "can't be used here"));
  report.equal("…and gets no profile", await profileById(db, outsider.id), null);
  await four.page.goto(`${env.E2E_BASE_URL}/`, { waitUntil: "networkidle0" });
  report.equal("…and is signed out (the app sends it to /login again)", new URL(four.page.url()).pathname, "/login");
  await four.page.close();

  // Third account, two tabs at once: exactly one profile, both tabs on Today.
  const third = await createGoogleLikeUser(ctx, `e2e.race${tag}@example.com`, `Race ${tag}`);
  const race = await freshPage(ctx);
  await signInWithEmail(ctx, race.context, `e2e.race${tag}@example.com`, third.password);
  const tabB = await trackedPage(ctx, race.context);
  await Promise.all([
    race.page.goto(`${env.E2E_BASE_URL}/auth/welcome`, { waitUntil: "networkidle0" }),
    tabB.goto(`${env.E2E_BASE_URL}/auth/welcome`, { waitUntil: "networkidle0" }),
  ]);
  report.check(
    "two tabs provisioning at once both land on Today",
    new URL(race.page.url()).pathname === "/" && new URL(tabB.url()).pathname === "/",
    [race.page.url(), tabB.url()],
  );
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("id", third.id);
  report.equal("…and exactly one profile exists", count, 1);
  report.equal("…named from the identity", (await profileById(db, third.id))?.username, `race_${tag}`);
  await tabB.close();
  await race.page.close();

  // Signed out, the handler sends people to sign in.
  const anon = await freshPage(ctx);
  await anon.page.goto(`${env.E2E_BASE_URL}/auth/welcome`, { waitUntil: "networkidle0" });
  report.equal("signed out, the welcome handler redirects to /login", new URL(anon.page.url()).pathname, "/login");
  await anon.page.close();

  return { id: firstUser.id, email: first.email, password: firstUser.password, fullName };
}

async function renamePasswordAccount(ctx: Ctx, account: PasswordAccount): Promise<string> {
  const { report, env, db } = ctx;
  const newUsername = `e2e_rn_${tag}`;
  const { context, page } = await freshPage(ctx);
  await signIn(page, env.E2E_BASE_URL, account.username, account.password);

  await page.goto(`${env.E2E_BASE_URL}/u/${account.username}`, { waitUntil: "networkidle0" });
  report.check("the owner sees Edit profile", await pageSays(page, "Edit profile"));

  await submitProfileEdit(page, { username: "ab" });
  await page.waitForSelector('details input[name="username"][aria-invalid="true"]');
  report.check("a too-short username gets a field error", await pageSays(page, "3–20 characters"));

  await submitProfileEdit(page, { username: newUsername, displayName: `Renamed ${tag}` });
  await waitForPath(page, `/u/${newUsername}`);
  report.equal("saving goes to the new profile URL", new URL(page.url()).searchParams.get("saved"), "username");
  report.check("the page says to sign in with the new username", await pageSays(page, "Sign in with your new username next time"));
  report.check("the page shows the new handle", await pageSays(page, `@${newUsername}`));
  const navHref = await page.$eval('nav[data-app-chrome="bottom-nav"] a[href^="/u/"]', (a) => a.getAttribute("href"));
  report.equal("the bottom nav links to the new profile", navHref, `/u/${newUsername}`);

  const profile = await profileById(db, account.id);
  report.equal("the profile has the new username and display name", [profile?.username, profile?.display_name], [newUsername, `Renamed ${tag}`]);
  report.equal("the sign-in email moved with the username", await authEmail(db, account.id), `${newUsername}@${PASSWORD_DOMAIN}`);

  const oldUrl = await fetch(`${env.E2E_BASE_URL}/u/${account.username}`, { headers: { Cookie: await cookieHeader(context, env.E2E_BASE_URL) } });
  report.equal("the old profile URL is gone (404)", oldUrl.status, 404);

  await page.goto(`${env.E2E_BASE_URL}/leaderboard`, { waitUntil: "networkidle0" });
  report.equal("the leaderboard still renders", new URL(page.url()).pathname, "/leaderboard");

  await page.goto(`${env.E2E_BASE_URL}/u/${newUsername}`, { waitUntil: "networkidle0" });
  await signOutFromProfile(page);
  await signIn(page, env.E2E_BASE_URL, newUsername, account.password);
  report.check("the new username signs in", true);

  const again = await freshPage(ctx);
  await again.page.goto(`${env.E2E_BASE_URL}/login`, { waitUntil: "networkidle0" });
  await again.page.type('input[name="username"]', account.username);
  await again.page.type('input[name="password"]', account.password);
  await clickButton(again.page, "Sign in");
  await again.page.waitForSelector('[role="alert"]');
  report.check("the old username no longer signs in", await pageSays(again.page, "Wrong username or password."));
  await again.page.close();
  await page.close();
  return newUsername;
}

async function renameGoogleLikeAccount(ctx: Ctx, account: GoogleLikeAccount, takenUsername: string): Promise<string> {
  const { report, env, db } = ctx;
  const newUsername = `e2e_gr_${tag}`;
  const { context, page } = await freshPage(ctx);
  await signInWithEmail(ctx, context, account.email, account.password);
  const before = await profileById(db, account.id);
  if (!before) throw new Error("The Google-like account has no profile");

  await page.goto(`${env.E2E_BASE_URL}/u/${before.username}`, { waitUntil: "networkidle0" });
  await submitProfileEdit(page, { username: takenUsername });
  await page.waitForSelector('details input[name="username"][aria-invalid="true"]');
  report.check("a taken username gets a friendly error", await pageSays(page, "That username is taken."));
  report.equal("…and nothing changes", (await profileById(db, account.id))?.username, before.username);

  await submitProfileEdit(page, { username: before.username, displayName: `Zoë ${tag}` });
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("saved") === "profile", { timeout: WAIT_MS });
  report.equal("a display-name-only change keeps the URL", new URL(page.url()).pathname, `/u/${before.username}`);
  report.check("…and says it saved", await pageSays(page, "Profile saved."));

  await submitProfileEdit(page, { username: newUsername.toUpperCase() });
  await waitForPath(page, `/u/${newUsername}`);
  report.equal("a username change (typed in capitals) is saved lowercased", (await profileById(db, account.id))?.username, newUsername);
  report.check("…with a plain saved notice (sign-in is unaffected)", (await pageSays(page, "Profile saved.")) && !(await pageSays(page, "Sign in with your new username")));
  report.equal("the Google account's email is untouched", await authEmail(db, account.id), account.email);

  await page.goto(`${env.E2E_BASE_URL}/`, { waitUntil: "networkidle0" });
  report.equal("the renamed player still opens Today", new URL(page.url()).pathname, "/");
  await page.close();
  return newUsername;
}

async function otherProfileHasNoEdit(ctx: Ctx, viewer: GoogleLikeAccount, otherUsername: string): Promise<void> {
  const { context, page } = await freshPage(ctx);
  await signInWithEmail(ctx, context, viewer.email, viewer.password);
  await page.goto(`${ctx.env.E2E_BASE_URL}/u/${otherUsername}`, { waitUntil: "networkidle0" });
  ctx.report.check("someone else's profile has no Edit profile control", !(await pageSays(page, "Edit profile")));
  ctx.report.check("…and no edit form", (await page.$('input[name="username"]')) === null);
  await page.close();
}

async function adminLists(ctx: Ctx, passwordUsername: string, googleUsername: string): Promise<void> {
  const { page } = await freshPage(ctx);
  await signIn(page, ctx.env.E2E_BASE_URL, ctx.env.E2E_TEST_USERNAME, ctx.env.E2E_TEST_PASSWORD);
  await page.goto(`${ctx.env.E2E_BASE_URL}/admin`, { waitUntil: "networkidle0" });
  ctx.report.check("/admin lists the renamed password account as password", await pageSays(page, `@${passwordUsername} · password`));
  ctx.report.check("/admin lists the renamed Google-like account as Google", await pageSays(page, `@${googleUsername} · Google`));
  await page.close();
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

/**
 * Deletes every account this run made (profiles cascade), plus their rate-limit counters,
 * including the sign-up and sign-in counters (local database only), so reruns (and the Movies
 * suite right after) don't hit the hourly sign-up or five-minute sign-in limits.
 */
async function cleanUp(ctx: Ctx): Promise<void> {
  const { data } = await ctx.db.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) if (user.email?.includes(tag)) ctx.created.add(user.id);
  for (const id of ctx.created) {
    const { error } = await ctx.db.auth.admin.deleteUser(id);
    if (error) console.error(`  ! couldn't delete test user ${id}: ${error.message}`);
  }
  if (ctx.created.size > 0) {
    await ctx.db.from("rate_limits").delete().in("key", [...ctx.created].map((id) => `profileEdits:${id}`));
  }
  await ctx.db.from("rate_limits").delete().like("key", "signUps%");
  await ctx.db.from("rate_limits").delete().like("key", "signIn%");
  console.log(`\n  · deleted ${ctx.created.size} test account${ctx.created.size === 1 ? "" : "s"}`);
}

async function main(): Promise<boolean> {
  const env = e2eAccountsEnv();
  const report = new Report();
  const db = e2eDb(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

  report.section("setup");
  report.note(`run tag ${tag}`);
  const health = await fetch(`${env.E2E_BASE_URL}/login`).catch((error: unknown) => error);
  if (!report.check(`the dev server answers at ${env.E2E_BASE_URL}`, health instanceof Response && health.ok, health instanceof Error ? health.message : undefined)) {
    return false;
  }

  const browser = await launchChrome(env.E2E_CHROME_PATH);
  const ctx: Ctx = { env, db, browser, report, errors: [], created: new Set() };
  try {
    let password: PasswordAccount | undefined;
    let google: GoogleLikeAccount | undefined;
    let renamedPassword: string | undefined;
    let renamedGoogle: string | undefined;
    await report.runSection("password sign-up", async () => {
      password = await passwordSignUp(ctx);
    });
    await report.runSection("first sign-in without a profile", async () => {
      google = await autoProvision(ctx);
    });
    await report.runSection("rename a password account", async () => {
      if (!password) throw new Error("skipped: no password account");
      renamedPassword = await renamePasswordAccount(ctx, password);
    });
    await report.runSection("rename a Google-like account", async () => {
      if (!google || !renamedPassword) throw new Error("skipped: needs both accounts");
      renamedGoogle = await renameGoogleLikeAccount(ctx, google, renamedPassword);
      await otherProfileHasNoEdit(ctx, google, renamedPassword);
    });
    await report.runSection("admin", async () => {
      if (!renamedPassword || !renamedGoogle) throw new Error("skipped: needs both renamed accounts");
      await adminLists(ctx, renamedPassword, renamedGoogle);
    });

    report.section("browser health");
    for (const context of browser.browserContexts()) for (const page of await context.pages()) await page.close();
    report.check("no console errors or uncaught page errors", ctx.errors.length === 0, ctx.errors);
  } finally {
    await browser.close();
    await cleanUp(ctx);
  }

  console.log(report.summary());
  return !report.failed;
}

main().then(
  (passed) => process.exit(passed ? 0 : 1),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
