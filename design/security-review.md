# Security review: Daily Games

October 6, 2026. Covers the uncommitted working tree on `main`, based on commit 35d0a3a. The changes are 60 modified tracked files plus 28 new files or folders, including 6 migrations.

**Updated after merging `frictionless-signin` (branch `integration`).** The owner decided against any invite system: sign-up is open (username and password, or Google), and a first Google sign-in gets a profile automatically and lands on Today. Every invite item below is marked *superseded by owner decision: open sign-up*, the invite code is gone from the app, the database (migration `20261010000000_remove_invites`), the env vars and the docs, and the "username squatting through public sign-up" fix was re-evaluated for open sign-up (see [Open sign-up re-evaluation](#open-sign-up-re-evaluation)). Every other fix stands.

## Summary

The core is sound. Puzzle solutions and images stay on the server until you have earned them, every action checks who you are, nothing secret is in git or in the browser bundle, and RLS blocks all writes. The real gaps were around the edges:
- anyone with a Supabase session could read the player list;
- one shared invite code let a friend create alt accounts to see answers early (*superseded by owner decision: open sign-up*; with open sign-up this is an accepted risk, see below);
- nothing throttled password guessing or account creation;
- a stolen session could change the account's password.

Those are fixed in code (the invite fix since withdrawn by the owner), but **none of it is live yet**: it is committed on the `integration` branch only, not deployed or pushed to the hosted database.

**Your Google error.** "Unsupported provider: provider is not enabled" came from the site showing "Continue with Google" while Google was switched off in Supabase. At 21:29 UTC today, Supabase had Google switched on (its authorize endpoint now redirects to Google), so that exact error should be gone. A full Google sign-in also needs the redirect URLs and the deploy in steps 3–7 below. Because Google sign-ups are open and the old database policy is still live, **anyone with a Google account can currently read every player's username, display name and admin flag** through the API. Step 5 (the migrations) closes that. (With open sign-up, anyone can of course still join and see the boards *through the app*; that is now by design.)

## Fixed

Severity is the rating after independent verification, for a private friends app.

| Issue | Severity | Who could exploit it | What changed | Test added |
|---|---|---|---|---|
| Any signed-in Supabase user (no profile needed) could read every profile, including who is an admin | Low (live now via Google) | Outsider with any Google account or confirmable email | Migration `20261008000000_lock_down_public_roles` drops both RLS policies and revokes all table, sequence and function grants from `anon`/`authenticated`, plus the default grants for future objects. (Public sign-up is back **on** after the merge, for Google; see the re-evaluation) | db-smoke `lockdownChecks`: every table refuses anon and signed-in users, no self-promotion to admin, RPCs refused |
| Outsider could block a username by pre-registering `<name>@users.daily.invalid` | Low | Outsider | Re-evaluated for open sign-up and kept: `reclaimSignInEmail` (`src/server/profiles.ts`) deletes a profile-less auth user older than 2 minutes holding that email, on sign-up (then retries once) and now also before a password account renames to that username (`orphan_auth_user_for_email`, service role only). While the holder is younger than that, a rename says "That username is taken" rather than a generic failure, as it does if someone claims the email between the check and the move | `profiles.test.ts` (reclaim, in-flight sign-up left alone, players never removed, young holder and race read as taken), `(auth)/actions.test.ts`; db-smoke orphan and `publicSignUpChecks` |
| A stolen session could set a new password without the old one and lock the owner out | Medium | Session thief | Migration `20261009000000_password_change_guard`: a trigger on `auth.users` refuses any password change the server didn't pre-authorise with a one-minute grant. Only the admin reset grants one. `secure_password_change = true` | db-smoke `passwordChecks` (7 checks, including a direct Supabase Auth call with a stolen token) |
| Admins could reset their own password with no reauthentication, or reset/demote other admins, including the owner | Medium | Stolen admin session | `src/server/admin-policy.ts`: nobody resets their own password, nobody can act on an owner (`OWNER_USER_IDS`), and only an owner can act on another admin. `requireAdmin` re-checks the session with Supabase on every call. Admin actions are logged | `admin-policy.test.ts`, `admin/actions.test.ts` |
| One shared invite code let a friend make alt accounts to see today's answer before playing on their main | Medium | Friend | **Superseded by owner decision: open sign-up.** The single-use invites (migration `20261009000100_invites`) were removed again by `20261010000000_remove_invites`, along with `/admin` invites, `npm run invite` and the onboarding form. Alt accounts are now an accepted risk | (removed) |
| Invite checks had no rate limit | Low | Outsider | **Superseded by owner decision: open sign-up** (no invite checks left). Account creation is limited instead: 5 password sign-ups per hour per client network and 50 per hour overall | `auth-limits.test.ts`, `(auth)/actions.test.ts` |
| Password sign-in had no throttle | Medium | Outsider | 10 per 5 min per client network and 10 per 15 min per username, checked before Supabase is called. A client network is an IPv4 address or an IPv6 /64 (was the full IPv6 address) | `auth-limits.test.ts`, `client-ip.test.ts`, `(auth)/actions.test.ts` |
| Leaderboard, Today standings and profile pages showed friends' results for today before you had played | Low | Friend | Migration `20261008000100_leaderboard_spoiler_wall`: today's results for a game count only once the viewer has finished it. This covers points, wins, rank, labels and history | db-smoke spoiler checks; `leaderboards.test.ts` |
| Display names could be invisible, bidi-reversed or copies of another friend's name | Low | Friend or outsider | NFC normalisation, invisible and control characters rejected in both the app and the DB (`20261008000200_display_name_rules`), case-insensitive unique names, and `@username` shown on boards. Auto-provisioned Google names are tidied to the same rules (`tidyDisplayName`), and a name already in use gets a number (`Ana Ruiz 2`) | `validation.test.ts`, `username.test.ts`, `profiles.test.ts`; db-smoke; both E2E suites |
| 1–2 character catalog searches cost about 1 s of DB time each | Low (Medium once Movies goes live) | Friend or session thief | Migration `20261008000300_catalog_search_key_once` computes the key once per call (1.29 s → 0.23 s). The normalised key must be at least 2 characters. Catalog limit cut from 40 to 20 per 10 s | `schemas.test.ts`; existing db-smoke search checks |
| The image route could drain the Supabase egress quota | Low (Medium once asset games go live) | Friend or session thief | 40 per 10 s plus 1000 per day per player; `ETag`/304 so repeat views skip the bytes | `http.test.ts` |
| Session cookies were readable from JavaScript | Low | Anyone who finds an XSS | `httpOnly`, `secure` in production, `sameSite: lax` (`src/lib/auth-cookies.ts`) | Manual Chrome check; E2E |
| No clickjacking protection or security headers; `x-powered-by` sent | Low | Malicious site framing ours | `next.config.ts`: CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `poweredByHeader: false` | `curl -I` on local |
| Testing games' names and rules shipped in every player's JS | Low | Friend | Each game has its own route, so a testing game's code is only in its admin-only route | `npm run test:bundles`; `registry.test.ts` |
| Moves and game starts were unthrottled | Low | Friend | `moves` bucket, 30 per 10 s | E2E plays every game |
| *Merge review:* Supabase Auth's public sign-up said "User already registered" for a player's sign-in email or Gmail address, so anyone with the publishable key could test who is a member | Low | Outsider | Supabase only answers a repeat sign-up like a new one when neither email nor phone sign-ups are auto-confirmed, and `config.toml` had phone auto-confirm on (`[auth.sms] enable_confirmations = false`). Now `true`; the hosted project needs phone confirmations on too (step 4) | db-smoke `publicSignUpChecks`: with sign-up open, Confirm phone must be on and a sign-up with a player's email must be answered 200 with no session |
| *Merge review:* any 422 from creating an account read as "That username is taken", including Supabase refusing a weak or breached password once the hosted password rules (step 4) are on. Players would try other names and use up their sign-up allowance | Medium | Nobody (a usability failure on the main way in) | Only `email_exists`/`user_already_exists` mean taken (`isEmailTaken`); `weak_password` is reported on the password field with Supabase's reason (`weakPasswordMessage`, also used by the admin reset). `passwordSchema` now requires a letter and a digit, matching the hosted rule and `password_requirements` in `config.toml` | `(auth)/actions.test.ts` (weak password, other 422s), `admin/actions.test.ts`, `validation.test.ts` |
| Profile edits (username, display name) were new with the merge | Low | Friend | `profileEdits` bucket, 10 per hour per player; renames are a compare-and-set, and a password account's sign-in email moves with its username | `profiles.test.ts`; accounts E2E |
| `catalog_search_key` was callable by anyone | Info | Outsider | Covered by the lockdown revoke | db-smoke |
| A revoked session kept admin powers for up to 1 hour | Info | Session thief | `requireAdmin` uses `auth.getUser()` | Manual |
| `.env.local` was world-readable | Info | Local user | `chmod 600` | `ls -l` |

## Open sign-up re-evaluation

The audit's squatting fix assumed public sign-up in Supabase Auth would stay **off**. Open sign-up with Google needs "Allow new users to sign up" **on**, and that switch also opens Supabase Auth's public email sign-up endpoint (`POST /auth/v1/signup` with the publishable key, which every browser has). The app never uses that endpoint: password accounts are created by the sign-up action through the admin API. So the question is what an outsider can do with it.

| Goal | Why it fails | Checked by |
|---|---|---|
| (a) Take over or impersonate an existing player | Every profile, play and board row is keyed to the auth user id, never to an email or name. Signing up with a player's sign-in email gives no session and doesn't touch their password. With Confirm email and Confirm phone both on, Supabase answers it exactly like a new sign-up (an obfuscated user), so it doesn't reveal that the player exists; with either auto-confirm on it answers 422 "User already registered" instead, which the merge review found locally (phone auto-confirm was on) and is now fixed. A Google address can't be pre-registered usefully: with Confirm email on, the squatter can't confirm it, and when the real owner first signs in with Google, Supabase links the identity and strips the unconfirmed password identity (`RemoveUnconfirmedIdentities`). A session can't move itself onto another address without confirming it (Secure email change), and can't set a password (password-change guard). `/auth/welcome` only gives a profile to accounts whose `providers` claim includes `google`, which Supabase sets and users can't. Display names are unique ignoring case and shown with `@username` | db-smoke `publicSignUpChecks` (including the settings and the 200 answer), `passwordChecks`; `profiles.test.ts` ("only sets up Google accounts"); accounts E2E (a profile-less non-Google account is signed out) |
| (b) Claim a username that belongs to a password account | The username is taken by the profile (unique), and its `<name>@users.daily.invalid` email is taken by the account (unique). For a username nobody has yet, a squatter can hold the email (an unconfirmed user, no session, no profile); the next sign-up for that name, or a password account renaming to it, deletes the squatter once it is 2 minutes old (`reclaimSignInEmail`); until then the name reads as taken | `profiles.test.ts` (`reclaimSignInEmail`), `(auth)/actions.test.ts`; db-smoke |
| (c) Read other players' data | `anon` and `authenticated` have no privileges in `public`, so a self-registered account reads nothing through the API. Through the app it can't get past `requireProfile` without a profile | db-smoke `lockdownChecks` |

**Residual risk, honestly:**
- **Anyone can join.** Sign-up is open, so "friends only" is not enforced. Anyone who finds the URL can create a username/password account (5 per hour per client network, 50 per hour overall) and then see every player's username, display name, streaks and, once they've finished a game, that day's results. The only gate left is Google's: keep the OAuth consent screen in Testing with friends listed as test users, which stops strangers using Google but not password sign-up. `/admin` lists every player and when they joined; remove unwanted accounts in Supabase → Authentication → Users (the profile and plays go with them).
- **Alt accounts are back.** Any player can make a second account, play today's puzzle on it to learn the answer, then score perfectly on their main one. The spoiler wall can't prevent this. This is the trade the owner made for zero-friction sign-in.
- **Name pre-claiming.** A stranger can take a display name like "Ana Ruiz" before Ana joins; Ana's Google sign-in then becomes "Ana Ruiz 2". The `@username` next to every name makes this visible; an admin deletes the impostor.
- **It depends on three hosted settings.** If "Confirm email" or "Secure email change" were turned off in the hosted project, the public endpoint would hand out signed-in accounts for any address: a stranger could pre-register a friend's Gmail address with a password and keep it after the friend's first Google sign-in links to it (account takeover), or move their own account onto a free username's sign-in email. If phone confirmations were off, the endpoint would say whether an address is registered, which tells a stranger whether a given Gmail address plays here (usernames are no secret: every board shows them). db-smoke checks the first and third against whatever Supabase it runs on; for hosted, `GET /auth/v1/settings` must show `mailer_autoconfirm: false` and `phone_autoconfirm: false` (step 8).
- **Squatting is delayed, not prevented.** A username's sign-in email can be held for up to 2 minutes at a time, and a squatter can re-register after each reclaim; each round costs them a sign-up against Supabase's own rate limits. The real player sees "That username is taken" and can retry two minutes later.
- **Email sending.** The public endpoint sends a confirmation email for every sign-up it accepts, so strangers can make the project send mail to arbitrary addresses, bounded by Supabase's email rate limit.
- **Profile-less users from before the merge.** Anyone who signed in with Google while the shared code was live and stopped at the invite form still has a bare auth user. After deploy, their next visit gives them a profile automatically. Step 2 below lists them so you can delete strangers first.
- A Supabase "before user created" auth hook that refuses email sign-ups not made by the server would close the public endpoint entirely. It is not done: it needs a server-only marker the hook can trust and hosted hook configuration, and the measures above already keep that endpoint from producing a player.

## Needs you / needs deploy

Do these in order. Steps 5 and 6 should be minutes apart: the old code calls a leaderboard function the migrations drop, and the new code calls functions only the migrations create.

1. **Merge the `integration` branch** into `main` (it holds the security fixes merged with `frictionless-signin`; nothing is pushed). Run `npm run check`, `npm run build` and `npm run test:bundles` on the result.
2. **Run the pre-checks in the hosted SQL editor.** All three are read-only. The first two must return 0 rows, or the display-name migration fails:
   ```sql
   select lower(display_name), count(*) from public.profiles group by 1 having count(*) > 1;
   select username from public.profiles where display_name ~ '[[:cntrl:]­؜ᅟᅠ᠎​‌‎‏ -‮⁠-⁯⠀ㅤ﻿ﾠ]';
   select u.id, u.email, u.created_at, u.raw_app_meta_data -> 'providers' as providers
   from auth.users u left join public.profiles p on p.id = u.id
   where p.id is null order by u.created_at;
   ```
   The third lists auth users without a profile. Any Google ones get a profile on their next visit after deploy; delete the ones you don't know (Authentication → Users) before step 6.
3. **Set Vercel env vars** for both Production and Preview, before deploying:
   - Add `OWNER_USER_IDS`: your auth user id, from Supabase → Authentication → Users → your row → UID. Without it, nobody can manage other admins in the app.
   - Keep (or add) `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` to keep Google. It is read at build time, so the deploy in step 6 applies it.
   - Delete `INVITE_CODE`. Nothing reads it any more.
   - Unchanged: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PUZZLE_SEED_SECRET`.
4. **Change these Supabase Auth settings first** (they only tighten what the public endpoint can do, so they are safe with the old code):
   - Sign In / Providers → "Allow new users to sign up": **ON** (new Google players need it).
   - Providers → Email: enabled (username sign-in goes through it), **"Confirm email" ON**, **"Secure email change" ON**, **"Secure password change" ON** (all match `config.toml`).
   - Providers → Phone: leave the provider off, but phone confirmations **ON** (`[auth.sms] enable_confirmations = true`). Otherwise public sign-up reveals which emails are registered.
   - Passwords: turn on letters + digits requirements (`password_requirements = "letters_digits"`), and leaked-password protection if your plan has it. The app's sign-up and admin reset check the same character rule first, and show Supabase's reason if it still refuses one.
   - Rate Limits: leave sign-in at the default. Every sign-in through the app comes from Vercel's IPs, so a lower limit would lock friends out. Keep the email-sending limit low.
   - URL Configuration: set Site URL to `https://daily-games-eta.vercel.app`, and add `https://daily-games-eta.vercel.app/auth/callback` to Redirect URLs.
5. **Push the migrations.** Run `npx supabase db push --dry-run`. It should list exactly these 7, in this order: `20261008000000_lock_down_public_roles`, `20261008000100_leaderboard_spoiler_wall`, `20261008000200_display_name_rules`, `20261008000300_catalog_search_key_once`, `20261009000000_password_change_guard`, `20261009000100_invites`, `20261010000000_remove_invites`. (The invites table is created and dropped again in the same push; it was already applied on local databases, so its migration stays in the history.) Then run `npx supabase db push`.
6. **Deploy to production right away**: `vercel --prod`, or push to `main` if the project is git-connected. In the Vercel dashboard, confirm that the production deployment is the new commit.
7. **In Google Cloud Console**, the OAuth client's authorised redirect URI must be `https://<project-ref>.supabase.co/auth/v1/callback`. To keep the group to friends, leave the consent screen in "Testing" and add each friend as a test user (up to 100); publishing it lets any Google account in.
8. **Check after deploy (about 5 minutes):**
   - `curl -s https://<project-ref>.supabase.co/auth/v1/settings -H "apikey: <publishable key>"` shows `"disable_signup":false`, `"mailer_autoconfirm":false` and `"phone_autoconfirm":false`.
   - `curl -sI https://daily-games-eta.vercel.app/login` shows `content-security-policy` with `frame-ancestors 'none'`, `x-frame-options: DENY` and `x-content-type-options: nosniff`, and no `x-powered-by`. (At 21:29 UTC today the live site still sent `x-powered-by: Next.js` and none of the new headers.)
   - After you sign in, DevTools shows the `sb-…-auth-token` cookie as HttpOnly, Secure and SameSite=Lax.
   - In a private window, `/signup` asks only for a username, a password and an optional display name, and lands on Today. Delete the test user in Supabase afterwards.
   - "Continue with Google" with an account that has never signed in lands straight on Today with a "Welcome!" note naming your @username, and `/onboarding` is a 404.
   - Rename yourself from "Edit profile" on your profile page, then rename back.
   - Resetting a test player's password from `/admin` works. This exercises the password guard.
9. **Optional:**
   - Shorten JWT expiry to 900–1800 s.
   - Add Vercel Firewall per-IP rules on POST `/login` and `/signup`.
   - Turn on Supabase and Vercel spend alerts.
   - Confirm Vercel Deployment Protection is on for previews.
   - Run these read-only checks:
     ```sql
     select id, public from storage.buckets;
     select * from pg_publication_tables;
     select extname from pg_extension;
     ```
     Expect no buckets, no publication tables and no `pg_graphql`.

## Accepted risks / deferred

| Item | Why it's left |
|---|---|
| Open sign-up: strangers can join and see the boards, players can make alt accounts to peek at answers, names can be pre-claimed | Owner decision (zero-friction sign-in). See [Open sign-up re-evaluation](#open-sign-up-re-evaluation). |
| Password guessing straight against Supabase Auth with the public key, which skips the app's throttle | Closing it needs hosted settings (password rules, step 4) or replacing the guessable `<username>@users.daily.invalid` emails with HMAC-based ones, which means rewriting every hosted user's email. Strong passwords are the practical defence. Admins should use long random ones. |
| The overall sign-up limit (50/hour) can be used up by anyone, which blocks real password sign-ups for that hour | Low: Google sign-in isn't affected, and the per-network limit (5/hour, IPv6 by /64) makes one client use up only a tenth of it. *(Replaces the global invite limit item, superseded by owner decision: open sign-up.)* |
| Anyone who knows a username can make that friend wait up to 15 min to sign in (per-username limit) | Deliberate trade-off against guessing from many IPs. Friends who are already signed in aren't affected. |
| Many attackers below the app's per-IP limit can still use up Supabase's per-IP sign-in limit for Vercel's shared egress IPs | The app can't pass the real client IP to hosted Supabase Auth. The fixes would be hosted-side: a higher limit or a fixed egress IP. |
| Image bytes are read from Postgres on every uncached request | Moving them to a cache or Storage is an architecture change. The new limits and ETag already bound the abuse. Do it before any asset game goes live. |
| No `statement_timeout` on the search functions | A per-function setting doesn't apply to the statement that's already running. A server-wide timeout for the service role is your call. |
| Player pages accept a revoked access token until it expires (up to 1 h) | This is how Supabase works. Admin pages already re-check. Shortening the JWT expiry (step 9) narrows the window. |
| A thief with a fresh stolen session can still play as that friend until the token expires or an admin resets | They can no longer change the password. An admin reset signs out every session. |
| Admins can reset any regular player's password and see account emails, including Google addresses | Admins are trusted by design. Keep the admin list short. |
| Cross-script look-alike display names (for example a Cyrillic "А") | `@username` shown next to every name makes impostors visible. |
| `allowedDevOrigins` and 5 high npm advisories in `eslint-config-next` | Dev-only. Production dependencies show 0 vulnerabilities. `npm audit fix --force` would downgrade Next tooling, so wait for an upstream fix. |
| Number Hunt can be solved by binary search | A game-design issue, not security. |

## Verified secure

- No secret value appears in git history, in the client JS (checked on a canary build and on the live site) or in error pages. Production source maps return 403.
- RLS is on for all 8 tables with no write policies, so direct PostgREST inserts, updates and deletes do nothing. `is_admin` comes from the database, never from the JWT or `user_metadata`.
- A puzzle's solution only reaches the browser after your play is finished. An image is served only if it is in your own play view. Puzzle images are re-encoded with their metadata stripped.
- Every server action re-checks auth and validates its input with zod. Plays are keyed to your verified id, so there is no IDOR. Moves only apply to today, use an optimistic version check and get a score from the server.
- Next's Origin check blocks CSRF on server actions, and cookies are SameSite=Lax. The OAuth callback has no open redirect.
- There is no XSS sink (`dangerouslySetInnerHTML`, `innerHTML` or `eval`). Search input can't inject SQL `LIKE` wildcards.
- The puzzle seed secret is 64 hex characters, differs between local and hosted, and is never sent to the client.
- `take_rate_limit` is atomic: 100 concurrent calls against a limit of 40 returned exactly 40 allowed.
- The live site sends HSTS (2 years, preload). Signed-out API calls get 401 with `no-store`.

## How this was checked

- **Audit.** Parallel auditors each covered one area: authentication, authorisation, game integrity, input handling, abuse and cost, database, and secrets and config. They worked from the code, a read-only snapshot of the hosted database's policies, grants and function ACLs, and local Supabase. Every exploit was reproduced on local Supabase only, and the throwaway users were deleted afterwards.
- **Verification.** A second pass checked each finding independently and marked it confirmed, refuted or duplicate, re-rating severity for a friends app. About 40 raw findings came down to 9 unique confirmed issues. Two were refuted: the "Google provider disabled" premise was out of date, and the "previews share prod" risk was speculative.
- **Re-audit.** A re-audit of the fixes found two partial fixes (password change, client bundle) and 5 new issues. A second round fixed both partial fixes and 4 of the 5 new issues. The fifth was the global invite limit, now gone with the invites.
- **Merge with `frictionless-signin`.** On the `integration` branch: `npx next typegen`, `npm run check`, `npm run build`, `npm run test:db`, `npm run test:bundles` and both E2E suites (`test:e2e`, `test:e2e:accounts`) against a dev server on port 3600 all pass. The local Supabase used for this still runs with public sign-up off and Confirm email off (it was started from the pre-merge `config.toml`), so db-smoke checked the sign-up-off branch of `publicSignUpChecks`; the sign-up-on branch and the email-change check run once local Supabase is restarted with the merged `config.toml`.
- **Merge review follow-up.** A review of the merge found the weak-password and "already registered" issues above (marked *Merge review*), plus a rename onto a squatted name answering with a generic failure. After the fixes, on `integration`: `npx next typegen`, `npm run check` (426 tests in 41 files), `npm run build`, `npm run test:bundles`, `npm run test:db` and both E2E suites against a dev server on port 3600 pass on the shared local Supabase (sign-up still off there). To exercise the open sign-up configuration without restarting the shared stack, a temporary GoTrue v2.197 container ran against the same database with sign-up on, both confirmations on and the letters + digits rule: the full db-smoke and the accounts E2E pass against it, its admin endpoint answers an all-letters password with 422 `weak_password` (`reasons: ["characters"]`), and a password account renaming onto a squatter's fresh email gets "username taken" with its sign-in email untouched (GoTrue's admin update answers a held email with a bare 500, which `updateProfile` now re-checks). With phone auto-confirm switched back on, db-smoke's two new checks fail as intended (the sign-up answers 422 `user_already_exists`).
- **Tests.** At the original audit I re-ran `npm run check`: typecheck, lint and 356 tests in 39 files all passed (426 tests in 41 files after the merge and its review follow-up, above). The fixing agent reported that `npm run build`, `npm run test:db`, `npm run test:bundles` and `npm run test:e2e` pass. I did not re-run those, because the local database is shared with another worktree.
- **Hosted access.** The only hosted access was read-only GETs: Supabase `/auth/v1/settings` and `/authorize`, and the live `/login` page. Nothing was written to Supabase or Vercel. The audit pass itself committed nothing; the work was committed afterwards on `integration` (merge `aa06869` and the follow-ups after it), and nothing has been pushed.
