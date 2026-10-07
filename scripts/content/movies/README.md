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
npm run content:movies:barcode-levels -- --film <id|auto> --date <YYYY-MM-DD|next-free>   # frames from movie-screencaps.com (section 4)
npm run content:movies:plan-barcode -- --from <YYYY-MM-DD> --days 60 --dry-run   # which film each Fade to Color day gets (section 5)
```

Run them in this order. Degrees and stills read the catalog; Frame by Frame and Color Grade read
the stills cache first and only go to TMDB for films that aren't cached. Each script can be rerun
at any time. A day someone has played is never replaced by anything. Otherwise, per script:

| Script | A day that already has a puzzle |
|---|---|
| `degrees`, `frame-by-frame` | Skipped. With `--replace-fixtures`, a DEV FIXTURE puzzle nobody has played is replaced; a curated one never is |
| `color-grade` | Skipped. With `--replace`, any puzzle nobody has played is regenerated (DEV FIXTURE or curated: use it to redo a bad pick) |
| `barcode-levels` | Refused. With `--replace-fixtures`, a DEV FIXTURE nobody has played is replaced; a curated one never is |
| `plan-barcode` | Kept as it is (whatever it holds) and counted for the selection rules |
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

## 4. Fade to Color levels: `content:movies:barcode-levels`

One film, one day: renders the film's ten levels and stores them as that day's `fade-to-color`
puzzle.

```bash
npm run content:movies:barcode-levels -- --film 483 --date 2026-10-06
npm run content:movies:barcode-levels -- --film 483 --date next-free --pace slower
npm run content:movies:barcode-levels -- --film 483 --dry-run --out design/barcode-tests/dune-part-two-2024/levels
npm run content:movies:barcode-levels -- --film 243 --date 2026-10-10 --head 0.065 --replace-unplayed
```

`design/barcode-tests/*/levels/` is gitignored: a review export reveals a puzzle's answer and every
locked level, so it never goes in the repository.

> **The local database is shared.** Every checkout and worktree on this machine (the main checkout,
> `games-worktrees/*`) talks to the same local Supabase. Puzzles written by this script use the
> ten-level Fade to Color format; a checkout still on the old single-barcode Fade to Color code
> can't load those days (2026-10-06 onward locally) until this branch is merged. And a day that has
> been played is never freed by deleting plays, not even the E2E account's: pick the next unplayed
> day instead (`--date next-free`), or ask the owner first.

**Frames.** From [movie-screencaps.com](https://movie-screencaps.com) (complete films as numbered
screencaps in film order; free for non-commercial use). The script finds the film's gallery in the
site's directory by normalised title and year (preferring a 4K gallery), or takes `--url`. It
reads the gallery's first and last pages for the CDN image pattern and the number of caps, then
downloads ~2,400 thumbnails (`?class=thumbnail`) and ~350 full-quality frames (`?width=…`, sized
so a strip is sharp at the level height). The CDN needs the gallery page as Referer and a browser
User-Agent. At most 6 requests in flight with a short pause after each, retries with backoff.
Frames are cached in a temp directory during the run and deleted at the end; only the levels are
kept. A run takes about two minutes.

**Levels** (`lib/barcode-levels.mts`, unit-tested on synthetic images; the owner-approved
"G+ edges-first" design, reference prototypes in `design/barcode-tests/dune-part-two-2024/reference/`):

- Level 1: the squeezed-frame barcode. Frames sampled evenly across the whole film (the level width,
  kept within 1,600–3,000), letterbox mattes cut away, each frame squeezed to one column (its
  vertical structure survives), laid out left to right. Averaged in sRGB like the approved
  prototype; averaging in linear light brightened Dune: Part Two's columns by about 20%.
- Levels 2–10: the film's story (the whole film minus `--head`, default 5%, and `--tail`, default
  1.5%: opening logos, titles and credits, which often run over the first scenes, and closing
  cards; a credit names the film) cut into N equal stretches (pace `normal`: 128, 88, 60, 42, 30, 21, 15,
  10, 6; `slower` and `faster` are the other presets). Each stretch gives its middle frame (or a
  nearby one, if that is near black) and a full-height strip one N-th of the canvas wide. Cuts
  start at the frame edges, alternating left and right, and move toward the centre level by level
  (crop position (i/8)^ease). Of 9 candidate windows near the target, the most informative wins
  (mean gradient + 0.35 × contrast; near-black windows rejected; text on a flat ground, like a title
  card, marked down to a quarter), never crossing the centre. The distance penalty and the edge
  margin are in the prototype's 533-pixel frame units, so frame resolution doesn't change choices.
  Credits laid over the picture (Barbie's run to 6.1% of the film) can't be told from the picture
  automatically: the run log and `levels.json` say where each level's first and last strips come
  from, so check them in the `--dry-run --out` review and raise `--head`/`--tail` if needed.
- Each level is a 2400 × 800 WebP by default (`--width`, `--height`), with its average and
  dominant colour. The film's colourfulness (mean saturation) is measured too.

**Stored as** ten `puzzle_assets` (`barcode-level-1` … `barcode-level-10`). The public payload
holds only level 1, `maxGuesses: 10` and the film's look; the solution holds the answer snapshot,
all ten levels, the pace and the frame credit. A date that has a puzzle is refused unless nobody
has played it and you pass `--replace-fixtures` (a DEV FIXTURE) or `--replace-unplayed` (a curated
puzzle); a played date is never touched (the database refuses the delete).

**Selection rules** (approved, `design/barcode-film-selection.md`), each refused unless overridden.
They are the film picker's rules (section 5), checked by the same code (`clashes` in
`src/games/fade-to-color/picker.ts`), so a hand-picked film obeys them too:

- a film that is another day's answer within 365 days either side (`--allow-repeat`);
- a director who has another answer within 30 days either side (`--allow-same-director`);
- a film that looks like the same series as an answer within 30 days either side
  (`--allow-same-series`). The catalog has no franchise data, so this is `sameSeries` from
  `src/games/fade-to-color/decoys.ts`, a generous title match: "Dune" and "Dune: Part Two",
  "Spider-Man: No Way Home" and "The Amazing Spider-Man 2", but also "Star Wars" and "Star Trek"
  (same first word). Sequels that share no words with their series ("The Empire Strikes Back")
  slip through;
- a black-and-white film (`--allow-monochrome`; checked on the thumbnails, before the full-quality
  frames);
- a gallery of a single page or under 1,000 caps, not a whole film (`--allow-few-caps`).

The first three are checked before anything is downloaded; dry runs only warn about them. What the
frames show (black and white, colour, too few caps) is recorded in the gallery verdicts (section 5)
so the picker never chooses that film again.

`--film auto` lets the film picker choose the day's film (section 5) and renders it; it needs
`--date` and takes no `--url` or `--allow-*` flags. A film refused on its frames is recorded and the
day is picked again.

The film's gallery comes from the cached copy of the site's directory (section 5), fetched at most
once a day.

| Flag | Default | |
|---|---|---|
| `--film` | (required) | Catalog id (`movie_films.id`), or `auto` for the film picker's choice |
| `--date` | (required unless `--dry-run`) | `YYYY-MM-DD`, or `next-free`: the first day from today (New York) without a puzzle |
| `--url` | from the directory | The film's gallery URL |
| `--pace` | `normal` | `normal`, `slower` or `faster` |
| `--width`, `--height` | 2400, 800 | Level size |
| `--samples` | the width, within 1,600–3,000 | Frames squeezed into level 1 |
| `--quality` | 88 | WebP quality |
| `--concurrency` | 6 | Requests in flight (1–6) |
| `--head`, `--tail` | 0.05, 0.015 | Fractions of the film strips never come from (titles and credits) |
| `--replace-fixtures` | | Take a day that holds an unplayed DEV FIXTURE |
| `--replace-unplayed` | | Take a day whose curated puzzle nobody has played (to re-render it) |
| `--allow-repeat` | | Allow a film that is another day's answer within 365 days |
| `--allow-same-director` | | Allow a director with another answer within 30 days |
| `--allow-same-series` | | Allow a film that looks like the same series as an answer within 30 days |
| `--allow-monochrome` | | Allow a black-and-white film |
| `--allow-few-caps` | | Allow a one-page or under-1,000-cap gallery (a short film) |
| `--dry-run` | | Render and validate, write nothing; with `--out <dir>`, save `level-01.webp` … and `levels.json` for review |
| `--cache-dir` | `content/movies/cache` | Where the directory copy and the gallery verdicts live |
| `--refresh-directory` | | Fetch the site's directory even if the copy is less than a day old |
| `--percentiles` | `pool` | With `--film auto`: what fame percentiles are computed over (section 5) |

## 5. Choosing the film: `content:movies:plan-barcode`

Which film each Fade to Color day gets, by the approved logic (`design/barcode-film-selection.md`,
approved 2026-10-06). The logic is pure and lives with the game, `src/games/fade-to-color/picker.ts`;
its inputs are loaded at run time by `lib/film-picker.mts`; days are rendered through the same code
as `barcode-levels` (`lib/barcode-day.mts`).

```bash
npm run content:movies:plan-barcode -- --from 2026-10-11 --days 60 --dry-run   # print the plan, write nothing
npm run content:movies:plan-barcode -- --days 7                                # plan and render today + 6 days
npm run content:movies:barcode-levels -- --film auto --date next-free         # one day, the picker's film
```

**The pool.** Catalog films (`movie_films`, read when the script runs, so a bigger catalog counts at
once) that have a movie-screencaps.com gallery: same normalised title, a year within one, as
`findGallery` matches them (`matchGalleries`). If two films claim one gallery, the exact year wins,
then the better-known film. Films without a year are left out.

**Fame score (0–100).** Popularity is the film's Wikipedia language editions
(`movie_films.popularity`). Each film gets two percentiles, the share of films at or below its
popularity: overall, and within its era (films released within 2 years either side). Score =
the higher of overall and 0.9 × era, rounded to a whole number, so recent hits that haven't built up
editions yet aren't buried. By default the percentiles are computed **over the pool**
(`--percentiles pool`), which reproduces the approved numbers (Barbie and Avatar: The Way of Water
90, The Batman 85). `--percentiles catalog` computes them over every catalog film with a year
instead; that puts most films with frames in the top tier (Liar Liar becomes Iconic) and drifts as
the catalog grows. Scores depend only on the catalog and the directory.

**Tiers and the mix.** Iconic (85+) on 25% of days, Well-known (60–84) on 55%, Known (45–59) on 20%;
below 45 never. Each day draws its tier by those weights, then a film within it.

**Rules.** A film is skipped on a day when it is another day's answer within 365 days either side,
a director of it directed another answer within 30 days either side, it looks like the same series
as another answer within 30 days either side (section 4), or it is known to be black and white.
"Another day's answer" means every stored Fade to Color puzzle (DEV FIXTURES included, as the
renderer counts them) plus the days planned earlier in the same run. Because "used" is always read
from the stored puzzles, resetting the testing period at launch is a matter of which puzzles are
stored; nothing else needs changing.

**Fallback.** If no film in the drawn tier is eligible, the nearest tier with one is used, the more
popular one first when two are equally near (Iconic → Well-known → Known; Well-known → Iconic →
Known; Known → Well-known → Iconic). The plan's `why` says so. If no tier has an eligible film, the
day gets no film and the plan says so: the rules are never relaxed silently. With today's pool a
whole year of days needs no fallback.

**Deterministic.** The tier comes from the day's seeded rng (`PUZZLE_SEED_SECRET`, the game and the
date, its own seed domain apart from the final pick's); within the tier every eligible film gets a
key from the day's seed and its id, and the lowest key wins. Rerunning gives the same plan for the
same database, directory and verdicts, whatever order they come in. Adding a film to the pool only
ever changes a day's pick to that film, and planning a later stretch after storing an earlier one
gives the same days as planning both at once.

**Black-and-white films and short galleries** can only be told from the frames. The renderer
measures colour on the thumbnails and refuses a grey film; it also refuses a gallery under 1,000
caps. Either way it records a **gallery verdict** (`screencaps-verdicts.json` in the cache folder,
keyed by gallery URL), the planner picks the day again without that film, and every later plan skips
it. A dry run can't know yet, so until a film has been rendered its colour is unchecked: the
summary says how many planned films that is, and those days can change when rendered (later days
may move too). A gallery that shows only one page is not recorded: that may be the site's markup
changing, so the run stops for a human to look.

**The directory** is one request, cached in the cache folder (`screencaps-directory.html`) and reused
for 24 hours; a page that lists no films is refused rather than cached.

**Rendering** (without `--dry-run`): days are rendered and stored one at a time in date order, each
picked against everything stored so far, so the stored days follow the rules even when a film was
refused. Any failure other than a refusal stops the run; the days stored so far stay, and rerunning
carries on. A stored day is never replaced.

**A pre-rendered library** (the planned overnight job) changes only where candidates come from: the
rendered films, with their measured colour, instead of the directory. `pickFilm`/`planDays` take
candidates from either.

The plan prints one line per day (date, film, year, tier, score, why) and a summary: the pool, the
eligible films per tier, how many planned films are unchecked for colour, the tier shares against
the targets, fallbacks, and the closest same-director, same-series and repeated pairs across stored
and planned days.

| Flag | Default | |
|---|---|---|
| `--from` | today (America/New_York) | First date, `YYYY-MM-DD` |
| `--days` | 30 | Number of dates (at most 366) |
| `--dry-run` | | Print the plan; download and write nothing |
| `--percentiles` | `pool` | `pool` or `catalog`: what fame percentiles are computed over |
| `--cache-dir` | `content/movies/cache` | Where the directory copy and the gallery verdicts live (git-ignored) |
| `--refresh-directory` | | Fetch the site's directory even if the copy is less than a day old |
| `--pace`, `--concurrency` | `normal`, 6 | Passed to the renderer |

## Shared utilities (`lib/`)

| Module | What it gives you |
|---|---|
| `pipeline.mts` | `pipelineDb({ allowRemote })` (the service-role client, refusing non-local databases by default); `puzzleDateRange(days, from?)` (dates in the game timezone, via `src/core/day.ts`); `contentSeed(gameId, date)`; `selectAllPages(...)` (reads past PostgREST's 1000-row cap); `existingPuzzleDates(...)`; `replaceableFixtureDates(...)` and `deleteFixturePuzzle(...)` (for `--replace-fixtures`); `deleteUnplayedPuzzle(...)` (for `--replace-unplayed`, guarded by the plays foreign key); `newAsset(kind, image)` and `insertPuzzleIfAbsent(db, { gameId, date, puzzle, solution, assets })` (writes a puzzle and its assets, never overwrites, rolls back on a failed asset); `positiveInt` for flags |
| `http.mts` | `fetchWithRetry` (timeouts, backoff with jitter, `Retry-After`, a descriptive User-Agent), `mapPool`, `chunk` |
| `wikidata.mts` | SPARQL and `wbgetentities` clients with zod validation, plus claim helpers |
| `catalog-model.mts` | Pure Wikidata → catalog rules: which films qualify, genre names, external-id conflicts |
| `degrees-graph.mts` | Pure graph code: `buildGraph`, `linkDistances` (BFS), `bestShortestPath`, `actorPool`, `pickPuzzle` |
| `tmdb.mts` | The TMDB client (`tmdbClient`, `fetchFilmStills`, `encodeStill`, `rankBackdrops`) |
| `stills-cache.mts` | Layout of the stills cache: `readCachedStills`, plus the manifest schema |
| `film-stills.mts` | `stillsSource()`: a film's stills from the cache, else TMDB (what the image pipelines use) |
| `barcode-levels.mts` | Pure Fade to Color level maths: mattes, squeezed columns, the edges-first schedule, dark-frame skipping, smart crop, colour data |
| `barcode-render.mts` | `renderLevels(source, options)`: the ten levels from any `FrameSource` (the real pipeline and the DEV FIXTURE generator share it); tested end to end on an in-memory film |
| `screencaps.mts` | movie-screencaps.com: directory resolver (`findGallery`, `matchGalleries` for a whole catalog), gallery reader, and `ScreencapsSource` (polite downloads, temp cache deleted on `close()`) |
| `screencaps-cache.mts` | The cache folder: the directory copy (`loadDirectory`, one request a day) and the gallery verdicts (`GalleryVerdicts`) |
| `film-picker.mts` | The film picker's inputs, loaded at run time: the pool, fame scores, candidates, stored answers (`loadPickerInputs`, `buildPickerInputs`), and the day's seed (`pickSeed`) |
| `barcode-day.mts` | `renderBarcodeDay`: one Fade to Color day end to end (rules, render, store); `barcode-levels` and the planner both use it |
| `barcode-plan.mts` | `pickAndRenderDay` (pick, render, pick again after a refusal) and the plan's printout |

Image encoding is shared with the fixture tooling in `scripts/content/lib/images.mts`
(`encodeImage`: sharp, sRGB, metadata stripped, 4 MB cap).

The other scripts in this folder belong to the image games and build on these utilities:
`frame-by-frame.mts`, `color-grade.mts` and `barcode-levels.mts`. Each one documents its usage in its
header.

## Tests

The pure parts are unit-tested with no network or database: the retry and backoff logic, Wikidata
parsing, catalog rules, the graph and puzzle picker, TMDB ranking and re-encoding (including a
check that metadata is stripped), the Degrees schema, the Fade to Color level maths (on synthetic
images), the movie-screencaps.com page and directory parsing and gallery matching, the cache folder,
and the film picker's inputs and its pick-again-after-a-refusal loop. Run them with
`npx vitest run scripts`. The film picker itself is tested in `src/games/fade-to-color/picker.test.ts`
(every rule and its boundary, the fallback, determinism, the tier mix and evenness over thousands of
days, a year-long plan checked against every rule).
