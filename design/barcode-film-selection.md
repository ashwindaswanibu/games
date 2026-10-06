# Color Barcode: daily film selection

> **Approved by Ashwin 2026-10-06**, including the fixes: no repeat of the same franchise or director within 30 days, and skip black-and-white films. Still open: optional genre caps, TMDB vote-count blend once a key exists.

## 1. Which films are possible at all
A film needs **frames from the whole movie** to make a barcode. Today's source is **movie-screencaps.com**, which has 1,385 films from 1902–2026. MovieNet (1,100 films, pre-2019) gets added later.

Of those 1,385, **825 match our movie catalog**, which we need for the guess search and the answer details. Most of the misses are pre-1950 films, which the catalog doesn't cover.

## 2. How "popular" is measured
**The signal:** how many language editions of Wikipedia have an article on the film. This is a robust, worldwide measure of fame.
- *The Godfather*: 132
- *Jurassic Park*: ~100
- *Liar Liar*: 51
- *Kickboxer*: 33

**The problem:** recent films haven't built up articles yet. *Godzilla Minus One* has only 27, even though it was a big deal.

**The fix:** each film gets two percentiles:
- **Overall:** compared with all films.
- **Era:** compared with films released within 2 years of it.

**Score (0–100) = the higher of overall, or era × 0.9.** This lifts recent hits fairly: *Barbie* and *Avatar: The Way of Water* score 90, *The Batman* 85.

## 3. Tiers and the daily mix
| Tier | Score | Films today | Share of days |
|---|---|---|---|
| Iconic | ≥ 85 | 127 | ~25% |
| Well-known | 60–84 | 228 | ~55% |
| Known | 45–59 | 115 | ~20% (so it's not always the most mainstream) |
| Too obscure | < 45 | 326 | never |

**470 eligible films, about 1.3 years of daily puzzles without repeats,** before adding MovieNet.

## 4. How each day's film is picked
- **Deterministic by date:** everyone gets the same film. The tier is drawn by weight, then a film within that tier.
- **No film repeats within 365 days.**

## Sample: 14 days from the current logic
The Batman (2022) · Star Trek: First Contact (1996) · Sweeney Todd (2007) · Star Wars IV (1977) · Wonder Woman 1984 (2020) · X-Men: First Class (2011) · The Amazing Spider-Man 2 (2014) · Jurassic Park (1993) · Iron Man 2 (2010) · Godzilla: King of the Monsters (2019) · Scarface (1983) · Dune (1984) · Ready Player One (2018) · Night of the Living Dead (1968)

## Known gaps, fixes proposed
1. **Franchises cluster** (two Spider-Man films in a fortnight): no repeat of the same franchise or director within 30 days.
2. **Black-and-white films** make gray, dull barcodes: auto-skip films whose barcode has very low color saturation.
3. **Too superhero/blockbuster-heavy:** optionally cap any one genre's share per month.
4. **Better popularity data:** with a TMDB key we could blend in TMDB vote counts, which track how many people have actually *seen* a film. That's a better "would my friends know this?" signal than Wikipedia coverage alone.

## For Ashwin to decide
- Do the tier cutoffs and the 25 / 55 / 20 mix feel right? Too mainstream, or not mainstream enough?
- Should black-and-white films ever appear?
- Any hard exclusions (horror, kids' films, sequels...)?
