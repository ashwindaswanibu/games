# Movies content pipeline

Scripts that build the Movies bucket's data on your machine and write it into Supabase: the movie
catalog, the daily Degrees of Separation puzzles and the film stills the image games are made from.
They run locally (`npm run content:movies:*`), load `.env.local`, and refuse to write to anything
but a local Supabase unless you pass `--allow-remote`.

The plan behind all this is `design/movies-build-plan.md` (section 5). The game side is in
`src/games/_movies/README.md`.

## Quick start

```bash
npm run db:start                         # local Supabase (if it isn't running)
npm run content:movies:catalog           # Wikidata → films, people, credits (~30–40 min, no key)
npm run content:movies:degrees           # Degrees puzzles: today (New York) + 30 days
npm run content:movies:stills -- --top 100   # needs TMDB_API_KEY (see below)
npm run content:movies:fixtures          # DEV FIXTURE puzzles for all four Movies games, today + 7 days
```

Per-game real pipelines (each documents its flags in its header):

```bash
npm run content:movies:frame-by-frame    # needs cached stills or TMDB_API_KEY
npm run content:movies:color-grade       # needs cached stills or TMDB_API_KEY, and content/neutral/*.jpg
npm run content:movies:barcodes          # needs local video files in content/barcodes/ and ffmpeg
```

Run them in this order. Degrees and stills read the catalog; Frame by Frame and Color Grade read
the stills cache first and only go to TMDB for films that aren't cached. Each script can be rerun
at any time. A day someone has played is never replaced by anything. Otherwise, per script:

| Script | A day that already has a puzzle |
|---|---|
| `degrees`, `frame-by-frame` | Skipped. With `--replace-fixtures`, a DEV FIXTURE puzzle nobody has played is replaced; a curated one never is |
| `color-grade`, `barcodes` | Skipped. With `--replace`, any puzzle nobody has played is regenerated (DEV FIXTURE or curated: use it to redo a bad pick) |
| `content:fixtures` (DEV FIXTURES) | Skipped. With `--replace`, only a DEV FIXTURE nobody has played is regenerated; a curated puzzle is never touched |
| `stills`, `catalog` | Write no puzzles |

A puzzle is a DEV FIXTURE when its stored payload has `fixture: true` (the board shows a "Dev
fixture" tag from the same flag).

## 1. Catalog: `content:movies:catalog`

**Source.** [Wikidata](https://www.wikidata.org), CC0 licensed, no key needed.

**Which films.** Every film item (`film`, `feature film`, `animated film`) released from 1950 on,
ranked by **sitelink count**: the number of Wikipedia language editions with an article about it.
That is a robust, language-neutral measure of fame. The script takes:

- the top `--limit` films of that global ranking (default 4,500), plus
- the 40 best-known films in each of about 30 major non-English original languages (Hindi,
  Japanese, Korean, French, Italian, Spanish, Chinese, Tamil, Telugu, Persian and others). These
  guarantee that world cinema is represented even where English Wikipedia dominates the global
  ranking.

Films with no release date, no cast, or a release year in the future are skipped. A typical run
gives about 5,000 films.

**What is stored for each film.** Title (the English label, else the original title), year
(earliest release), genres (display names such as "Science fiction", taken from Wikidata's genre
labels), directors, popularity (the sitelink count), TMDB and IMDb ids, and the Wikidata id.

**Cast and billing.** The top 30 cast members (P161) in **the order Wikidata lists them**. That
order is the `billing` column, where 0 means top billed. RDF and SPARQL have no statement order,
so cast is read through the Action API (`wbgetentities`), which keeps the order editors entered.
They usually copy it from the credits, which makes it the best free billing signal. A person's
popularity is their own sitelink count.

**How it runs.**
1. One SPARQL query lists the candidates, and one query per language adds the language picks.
2. `wbgetentities` fetches the films' statements, 50 per request, one request at a time. The
   Action API rate-limits bursts. When it returns HTTP 429 the script waits as long as
   `Retry-After` says, which is why a full run takes 30–40 minutes.
3. SPARQL fetches the labels and sitelink counts of genres, directors and roughly 70,000 actors,
   400 per query.
4. Rows are upserted into `movie_films`, `movie_people` and `movie_credits`.

Every request retries transient failures (network errors, 408, 429, 5xx) with exponential backoff
and jitter, and honours `Retry-After`. Responses are validated with zod.

**Idempotent.** Films and people are upserted on `wikidata_id`, so a rerun refreshes them in place
and never duplicates anything. Each imported film's credits are replaced by its current Wikidata
cast. Films and people are **never deleted**: a published puzzle or a play may refer to them.

Some Wikidata items share a TMDB or IMDb id, which the catalog requires to be unique. In that case
the more popular film keeps the id, and an id already stored for another item stays with that
item.

| Flag | Default | |
|---|---|---|
| `--limit` | 4500 | Films taken from the global ranking |
| `--min-sitelinks` | 20 | Smallest sitelink count considered for the global ranking |
| `--min-year` | 1950 | Earliest release year |
| `--per-language` | 40 | Films guaranteed per non-English language (0 turns this off) |
| `--language-min-sitelinks` | 12 | Smallest sitelink count for a language pick |
| `--dry-run` | | Fetch everything and print the counts, but write nothing |

## 2. Degrees puzzles: `content:movies:degrees`

This builds the bipartite actor–film graph from **every** catalog credit, in memory. The game
accepts any catalog credit as a link, so computing par over all credits means a player can never
beat par with a credit the generator ignored.

For each date:

1. **Pool.** The 300 best-known people (`--pool-size`) who are clearly actors in this catalog:
   at least 6 films, at least 3 of them billed in the top 5.
2. **Target par.** The seeded rng chooses 2 links (about 55% of days) or 3. If no pair fits the
   target, it falls back to the other.
3. **Pair.** A start from the pool, then an end from the pool whose shortest chain to the start
   is exactly that par, found by breadth-first search.
4. **Solution.** Of all the shortest chains, the most recognisable one is stored: famous films,
   famous intermediate co-stars, credits near the top of the bill.

Stored shapes are defined in `src/games/degrees/schema.ts`, which both the game and this script
import:

```jsonc
// puzzles.payload (every player receives it)
{ "start": { "id": 12, "name": "Tom Hanks" }, "end": { "id": 98, "name": "Meryl Streep" }, "par": 2 }
// puzzles.solution (server-only until the play ends; the reveal)
{ "path": [ { "film": { "id": 7, "title": "…", "year": 2002 }, "person": { "id": 40, "name": "…" } },
            { "film": { … }, "person": { "id": 98, "name": "Meryl Streep" } } ] }
```

Before anything is written, each puzzle is checked against those schemas, against the registered
game's own schemas if `degrees` is in `src/games/registry.ts`, and against the graph: every link
must be a real pair of credits.

**Never overwrites a real puzzle.** A date that already has a `degrees` puzzle is skipped, whoever
wrote it. Pass `--replace-fixtures` to let real puzzles take over DEV FIXTURE days nobody has played
(for example after `content:movies:fixtures` filled the coming week). To regenerate an unplayed
curated day, delete that row yourself first.

**Variety.** Nobody appears as a start or end actor twice within `--spacing` days (default 45).
Puzzles already stored on either side of the range count towards this.

**Seeded.** Choices come from `PUZZLE_SEED_SECRET` plus the date, so the schedule can't be predicted
from the source code. Rerunning a date against the same catalog reproduces the same puzzle.

| Flag | Default | |
|---|---|---|
| `--from` | today (America/New_York) | First date, `YYYY-MM-DD` |
| `--days` | 31 | Number of dates: today plus the next 30 |
| `--pool-size` | 300 | Size of the start/end actor pool |
| `--spacing` | 45 | Days before the same actor can be a start or end again |
| `--replace-fixtures` | | Also replace DEV FIXTURE puzzles nobody has played |
| `--dry-run` | | Print the picks, but write nothing |

## 3. Stills: `content:movies:stills`

This downloads film backdrops from TMDB and re-encodes them into the exact form `puzzle_assets`
stores them in.

```bash
npm run content:movies:stills -- --top 100              # the 100 best-known films
npm run content:movies:stills -- --film 42 --film 7     # specific films (movie_films.id)
npm run content:movies:stills -- --top 100 --per-film 10 --refresh
```

- **Finding the film.** The TMDB id comes from Wikidata (nearly every catalog film has one). If it
  is missing, the script looks the film up by its IMDb id.
- **Textless backdrops only.** It asks TMDB for images with no language tag. Backdrops tagged with a
  language usually show the title treatment, which would give the answer away. Landscape images at
  least 1280 px wide are preferred, ordered by TMDB votes.
- **Re-encoding.** Images are re-encoded with sharp to webp, at most 1280 px wide, with all
  metadata (EXIF, XMP, ICC) stripped. That is `encodeStill()` in `lib/tmdb.mts`.
- **Output.** Files go to `content/movies/stills/tmdb-<id>/` as `01.webp, 02.webp, …` (best first),
  with a `manifest.json` (film identity, sizes, TMDB paths). The folder is git-ignored. Films that
  are already cached are skipped unless you pass `--refresh`.
- **Using the cache.** `frame-by-frame.mts` and `color-grade.mts` get stills through
  `stillsSource()` in `lib/film-stills.mts`: the cache first (no network, the same stills every
  run), then TMDB for films that aren't cached. Without `TMDB_API_KEY` they use cached films only.
  Each image can go straight to `newAsset(kind, image)` and `insertPuzzleIfAbsent(...)`, both in
  `lib/pipeline.mts`.

Without `TMDB_API_KEY`, the script stops before touching the database, with instructions. Until
there is a key, the image games use their DEV FIXTURE generators (`npm run content:fixtures`).

### Getting a TMDB key (free, about 5 minutes)

1. Create an account at <https://www.themoviedb.org/signup> and verify your email.
2. Open **Settings → API** (<https://www.themoviedb.org/settings/api>) and click **Create** /
   **Request an API key**. Choose **Developer**, accept the terms, and describe the app: a private,
   non-commercial daily puzzle site for friends. The URL can be the site's address.
3. TMDB then shows two credentials. Either works:
   - **API Read Access Token** (v4, a long string starting with `eyJ`). This one is preferred. It is
     sent as a bearer token.
   - **API Key** (v3, 32 hex characters). It is sent as `api_key`.
4. Add it to `.env.local`, which is never committed:
   ```
   TMDB_API_KEY=eyJhbGciOi…
   ```
5. Run `npm run content:movies:stills -- --top 100`.

### TMDB attribution (required)

TMDB's API terms require every product that shows TMDB data or images to carry this notice, with
the TMDB logo, somewhere users can see it (an about or credits area or the footer):

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The plan's decision is to put it in the **app footer as soon as any TMDB image is live** (plan §4).
TMDB images are licensed for display only. They must not be redistributed, which is why the stills
cache is git-ignored and assets are served only through the authenticated `/api/assets/[id]`
route. Wikidata (the catalog) is CC0 and needs no attribution, though crediting it is courteous.

## Shared utilities (`lib/`)

| Module | What it gives you |
|---|---|
| `pipeline.mts` | `pipelineDb({ allowRemote })` (the service-role client, refusing non-local databases by default); `puzzleDateRange(days, from?)` (dates in the game timezone, via `src/core/day.ts`); `contentSeed(gameId, date)`; `selectAllPages(...)` (reads past PostgREST's 1000-row cap); `existingPuzzleDates(...)`; `replaceableFixtureDates(...)` and `deleteFixturePuzzle(...)` (for `--replace-fixtures`); `newAsset(kind, image)` and `insertPuzzleIfAbsent(db, { gameId, date, puzzle, solution, assets })` (writes a puzzle and its assets, never overwrites, rolls back on a failed asset); `positiveInt` for flags |
| `http.mts` | `fetchWithRetry` (timeouts, backoff with jitter, `Retry-After`, a descriptive User-Agent), `mapPool`, `chunk` |
| `wikidata.mts` | SPARQL and `wbgetentities` clients with zod validation, plus claim helpers |
| `catalog-model.mts` | Pure Wikidata → catalog rules: which films qualify, genre names, external-id conflicts |
| `degrees-graph.mts` | Pure graph code: `buildGraph`, `linkDistances` (BFS), `bestShortestPath`, `actorPool`, `pickPuzzle` |
| `tmdb.mts` | The TMDB client (`tmdbClient`, `fetchFilmStills`, `encodeStill`, `rankBackdrops`) |
| `stills-cache.mts` | Layout of the stills cache: `readCachedStills`, plus the manifest schema |
| `film-stills.mts` | `stillsSource()`: a film's stills from the cache, else TMDB (what the image pipelines use) |

Image encoding is shared with the fixture tooling in `scripts/content/lib/images.mts`
(`encodeImage`: sharp, sRGB, metadata stripped, 4 MB cap).

The other scripts in this folder belong to the image games and build on these utilities:
`frame-by-frame.mts`, `color-grade.mts` and `barcodes.mts`. Each one documents its usage in its
header.

## Tests

The pure parts are unit-tested with no network or database: the retry and backoff logic, Wikidata
parsing, catalog rules, the graph and puzzle picker, TMDB ranking and re-encoding (including a
check that metadata is stripped), and the Degrees schema. Run them with `npx vitest run scripts`.
