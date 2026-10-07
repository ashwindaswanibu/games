# Daily

Daily puzzle games for a group of friends: everyone gets the same puzzles each day, and there's
one overall leaderboard plus one per game.

**Stack:** Next.js 16 (App Router), Supabase (Postgres + Auth), Tailwind v4, deployed on Vercel.

## How it works

- **One game day for everyone.** Puzzles roll over at midnight New York time (`src/core/day.ts`).
- **Answers stay on the server.** The browser gets the puzzle and the player's own state. Every
  move is a server action that checks the caller, validates the move, applies it, and saves it
  with an optimistic version check (so a double-tap can't apply a move twice).
- **Puzzles are generated lazily and deterministically.** The first request of the day generates
  the puzzle from a seed of `(PUZZLE_SEED_SECRET, game, date)` and stores it. Curated games can skip
  `generate` and have their puzzles loaded into the `puzzles` table ahead of time.
- **Scores are normalized.** Every finished play scores 0–100. The overall board sums them; each
  game also keeps its own result label (like `4/7`) for its own board.
- **Spoiler wall.** You can't see friends' results for a game until you've finished it: not on the
  play page, and not as today's points, labels or wins on the Today standings, the leaderboards or
  profiles (the `leaderboard` SQL function and `src/server/leaderboards.ts` filter by viewer).
  Who has played today (attendance, streaks) stays visible.
- **Open sign-up, no forms on the way in.** Anyone who reaches the site can create an account:
  a username and password, or Google. There is no invite code. A first Google sign-in gets a profile
  automatically (username and display name from the Google name, falling back to the email;
  `GET /auth/welcome`) and lands on Today with a note saying how to change them. Players change
  their username and display name later from their own profile page. To keep the group to friends,
  see [Who can join](#who-can-join).
- **Passwords change only through an admin reset.** A trigger on `auth.users` refuses any password
  change the server didn't authorise a moment before (`allow_password_change`), so a stolen session
  can't set a new password through Supabase Auth and lock the owner out. Nobody resets their own
  password in `/admin` either (no reauthentication there); admins ask an owner. See "Accounts".
- **The database is server-only.** The publishable key is public, so the `anon` and `authenticated`
  roles have no privileges at all in `public` (no tables, sequences or functions; RLS stays on as a
  second layer). Only the service role, used after `requireProfile`/`requireAdmin`, reads or writes.
- **Display names are visible and unique.** NFC, no invisible, bidi or blank-looking characters,
  unique ignoring case (`src/lib/validation.ts` and the database), and `@username` is shown next to
  them on boards. Google names are tidied to fit; a name someone already uses gets a number
  (`Ana Ruiz 2`).
- **Buckets.** Every game belongs to one bucket (Words, Movies, Geography, Chess;
  `src/games/buckets.ts`). Today groups games by bucket, and each bucket has its own board (the
  same leaderboard, limited to that bucket's games).
- **Server-resolved moves.** A game whose moves need facts the puzzle doesn't carry (such as "was
  this actor in this film?") adds a `server.ts` with `resolveMove`, listed in
  `src/games/server-registry.ts`. The pipeline runs raw move → `moveSchema` → `resolveMove` →
  `resolvedMoveSchema` → the pure `applyMove` (`src/server/move-pipeline.ts`).
- **Secret images.** Puzzle images live in `puzzle_assets` (service role only) and are served by
  `GET /api/assets/[id]`, but only while the id appears in the caller's own play view (puzzle,
  state or reveal).
- **Rate limits.** Route handlers that do real work per call (catalog search, puzzle images) start
  with `guardRequest` (`src/server/http.ts`): signed in, allowed (the catalog only for players who
  can open a Movies game), and within per-player limits counted in Postgres (`take_rate_limit`),
  else 401 / 404 / 429. Moves, game starts, profile edits, password sign-ups (per client network
  and in total) and password sign-ins (per client network and per username) are limited too
  (`src/server/rate-limit.ts` lists every bucket). A client network is an IPv4 address or an IPv6
  /64.
- **Admins and owners.** Admins see testing games and every player (how they sign in, when they
  joined), reset other players' passwords and promote players. Only an owner (`OWNER_USER_IDS`)
  may reset another admin's password or demote them, and nobody can do either to an owner. Admin
  pages and actions re-check the session with Supabase on every request.
- **Testing games stay hidden.** Each game has its own play route (`src/app/(app)/play/<id>/`), and
  client code is bundled per route, so a player's browser never receives the code, name or rules
  of a game in testing, nor the URL of its chunks. `npm run test:bundles` checks a production build
  for this.

## Layout

```
src/
  core/            Pure, framework-free logic, unit tested
    game.ts        GameDefinition: the contract every game implements
    view.ts        PlayView / MoveResponse / GameUiProps: the browser-facing shapes
    day.ts         Game-day boundary (America/New_York), DST-safe
    random.ts      Seeded PRNG handed to puzzle generators
    scoring.ts     0–100 normalization helpers
  games/
    registry.ts    All games (logic); live vs testing
    game-ui-context.tsx  connectGameUi: how a game's UI gets its props from the game host
    server-registry.ts  Game id → server module (games with server-resolved moves)
    buckets.ts     Bucket metadata and grouping helpers
    number-hunt/   Reference game. Copy this folder to start a new one
    _movies/       Shared Movies foundation: catalog schemas, clues, UI kit (see its README)
  server/          Server-only: auth, puzzles, plays, leaderboards, Supabase clients
  app/
    api/           Route handlers: /api/assets/[id], /api/catalog/{films,people,filmography,cast}
    (auth)/        /login, /signup, plus server actions for all auth flows
    (app)/         Signed-in app: Today (/), /play/<id> (one route per game), /leaderboard,
                   /u/[username], /admin
    (immersive)/   Full-screen games, outside the app's header and nav (/play/fade-to-color)
    _play/         What every play route shares: the session, hosts, server actions
    auth/callback  OAuth code exchange
    auth/welcome   First sign-in: creates the profile from the Google identity, then Today
  proxy.ts         Session refresh; redirects signed-out visitors to /login
supabase/
  migrations/      Schema, RLS, the leaderboard/streak SQL functions, puzzle assets, movie catalog
scripts/
  db-smoke.mts     Database contract checks (npm run test:db)
  check-client-bundles.mts  Testing games stay out of players' bundles (npm run test:bundles)
  content/         Local content tooling, e.g. DEV FIXTURE puzzles (npm run content:fixtures)
```

## Adding a game

1. Copy `src/games/number-hunt/` to `src/games/<your-id>/`.
2. In `logic.ts`, define the zod schemas for puzzle/solution/move, then implement `generate`,
   `initialState`, `applyMove`, `outcome`, `score` (0–100), `shareGrid`, and optionally `reveal`
   and `friendDetail` (a small JSON detail of a finished play for friends' results, such as which
   option a player picked; only friends who have finished the puzzle get it). Keep it pure: use
   the `rng` you're given, never `Math.random()` or `Date.now()`.
3. Build the UI in `ui.tsx` as a client component that takes `GameUiProps<typeof yourGame>`, and
   export `YourGameEntry = connectGameUi(YourGameUi)` from it.
4. Register the game in `src/games/registry.ts` (plus `src/games/server-registry.ts` if it has a
   `server.ts`) and set its `bucket`. Give it a play route: copy
   `src/app/(app)/play/number-hunt/page.tsx` to `play/<your-id>/page.tsx` and point it at your id
   and entry. (One route per game is what keeps unreleased games out of players' bundles.)
5. Start with `availability: "testing"`. Testing games are visible only to admins and don't count
   toward leaderboards. Switch to `"live"` when it's ready.

`npm test` checks every registered game's generator for determinism, schema validity, and JSON
round-tripping.

## Local development

Requires Node 20.9+ and Docker.

```bash
npm install
npm run db:start                 # local Supabase; prints the URL and keys
cp .env.example .env.local       # fill in the keys printed above, plus PUZZLE_SEED_SECRET
npm run dev                      # http://localhost:3000
```

There is one local Supabase per machine: every checkout and git worktree shares it. Content one
branch writes in a new format (for example the ten-level Fade to Color puzzles) breaks those days
for checkouts still on the old code until that branch is merged; see
`scripts/content/movies/README.md`. Never delete someone's plays to free a day for new content.

Then make yourself an admin: sign up at `/signup`, then run this in Supabase Studio
(http://127.0.0.1:54323):

```sql
update public.profiles set is_admin = true where username = '<you>';
```

Useful scripts: `npm run check` (typecheck + lint + tests), `npm run db:reset` (rebuild the
database from migrations), `npm run db:types` (regenerate DB types to diff against
`src/server/database.types.ts`), `npm run test:bundles` (after `npm run build`: no testing game
reaches players' bundles).

`npm run test:e2e` plays every Movies game end to end in the installed Chrome at phone size, against
a local dev server (`npx next dev -p 3300`; set `E2E_BASE_URL` to use another port), as the local
admin test account (`E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` in `.env.local`). It checks the
spoiler wall throughout, resets that account's plays of today's Movies puzzles first (local database
only), and saves screenshots to `design/overnight-shots/`.

`npm run test:e2e:accounts` checks the account flows against the same dev server: password sign-up
lands on Today, a first sign-in without a profile gets one automatically (including name collisions
and two tabs at once), and username / display name changes for both kinds of account (a password
account then signs in with its new username). It creates its own throwaway accounts and deletes them.

### Google sign-in

1. In Google Cloud Console, create an OAuth client (type: Web application). Add the authorized
   redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` (for local:
   `http://127.0.0.1:54321/auth/v1/callback`).
2. Production: in the Supabase dashboard, open Auth → Providers → Google and paste in the client
   ID and secret. Local: set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` and turn on
   `[auth.external.google]` in `supabase/config.toml`.
3. Add `https://<your-domain>/auth/callback` to Auth → URL Configuration → Redirect URLs.
4. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` (the button is hidden otherwise, because Supabase
   answers "Unsupported provider: provider is not enabled" until step 2 is done).
5. A first Google sign-in creates a Supabase user, which needs Auth → "Allow new users to sign up"
   **on** (see [Who can join](#who-can-join) for what that opens and why it's safe).

### Who can join

Sign-up is open: there is no invite code. The zero-friction way to keep the group to friends is to
leave the Google OAuth app's publishing status on **Testing** (Google Cloud Console → Google Auth
Platform → Audience) and add each friend's Google account as a test user. Google then refuses
everyone else before they reach the app, and friends just tap "Continue with Google". (Testing mode
allows up to 100 test users.) Password sign-up has no such gate: anyone who finds the site can
create a username/password account, limited to 5 per client network and 50 in total per hour
(`src/server/rate-limit.ts`). `/admin` lists every player, how they sign in and when they joined.
With no gate, anyone can also make a second account to look at a day's answers before playing on
their main one; the spoiler wall can't stop that (see `design/security-review.md`).

Accounts only become players through the app: password accounts get their profile in the sign-up
request, and `/auth/welcome` only sets one up for Google accounts (Supabase's `providers` claim,
which users can't set). "Allow new users to sign up" also opens Supabase Auth's public email
sign-up endpoint (the publishable key is in every browser). An account made there gets no profile,
is signed out by `/auth/welcome`, and can read nothing (see "The database is server-only"). If it
grabbed a free username's sign-in email (`<name>@users.daily.invalid`), the next real sign-up or
rename to that name deletes it (`reclaimSignInEmail` in `src/server/profiles.ts`). Keep Auth →
Providers → Email → **Confirm email** and **Secure email change** on in the hosted project (both
are on in `supabase/config.toml`): they stop that endpoint from producing a signed-in account, or
an email change, for an address its caller doesn't control, and stop a pre-registered password
surviving a friend's first Google sign-in with the same address. Also keep **Confirm phone** on
(Providers → Phone; on in `config.toml` too, even though phone sign-in is off): Supabase only
answers a sign-up for an already registered email like any other sign-up when neither email nor
phone sign-ups are auto-confirmed, and otherwise says "User already registered", which tells anyone
whether a Gmail address belongs to a player. Don't turn the Email provider off: username/password
sign-in goes through it.

## Deploying

1. Create a Supabase project. Run `npx supabase link` and then `npx supabase db push` to apply the
   migrations.
2. Import the repo into Vercel and set the same env vars as `.env.local`, using the production
   Supabase keys and your user id in `OWNER_USER_IDS` (sign up first, then copy your id from
   Supabase → Authentication → Users).
3. In Supabase → Auth → URL Configuration, set the Site URL to your Vercel domain.
4. In Supabase → Auth, match `supabase/config.toml`: "Allow new users to sign up" **on** (Google),
   Email provider on with "Confirm email" and "Secure email change" on, "Secure password change"
   on, and phone confirmations on. The password-change trigger is what actually stops a stolen
   session from changing a password; secure password change only covers sessions older than a day.
   `curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <publishable key>"` should show
   `mailer_autoconfirm: false` and `phone_autoconfirm: false`.
5. In Supabase → Auth → Passwords: require letters and digits (`password_requirements` in
   `config.toml`; the app's sign-up and admin reset check the same rule first), and turn on
   leaked-password protection if your plan has it, since anyone can call Supabase Auth directly
   with the public key. A password Supabase still refuses is reported on the password field. Leave
   the sign-in rate limit at its default: every sign-in through the app reaches Auth from Vercel's
   addresses, so a lower limit would lock friends out.

## Accounts

Username/password accounts are stored as Supabase users with an undeliverable
`<username>@users.daily.invalid` email, so players only ever see usernames. That means there's no
"forgot password" email: an admin resets passwords from `/admin`.

Passwords change only that way. The server calls `allow_password_change(<user id>)` right before the
admin API sets the password, and a trigger on `auth.users` (migration
`20261009000000_password_change_guard.sql`) refuses every other password change, including one sent
straight to Supabase Auth with a stolen session. An admin reset also signs the player out
everywhere, which is how to recover an account you think was taken over. No one resets their own
password in the app: admins ask an owner, and an owner who is locked out runs
`select public.allow_password_change('<user id>');` in the Supabase SQL editor and then, within a
minute, sets the password with the admin API (`auth.admin.updateUserById` with the secret key),
which also signs out every session.

Players change their username and display name from "Edit profile" on their own profile page
(rate limited). For a username/password account the sign-in email moves with the username (auth
email first, then the profile, and the email is moved back if the profile update fails), so they
sign in with the new username from then on. Google accounts only change the profile. Profiles,
boards and results look players up by id, so a rename shows up everywhere at once; old `/u/<name>`
links stop working.
