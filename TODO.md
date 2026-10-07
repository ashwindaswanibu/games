# To-do

A running list of things we've agreed to do later. Newest decisions live in `design/game-ideas.md` and `design/barcode-film-selection.md`.

## Fade to Color
- [x] **Build the game screen into the app** (full screen, from the approved first look), renamed **Fade to Color**, at `/play/fade-to-color`.
- [x] **Per-film color scheme:** every color on the screen is taken from the film's levels and relit, so dark films glow instead of going muddy.
- [x] **Remove the clue machinery.** The screen shows only the barcode and the reels.
- [x] **Final pick:** after a wrong guess on reel 10, one pick from 4 films (the answer + 3 look-alikes by genre, era and fame) for 5 points.
- [x] **Wordmark:** "Dip to Black" (Ashwin's pick of 12 treatments): "Fade to" fades down letter by letter as the film rolls, then "Color" rises filled with the film.
- [ ] **Series data for the final pick:** import Wikidata "part of the series" (P179) into the catalog, so sequels that share no words with their series (e.g. *The Empire Strikes Back*) can't be decoys for one another.
- [ ] **A win animation** (Ashwin, 2026-10-06): a moment that celebrates naming the film, not just the cut to the end card.
- [ ] **Options gameplay** (Ashwin, 2026-10-06): find the best way to play with the four options (only after reel 10? a lifeline you can open any time, for at most 10 points?), then build it. Brainstorm and build overnight; Ashwin reviews the next day.
- [ ] **Open it to everyone:** it's still `testing` (admins only) until Ashwin says so.
- [ ] **Retire the "Color Grade" game** (a misreading of the movie-LUT idea).
- [ ] **Render every eligible film once, ahead of time** (Ashwin, 2026-10-06; *parked, planned as tomorrow night's job*: all 470 films first, then the new MovieNet films): instead of rendering each day's film the day before, render the whole pool once in the cloud, then the daily picker only chooses from films that are already done. Sizing from the Dune run: about 20 MB of frames downloaded and 2 minutes per film, about 0.9 MB of finished levels. For the 470 eligible films that's roughly 9 GB to download (politely, resumable, about 16 hours at one film at a time) and 420 MB of levels.
  - Split the pipeline in two: *render* a film's ten levels (once per film) and *schedule* a day (choose the film, draw the final pick's options with that day's secret seed, link the levels).
  - Store the levels in Cloudflare R2 rather than Postgres (420 MB would fill the free database), served through the same "only what you've earned" check.
  - New films get rendered as they're added to the catalog (weekly).
- [ ] **At launch, reset the testing period** (Ashwin, 2026-10-06): films used while the game is in testing (Dune: Part Two, The Matrix, Amélie, Mad Max: Fury Road, Barbie, …) go back into the pool, so the "no film twice within a year" rule only counts real days. Ashwin says when.
- [ ] **Daily film picker:** implement the approved selection logic (tiers 25/55/20, no repeats within a year, no franchise or director repeats within 30 days, skip black-and-white films).
- [ ] **Add MovieNet as a second frame source** (*after* the 470 are rendered; same overnight job) (about 1,100 complete films, pre-2019). Needs a free OpenDataLab account (Ashwin). First download only the 10 KB Movie List and measure how many *new* popular films it adds before committing to the ~250 GB download (process in the cloud).

## Home page and overall UI
- [ ] **Home page overhaul** (Ashwin, 2026-10-06): build it from the themes already discussed (the "Title Sequence" direction: B's look with A's motion), with everything learned from his taste while making Fade to Color, and the same control over every element. Claude does a full pass overnight; Ashwin reviews it the next day (recording, stills and a list of every decision made). Games already played today must show their result on the home screen.
- [ ] Bring the same level of design to every screen and game (laptop first, phone good too).

## Content and data
- [ ] **A much bigger film catalog for guessing** (Ashwin, 2026-10-06). Today's has 4,986 films, too few for the guess dropdown and weak on Indian cinema. Every known film is freely available. Wikidata has about 350,000 films (31,000 Indian; CC0). IMDb's datasets have every title, its cast and vote counts; they're free for personal, non-commercial use and refreshed daily. Plan: import them, rank search results by how well-known a film is (IMDb votes, Wikipedia editions), and include original and English titles, so the dropdown finds anything without burying the films people mean.
- [ ] **Use the same catalog for Degrees of Separation**, with cast for every film. IMDb's cast list covers all films; Wikidata has cast for about 22,700 of its 31,000 Indian films. That fixes the missing Indian films.
- [ ] **TMDB API key** (Ashwin) for better popularity data (vote counts) and stills.
- [ ] **Weekly catalog refresh** from Wikidata, with a lower bar for films from the last 2 years.
- [ ] Optional genre caps per month for film selection.

## Infrastructure and cost
- [ ] **Connect Vercel to the GitHub repo** for auto-deploys (Ashwin grants Vercel's GitHub access).
- [ ] **Purge old puzzle images nightly**, keeping yesterday (a Supabase scheduled job).
- [ ] **Serve level images from Cloudflare R2** behind signed links, so there are no egress costs.
- [ ] **Cache leaderboards** (recompute on finish or every minute) instead of recalculating on every view.
- [ ] Decide the global scoring rule across buckets (plain sum vs equal-weight buckets vs best-N).
