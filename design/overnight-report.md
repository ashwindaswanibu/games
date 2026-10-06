# Movies overnight report (2026-10-06)

All four Movies games are built, registered and playable in the local app. They're set to `testing`, so only admins see them and they don't count on leaderboards. **Only Degrees has real puzzles.** Frame by Frame, Color Grade and Color Barcode run on procedurally generated stand-ins labelled **DEV FIXTURE**. Real content for those three needs a TMDB key, a few neutral photos, and ffmpeg plus film files (see [What needs you](#4-what-needs-you)).

Everything checked this morning passes: 304 unit tests, 46 DB checks, and the E2E suite on its last run. Nothing is deployed or committed; there's no git repo, so review against the snapshot ([§7](#7-how-to-review-the-code)).

> Spoiler note: the `*-finished.png` screenshots show today's answers. Play first if you want to.

---

## 1. What you can try right now

```bash
cd ~/games
npm run db:start          # only if Supabase is down (it was up this morning)
npx next dev -p 3300      # the port the E2E suite uses; `npm run dev` (:3000) also works
```

Open **http://localhost:3300**. The disk had only 1.9 GB free this morning, so free some space first if you can (§4.1).

**Which account to use.** Testing games are visible only to admins.
- **Quickest: `tester_7a45`.** It's the only local account and it's an admin. The password is `E2E_TEST_PASSWORD` in `.env.local`. The E2E run already finished all four Movies games on it today, so you'll land on finished boards. To play them fresh, run this in Studio (http://127.0.0.1:54323, SQL editor):
  ```sql
  delete from public.plays
  where user_id = (select id from public.profiles where username = 'tester_7a45')
    and puzzle_date = '2026-10-06'
    and game_id in ('degrees','frame-by-frame','color-grade','color-barcode');
  ```
- **Your own account.** Sign up at `/signup` with the `INVITE_CODE` from `.env.local`, then run `update public.profiles set is_admin = true where username = '<you>';`.

**Where the games are.** On the Today page (`/`) there's a **Movies** section under Words, and each card is tagged TESTING. Direct links: `/play/degrees`, `/play/frame-by-frame`, `/play/color-grade`, `/play/color-barcode`. The leaderboard now has Overall, per-bucket and per-game tabs, but testing games score nothing there.

**What's playable.** Today, Oct 6, has a DEV FIXTURE puzzle for all four games. From Oct 7, Degrees switches to real puzzles. The other three have fixtures only up to Oct 13.

## 2. What was built

**Shared platform.**
- Games belong to buckets (Words, Movies, Geography, Chess). The Today page is grouped by bucket and the leaderboard has bucket tabs.
- A per-game server step checks moves against the database, for example "was this actor in this film?".
- Secret images live in `puzzle_assets`. `/api/assets/[id]` serves an image only once it's part of your current play view. Unknown or unearned ids get 404, signed-out callers get 401.
- Movie catalog from Wikidata: **4,986 films, 32,963 people, 81,775 credits**. Search uses accent- and typo-tolerant autocomplete.
- Every catalog and asset route is rate-limited in Postgres and requires sign-in.
- Shared Movies UI kit in `src/games/_movies/`, content pipelines in `scripts/content/movies/`, and an E2E suite in `scripts/e2e/`.

### Degrees of Separation 🔗
- Link today's start actor to the end actor. Each link is two searches: a film the current actor was in, then a co-star from that film's cast. The server checks both credits. Nobody already in the chain can be picked again.
- You get at most **par + 4** links. The last allowed link must land on the end actor; anything else is refused with a prompt to undo. Undo is free. Giving up (with a confirm step) is the only way to lose.
- **Score:** 100 at par, minus 15 per extra link, never below 40. Giving up scores 0. The result reads "N links · par P".
- **Share grid:** 🎞 per link, then ⭐ for a win or 🏳️ for a give-up. The reveal shows one shortest route.
- **Puzzles:** real ones for Oct 7 to Nov 5. Par is the true shortest path over every credit, and an independent check confirmed it for every stored puzzle. Oct 6 is a fixture.
- Screenshots: [mid-play](overnight-shots/movies-degrees-mid.png) · [finished](overnight-shots/movies-degrees-finished.png)

### Frame by Frame 🖼️
- Six frames, hardest first. A wrong guess or a skip reveals the next frame. On frame 6, Skip becomes Give up, with a confirm step.
- **Clues on a wrong guess:** released earlier or later, shared genres, same director. A film you've already guessed can't be picked again.
- **Score:** 100, 88, 76, 64, 52 or 40 by the frame you name it on, 0 for a miss.
- **Share grid:** 🟩 named, 🟥 missed, ⬛ skipped, ⬜ unused.
- **Frames stay secret:** the puzzle holds only frame 1. Each later frame enters your state only when you earn it, and all six arrive with the reveal.
- **Board:**
  - a 16:9 screen with letterbox bars and an iris transition;
  - a film strip you can flip back through;
  - the last guess and its clues right under the search;
  - a contact sheet of all six frames at the end.
- **Content:** DEV FIXTURE frames are procedural stand-ins. Frames 5–6 deliberately show the year and the title's initials, so a test game can always be won.
- Screenshots: [mid-play](overnight-shots/movies-frame-by-frame-mid.png) · [finished](overnight-shots/movies-frame-by-frame-finished.png)

### Color Grade 🎨
- Five tries, each with its own stage:
  1. Palette: five colour columns, each as wide as its share of the frame. Hex values show on hover, focus or tap, or all at once.
  2. Graded: a neutral photo regraded to the film's look, with a Graded/Original toggle.
  3. Blurred frame.
  4. The frame itself.
  5. Final guess.
- A wrong guess or a skip moves to the next stage. Clues are the same as Frame by Frame, and the last try is Give up, with a confirm step.
- **Score:** 100, 85, 70, 55 or 40, and 0 for a loss. The board sits on a neutral-gray stage.
- **Image maths** (pure and unit-tested): seeded k-means in CIELAB, Reinhard colour transfer, and blur in linear light. Fixtures and the real pipeline share the same build code.
- **Content:** DEV FIXTURES grade a procedural cut-paper landscape onto a procedural village, so they show the mechanics, not the feel.
- Screenshots: [mid-play](overnight-shots/movies-color-grade-mid.png) · [finished](overnight-shots/movies-color-grade-finished.png)

### Color Barcode 📼
- The barcode is visible from the start: 360 stripes, each a frame's average colour, drawn in the browser from hex data, so no image is stored.
- You get 6 guesses and no skip. Give up comes with a confirm step.
- **Each miss gives:** released earlier or later, the decade, shared genres, and whether it's the same director.
- **Edge code, from the 3rd miss:** a timeline under the barcode shows the answer's decade with your guesses pinned on it. The years in that decade your clues rule out are struck through ("Released 2000–2008").
- **Score:** 100, 88, 76, 64, 52 or 40. **Share grid:** 🟩 solved, 🟨 a miss in the right decade, ⬛ any other miss.
- **Content:** DEV FIXTURE barcodes are procedural. They're built from scenes with a dark turn and a climax, using colours chosen from the answer's genres.
- Screenshots: [mid-play](overnight-shots/movies-color-barcode-mid.png) · [finished](overnight-shots/movies-color-barcode-finished.png) · [Today page](overnight-shots/movies-today.png)

## 3. Decisions I made while you slept

Rows 1–10 are the plan's **[DECISION]**s. Rows 11 onward are calls the agents made during the build.

| # | Decision | Why | To change it |
|---|---|---|---|
| 1 | All four games ship as `availability: "testing"` | You review them before friends see them | Set `"live"` in `src/games/<id>/logic.ts` (§4.5) |
| 2 | Global score unchanged (plain sum) | How buckets roll up is your call | §4.6 |
| 3 | `number-hunt` sits in Words as a placeholder | Every game needs a bucket | `bucket` in `src/games/number-hunt/logic.ts` |
| 4 | `src/core` stays pure; a per-game `server.ts` resolves moves against the DB | Game logic stays unit-testable with plain inputs | Architectural; `src/server/move-pipeline.ts` |
| 5 | Stills are re-encoded into `puzzle_assets`, never hot-linked | Unrevealed frames never reach the browser, and metadata is stripped | Changing it weakens the spoiler wall |
| 6 | Catalog from Wikidata | CC0, no key, so it could be built overnight | Switch to TMDB credits once there's a key (better billing) |
| 7 | Images from TMDB, with DEV FIXTURE stand-ins until there's a key | TMDB needs your account | §4.2 |
| 8 | TMDB attribution goes in the app footer once TMDB images are live | Required by TMDB's terms | Any visible spot works (an About page, for example) |
| 9 | Real barcodes come from local video files plus ffmpeg | A true barcode needs the whole film | §4.4 |
| 10 | No sound | Scope | Add later |
| 11 | Fixture generators are in `scripts/content/fixtures/<id>.mts`, not `scripts/content/movies/fixtures/` | That's the only place the runner loads them from, and it brings the local-only guard and the never-replace-played rule | Move them and update `scripts/content/fixtures.mts` |
| 12 | Deleted the TEMPORARY `kit-check` scaffold game and 8 hand-entered films with no Wikidata id | Not production quality; the films would have been duplicated on import | — |
| 13 | Catalog = top 4,500 films by Wikipedia sitelinks (at least 20, released 1950 or later) plus the top 40 in each of 30 non-English languages; at most 30 cast per film; billing = Wikidata cast order | A fame proxy that keeps world cinema in; the only free billing signal | `--limit` and the constants in `scripts/content/movies/catalog.mts` |
| 14 | TMDB stills go to a git-ignored cache (`content/movies/stills/`). Game pipelines attach them to dates, and Color Grade no longer looks up TMDB by Wikidata id | An asset belongs to one puzzle date, and TMDB images can't be redistributed | `scripts/content/movies/lib/film-stills.mts` |
| 15 | Degrees: at most par + 4 links, the last slot must reach the end actor, undo is free, giving up is the only loss | No dead-end losses; it stays a puzzle, not a grind | `EXTRA_LINKS`, `EXTRA_LINK_PENALTY`, `MIN_WIN_SCORE` in `src/games/degrees/logic.ts` |
| 16 | Degrees picks: ends from the 300 best-known actors, about 55% par 2, no repeat start or end actor within 45 days, seeded from `PUZZLE_SEED_SECRET` | Recognisable names; a schedule nobody can predict | Constants in `scripts/content/movies/degrees.mts` |
| 17 | New signed-in routes `/api/catalog/filmography?person=` and `/api/catalog/cast?film=` | Degrees' two-step pick; kept generic so the kit can reuse them | — |
| 18 | Skipping the last try ends the game. In Frame by Frame and Color Grade it's labelled Give up and shown as "Gave up" | A clear way out | Each game's `ui.tsx` |
| 19 | Color Grade: stage 2 also unlocks the ungraded neutral photo; the palette is stored as data (hex and share) | Comparing the two shows what the grade did, and the neutral photo says nothing about the film | `src/games/color-grade/logic.ts` |
| 20 | Color Barcode: the plan's "year tick marks from the 3rd miss" became the Edge code timeline under the barcode, not marks drawn on it. No skip; Give up was added in review | Nothing ever covers the barcode, and tick marks alone would repeat clues you already have | `edgeDecade` in `logic.ts`, plus `ui.tsx` |
| 21 | Game emojis 🔗 🖼️ 🎨 📼 (three of the games used to share 🎞️) | So the cards and share texts can be told apart | `emoji` in each `logic.ts` |
| 22 | Postgres rate limits: catalog 40 per 10 s, images 120 per 10 s per player. Catalog routes return 404 to players who can't open any Movies game | Vercel runs several instances, so an in-memory limit wouldn't hold | `src/server/rate-limit.ts` and the route handlers |
| 23 | Replace rules: a day someone has played is never replaced. `--replace-fixtures` (Degrees, Frame by Frame) replaces only DEV FIXTURES; `--replace` (Color Grade, Barcodes) redoes any unplayed day; `content:fixtures --replace` replaces only fixtures | Curated or played content is never lost | Table in `scripts/content/movies/README.md` |
| 24 | **System-level:** the integrator quit and reopened Docker Desktop and deleted `~/games/.next` (504 MB) | Docker had hung and the disk had about 200 MB free. Nothing outside the project was deleted | — (flagged because it touched your machine) |
| 25 | Swapped the 7 unplayed Degrees fixtures for Oct 7–13 (4 had the wrong par) for real puzzles; regenerated the unplayed Frame by Frame and Color Grade fixtures from the full catalog | They were wrong or came from a 15-film starter set | Oct 6 Degrees is still a fixture because it has been played |
| 26 | `test:e2e` (one file, `scripts/e2e/movies.mts`) deletes the test account's plays of today's Movies puzzles before each run, local DB only | Every run starts from a fresh board | `scripts/e2e/movies.mts` setup |
| 27 | UX from review: the last guess and its clues appear under the search and scroll into view after each move; a compact one-line title slate during play; clue chips read "Shares X · Y +N" with redundant parent genres dropped | On a 390×844 phone the clues for a miss were below the fold | `_movies/ui/clue-chips.tsx`, `_movies/clue-text.ts`, `stage.tsx` |
| 28 | The fixer ran Prettier at width 140 on files it touched; the project has no Prettier config | Matches the hand-written style | Add a `.prettierrc`. Expect some formatting noise in the diff |

## 4. What needs you

1. **Free disk space (do this first).** There was 1.9 GB free this morning, and `.next` is back to 425 MB. The biggest candidates (the integrator's measurements; I left them alone) are `~/Library/Caches/pip` (5.3 GB), `com.openai.codex` (3.9 GB), Arc caches (3.8 GB + 1.2 GB) and `com.docker.docker` (2.7 GB).
2. **TMDB key** (free, about 5 minutes; the full guide is in `scripts/content/movies/README.md`):
   1. Sign up at themoviedb.org/signup and verify your email.
   2. Go to Settings → API → Create → Developer. Describe it as a private, non-commercial daily puzzle site for friends.
   3. Copy the **API Read Access Token** (v4, starts with `eyJ`). The v3 key also works.
   4. Add `TMDB_API_KEY=…` to `~/games/.env.local`.
   5. Run `npm run content:movies:stills -- --top 100`, then `npm run content:movies:frame-by-frame -- --replace-fixtures`.
   6. Before any TMDB image goes live, add the attribution footer. It isn't built yet.
3. **Neutral photos for Color Grade.**
   - Put 5–10 of your own (or CC0) photos in `content/neutral/*.jpg`.
   - Each should be an ordinary daylight scene with whites that look white, no faces and no text, at least 1280×720, landscape. The guide is `content/neutral/README.md`.
   - Then run `npm run content:movies:color-grade -- --replace`.
4. **Real barcodes.**
   1. Run `brew install ffmpeg` (it isn't installed).
   2. Put a film file you own at `content/barcodes/<WikidataId>.<ext>`. The folder is git-ignored.
   3. Run `npm run content:movies:barcodes -- --film <Q-id>`, then `… -- --publish --film <Q-id> --date YYYY-MM-DD`.
   4. Each day needs one full film file, so this is the slow part.
5. **Promoting games from testing to live.** Set `availability: "live"` in `src/games/<id>/logic.ts`. Live games are visible to everyone and count on leaderboards. Before promoting a game, make sure:
   - it has real content and enough days scheduled (today only Degrees qualifies);
   - the scoring rule in item 6 is settled;
   - the TMDB footer is in, for the image games.
6. **Global scoring rule (A/B/C).**
   - The options are **A** plain sum of every game's score (current), **B** equal weight per bucket, or **C** best N per bucket.
   - Under A, promoting all four Movies games makes 4 of the 5 games Movies, so the global board would mostly measure Movies.
   - The global total lives in `leaderboard()` in `supabase/migrations/20261005000000_init.sql`, so changing it means a new migration.
7. **Smaller calls when you play:**
   - Is par + 4 the right Degrees limit?
   - Should the search lists open above the field on a real phone with the keyboard up? The kit supports `placement="above"`.
   - Are the clue and countdown wordings right?

## 5. Verification

| Check | Result | Run by |
|---|---|---|
| `npm run check` (tsc, eslint, vitest) | Clean; **32 files, 304 tests passed** | Me, this morning (10:07) |
| `npm run test:db` | **46 checks, 0 failed**: RLS on the new tables, asset and catalog constraints, search ranking, rate limits | Me, this morning |
| `npm run build` | Green, 18 routes | Fix agent, after its last CSS change (not re-run this morning) |
| `npm run test:e2e` | The E2E agent's run passed **192 of 192 checks**. After the review fixes it was re-run with new checks added (last guess visible above the nav, screen-reader status text) and passed with no ✗; that run's total wasn't recorded | Agents (not re-run this morning: it wipes and replays the test account) |
| E2E outcomes, read from today's stored plays | Degrees won 100, "2 links · par 2" · Frame by Frame won 3/6, 76 · Color Grade won 3/5, 70 · Color Barcode won 4/6, 64 | Local DB, this morning |
| Spoiler wall (E2E, every checkpoint) | No unearned image id in the page HTML or in any response. The answer title is absent during play. Unearned `/api/assets/<id>` returns 404, and signed-out requests return 401 | Agents |
| Degrees par | Every pipeline puzzle's par equals the true shortest path over the full catalog | Catalog agent (independent check) |
| Local DB state | Migrations: 4 applied (3 new). Puzzles: Degrees 31 days (Oct 6 to Nov 5, 1 fixture); the other three 8 days each (Oct 6–13, all fixtures) | Me, this morning |

The screenshot set in `design/overnight-shots/` (9 PNGs, 10:05 this morning) comes from the last E2E run, at 390 px wide.

## 6. Known limitations and open issues

- **Only Degrees is real.** The other three run on procedural stand-ins, so you can't judge their difficulty or beauty yet. Fixture barcodes also lean on the answer's genre colours, which hints at the genre.
- **Content runs out on Oct 13** for Frame by Frame, Color Grade and Color Barcode. After that the app shows "Today's puzzle isn't ready yet". Degrees runs to Nov 5.
- **Real pipelines have never run on real inputs:**
  - stills, Frame by Frame and Color Grade, because there's no TMDB key;
  - barcodes, because there's no ffmpeg and no video files.
  
  They're unit-tested with fakes only. The Frame by Frame hard-to-easy ordering heuristic hasn't seen a real still.
- **Today's Degrees (Oct 6)** is a fixture built from a 42-film seed. It can't be swapped because the test account has played it.
- **Catalog quality:**
  - Billing is Wikidata's cast-list order, which isn't guaranteed to match the credits.
  - 24 films are dated 2026, and some may not be out yet; the year check only rejects later years.
  - The "people with only a `mul` label" gap looks handled: the importer asks for `en|mul`, and Bruce Willis is present.
- **No real phone has been tested.** Every browser check ran in headless Chrome at 390×844.
- **Visual nits I saw in this morning's screenshots:**
  - Color Grade's reveal strip shortens "Palette" to "PALE…" at 390 px.
  - The title slate wraps to two lines on DEV FIXTURE days because of the tag.
  - The bottom nav sitting mid-page and the round "N" badge are artefacts of the full-page capture and Next's dev indicator, not bugs.
- **The E2E spoiler-text check skips answer strings under 5 characters** (for example "Heat"). The image-id check has no such gap.
- **The `text_array_ok` DB function** relies on Supabase's default grant for service_role rather than an explicit one.
- **Nothing is deployed.** Production needs:
  - `npx supabase db push` (3 new migrations);
  - the catalog import and puzzle runs with `--allow-remote`;
  - the TMDB footer.
- **Your `algotrading-frontend` container** has been in a restart loop since Docker came back up; it was still "Restarting" this morning. Nobody touched it.

## 7. How to review the code

There's no git repo, so diff against the pre-build snapshot:

```bash
# Which files changed
diff -rq -x node_modules -x .next -x tsconfig.tsbuildinfo -x .DS_Store \
  ~/games-snapshots/2026-10-06-before-movies ~/games
# Full diff, without the lockfile and screenshots
diff -ruN -x node_modules -x .next -x tsconfig.tsbuildinfo -x .DS_Store -x package-lock.json -x '*.png' \
  ~/games-snapshots/2026-10-06-before-movies ~/games > ~/movies-overnight.diff
```

That's about 141 files and 16,300 added lines, not counting the lockfile, the PNGs and `design/home/`.

**Suggested order:**
1. `design/movies-build-plan.md`
2. `src/server/move-pipeline.ts` and `src/server/assets.ts` (the spoiler wall)
3. The migrations
4. One game end to end: `src/games/degrees/`
5. `src/games/_movies/`
6. The scripts

**Changed (21 files that existed before)**
- Platform: `src/core/game.ts` (buckets), `src/proxy.ts`, `src/server/{auth,plays,database.types}.ts`
- App: `src/app/(app)/page.tsx` (Today grouped by bucket), `src/app/(app)/leaderboard/page.tsx` (bucket tabs), `src/app/globals.css` (scroll padding), `src/components/{ui,bottom-nav}.tsx`
- Registries: `src/games/{registry,registry.test,ui}.ts`, `src/games/number-hunt/logic.ts` (bucket)
- Tooling: `package.json`, `package-lock.json` (sharp; puppeteer-core and tsx as dev dependencies), `vitest.config.mts`, `scripts/db-smoke.mts`, `.gitignore`, `README.md`, `next-env.d.ts` (generated)

**New**
- DB: `supabase/migrations/20261006000000_assets_and_movie_catalog.sql`, `20261007000000_movie_catalog_text_checks.sql`, `20261007000100_rate_limits.sql`
- Server: `src/server/{move-pipeline,game-services,game-services.fake,game-server,assets,catalog,catalog-scoped,http,rate-limit}.ts` plus tests; `src/core/assets.ts`
- API: `src/app/api/assets/[id]/`, `src/app/api/catalog/{films,people,filmography,cast}/`
- Games: `src/games/{buckets,server-registry}.ts`
  - `src/games/{degrees,frame-by-frame,color-grade,color-barcode}/`: logic, server, ui, CSS and tests in each
  - plus `path.ts`, `frame-order.ts`, `imaging.ts` and `barcode.ts`
- Movies kit: `src/games/_movies/` (schemas, hints, clue text, scoped search, server helpers, README, `ui/`)
- Content: `scripts/content/fixtures.mts`, `scripts/content/lib/`, `scripts/content/fixtures/` (4 generators and the Degrees seed), `scripts/content/movies/` (catalog, degrees, stills, frame-by-frame, color-grade, barcodes, `lib/`, README), `content/neutral/README.md`, `content/barcodes/.gitignore`
- E2E: `scripts/e2e/movies.mts`, `scripts/e2e/lib/`
- Design: `design/movies-build-plan.md`, `design/overnight-shots/`, this report. `design/home/` (`home-a.html`, `home-b.html`) is the separate home prototype the plan mentions, not part of the Movies build.
