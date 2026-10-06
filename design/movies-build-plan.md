# Movies bucket: overnight build plan (2026-10-06)

Ashwin asked for the Movies games to be built front end and back end overnight, for review in the morning. He was asleep, so the decisions below were made without him. Each one is marked **[DECISION]** so it's easy to challenge. A pre-build snapshot of the whole project is at `~/games-snapshots/2026-10-06-before-movies/`, so every change can be diffed (`diff -ru ~/games-snapshots/2026-10-06-before-movies ~/games`).

## Scope

There are four games, all in the new **Movies** bucket:

| id | Game | Loop |
|---|---|---|
| `degrees` | Degrees of Separation | Link today's start actor to the end actor through films they shared, in as few links as possible |
| `frame-by-frame` | Frame by Frame | Guess the film from a frame; each miss or skip reveals another frame |
| `color-grade` | Color Grade | Guess the film from its look: palette, then a neutral photo graded like the film, then a blurred still, then the still |
| `color-barcode` | Color Barcode | Guess the film from ten levels of the whole film: a squeezed-frame barcode, then real frame strips that widen and move from the frame edges to the centre, with clues on wrong guesses |

- **[DECISION]** All four ship with `availability: "testing"`. They're visible only to admins and don't count on leaderboards until Ashwin promotes them.
- **[DECISION]** No changes to how global scores are calculated. Plain sum is unchanged. How buckets add up into the global score is still Ashwin's call (A/B/C from the chat).
- The real app's frame (the header, Today page and leaderboard look) is **not** restyled tonight. The Title Sequence home is a separate prototype in `design/home/` and gets ported only after review. The game **boards** are built in the Movies-world style, since each bucket's board is its own world anyway.

## Platform changes (additive)

### 1. Buckets
- `src/core/game.ts`: `BucketId = "words" | "movies" | "geography" | "chess"`, and `GameDefinition.bucket: BucketId`.
- `src/games/buckets.ts`: bucket metadata (id, name, order, accent) and helpers such as `gamesInBucket`.
- Leaderboard page gets an extra row of tabs: Overall, then one per bucket, then per game. A bucket board is the existing `leaderboard()` RPC called with that bucket's game ids, so no SQL change is needed.
- The Today page groups games by bucket in the existing placeholder style.
- **[DECISION]** `number-hunt` (the reference game) goes in `words` as a temporary placeholder, with a comment saying so.

### 2. Server-side move resolution
Some moves need facts that aren't in the puzzle, for example "was this actor in this film?" or "what year was the film you guessed released?".
- **[DECISION]** `src/core` stays pure. A game may also have a server module, `src/games/<id>/server.ts` (imports `server-only`), registered in `src/games/server-registry.ts`, with:
  ```ts
  resolveMove(ctx: { move; puzzle; solution; state }, services: GameServices): Promise<{ ok: true; move: Resolved } | { ok: false; error: string }>
  ```
- The platform's `applyMove` runs: raw move → `moveSchema` → `resolveMove` (if registered) → pure `game.applyMove(resolved)`. Game logic stays unit-testable with plain resolved moves.
- `GameServices` (in `src/server/game-services.ts`) exposes read-only catalog lookups: `films.get(ids)`, `people.get(ids)`, `credits.filmsOf(personId)`, `credits.castOf(filmId)`, `credits.together(personId, filmId)`.

### 3. Puzzle assets (images that must stay secret until revealed)
- New table `puzzle_assets (id uuid, game_id, puzzle_date, kind, mime, width, height, bytes bytea, created_at)`. RLS is on with no policies, so only the service role can read it.
- `GET /api/assets/[id]` serves the bytes only if **the asset id appears in the caller's current `PlayView`** for that game and date. That covers the puzzle, the state and the reveal. No other per-game access rules are needed: an image is visible exactly when the game has put it in front of you. Responses are `Cache-Control: private`.
- **[DECISION]** Stills are downloaded and re-encoded into `puzzle_assets` rather than hot-linked from TMDB. That keeps unrevealed frames off the client entirely, strips metadata and controls size.

### 4. Movie catalog
- Tables: `movie_films (id, title, year, genres[], directors[], popularity, tmdb_id, imdb_id, wikidata_id)`, `movie_people (id, name, popularity, wikidata_id)`, `movie_credits (film_id, person_id, billing)`. `pg_trgm` indexes on titles and names provide autocomplete.
- **[DECISION]** The catalog comes from **Wikidata**: CC0 licensed, no API key, so it can be built tonight. It covers popular films (by Wikidata sitelink count, a decent popularity proxy) and their cast.
- **[DECISION]** Images come from **TMDB**, which needs `TMDB_API_KEY`. Creating that account is Ashwin's job; it's free. The content pipeline is built and documented. Until there's a key, the image games run on clearly labelled **DEV FIXTURE** images that are generated procedurally, so the whole loop can still be played and tested.
- Search: `GET /api/catalog/films?q=` and `/api/catalog/people?q=`, both requiring sign-in.
- **[DECISION]** TMDB attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB") goes in the app footer once TMDB images are actually used.

### 5. Content pipeline (`scripts/content/movies/`, run locally)
| Script | Needs | Produces |
|---|---|---|
| `catalog` | network | Wikidata → catalog tables |
| `degrees` | catalog | daily Degrees puzzles for the next N days. The start and end actors are popular; the shortest path is 2–3 links, found by BFS over credits; the par value is stored |
| `stills` | `TMDB_API_KEY` | per-film backdrops/stills → re-encoded assets |
| `color-grade` | stills + `content/neutral/*.jpg` | k-means palette, a Reinhard color transfer onto a neutral photo, a blurred still, the still |
| `frame-by-frame` | stills | frames ordered from hard to easy |
| `barcode-levels` | network (movie-screencaps.com) | the ten Color Barcode levels of one film, from its complete screencap gallery (frames deleted after the run). Dev fixtures render procedural films through the same renderer. (Superseded the earlier local-video `barcodes` script, 2026-10-06) |
| `fixtures` | nothing | DEV FIXTURE puzzles for today plus 7 days, for every game |

Curated puzzles go into `puzzles` ahead of time. These games have no `generate`, so a missing puzzle shows "Today's puzzle isn't ready yet".

## Game rules (first pass, easy to tune)
- **Degrees.** Move = pick a film the current actor was in, then a co-star from it. The server checks both links. Undo the last link is free; you can also give up. The game is won on reaching the end actor. Max links = par + 4. Score: 100 at par, minus 15 for each extra link, never below 40; 0 if lost or given up. Share grid: one 🎞 per link plus ⭐ at the end. Reveal: one optimal path.
- **Frame by Frame.** 6 frames, revealed from hardest to easiest. A wrong guess or a skip reveals the next one. A wrong guess also gives clues: release year higher or lower, shared genres, same director. Score: `attemptsScore(frameUsed, 6)`.
- **Color Grade.** Stages: palette, graded neutral photo, blurred still, still, then one last guess, for 5 tries. Same clue system. Score: `attemptsScore(try, 5)`. **The play area is neutral gray.**
- **Color Barcode.** (Revised 2026-10-06.) Ten levels, level 1 (the squeezed-frame barcode) shown at the start; a wrong guess or a skip reveals the next level, which replaces the current one (earlier levels can be viewed again). 10 attempts. Clues on wrong guesses: year higher or lower, shared genres, same director. Score: `attemptsScore(attempt, 10)`. Share grid: one mark per attempt. Reveal: all levels plus title, year and director.

## Front end
- Shared Movies-world kit (`src/games/_movies/ui/`):
  - `FilmSearch` and `PersonSearch` autocomplete.
  - `RevealStrip` for showing stage progress.
  - `ClueChips` for year ↑↓, genre and director clues. These use shape and arrows as well as color.
  - A `MoviesStage` frame component.
- **Visual language: Title Sequence, Movies world.** Ochre and black with a cool cyan projector beam, film-leader countdown details, a gun-barrel iris for transitions, film grain kept off the image itself. Color games use a **neutral-gray** stage so the surrounding UI doesn't skew how the colors read.
- **[DECISION]** No sound tonight.

## Verification
- Unit tests for every game's logic and for the asset access rule.
- The DB smoke test is extended to the new tables.
- End-to-end tests drive the installed Chrome via `puppeteer-core`, with no browser download. They sign in as the local test user, made admin locally, and play every Movies game to completion against the DEV FIXTURE puzzles.
- Independent review passes for spoiler leaks (no solution or unrevealed asset may reach the client), correctness and UX, followed by fixes.
- A morning report goes in `design/overnight-report.md`.
