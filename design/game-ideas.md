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

### Color Grade (the "movie LUT" game)
*Ashwin, 2026-10-05*

Guess the movie from its color grading, revealed in stages:
1. A five-color palette
2. A neutral photo re-graded in the film's look
3. A blurred still
4. The clear still

- Fewer reveals means more points. Wrong guesses can give year and genre clues.
- Pipeline: TMDB stills, k-means palette extraction, Reinhard color transfer onto a neutral photo. Hand-pick films with distinctive grades, since many films share the same teal-and-orange look.
- Design note: the play area must be neutral gray, like a colorist's grading suite, so surrounding UI colors don't bias perception.

### Color Barcode
*Ashwin, 2026-10-06*

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
