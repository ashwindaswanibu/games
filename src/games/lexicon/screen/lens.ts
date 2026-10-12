/**
 * The book falls open at the gap: where each page of today's dictionary sits across the fore-edge,
 * as a fraction of its width. With no guesses every page is as wide as the next. As the gap closes,
 * the pages still in play spread apart under the light and the ruled-out pages press together at
 * each side, so the endgame gets more of the frame. The lit window still narrows on every guess
 * (it follows the share of words left, raised to `gamma`), only more slowly than the words do, so
 * the picture stays honest. Pure.
 */

export interface LensOpts {
  /** How much the lit window is opened up: the share of words left is raised to this power. */
  gamma: number;
  /** The widest a page in play may be, as a share of the width. */
  maxLeaf: number;
  /** The narrowest a ruled-out side may be pressed (while there's room for both sides). */
  minSide: number;
}

/** A page in play is at most 7% of a laptop's book (about 91px). */
export const LAPTOP: LensOpts = { gamma: 0.45, maxLeaf: 0.07, minSide: 0.06 };
/** On a phone the book is narrow, so the pages in play are let open wider: up to 14%. */
export const PHONE: LensOpts = { gamma: 0.35, maxLeaf: 0.14, minSide: 0.08 };

export interface Lens {
  /** Where page boundary `i` is (0 is the book's head edge, `total` its tail): 0 to 1. */
  x(i: number): number;
  /** How wide page `i` is. */
  pitch(i: number): number;
  /** The middle of page `i`. */
  centre(i: number): number;
  /** Where the gap (the pages from `low + 1` to `high - 1`) starts, and how wide it is. */
  gapFrom: number;
  gapWidth: number;
}

/** The lens for a dictionary of `total` pages whose gap lies strictly between `low` and `high`. */
export function lens(total: number, low: number, high: number, o: LensOpts): Lens {
  const a = low + 1; // ruled-out pages before the gap
  const n = high - low - 1; // pages in the gap
  const b = total - high; // ruled-out pages after it
  const f = n / total;
  const whole = a + b === 0;
  const G = whole ? 1 : Math.max(f, Math.min(f ** o.gamma, n * o.maxLeaf));
  const R = 1 - G;
  let L = whole ? 0 : (R * a) / (a + b);
  if (a > 0 && b > 0 && R >= 2 * o.minSide) L = Math.min(Math.max(L, o.minSide), R - o.minSide);
  if (a === 0) L = 0;
  if (b === 0) L = R;
  const Rt = R - L;

  const x = (i: number) => {
    if (i <= 0) return 0;
    if (i >= total) return 1;
    if (i < a) return (i * L) / a;
    if (i < a + n) return L + ((i - a) * G) / n;
    return L + G + ((i - a - n) * Rt) / b;
  };
  const pitch = (i: number) => x(i + 1) - x(i);
  return { x, pitch, centre: (i) => x(i) + pitch(i) / 2, gapFrom: L, gapWidth: G };
}
