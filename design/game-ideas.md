# Game ideas

A running list of game ideas, grouped by bucket. Add to it freely.

## Movies / pop culture

### Frame by Frame
*Ashwin, 2026-10-06*

Show one frame from a movie and ask the player to guess the title. If they can't, show another frame, and keep going. Fewer frames needed means more points.

- Format: gradual reveal. Guess at any point; a wrong guess or a skip reveals the next frame.
- Ideas to explore:
  - Order frames from hardest (an obscure detail) to easiest (the iconic shot).
  - Optionally give clues on wrong guesses, such as release year higher or lower, or genre.
  - The share grid shows which frame you got it on, e.g. 🟥🟥🟩⬜⬜.
- Prior art to differentiate from: Framed (framed.wtf) uses the same core loop.
- Content source: TMDB stills/backdrops (credit required, fine for non-commercial use). Each puzzle needs hand-picked frame ordering.

### ~~Color Grade~~ (retired)
> **Retired 2026-10-06.** This palette / re-graded-photo concept was Claude's misreading of Ashwin's "movie LUT" idea. His idea is the **Color Barcode** game below (reference: https://game.movieluts.com/). Kept here only as history.

*Originally logged 2026-10-05*

Guess the movie from its color grading, revealed in stages:
1. A five-color palette
2. A neutral photo re-graded in the film's look
3. A blurred still
4. The clear still

- Fewer reveals means more points. Wrong guesses can give year and genre clues.
- Pipeline: TMDB stills, k-means palette extraction, Reinhard color transfer onto a neutral photo. Hand-pick films with distinctive grades, since many films share the same teal-and-orange look.
- Design note: the play area must be neutral gray, like a colorist's grading suite, so surrounding UI colors don't bias perception.

### Color Barcode (Ashwin's "movie LUT" game)
*Ashwin, 2026-10-05/06*

**Reference:** https://game.movieluts.com/ (Movie LUTs Card Game): guess the film from its color barcode, the average color of every frame. This is the game. Build what that site has.

**Ashwin's design (2026-10-06):**
- Emulate that game closely, but **no multiple-choice options**: players type or search their guess.
- **A wrong guess shows that film's own barcode** next to the target, so players can visually compare how close or far off they were.
- **The barcode gains detail with each guess** (2026-10-06). The exact mechanic is still to be confirmed: (A) resolution sharpens, going from a few wide blocks to more and finer stripes, or (B) it zooms in so stripes get wider.
- **A different barcode at each guess, up to the max guesses.** The max is configurable and grows as we add more barcode levels.
- **A nice "reel opening" animation after each guess.** The design of the expanding barcode is still open.
- **Sources (2026-10-06):** merge several sources, starting with **MovieNet** (1,100 complete films, pre-2019) and **movie-screencaps.com** (complete films in order, including current releases; free for non-commercial use). Generate the barcode, keep only the barcode, and delete the frames.
- **Film selection:** random, from films that are well heard-of and popular. Not always the most mainstream, but never too obscure. Detailed selection logic comes later.
- **First test:** *Dune: Part Two* (2024). Barcodes and a per-guess frame reveal live in `design/barcode-tests/dune-part-two-2024/`.
- **Reveal model (approved 2026-10-06, "okay like this"):** each guess shows more real frame detail. Combine both ideas: each guess zooms into a half of the film's timeline AND shows fewer, wider slices of real HQ frames, while the reel stays the same width. With infinite guesses the end point would be the whole film, frame by frame. In practice there are about 10 guesses.
- A thin full-film barcode stays pinned above the reel, with a bracket showing which stretch you're seeing.
- Reel-opening animation: the chosen half slides out and stretches to fill the reel, then the slices widen and "develop" from color into image.
- **Open:** which half to zoom into each guess (A: the player picks, B: we aim at an iconic moment, C: random daily, the same for everyone), and the exact number of guesses.
- **SUPERSEDED (2026-10-06):** no zoom. Ashwin picked **strategy G: edges first**. Each guess shows real HQ frame strips across the whole film, getting wider, with cuts drifting from the frame edges to the center so faces arrive late. G+ adds the squeezed-frame barcode as guess 1 and smart edge cuts that skip black or flat strips. Pace: **normal** (Ashwin, 2026-10-06): strips per guess 128, 88, 60, 42, 30, 21, 15, 10, 6. Renders are in the scratchpad.
- **Web app spec (Ashwin, 2026-10-06):**
  - Must look immaculate and make people go "wow".
  - After each guess, the more detailed render **replaces** the current one in place, with a transition that makes you go "wow".
  - You can go back to view earlier levels.
  - Shows the attempt number and attempts left. Nothing else is required.
  - Fill the space creatively, laptop first.
- **Wrong guesses (Ashwin, 2026-10-06):** NO comparison barcode for the guessed film. The game is simply the reel unreeling, or decompressing, a bit more after each wrong guess.
- **Keep it clean (Ashwin, 2026-10-06):** no clues of any kind (no year, genre or director chips). The screen shows only the barcode and the attempt number and attempts left. Remove the clue machinery from Color Barcode once the v2 engine lands.
- **Design principle (Ashwin, 2026-10-06):** "clean" means no game data clutter (release dates, clues, stats). It does NOT mean empty. The screen must be stylistically rich, well thought out and wow-inducing. Uninspired blank space is unacceptable. The game is about color palette, so the only game element is the barcode (plus attempts), and the visual design fills the space around it.
- **Idea, maybe:** at the very end, e.g. on the final attempt, offer multiple-choice options just for fun. Details to discuss.
- **Film selection (Ashwin, 2026-10-06):** random daily film that is popular enough. Claude does the first pass on how to measure "popular"; Ashwin reviews.

Guess the movie from its "barcode": every frame of the film reduced to its average color, lined up left to right as thin vertical stripes. The whole film's color arc reads at a glance, e.g. the warm-to-cold shift of a thriller or the green of The Matrix.

- Could be its own game, or the first and hardest stage of Color Grade (barcode, then palette, then graded photo, then still).
- Prior art and inspiration: moviebarcode.tumblr.com, The Colors of Motion.
- Content problem: a real barcode needs the full film video, which we won't have. Options:
  - Approximate the barcode from many stills (TMDB has dozens of images per film) plus trailer frames.
  - Hand-make barcodes for a curated set of films.
- The share grid could be a tiny strip of the barcode itself.

### Degrees of Separation
*Ashwin, 2026-10-06*

Get from one actor to another in the fewest steps, through movies they both appeared in. For example, Actor A was in Film 1 with Actor B, who was in Film 2 with Actor C. Like Six Degrees of Kevin Bacon.

- Format: a puzzle with a known best answer. Each day gives a start actor and an end actor. Players build a chain by picking a film, then a co-star, and so on. The score compares your chain length with the shortest possible.
- The server computes the shortest path with a breadth-first search over a cast graph built from TMDB credits. It also checks every link.
- Possible twists:
  - A move limit.
  - "Reveal a link" hints that cost points.
  - A bonus for using obscure films.
  - Showing friends' chains after the spoiler wall lifts, which makes for good banter.
- Prior art and inspiration: The Oracle of Bacon (oracleofbacon.org).
- Search needs to be fast: autocomplete over actors and films. Restrict to well-known films so chains stay fair.
