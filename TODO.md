# To-do

A running list of things we've agreed to do later. Newest decisions live in `design/game-ideas.md` and `design/barcode-film-selection.md`.

## Fade to Color
- [x] **Build the game screen into the app** (full screen, from the approved first look), renamed **Fade to Color**, at `/play/fade-to-color`.
- [x] **Per-film color scheme:** every color on the screen is taken from the film's levels and relit, so dark films glow instead of going muddy.
- [x] **Remove the clue machinery.** The screen shows only the barcode and the reels.
- [x] **Final pick:** after a wrong guess on reel 10, one pick from 4 films (the answer + 3 look-alikes by genre, era and fame) for 5 points.
- [x] **Wordmark:** "Dip to Black" (Ashwin's pick of 12 treatments): "Fade to" fades down letter by letter as the film rolls, then "Color" rises filled with the film.
- [ ] **Series data for the final pick:** import Wikidata "part of the series" (P179) into the catalog, so sequels that share no words with their series (e.g. *The Empire Strikes Back*) can't be decoys for one another.
- [ ] **Open it to everyone:** it's still `testing` (admins only) until Ashwin says so.
- [ ] **Retire the "Color Grade" game** (a misreading of the movie-LUT idea).
- [ ] **Daily film picker:** implement the approved selection logic (tiers 25/55/20, no repeats within a year, no franchise or director repeats within 30 days, skip black-and-white films).
- [ ] **Add MovieNet as a second frame source** (about 1,100 complete films, pre-2019). Needs a free OpenDataLab account (Ashwin). First download only the 10 KB Movie List and measure how many *new* popular films it adds before committing to the ~250 GB download (process in the cloud).

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
