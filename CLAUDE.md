@AGENTS.md

# Project conventions

- Read `README.md` first. The game contract is `src/core/game.ts`; the reference game is `src/games/number-hunt/`.
- `src/core` and `src/games/*/logic.ts` must stay pure and framework-free (no Next/Supabase imports, no `Date.now()`/`Math.random()`), so they're unit-testable.
- Anything that touches secrets or the database lives in `src/server` and imports `server-only`. Data access uses the service-role `db()` client **after** an explicit auth check (`requireProfile`/`requireAdmin`). The session client is only for auth.
- Server actions are public endpoints: re-check auth and validate every argument with zod.
- Puzzle solutions never reach the browser except through `reveal` after a play has finished (`toView` in `src/server/plays.ts` is the only place that builds the browser-facing view).
- Schema changes go in a new file in `supabase/migrations/`. Keep `src/server/database.types.ts` in sync.
- Before finishing a change, run `npm run check` and `npm run build`.
