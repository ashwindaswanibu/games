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
- **Spoiler wall.** You can't see friends' results for a game until you've finished it.
- **Friends only.** Signing up (password or Google) requires `INVITE_CODE`.
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
  can open a Movies game), and within a per-player limit counted in Postgres (`take_rate_limit`),
  else 401 / 404 / 429.

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
    ui.ts          Game id → client UI component
    server-registry.ts  Game id → server module (games with server-resolved moves)
    buckets.ts     Bucket metadata and grouping helpers
    number-hunt/   Reference game. Copy this folder to start a new one
    _movies/       Shared Movies foundation: catalog schemas, clues, UI kit (see its README)
  server/          Server-only: auth, puzzles, plays, leaderboards, Supabase clients
  app/
    api/           Route handlers: /api/assets/[id], /api/catalog/{films,people,filmography,cast}
    (auth)/        /login, /signup, plus server actions for all auth flows
    (app)/         Signed-in app: Today (/), /play/[gameId], /leaderboard, /u/[username], /admin
    auth/callback  OAuth code exchange
    onboarding/    Google users pick a username and enter the invite code
  proxy.ts         Session refresh; redirects signed-out visitors to /login
supabase/
  migrations/      Schema, RLS, the leaderboard/streak SQL functions, puzzle assets, movie catalog
scripts/
  db-smoke.mts     Database contract checks (npm run test:db)
  content/         Local content tooling, e.g. DEV FIXTURE puzzles (npm run content:fixtures)
```

## Adding a game

1. Copy `src/games/number-hunt/` to `src/games/<your-id>/`.
2. In `logic.ts`, define the zod schemas for puzzle/solution/move, then implement `generate`,
   `initialState`, `applyMove`, `outcome`, `score` (0–100), `shareGrid`, and optionally `reveal`.
   Keep it pure: use the `rng` you're given, never `Math.random()` or `Date.now()`.
3. Build the UI in `ui.tsx` as a client component that takes `GameUiProps<typeof yourGame>`.
4. Register the game in `src/games/registry.ts` and `src/games/ui.ts` (plus
   `src/games/server-registry.ts` if it has a `server.ts`). Set its `bucket`.
5. Start with `availability: "testing"`. Testing games are visible only to admins and don't count
   toward leaderboards. Switch to `"live"` when it's ready.

`npm test` checks every registered game's generator for determinism, schema validity, and JSON
round-tripping.

## Local development

Requires Node 20.9+ and Docker.

```bash
npm install
npm run db:start                 # local Supabase; prints the URL and keys
cp .env.example .env.local       # fill in the keys printed above, plus INVITE_CODE and PUZZLE_SEED_SECRET
npm run dev                      # http://localhost:3000
```

Then make yourself an admin. Sign up first, then run this in Supabase Studio (http://127.0.0.1:54323):

```sql
update public.profiles set is_admin = true where username = '<you>';
```

Useful scripts: `npm run check` (typecheck + lint + tests), `npm run db:reset` (rebuild the
database from migrations), `npm run db:types` (regenerate DB types to diff against
`src/server/database.types.ts`).

`npm run test:e2e` plays every Movies game end to end in the installed Chrome at phone size, against
a dev server on port 3300 (`npx next dev -p 3300`), as the local admin test account
(`E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` in `.env.local`). It checks the spoiler wall throughout,
resets that account's plays of today's Movies puzzles first (local database only), and saves
screenshots to `design/overnight-shots/`.

### Google sign-in

1. In Google Cloud Console, create an OAuth client (type: Web application). Add the authorized
   redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` (for local:
   `http://127.0.0.1:54321/auth/v1/callback`).
2. Production: in the Supabase dashboard, open Auth → Providers → Google and paste in the client
   ID and secret. Local: set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` and turn on
   `[auth.external.google]` in `supabase/config.toml`.
3. Add `https://<your-domain>/auth/callback` to Auth → URL Configuration → Redirect URLs.

## Deploying

1. Create a Supabase project. Run `npx supabase link` and then `npx supabase db push` to apply the
   migrations.
2. Import the repo into Vercel and set the same env vars as `.env.local`, using the production
   Supabase keys.
3. In Supabase → Auth → URL Configuration, set the Site URL to your Vercel domain.

## Accounts

Username/password accounts are stored as Supabase users with an undeliverable
`<username>@users.daily.invalid` email, so players only ever see usernames. That means there's no
"forgot password" email: an admin resets passwords from `/admin`.
