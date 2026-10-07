# Movies content pipeline

Scripts that build the Movies bucket's data on your machine and write it into Supabase: the movie
catalog, the daily Degrees of Separation puzzles and the film stills the image games are made from.
They run locally (`npm run content:movies:*`), load `.env.local`, and refuse anything but a local
Supabase unless you pass `--allow-remote` (writes; the owner's call) or, for a run that only reads
(a catalog build, a dry run, a check), `--allow-remote-read`, which gives a client that refuses
every write before it is sent.

The plan behind all this is `design/movies-build-plan.md` (section 5). The game side is in
`src/games/_movies/README.md`.

## Quick start

```bash
npm run db:start                         # local Supabase (if it isn't running)
npm run content:movies:catalog           # IMDb + Wikidata → ~60k films, people, credits (~6 min, no key)
npm run content:movies:degrees           # Degrees puzzles: today (New York) + 30 days
npm run content:movies:stills -- --top 100   # needs TMDB_API_KEY (see below)
npm run content:movies:fixtures          # DEV FIXTURE puzzles for all four Movies games, today + 7 days
```

Per-game real pipelines (each documents its flags in its header):

```bash
npm run content:movies:frame-by-frame    # needs cached stills or TMDB_API_KEY
npm run content:movies:barcode-levels -- --film <id|auto> --date <YYYY-MM-DD|next-free>   # frames from movie-screencaps.com (section 4)
npm run content:movies:plan-barcode -- --from <YYYY-MM-DD> --days 60 --dry-run   # which film each Fade to Color day gets (section 5)
```

Run them in this order. Degrees and stills read the catalog; Frame by Frame reads
the stills cache first and only goes to TMDB for films that aren't cached. Each script can be rerun
at any time. A day someone has played is never replaced by anything. Otherwise, per script:

| Script | A day that already has a puzzle |
|---|---|
| `degrees`, `frame-by-frame` | Skipped. With `--replace-fixtures`, a DEV FIXTURE puzzle nobody has played is replaced; a curated one never is |
| `degrees --repar-unplayed` | A curated day nobody has played whose par the catalog made stale is fixed in place (section 2); DEV FIXTURE days are left alone |
| `barcode-levels` | Refused. With `--replace-fixtures`, a DEV FIXTURE nobody has played is replaced; a curated one never is |
| `plan-barcode` | Kept as it is (whatever it holds) and counted for the selection rules |
| `content:fixtures` (DEV FIXTURES) | Skipped. With `--replace`, only a DEV FIXTURE nobody has played is regenerated; a curated puzzle is never touched |
| `stills`, `catalog` | Write no puzzles |

A puzzle is a DEV FIXTURE when its stored payload has `fixture: true` (the board shows a "Dev
fixture" tag from the same flag).

## 1. Catalog: `content:movies:catalog`

About 60,000 films (every film people are likely to name, Indian and world cinema included),
170,000 people and 650,000 credits, from two sources:

- **[IMDb's non-commercial datasets](https://developer.imdb.com/non-commercial-datasets/)**
  (`title.basics`, `title.ratings`, `title.principals`, `title.crew`, `name.basics`; refreshed
  daily). They decide which films are in and give vote counts, top-billed cast, IMDb's titles and,
  where Wikidata has none, directors and genres, and who acts (`primaryProfession`). **Personal
  and non-commercial use only**, with the credit line *"Information courtesy of IMDb
  (https://www.imdb.com). Used with permission."* (IMDb's exact wording) shown where players see
  the data: `IMDB_ATTRIBUTION` in `src/games/_movies/attribution.ts`, rendered at the foot of every
  Movies board, under the hits of every catalog search list and on Fade to Color's end card.
- **[Wikidata](https://www.wikidata.org)** (CC0), read in bulk through
  [QLever](https://qlever.dev) (a fast public SPARQL engine over Wikidata; the official query
  service is too slow and rate-limited for whole tables). It adds the Wikidata id, Wikipedia
  editions, the English label and aliases, the English Wikipedia title, year, genres, directors,
  TMDB id and deeper cast.

**Which films** (`selectionReason` in `lib/catalog-model.mts`). A title that isn't adult is in when:

1. it is a feature film (IMDb `movie`) with **at least 1,000 IMDb votes or an article in at least
   8 Wikipedias** (the second rule catches world cinema IMDb under-votes);
2. it is a feature film from the last two calendar years with 300+ votes (new releases);
3. it is a TV movie or direct-to-video feature with 5,000+ votes, at least 40 minutes long (or of
   unknown length) and not tagged Short or Adult (The Animatrix, the DC animated films);
4. it is already in the catalog. Nothing is ever dropped.

Released films only (a known year, not after this one); any year from 1870. About 1,000 votes is
where films stop being something a friend would guess; 500 would give ~76,000 films (+30 MB).

**What is stored for each film.**
- **Title** (`displayTitle`): Wikidata's English label, unless neither English Wikipedia nor IMDb
  uses that name; then the English Wikipedia title (without "(… film)"), else IMDb's main title.
  That fixes literal translations nobody uses ("Sometimes Happiness Sometimes Sadness..." is shown
  as *Kabhi Khushi Kabhie Gham*) without taking IMDb's US titles ("Like Stars on Earth" stays
  *Taare Zameen Par*).
- **Every searchable name**, in `movie_film_titles`: the display title, IMDb's main and original
  titles, Wikidata's English label and aliases ("K3G", "DDLJ"), the English Wikipedia title, and
  every display title the film had before (kept by a trigger). Latin script only, one row per
  search key.
- **Year** (Wikidata's earliest release with at least year precision, else IMDb's), **genres**
  (Wikidata's genre labels as display names, most specific first; IMDb's genres mapped onto the
  same names when Wikidata has none), **directors** (Wikidata's, else IMDb's, named by their
  Wikidata label when they have one), TMDB, IMDb and Wikidata ids. A refresh keeps a film's stored
  order of genres and directors.
- **People**: name, `popularity` (Wikipedia editions), Wikidata and IMDb ids, and **`is_actor`**:
  IMDb lists actor or actress among their primary professions, or Wikidata gives them the
  occupation actor, film actor or voice actor (`isActor` in `lib/catalog-model.mts`). Degrees
  starts and ends only at actors. 161,000 of the 168,000 people qualify: nearly everyone credited
  in a cast list has acted. And **`is_human`**: Wikidata says they are an instance of human (Q5);
  false for the 577 cast "members" that are groups (the Marx Brothers, the Beatles), animals
  (Lassie) or mis-linked items, null for IMDb-only people. Degrees never starts or ends at false.
- **`popularity`: Wikipedia editions** (Wikidata sitelinks; 0 without a Wikidata item). Its
  meaning hasn't changed: Degrees, Fade to Color decoys, stills and the fixtures rank by it.
- **`imdb_votes`** and the generated **`fame`** = ln(1 + IMDb votes), or ln(1 + 437 × popularity)
  when IMDb has no rating (437 is the catalog's average votes per edition). Search ranks by fame.

**Cast and billing** (`imdbCastToKeep`, `mergeCast`). IMDb's billed cast (actors and actresses in
`title.principals`, up to 10 a film; "self" and archive footage are left out, so documentary
subjects aren't lead actors): the first 4 always, places 5–10 when the person has a Wikipedia
article. Plus Wikidata's cast list (P161). `billing` (0 = top billed) is IMDb's order first, then
the film's stored order (for films imported before IMDb, Wikidata's credited order), then Wikidata
cast with no known order (no billing). At most 30 credits; over that, the least known unordered
ones go. People are Wikidata's (English label, else the language-neutral one, else IMDb's name;
`popularity` = Wikipedia editions; IMDb person id) or IMDb-only (IMDb's name, popularity 0). IMDb's
cast lands on the Wikidata person with the same IMDb id.

**How it runs.** Two steps, so local and hosted get identical content and every rule is testable
without a database:

1. **Build** (`lib/catalog-build.mts`, no writes). Downloads IMDb's files into `--cache-dir` (only
   when IMDb has a newer file than the cached one: ~1.4 GB, under a minute on a fast line), runs
   eleven QLever queries (~50 s, ~310 MB of CSV, cached), then reads IMDb's files as streams,
   keeping only what the selected films need (IMDb's principals alone are ~100 million lines). It
   writes a **snapshot** (`<cache-dir>/snapshot/`: films and people as NDJSON plus `meta.json`
   with the counts) and prints its summary. About 3.5 minutes; peaks at ~850 MB of memory. If
   QLever fails, the last cached result (at most 30 days old) is reused with a loud warning.
2. **Apply** (`lib/catalog-apply.mts`). Reads the target's rows, plans every write with the pure
   functions in `lib/catalog-plan.mts`, writes in batches of at most 500 rows (well inside the
   API's 8-second limit) and checks the id contract afterwards. About 2 minutes locally for the
   first import, seconds when little changed; expect 15–25 minutes against the hosted database.

A full local run (`npm run content:movies:catalog`) took 5.5 minutes. Rerunning on an unchanged
snapshot writes nothing.

**Catalog ids never change.** Stored puzzles, solutions and plays reference films and people by
`movie_films.id` / `movie_people.id` (as JSON, which no foreign key protects). So:

- An incoming film matches a stored one by Wikidata id, else IMDb id (people: Wikidata id, else
  IMDb person id), and is written under the stored row's own id. A new film is inserted without
  an id. A stored external id is never changed; an empty one is filled in unless another row
  holds it. Nothing is merged or moved: when the two ids point at two stored rows, the Wikidata
  match wins and the other row is left alone (`planCatalogWrites`, property-tested).
- Films and people are never deleted. A credit no source lists any more is removed, except one a
  stored Degrees chain uses (solutions and players' chains replay).
- Triggers refuse any update that changes a film's or person's id.
- Before writing, apply saves every film's and person's ids to
  `<cache-dir>/baselines/catalog-ids-<time>.json`; afterwards it checks that every one still exists
  with the same non-empty Wikidata, IMDb and TMDB ids, that every catalog id a stored puzzle or play
  references exists, and that every link of a stored Degrees solution is still a credit. Any
  failure exits non-zero. The same checks run read-only with
  `npm run content:movies:catalog-check [-- --baseline <file>]`.
- A run that would remove more than 20% of the stored credits of the films it covers stops (a
  source was probably incomplete); `--allow-mass-removal` overrides.

**Search** (`search_films` / `search_people`, latest in
`supabase/migrations/20261013000000_catalog_search_word_starts.sql`). A film matches by any of its
names. How a name matches the query (`catalog_match_class`, one definition for films,
filmographies and people; `matchClass` in `src/games/_movies/scoped-search.ts` mirrors it):

0. exact;
1. the name starts with the query as whole words ("stree" → Stree 2), also right after a leading
   "the", "a" or "an" ("dark" → The Dark Knight);
2. the name starts with the query, ending mid-word ("stree" → Street Kings), also after an article;
3. a later word starts with the query, ending at a word end ("guide" → The Hitchhiker's Guide to
   the Galaxy; 3+ characters);
4. a later word starts with the query, ending mid-word ("stree" → The Wolf of Wall Street; 3+);
5. substring (3+ characters);
6. typos (4+ characters: trigram similarity, or one or two edits at the start of a name for short
   titles like "sholey"), only when the others found fewer results than asked for.

Spaces and punctuation don't matter for exact matches and starts (a generated no-spaces key,
`compact_key`, on titles and people's names): "xmen" finds X-Men, "walle" WALL-E, "raone" Ra.One,
"shahrukh" Shah Rukh Khan (a start ignores spaces only from 3 characters of query, so "it"
doesn't find "I, Tonya").
Sequel numbers match either way: names and queries are also compared with "part", "chapter",
"vol.", "volume" and "episode" before a number dropped and roman numerals written as digits
(`number_key`, `catalog_number_key`): "godfather 2" → The Godfather Part II, "dune 2" → Dune: Part
Two, "kill bill 2" → Kill Bill: Volume 2, "rocky 2" → Rocky II.

Classes 0–3 rank together, by fame plus a bonus; then class 4, then 5, then typos, each by fame:

- an exact title gets ln 30 and a whole-word start ln 3, so a name that starts with the query
  outranks an exact title only with ten times the votes ("dark" → The Dark Knight, 3.2 million
  votes, over Dark), and a mid-word start outranks a whole-word start only with three times
  ("stree" → Stree 2 above Street Kings);
- a later whole word never outranks an exact title ("stree" → Stree; "guide" → Guide; "earth" →
  Earth), and a partial later word comes after every name that starts with the query ("stree":
  The Wolf of Wall Street after Stree 2);
- an exact match on a film's display title beats an exact match on another film's other name
  unless that film has ten times the votes ("court" → Court, not Court – State Vs A Nobody, a.k.a.
  Court; "godfather" → The Godfather, a.k.a. Godfather, over the films titled Godfather).

People rank the same way, by the films they are in: ln(1 + the IMDb votes of every film they're
credited in, a film counting fully when they're billed in its top four, a quarter at 5th–10th and
a tenth below that). "salman" → Salman Khan, not Salman Rushdie (more Wikipedia editions, one
cameo); "deepika" → Deepika Padukone, not an IMDb-only "Deepika". A hit carries `aka`, the other
name it matched by, shown in the dropdown as "also: K3G". With a person it searches their
filmography the same way (Degrees); a film's cast is searched in memory by the same classes and
bonuses (`src/games/_movies/scoped-search.ts`), ranked by Wikipedia editions. Each class is its own
indexed, limited query: typical searches take 10–30 ms end to end, "the" ~45 ms.

**Rolling out to the hosted database** (the owner's call; agents never pass `--allow-remote`). One
sequence, explained step by step in `design/catalog-rollout.md`. With the hosted project's
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `PUZZLE_SEED_SECRET` exported in the shell
(they win over `.env.local`):

```bash
npx supabase db push                                                             # 1. schema
#                                                                                  2. deploy the app (it shows IMDb's credit line)
npm run content:movies:catalog -- --build-only --allow-remote-read               # 3. snapshot against hosted's films (read-only)
npm run content:movies:catalog -- --apply-only --dry-run --allow-remote-read     # 4. compare the plan's counts
npm run content:movies:catalog -- --apply-only --allow-remote                    # 5. apply; note the FIRST baseline path it prints
npm run content:movies:catalog-check -- --allow-remote-read --baseline <first baseline>   # 6.
npm run content:movies:degrees -- --repar-unplayed --dry-run --allow-remote-read # 7. stale Degrees pars…
npm run content:movies:degrees -- --repar-unplayed --allow-remote                #    …fixed on unplayed days
```

8. Then, in the Supabase SQL editor, one statement per run (`reindex … concurrently` can't run in
the transaction the editor wraps a script in): `reindex table concurrently public.movie_people;`,
then the same for `movie_credits`, `movie_films` and `movie_film_titles`. Indexes built row by row
are ~25% larger than fresh ones (locally 163 MB → 134 MB). The catalog then takes ~140 MB of the
free tier's 500 MB.

| Flag | Default | |
|---|---|---|
| `--min-votes` | 1000 | IMDb votes that bring a feature film in |
| `--min-sitelinks` | 8 | Wikipedia editions that bring a feature film in |
| `--recent-min-votes` | 300 | Votes for a feature film from the last two calendar years |
| `--extra-min-votes` | 5000 | Votes for a TV movie or direct-to-video feature |
| `--imdb-cast` | 4 | IMDb's billed cast always kept |
| `--imdb-cast-known` | 10 | IMDb's billed cast kept down to here when the person has a Wikipedia article |
| `--cache-dir` | `content/movies/catalog-cache` | Downloads, query results, snapshot, id baselines (git-ignored; never commit IMDb data) |
| `--snapshot` | `<cache-dir>/snapshot` | Where the snapshot is written or read |
| `--build-only` | | Build the snapshot, write nothing to the database |
| `--apply-only` | | Apply the existing snapshot (no downloads) |
| `--dry-run` | | Build (or read) the snapshot and print what would change, write nothing |
| `--offline` | | Use cached downloads and query results only |
| `--allow-mass-removal` | | Allow removing over 20% of the covered films' stored credits |
| `--allow-remote-read` | | Read a non-local database (only with `--build-only` or `--dry-run`; writes are refused) |
| `--allow-remote` | | Write to a non-local database (owner only) |

## 2. Degrees puzzles: `content:movies:degrees`

This builds the bipartite actor–film graph from **every** catalog credit, in memory. The game
accepts any catalog credit as a link, so computing par over all credits means a player can never
beat par with a credit the generator ignored.

For each date:

1. **Pool.** The 300 best-known people (`--pool-size`, by Wikipedia editions) who are actors
   (`is_actor`: IMDb or Wikidata says so), people (`is_human` isn't false: no groups like the Marx
   Brothers, no animals) and clearly act in this catalog: at least 6 films, at least 3 of them
   billed in the top 5, counting fiction only. Documentaries and concert films (a genre that is
   "Documentary", "… documentary" or "Concert"; `isNonFictionFilm`) don't count, so a singer's
   tour films don't make them an actor. Anyone credited, in any film, can still be a link in a
   chain. This is an interim rule (2026-10-07); the owner chooses the final one (`TODO.md`).
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
(for example after `content:movies:fixtures` filled the coming week). The one rewrite of a curated
day is `--repar-unplayed` (below), and only for a day nobody has played whose par the catalog made
stale. To regenerate an unplayed curated day for any other reason, delete that row yourself first.

**Stale par after a catalog import** (`--repar-unplayed`). More credits can give a stored day's
pair a chain shorter than its par (locally, after the 60k-film import: 13 of 29 unplayed days;
Justin Timberlake and Julie Andrews became co-stars through Shrek the Third). `catalog-check`
lists such days as warnings. `--repar-unplayed` goes through every stored day from `--from`
(default today) on and recomputes the shortest chain over the current credits
(`reparDecision` in `lib/degrees-graph.mts`, unit-tested):

- a day someone has played is never touched (its results already count against that par);
- a DEV FIXTURE day is left alone (`--replace-fixtures` replaces those with real puzzles);
- par still the shortest: kept;
- shorter but still 2+ links: par and solution rewritten, same start and end (and the names
  players were shown);
- the pair are now co-stars: the day is regenerated by the rules above (seeded by its date,
  `--spacing` respected).

Writes go through the database function `replace_unplayed_puzzle`, which locks the day, refuses
it if anyone has started it (even a moment ago) or if it changed since it was read, and only then
rewrites it in place (the day is never empty). Run it with `--dry-run` first.

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
| `--repar-unplayed` | | Instead of new days: fix stale par on stored days nobody has played (above); takes `--from`, not `--days` |
| `--dry-run` | | Print the picks, but write nothing |
| `--allow-remote-read` | | Read a non-local database (with `--dry-run` only) |
| `--allow-remote` | | Write to a non-local database (owner only) |

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
- **Using the cache.** `frame-by-frame.mts` gets stills through
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
from the stored puzzles. The launch reset (testing-phase films return to the pool) isn't built
yet: played puzzles are never deleted, so it will need a launch-date cutoff where the stored
answers are loaded (`loadDayAnswers`). A film may come back exactly 365 days later; a director or
series needs more than 30 days.

**Fallback.** If no film in the drawn tier is eligible, the nearest tier with one is used, the more
popular one first when two are equally near (Iconic → Well-known → Known; Well-known → Iconic →
Known; Known → Well-known → Iconic). The plan's `why` says so. If no tier has an eligible film, the
day gets no film and the plan says so: the rules are never relaxed silently. With today's pool a
whole year of days needs no fallback.

**Deterministic.** The tier comes from the day's seeded rng (`PUZZLE_SEED_SECRET`, the game and the
date, its own seed domain apart from the final pick's); within the tier every eligible film gets a
key from the day's seed and its id, and the lowest key wins. Rerunning gives the same plan for the
same database, directory and verdicts, whatever order they come in, and planning a later stretch
after storing an earlier one gives the same days as planning both at once. Days not stored yet can
change when the catalog or the gallery list changes (scores are relative, and one changed day moves
later ones through the rules); a stored day never changes.

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
| `pipeline.mts` | `pipelineDb({ allowRemote, allowRemoteRead })` (the service-role client: refuses non-local databases by default, read-write with `allowRemote`, and with `allowRemoteRead` a `readOnlyDb` that throws on any insert, upsert, update, delete or function call before it is sent); `puzzleDateRange(days, from?)` (dates in the game timezone, via `src/core/day.ts`); `contentSeed(gameId, date)`; `selectAllPages(...)` (reads past PostgREST's 1000-row cap); `existingPuzzleDates(...)`; `replaceableFixtureDates(...)` and `deleteFixturePuzzle(...)` (for `--replace-fixtures`); `deleteUnplayedPuzzle(...)` (for `--replace-unplayed`, guarded by the plays foreign key); `newAsset(kind, image)` and `insertPuzzleIfAbsent(db, { gameId, date, puzzle, solution, assets })` (writes a puzzle and its assets, never overwrites, rolls back on a failed asset); `positiveInt` for flags |
| `http.mts` | `fetchWithRetry` (timeouts, backoff with jitter, `Retry-After`, a descriptive User-Agent), `mapPool`, `chunk` |
| `imdb.mts` | IMDb's datasets: download when newer, streaming gzip line reader, line parsers, compact `IntTable` |
| `qlever.mts` | QLever (bulk Wikidata) queries, a streaming RFC 4180 CSV parser, cached results with a fallback |
| `catalog-model.mts` | Pure catalog rules: which films are in, display title and searchable names, genre and director names, IMDb cast depth, `mergeCast` billing |
| `catalog-build.mts` | The build step: sources → snapshot (`buildSnapshot`, `matchWikidataItems`) |
| `catalog-snapshot.mts` | The snapshot format (zod-validated NDJSON) |
| `catalog-plan.mts` | Pure apply planning: `planCatalogWrites` (ids never change), `planTitles`, `planCredits` |
| `catalog-apply.mts` | The apply step: plan against the target, write in batches, check |
| `catalog-check.mts` | The id contract: baseline comparison, references in stored puzzles and plays, Degrees solution credits; and the stale-par warning (`staleDegreesDays` over `chainNeighbourhood`, the credits a shorter chain could use, read without loading the whole graph) |
| `degrees-graph.mts` | Pure graph code: `buildGraph`, `linkDistances` (BFS), `bestShortestPath`, `actorPool`, `pickPuzzle`, `reparDecision` |
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
`frame-by-frame.mts` and `barcode-levels.mts`. Each one documents its usage in its
header.

## Tests

The pure parts are unit-tested with no network or database: the retry and backoff logic, IMDb line
parsing and streaming, the CSV parser, catalog rules (selection, titles, names, genres, cast
billing, who counts as an actor), the write planner (including a randomized test that stored ids
never change), the id checks and the stale-par check, the read-only database guard, the graph,
puzzle picker and stale-par decisions, TMDB ranking and re-encoding (including a
check that metadata is stripped), the Degrees schema, the Fade to Color level maths (on synthetic
images), the movie-screencaps.com page and directory parsing and gallery matching, the cache folder,
and the film picker's inputs and its pick-again-after-a-refusal loop. Run them with
`npx vitest run scripts`. The film picker itself is tested in `src/games/fade-to-color/picker.test.ts`
(every rule and its boundary, the fallback, determinism, the tier mix and evenness over thousands of
days, a year-long plan checked against every rule).
The catalog's database side (search tiers, no-spaces keys, names, fame, the id guard,
`replace_unplayed_puzzle`) is covered by `npm run test:db`.
