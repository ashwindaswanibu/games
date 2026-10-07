/**
 * The screen's motion, as numbers: the eases every animation shares and the key times of the
 * reel's unreel and of the win. Pure (no React, no DOM), so the beats can be tested.
 */

export const DOWN = "cubic-bezier(.45,0,.55,1)"; // the wordmark's "Fade to"
export const RISE = "cubic-bezier(.3,0,.2,1)"; // the wordmark's "Color"
export const SETTLE = "cubic-bezier(.2,.8,.2,1)"; // --ease

/** A reel unreels over this long, on this ease. */
export const UNREEL_MS = 1250;
export const UNREEL_EASE = "cubic-bezier(.62,.01,.28,1)";
/** How far into an unreel the room's light changes to the new frame's. */
export const LIGHT_AT = 0.4;

/** The time between letters for a wave of `n` letters: `step`, but the whole spread never longer than `cap`. */
export function letterStep(n: number, step: number, cap: number): number {
  return n > 1 ? Math.min(step, cap / (n - 1)) : 0;
}

/** In the win's print run, one print develops (and the playhead lands on it) this often. */
export const PRINT_RUN_STEP_MS = 85;

/** In the win, each letter takes its colour over this long, starting this far apart, the whole wave at most this long. */
export const LETTER_MS = 900;
const LETTER_STEP_MS = 45;
const LETTER_SPREAD_MS = 600;
/** From the last letter in to the film rolling on. */
export const HOLD_MS = 500;

/** The win's opening, ms from the server's answer, for a title of `letters` letters (see `win-timeline.ts`). */
export function openingBeats(letters: number) {
  const step = letterStep(letters, LETTER_STEP_MS, LETTER_SPREAD_MS);
  const color = 2400;
  // The name is complete when its last letter has its colour.
  const lit = color + step * Math.max(0, letters - 1) + LETTER_MS;
  return { house: 600, dip: 700, black: 2100, color, step, lit, hold: lit + HOLD_MS };
}

/**
 * How the win's card leaves, ms from the moment it starts to: when the room relights, when the end
 * card rises (and from when it takes clicks), when the card is done, and when all is at rest.
 */
export function exitBeats(kind: "roll" | "lift", reduced: boolean) {
  if (reduced) return { light: 500, creditsFrom: 500, creditsTo: 800, interactive: 800, cardGone: 500, done: 900 };
  const light = kind === "roll" ? UNREEL_MS * LIGHT_AT : 400;
  const creditsFrom = kind === "roll" ? light + 100 : light;
  return {
    light,
    creditsFrom,
    creditsTo: creditsFrom + (kind === "roll" ? 1300 : 1200),
    interactive: creditsFrom,
    cardGone: kind === "roll" ? UNREEL_MS : 1200,
    done: light + 1400,
  };
}
