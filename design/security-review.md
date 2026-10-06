# Security review: Daily Games

October 6, 2026. Covers the uncommitted working tree on `main`, based on commit 35d0a3a. The changes are 60 modified tracked files plus 28 new files or folders, including 6 migrations.

## Summary

The core is sound. Puzzle solutions and images stay on the server until you have earned them, every action checks who you are, nothing secret is in git or in the browser bundle, and RLS blocks all writes. The real gaps were around the edges:
- anyone with a Supabase session could read the player list;
- one shared invite code let a friend create alt accounts to see answers early;
- nothing throttled password or invite guessing;
- a stolen session could change the account's password.

Those are fixed in code, but **none of it is live yet**: nothing is committed, deployed or pushed to the hosted database.

**Your Google error.** "Unsupported provider: provider is not enabled" came from the site showing "Continue with Google" while Google was switched off in Supabase. At 21:29 UTC today, Supabase had Google switched on (its authorize endpoint now redirects to Google), so that exact error should be gone. A full Google sign-in also needs the redirect URLs and the deploy in steps 3–7 below. Because Google sign-ups are open and the old database policy is still live, **anyone with a Google account can currently read every player's username, display name and admin flag**. Step 4 closes that.

## Fixed

Severity is the rating after independent verification, for a private friends app.

| Issue | Severity | Who could exploit it | What changed | Test added |
|---|---|---|---|---|
| Any signed-in Supabase user (no invite needed) could read every profile, including who is an admin | Low (live now via Google) | Outsider with any Google account or confirmable email | Migration `20261008000000_lock_down_public_roles` drops both RLS policies and revokes all table, sequence and function grants from `anon`/`authenticated`, plus the default grants for future objects. `enable_signup = false` locally | db-smoke `lockdownChecks`: all 8 tables refuse anon and signed-in users, no self-promotion to admin, RPCs refused |
| Outsider could block a username by pre-registering `<name>@users.daily.invalid` | Low | Outsider | Sign-up deletes a profileless squatter older than 2 minutes and retries once (`orphan_auth_user_for_email`, service role only) | db-smoke orphan checks; manual local run |
| A stolen session could set a new password without the old one and lock the owner out | Medium | Session thief | Migration `20261009000000_password_change_guard`: a trigger on `auth.users` refuses any password change the server didn't pre-authorise with a one-minute grant. Only the admin reset grants one. `secure_password_change = true` | db-smoke `passwordChecks` (7 checks, including a direct Supabase Auth call with a stolen token) |
| Admins could reset their own password with no reauthentication, or reset/demote other admins, including the owner | Medium | Stolen admin session | `src/server/admin-policy.ts`: nobody resets their own password, nobody can act on an owner (`OWNER_USER_IDS`), and only an owner can act on another admin. `requireAdmin` re-checks the session with Supabase on every call. Admin actions are logged | `admin-policy.test.ts`, `admin/actions.test.ts` |
| One shared invite code let a friend make alt accounts to see today's answer before playing on their main | Medium | Friend | Single-use invites per player (migration `20261009000100_invites`): 100 random bits, 7-day expiry, only the hash stored, redeemed in one transaction. Admins create them in `/admin`, which shows who invited whom | `invite.test.ts`, `(auth)/actions.test.ts`, db-smoke `inviteChecks` |
| Invite checks had no rate limit | Low | Outsider | 5 per 10 min per IP (and per user during onboarding), plus 30 per hour globally | `invite.test.ts` |
| Password sign-in had no throttle | Medium | Outsider | 10 per 5 min per IP and 10 per 15 min per username, checked before Supabase is called | `sign-in-limit.test.ts`, `(auth)/actions.test.ts` |
| Leaderboard, Today standings and profile pages showed friends' results for today before you had played | Low | Friend | Migration `20261008000100_leaderboard_spoiler_wall`: today's results for a game count only once the viewer has finished it. This covers points, wins, rank, labels and history | db-smoke spoiler checks; `leaderboards.test.ts` |
| Display names could be invisible, bidi-reversed or copies of another friend's name | Low | Friend | NFC normalisation, invisible and control characters rejected in both the app and the DB (`20261008000200_display_name_rules`), case-insensitive unique names, and `@username` shown on boards | `validation.test.ts`; db-smoke; E2E |
| 1–2 character catalog searches cost about 1 s of DB time each | Low (Medium once Movies goes live) | Friend or session thief | Migration `20261008000300_catalog_search_key_once` computes the key once per call (1.29 s → 0.23 s). The normalised key must be at least 2 characters. Catalog limit cut from 40 to 20 per 10 s | `schemas.test.ts`; existing db-smoke search checks |
| The image route could drain the Supabase egress quota | Low (Medium once asset games go live) | Friend or session thief | 40 per 10 s plus 1000 per day per player; `ETag`/304 so repeat views skip the bytes | `http.test.ts` |
| Session cookies were readable from JavaScript | Low | Anyone who finds an XSS | `httpOnly`, `secure` in production, `sameSite: lax` (`src/lib/auth-cookies.ts`) | Manual Chrome check; E2E |
| No clickjacking protection or security headers; `x-powered-by` sent | Low | Malicious site framing ours | `next.config.ts`: CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `poweredByHeader: false` | `curl -I` on local |
| Testing games' names and rules shipped in every player's JS | Low | Friend | Each game has its own route, so a testing game's code is only in its admin-only route | `npm run test:bundles`; `registry.test.ts` |
| Moves and game starts were unthrottled | Low | Friend | `moves` bucket, 30 per 10 s | E2E plays every game |
| `catalog_search_key` was callable by anyone | Info | Outsider | Covered by the lockdown revoke | db-smoke |
| A revoked session kept admin powers for up to 1 hour | Info | Session thief | `requireAdmin` uses `auth.getUser()` | Manual |
| `.env.local` was world-readable | Info | Local user | `chmod 600` | `ls -l` |

## Needs you / needs deploy

Do these in order. Steps 4 and 5 should be minutes apart: the old code calls a leaderboard function the migrations drop, and the new code calls functions only the migrations create.

1. **Commit the code.** First run `git checkout -- design/overnight-shots` to discard E2E screenshot churn that isn't part of the fix. If you merge `games-worktrees/frictionless-signin` later, be careful: it edits the same files (auth actions, leaderboards, rate limits, validation, env, db-smoke), so check that the lockdown, invite and spoiler-wall changes survive.
2. **Run the pre-checks in the hosted SQL editor.** Both queries are read-only and must return 0 rows, or the display-name migration fails:
   ```sql
   select lower(display_name), count(*) from public.profiles group by 1 having count(*) > 1;
   select username from public.profiles where display_name ~ '[[:cntrl:]­؜ᅟᅠ᠎​‌‎‏ -‮⁠-⁯⠀ㅤ﻿ﾠ]';
   ```
3. **Set Vercel env vars** for both Production and Preview, before deploying:
   - `OWNER_USER_IDS`: your auth user id, from Supabase → Authentication → Users → your row → UID. Without it, nobody can manage other admins in the app.
   - `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` to keep Google. This is read at build time, so the deploy in step 5 applies it.
   - Delete `INVITE_CODE`. Nothing uses it any more.
4. **Push the migrations.** Run `npx supabase db push --dry-run`. It should list exactly these 6: `20261008000000`, `…000100`, `…000200`, `…000300`, `20261009000000`, `20261009000100`. Then run `npx supabase db push`.
5. **Deploy to production right away**: `vercel --prod`, or push to `main` if the project is git-connected. In the Vercel dashboard, confirm that the production deployment is the new commit.
6. **Change these Supabase Auth settings:**
   - Sign In / Providers → "Allow new users to sign up": **leave it ON while you use Google**, because new Google players need it. After step 4, an account created that way can read nothing and can't become a player without a single-use invite. If you drop Google, turn it OFF.
   - Providers → Email → "Secure password change": ON, to match `config.toml`.
   - Passwords: turn on letters + digits requirements, and leaked-password protection if your plan has it. Admin resets must meet the same rule.
   - Rate Limits: leave sign-in at the default. Every sign-in through the app comes from Vercel's IPs, so a lower limit would lock friends out.
   - URL Configuration: set Site URL to `https://daily-games-eta.vercel.app`, and add `https://daily-games-eta.vercel.app/auth/callback` to Redirect URLs.
7. **In Google Cloud Console**, the OAuth client's authorised redirect URI must be `https://<project-ref>.supabase.co/auth/v1/callback`. If the consent screen is still in "Testing", only listed test users can sign in, so either publish the app or add your friends as test users.
8. **Check after deploy (about 5 minutes):**
   - `curl -sI https://daily-games-eta.vercel.app/login` shows `content-security-policy` with `frame-ancestors 'none'`, `x-frame-options: DENY` and `x-content-type-options: nosniff`, and no `x-powered-by`. (At 21:29 UTC today the live site still sent `x-powered-by: Next.js` and none of the new headers.)
   - After you sign in, DevTools shows the `sb-…-auth-token` cookie as HttpOnly, Secure and SameSite=Lax.
   - In `/admin`, create an invite and sign up with it in a private window. Using it a second time must be refused. Delete the test user in Supabase afterwards.
   - "Continue with Google" lands on `/onboarding` and asks for an invite.
   - Resetting a test player's password from `/admin` works. This exercises the password guard.
9. **Optional:**
   - Shorten JWT expiry to 900–1800 s.
   - Add Vercel Firewall per-IP rules on POST `/login`, `/signup` and `/onboarding`.
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
| Password guessing straight against Supabase Auth with the public key, which skips the app's throttle | Closing it needs hosted settings (password rules, step 6) or replacing the guessable `<username>@users.daily.invalid` emails with HMAC-based ones, which means rewriting every hosted user's email. Strong passwords are the practical defence. Admins should use long random ones. |
| The global invite limit (30/hour) can be used up by anyone, which blocks real sign-ups for that hour. Per-IP limits key on the full IPv6 address | Low, and **not fixed**. With 100-bit single-use codes the global cap isn't needed against guessing any more. Follow-up: drop it, or charge it only for wrong codes, and key IPv6 on the /64. |
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
- **Re-audit.** A re-audit of the fixes found two partial fixes (password change, client bundle) and 5 new issues. A second round fixed both partial fixes and 4 of the 5 new issues. The fifth is the global invite limit above.
- **Tests.** I re-ran `npm run check` just now: typecheck, lint and 356 tests in 39 files all pass. The fixing agent reported that `npm run build`, `npm run test:db`, `npm run test:bundles` and `npm run test:e2e` pass. I did not re-run those, because the local database is shared with another worktree.
- **Hosted access.** The only hosted access was read-only GETs: Supabase `/auth/v1/settings` and `/authorize`, and the live `/login` page. Nothing was written to Supabase or Vercel, and nothing was committed.
