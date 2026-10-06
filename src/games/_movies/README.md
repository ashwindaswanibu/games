# Building a Movies game

This folder is the shared foundation for the Movies bucket: catalog types and clue logic, server
helpers for resolving moves, and the Movies-world UI kit. A Movies game is an ordinary game (read
the root `README.md` and `src/core/game.ts` first) with up to three extras:

1. **Server-resolved moves.** The browser sends ids, and the server looks up the facts.
2. **Secret images**, stored in `puzzle_assets` and served by `GET /api/assets/[id]`.
3. **Curated puzzles**, made by a DEV FIXTURE generator now and by the content pipeline later.

The overall plan and the rules for each game are in `design/movies-build-plan.md`.

## Files you create

For a game with id `<id>`, a lowercase slug such as `frame-by-frame` (never renamed once played):

| File | What it holds |
|---|---|
| `src/games/<id>/logic.ts` | Pure `defineGame(...)`. No IO, no `Date.now()`, no `Math.random()`. |
| `src/games/<id>/logic.test.ts` | Unit tests for `applyMove`, `outcome`, `score`, `shareGrid` and `reveal`, written with plain resolved moves. |
| `src/games/<id>/server.ts` | `import "server-only"` and `defineGameServer(game, { resolveMove })`. Only needed if moves need lookups. |
| `src/games/<id>/server.test.ts` | Tests for `resolveMove`, using `createFakeGameServices` (no database). |
| `src/games/<id>/ui.tsx` | `"use client"` component taking `GameUiProps<typeof yourGame>`, built from the kit in `./ui`, plus `export const YourEntry = connectGameUi(YourUi)`. |
| `scripts/content/fixtures/<id>.mts` | DEV FIXTURE generator. The file name must equal the game id. |

Then register it. These are the only shared files you touch, and each needs one line:

- `src/games/registry.ts`: add the game to `GAMES`.
- `src/app/(app)/play/<id>/page.tsx`: a copy of another game's play route, pointed at your id and entry (one route per game keeps testing games out of players' bundles).
- `src/games/server-registry.ts`: add your server module to `GAME_SERVERS`, if you have one.

`src/games/registry.test.ts` fails if these three disagree. Every Movies game uses
`bucket: "movies"` and `availability: "testing"`. Movies games have **no `generate`**: puzzles are
loaded ahead of time, and a missing day shows "Today's puzzle isn't ready yet".

Naming conventions:

- Export the game as camelCase (`frameByFrame`), the server module as `<camel>Server`, and the UI as
  `<Pascal>Ui`.
- Moves are discriminated unions on `type` (`{ type: "guess", filmId }`, `{ type: "skip" }`).
- Asset `kind`s are lowercase slugs (`frame`, `palette`, `graded`, `blurred`, `still`, `barcode-level-1`).
- Don't import from another game's folder. If two games need something, put it in `_movies/`.

## The move pipeline

```
browser ─ raw move ─▶ moveSchema ─▶ resolveMove (server.ts) ─▶ resolvedMoveSchema ─▶ applyMove (pure)
```

`src/server/move-pipeline.ts` runs this for every move, after the platform has checked auth, the
play's version and the day.

- `moveSchema` validates what the browser sent. Keep it minimal: ids, not titles. The browser can't
  be trusted to tell you a film's year.
- `resolveMove(ctx, services)` receives `{ move, puzzle, solution, state }` plus `GameServices`, a
  read-only catalog API. It **only looks things up** and returns `{ ok: true, move: resolved }`.
  It may also return `{ ok: false, error }`, which rejects the move without using a turn; the error
  text is shown to the player. Every decision (right or wrong, which clues, game over) belongs in
  the pure `applyMove`, where it's unit-tested.
- The resolved move is validated against **`resolvedMoveSchema`**, which you declare on the game
  definition. Declare it exactly when you have a server module; a mismatch throws
  `GameConfigurationError`.
- `applyMove` gets the resolved move. Its type is the 6th type parameter of `defineGame`:

```ts
export const frameByFrame = defineGame<Puzzle, Solution, State, Move, Reveal, Resolved>({ ... });
```

`GameServices` (`src/server/game-services.ts`):

| Call | Returns |
|---|---|
| `films.get(ids)` | `Map<id, FilmRecord>`. Unknown ids are absent. |
| `people.get(ids)` | `Map<id, PersonRecord>` |
| `credits.filmsOf(personId)` | The person's cast credits |
| `credits.castOf(filmId)` | The film's cast, top billed first |
| `credits.together(personId, filmId)` | The credit, or `null` if they weren't in it |

Helpers in `./server.ts`: `resolveFilm(services, id)` returns the guessed film as `FilmDetails`
or a "pick one from the list" rejection; `resolvePerson` does the same for a person;
`toFilmDetails(record)` builds the snapshot you store in a solution.

A typical guess game:

```ts
// server.ts
import "server-only";
export const frameByFrameServer = defineGameServer(frameByFrame, {
  async resolveMove({ move }, services) {
    if (move.type === "skip") return { ok: true, move };
    const film = await resolveFilm(services, move.filmId);
    return film.ok ? { ok: true, move: { type: "guess", film: film.move } } : film;
  },
});

// logic.ts (inside applyMove)
const correct = move.film.id === solution.answer.id;
const clues = correct ? [] : computeClues(move.film, solution.answer, ["year", "genres", "director"]);
```

For tests, `createFakeGameServices({ films: [film({ id, title, year, ... })], people, credits })`
(from `src/server/game-services.fake.ts`) records every lookup in `.calls`. See
`src/server/move-pipeline.test.ts` for a complete example.

## Shared schemas and clues

`./schemas.ts` holds zod schemas that are safe on both sides of the wire:

- `filmRefSchema` (`id`, `title`, `year`): what a player may see of a film.
- `filmFactsSchema` (`year`, `genres`, `directors`): what clues compare.
- `filmDetailsSchema`: both together. Store the answer in the solution as `FilmDetails`; it's a
  snapshot, so catalog edits can't change a published puzzle.
- `personRefSchema`, plus `filmIdSchema` and `personIdSchema` for moves.
- `clueSchema`: a discriminated union of `year`, `decade`, `genres` and `director`.
- `filmGuessSchema`: `{ film: FilmRef, correct, clues }`, one guess as most games record it.

Store `FilmRef`s in the state, not `FilmDetails`. The state is sent to the browser, and the
answer's facts reach it only as clues.

`./hints.ts` is pure, with tests in `hints.test.ts`:

- `compareYear(guess, answer)` returns `"later"`, `"earlier"`, `"same"` or `"unknown"`. `"later"`
  means the answer came out later, so the player should guess higher.
- `sharedGenres` / `sharedDirectors` compare names case- and accent-insensitively.
- `sameDirector`, `sameDecade` and `decadeOf` are the smaller comparisons.
- `computeClues(guess, answer, kinds)` returns ready-made `Clue[]` in the order asked for.

`./clue-text.ts` (`describeClue`) is the wording and glyph for each clue, which `ClueChips` uses.

## Secret images (`puzzle_assets`)

The table is service-role only (RLS on, no policies). `GET /api/assets/[id]` serves an image
**only if its id appears in the caller's current play view** of that game and date: the puzzle,
the state, or the reveal. Unknown and forbidden ids both get a 404. So you decide when an image
is visible by where you put its `AssetRef` (`{ id, width, height }`, from `@/core/assets`):

| When the player should see it | Put the ref in |
|---|---|
| From the start | the **puzzle** |
| When earned (next frame, next stage) | the **solution**, then copy it into **state** in `applyMove` when earned |
| After the game ends | the **solution**, returned from **`reveal`** |

A ref that is only in the solution can never be fetched. **Never** put an unrevealed ref in the
puzzle: the whole puzzle goes to everyone who starts. The fixture runner rejects a `secret` asset
whose id is in the puzzle. Write a test that the state after N moves holds exactly the refs
earned so far.

In the UI, render images with `<PuzzleImage asset={ref} alt="Frame 2 of today's film" />`. Alt
text must describe the image's role in the game, never its content, because content would give the
answer away. Nothing is ever drawn over an image (no grain, no overlay); the kit keeps texture on
the surrounding UI only.

## DEV FIXTURE generators

`TMDB_API_KEY` isn't available yet, so image games run on procedurally generated, clearly
labelled stand-in images. A generator builds one day:

```ts
// scripts/content/fixtures/frame-by-frame.mts
import { frameByFrame } from "@/games/frame-by-frame/logic";
import { toFilmDetails } from "@/games/_movies/server";
import { defineFixtureGenerator } from "../lib/fixtures.mjs";
import { fixtureSvg } from "../lib/images.mjs";

export default defineFixtureGenerator({
  game: frameByFrame,
  async generate(ctx) {
    const films = await ctx.topFilms({ limit: 200, requireDirectors: true });
    const answer = ctx.rng.pick(films);
    const frame = (n: number, visibility: "shown" | "secret") =>
      ctx.addAsset({ kind: "frame", visibility, image: fixtureSvg({ width: 1280, height: 720, content: `...${n}...` }) });
    const first = await frame(0, "shown");
    const later: AssetRef[] = []; // import type { AssetRef } from "@/core/assets"
    for (let n = 1; n < 6; n++) later.push(await frame(n, "secret"));
    return { puzzle: { fixture: true, first }, solution: { answer: toFilmDetails(answer), later } };
  },
});
```

The fixture context (`scripts/content/lib/fixtures.mts`) provides:

- `ctx.rng`: seeded from (game, date), so rerunning a day reproduces it. Use it for every choice.
- `ctx.services`: the same `GameServices` that resolvers get. `ctx.db` is a service-role client
  for anything else; never write `puzzles` or `puzzle_assets` with it yourself.
- `ctx.topFilms({ limit, minYear?, requireDirectors? })`: the most popular catalog films. It fails
  with a clear message if the catalog is empty.
- `ctx.addAsset({ kind, visibility, image, format?, maxWidth?, maxHeight?, quality? })`: re-encodes
  the image with sharp (any raster `Buffer`, or SVG markup), strips metadata, caps the size at 4 MB,
  and returns the `AssetRef` to embed. Use `format: "png"` for flat graphics that must stay exact,
  such as palettes and barcodes, and webp (the default) for photographic frames.
- `fixtureSvg({ width, height, content })` from `lib/images.mts` wraps SVG content and stamps a
  "DEV FIXTURE" tag in the corner. Every fixture image must carry it. Also set a `fixture: true`
  flag in your puzzle and pass `devFixture={puzzle.fixture}` to `MoviesStage`, which shows the
  "Dev fixture" tag in the title slate.

The runner validates the puzzle and solution against your schemas, checks JSON round-tripping and
asset visibility, then writes the puzzle and its assets. If an asset fails to save, it deletes the
puzzle so no day is left half-written. It only writes to a local Supabase unless you pass
`--allow-remote`.

```bash
npm run content:fixtures                              # every generator, today (New York) + 7 days
npm run content:fixtures -- --game frame-by-frame     # one game (repeatable)
npm run content:fixtures -- --from 2026-10-06 --days 3
npm run content:fixtures -- --replace                 # regenerate days nobody has played
npm run content:fixtures -- --dry-run                 # generate and validate, write nothing
```

Days that have already been played are never replaced.

**Catalog.** Generators and resolvers read `movie_films`, `movie_people` and `movie_credits`. The
Wikidata import that fills them is a separate content-pipeline step (plan §5) and isn't part of
this foundation. Until it has run locally, `ctx.topFilms` fails and tells you to import the catalog
first. Don't hand-insert catalog rows that lack a `wikidata_id`: the importer upserts on that id,
so such rows would end up as duplicates.

## The Movies UI kit (`./ui`)

Import everything from `@/games/_movies/ui`. Every component is a typed client component.

| Component | Use |
|---|---|
| `MoviesStage` | The board's frame: an ochre title slate with the game name in film-title type, a film-leader `countdown`, and an ink "screen" lit by a cyan projector line. Props: `title`, `kicker`, `variant`, `countdown`, `devFixture`, `slateAside`, `compact` (pass `compact={playing}`: a one-line slate during play, so the puzzle and its controls fit a phone; the full title card returns when the play is over). |
| `variant="neutral"` | **Required for color games** (`color-grade`, `color-barcode`): a neutral-gray (R = G = B) colorist's suite, so the surrounding UI doesn't bias how colors read. Kit components inside inherit the variant. |
| `PuzzleImage` | An asset by ref. Reserves the aspect ratio, shows a loading note and a retry button, and never draws over the picture. |
| `IrisReveal` | Wrap the image in it, keyed by `revealKey={ref.id}`, to open each new image with a gun-barrel iris. It doesn't animate on first render or under reduced motion. |
| `FilmSearch` / `PersonSearch` | Autocomplete over `/api/catalog/films` and `/api/catalog/people`: debounced, cancels stale requests, caches results, ARIA combobox with ↑ ↓ Enter Esc. `excludeIds` shows already-used items struck through and unselectable. `placement="above"` for a field low on the screen. |
| `RevealStrip` | Stage progress as film frames. Each step has a `status` of `locked`, `current`, `seen`, `missed`, `skipped` or `solved`, shown by glyph and border as well as color. `onSelect` lets the player flip back through revealed stages. `showLabels` prints short stage names. |
| `ClueChips` | A guess's clues, using arrows and shapes (↑ ↓ = ■ □ ◆ ◇ ● ○ ?) plus words. A long list of shared genres is shortened on the chip ("Shares Epic · Crime drama +1"); screen readers get the full list. |
| `GuessLog` | Numbered guesses with verdicts and clue chips; takes `FilmGuess` entries or `{ skipped: true }`. `gaveUp` labels a final skip "Gave up". |
| `LastGuess` | Takes the guess log's `entries` and shows the newest one's verdict and clues. Put it in the controls right under the search, so a miss is answered where the player is looking (the `GuessLog` below is the history). After each new move it scrolls itself into view if needed. |
| `LiveStatus` / `guessAnnouncement` | A visually hidden `role="status"` region, and the sentence for it after a guess: the verdict, every clue, then what's next ("Heat isn't it. Before 1995; different director. 5 guesses left."). Every board announces each move. |
| `MoviesButton` | `kind="primary" \| "secondary" \| "quiet"`, 48px tall. |
| `FilmLeader` | A standalone film-leader countdown, if you need one outside the slate. |

Ground rules for boards: design mobile-first at 390px with tap targets of at least 44px; never
show state by color alone; respect `prefers-reduced-motion` (the kit does); keep the look elevated,
not kitschy (no clapperboards or popcorn). Show `submitMove` errors in a `role="alert"` element,
and disable inputs while `pending`.

## Checklist before you hand over

- [ ] `logic.ts` is pure, and its tests cover winning, losing, every rejection path, scoring and
      the share grid.
- [ ] Nothing in the puzzle or state leaks the answer: no answer title, id or facts, and no
      unearned asset refs. Clues are the only path from the answer's facts to the browser.
- [ ] `resolvedMoveSchema` is declared and the server module is registered (or neither, if you
      don't have one).
- [ ] The fixture generator works for today plus 7 days (`npm run content:fixtures -- --game <id>`).
- [ ] `npm run check` and `npm run build` pass.
