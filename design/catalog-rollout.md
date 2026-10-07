# Film catalog: rolling it out to the hosted database

> **The owner runs this, not an agent** (agents never pass `--allow-remote`). One sequence, in this
> order; each step says what to check before the next. It is the same sequence as
> `scripts/content/movies/README.md`, section 1. Measured locally on 2026-10-07: the catalog goes
> from 4,986 films to 60,559 (168,000 people, 646,000 credits, ~140 MB of the free tier's 500 MB).

## The sequence

| # | Step | Command | Writes to hosted? |
|---|---|---|---|
| 1 | Schema | `npx supabase db push` | yes (migrations) |
| 2 | Deploy the app | the usual Vercel deploy of `main` | no |
| 3 | Build the snapshot against hosted | `npm run content:movies:catalog -- --build-only --allow-remote-read` | no (read-only client) |
| 4 | Preview the apply | `npm run content:movies:catalog -- --apply-only --dry-run --allow-remote-read` | no (read-only client) |
| 5 | Apply | `npm run content:movies:catalog -- --apply-only --allow-remote` | yes |
| 6 | Check the id contract against the **first** baseline | `npm run content:movies:catalog-check -- --allow-remote-read --baseline <first baseline>` | no |
| 7 | Fix Degrees days the bigger catalog made easier | `npm run content:movies:degrees -- --repar-unplayed --dry-run --allow-remote-read`, then the same with `--allow-remote` instead | yes (unplayed days only) |
| 8 | Reindex, one statement per run | Supabase SQL editor, four statements (below) | yes (indexes) |

Why this order:

- **Schema before the app**: the new app calls `search_films` with a person, reads `aka` and
  `fame`, and expects the no-spaces keys; the old app only reads columns the new functions still
  return, so it keeps working between steps 1 and 2.
- **The app before the data**: IMDb's licence requires its credit line wherever its data is shown.
  The new app shows it (every Movies board, every catalog search list, Fade to Color's end card);
  the old one doesn't, so IMDb data must not reach players before the new app is live.
- **Build against hosted**: the build keeps every film the target already has, so it must read the
  hosted catalog's ids, not the local one's. It only reads.
- **Dry run before apply**: it compares the snapshot with the hosted rows and prints the plan
  without writing.
- **The first baseline**: apply saves every film's and person's ids before it writes. If it fails
  half-way and you run it again, the second run's baseline already contains the first run's
  writes. Always check against the first one.
- **Degrees after the catalog**: more credits make shorter chains, so some stored days' par becomes
  wrong. Step 6 lists them; step 7 fixes the unplayed ones.
- **Reindex last**: indexes built row by row during the import are ~25% larger than fresh ones.

## Before you start

- Work from the repository root on `main` with `catalog-expansion` merged, in a terminal used only
  for this.
- Point the scripts at the hosted project. Every `npm run content:*` script loads `.env.local`, but
  variables already in the environment win over it. Put these in `.env.hosted` (git-ignored, like
  every `.env*` file) and load them into this terminal only:

  ```bash
  # .env.hosted
  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_SECRET_KEY=<the hosted secret (service role) key>
  PUZZLE_SEED_SECRET=<the production seed secret>   # step 7 seeds regenerated days from it
  ```

  ```bash
  set -a; source .env.hosted; set +a
  npm run content:movies:catalog-check -- --allow-remote-read
  # first line: "Checking <project-ref>.supabase.co: 4986 films, …" (the old catalog, before step 5)
  ```

- Without a flag, every content script refuses a non-local database (`Refusing to use
  <host>…`). `--allow-remote-read` gives a client that refuses every write before it is sent
  (insert, upsert, update, delete, database functions); scripts that would write refuse the flag
  up front. `--allow-remote` writes.
- Downloads and query results go to `content/movies/catalog-cache/` (git-ignored; never commit
  IMDb data). Step 3 downloads ~1.4 GB from IMDb when IMDb has newer files than the cache.

## Steps in detail

**1. `npx supabase db push`.** `npx supabase migration list` first: five migrations are pending,
`20261011000000_catalog_expansion`, `20261012000000_catalog_search_tiers`,
`20261012000100_degrees_actors_and_repar`, `20261013000000_catalog_search_word_starts` and
`20261013000100_movie_people_is_human`. They add columns and indexes and replace the search
functions; nothing is deleted. Adding the no-spaces keys and the sequel-number key rewrites
`movie_people` and `movie_film_titles` (seconds at today's hosted size).

**2. Deploy the app** (Vercel, from `main`). Check that a Movies board shows *Information courtesy
of IMDb (https://www.imdb.com). Used with permission.* at its foot and that a film search lists it
under the hits.

**3. Build.** `npm run content:movies:catalog -- --build-only --allow-remote-read` (~6 minutes,
~850 MB of memory). It ends with the snapshot's summary; compare it with the local build: about
60,500 films (49,000 by votes, 9,000 by Wikipedia editions), 168,000 people of whom 161,000 are
actors and ~580 are not human (`notHuman`: groups, animals), 666,000 credits before the cap. A
count far off means a source was incomplete: stop (if QLever failed, the log says which cached
result it used instead).

**4. Dry run.** `npm run content:movies:catalog -- --apply-only --dry-run --allow-remote-read`
(~1 minute). Compare the plan with the local first import on the same old catalog:

| | Local first import (2026-10-07) |
|---|---|
| films | +55,573 new, 4,985 updated (46 retitled) |
| people | +135,498 new, 32,182 updated |
| titles | +41,985 |
| credits | 615,406 written, 460 removed |

Small differences are expected (IMDb refreshes daily; the hosted catalog may hold a few films
local doesn't). Stop if removals approach 20% of the stored credits (the apply refuses above
that anyway) or if updates are far above ~5,000 films.

**5. Apply.** `npm run content:movies:catalog -- --apply-only --allow-remote` (15–25 minutes over
the network). Its first lines print `id baseline saved to …/baselines/catalog-ids-<time>.json`:
**write that path down**; it is the first baseline. The run ends by checking the id contract (a
failure exits non-zero) and lists stale Degrees days as warnings (`!`). If it fails part-way, run
the same command again: it is idempotent (stored rows are updated under their own id, nothing is
deleted except credits no source lists), and check against the first baseline afterwards.

**6. Check.** `npm run content:movies:catalog-check -- --allow-remote-read --baseline
content/movies/catalog-cache/baselines/catalog-ids-<first>.json`. It must end with *✓ The catalog id
contract holds.*: every old film and person still exists with the same Wikidata, IMDb and TMDB ids;
every id a stored puzzle or play references exists; every link of a stored Degrees solution is
still a credit. It also lists the unplayed Degrees days from today on whose par is now stale (locally
13 of 29).

**7. Degrees.** `npm run content:movies:degrees -- --repar-unplayed --dry-run --allow-remote-read`,
read the list, then `npm run content:movies:degrees -- --repar-unplayed --allow-remote`. For every
stored day from today on that nobody has played: if the shortest chain is now shorter than par,
par and the solution are rewritten (same start and end) when the new par is still 2 or more, and
the day is regenerated by the normal rules when the pair are now co-stars. Played days and DEV
FIXTURE days are never touched; the write itself refuses a day someone started a moment ago
(`replace_unplayed_puzzle`). Run step 6's check again: it should find 0 stale days.

**8. Reindex.** In the Supabase SQL editor, run each statement **on its own** (`reindex …
concurrently` can't run inside a transaction, and the editor wraps a multi-statement script in
one):

```sql
reindex table concurrently public.movie_people;
```
```sql
reindex table concurrently public.movie_credits;
```
```sql
reindex table concurrently public.movie_films;
```
```sql
reindex table concurrently public.movie_film_titles;
```

Locally this took the catalog's indexes from 163 MB to 134 MB. Check the total afterwards
(Database → Usage, or `select pg_size_pretty(pg_database_size(current_database()));`): about
145 MB for the catalog plus whatever puzzle images are stored.

## Afterwards

- Search for "kabhi khushi", "xmen", "stree" and "deepika" in the app.
- Close the terminal (or `unset NEXT_PUBLIC_SUPABASE_URL SUPABASE_SECRET_KEY PUZZLE_SEED_SECRET`)
  so no later command in it reaches the hosted database.
- Later refreshes are the same steps 3–7 (step 6 against that run's baseline; step 8 only after a
  large import).

## Series, adult films and apostrophes (branch `catalog-quality`, built 2026-10-07, not live)

Three catalog fixes on top of the rollout above (`scripts/content/movies/README.md`, section 1):
Wikidata's series (`movie_films.series_qids`) for Fade to Color's four and the film picker, adult
films hidden (`movie_films.is_adult`), and an apostrophe kept inside its word in search keys, with
a second key that still finds the word after it ("hara" → the O'Haras). Same ground rules as above:
the owner runs it, from `main` with the branch merged, in a terminal with `.env.hosted` loaded. In
this order:

1. **Schema and key recompute:** `npx supabase migration list`, then `npx supabase db push`. Three
   migrations: `20261014000000_catalog_search_apostrophes` replaces `catalog_search_key` and
   rewrites every stored key that changes (locally 2,429 films, 976 people and 4,356 of 102,427
   searchable names, 49 of which merge into another name of the same film; seconds);
   `20261014000100_catalog_series_and_adult` adds `series_qids` (empty) and `is_adult` (false) and
   replaces `search_films` / `search_people` (same signatures);
   `20261014000200_catalog_search_split_key` adds the split key (`split_key`, apostrophes as
   spaces) to `movie_film_titles` and `movie_people` and replaces the two search functions again.
   Adding a stored generated column rewrites both tables and rebuilds their indexes: about 6 s
   locally (titles 26 → 28 MB, people unchanged at 54 MB), during which searches wait. Search uses
   the new keys from here on ("don" lists Don first, "hara" Catherine O'Hara). No reindex needed:
   the rewritten tables get fresh indexes, and the first migration rewrites only a few thousand
   rows.
2. **Deploy the app.** It reads `movie_films.is_adult`, so it must not go out before step 1; the
   old app keeps working after step 1.
3. **Build against hosted** (read-only): `npm run content:movies:catalog -- --build-only
   --allow-remote-read`. Check the summary: `adult` 3, `withSeries` about 2,250 and `series` about
   660 (local: 2,256 and 658), and `largestSeries` (Batman in film, Doraemon, Detective Conan,
   James Bond…): a studio catalogue or a universe in that list belongs in `NOT_A_SERIES`
   (`lib/catalog-model.mts`); add it and build again.
4. **Dry run:** `npm run content:movies:catalog -- --apply-only --dry-run --allow-remote-read`.
   Expect about 2,260 films updated for series and the adult flag, plus IMDb's vote changes since
   the last import (locally 16,828 updated in all, 1 retitled, unrelated to this branch).
5. **Apply:** `npm run content:movies:catalog -- --apply-only --allow-remote`; write down the first
   baseline path. Until this step the three adult films still show in search (the flag is false).
6. **Check:** `npm run content:movies:catalog-check -- --allow-remote-read --baseline <first
   baseline>`. It must end with ✓, and its notes say *3 films hidden as adult; 0 referenced by a
   stored puzzle or play* (a warning names any day that references one: look at it by hand).
7. **Re-check the stored fours:** `npm run content:movies:recheck-fours -- --dry-run
   --allow-remote-read`, then `npm run content:movies:recheck-fours -- --allow-remote` if it lists
   days: unplayed Fade to Color days from tomorrow on whose four now breaks the rules (two films of
   one Wikidata series, a hidden film) get a new four. Played days and today are never touched.
8. **Degrees,** as after every apply: `npm run content:movies:degrees -- --repar-unplayed --dry-run
   --allow-remote-read`, then with `--allow-remote` if it lists days.

Afterwards search the app for "don" (Don, 2006, first), "dont look up", "oceans eleven", "deep
throat" (not listed), and people for "hara" (Catherine O'Hara first; in Degrees, Home Alone's cast).
