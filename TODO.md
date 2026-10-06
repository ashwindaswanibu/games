# To-do

A running list of things we've agreed to do later. Newest decisions live in `design/game-ideas.md` and `design/barcode-film-selection.md`.

## Color Barcode
- [ ] **Build the game screen into the app**, from the approved first look: the room lit by the film's colors, the film-strip reel, the reflection, the light-sweep "unreel", and the 10-notch counter with look-back. To improve first: the wordmark font and the background.
- [ ] **Per-film color scheme:** make sure every film's colors come out nicely (dull or dark films shouldn't look muddy).
- [ ] **Remove the clue machinery** (year, genre and director chips). The screen shows only the barcode and attempts.
- [ ] **Retire the "Color Grade" game** (a misreading of the movie-LUT idea).
- [ ] **Daily film picker:** implement the approved selection logic (tiers 25/55/20, no repeats within a year, no franchise or director repeats within 30 days, skip black-and-white films).
- [ ] **Add MovieNet as a second frame source** (about 1,100 complete films, pre-2019). Needs a free OpenDataLab account (Ashwin). First download only the 10 KB Movie List and measure how many *new* popular films it adds before committing to the ~250 GB download (process in the cloud).
- [ ] *Maybe:* multiple-choice options at the very end, just for fun (to discuss).

## Home page and overall UI
- [ ] **Redesign the home page with the same precision as the barcode game:** pin down the intent, quick visual experiments, Ashwin picks, refine, then build. The live site still has the old basic home page.
- [ ] Bring the same level of design to every screen and game (laptop first, phone good too).

## Content and data
- [ ] **TMDB API key** (Ashwin) for better popularity data (vote counts) and stills.
- [ ] **Weekly catalog refresh** from Wikidata, with a lower bar for films from the last 2 years.
- [ ] Optional genre caps per month for film selection.

## Infrastructure and cost
- [ ] **Connect Vercel to the GitHub repo** for auto-deploys (Ashwin grants Vercel's GitHub access).
- [ ] **Purge old puzzle images nightly**, keeping yesterday (a Supabase scheduled job).
- [ ] **Serve level images from Cloudflare R2** behind signed links, so there are no egress costs.
- [ ] **Cache leaderboards** (recompute on finish or every minute) instead of recalculating on every view.
- [ ] Decide the global scoring rule across buckets (plain sum vs equal-weight buckets vs best-N).
