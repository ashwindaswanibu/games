import { barCount, barGradient, pressBars, type Rgb } from "../palette";

/**
 * The one rule for colour on type: wherever the film touches a title, it is the film pressed into
 * hard vertical bars of flat colour, in film order (see `pressBars`), never a gradient or a glow.
 * A title gets so many bars per letter, so a short word and a long title read at the same grain.
 * Callers always press from the first reel's columns: the barcode itself, never a later picture.
 */

/** How many letters `text` has (whitespace doesn't count). */
export function letterCount(text: string): number {
  return [...text].filter((ch) => ch.trim()).length;
}

/** `text`'s fill (a CSS gradient), `perLetter` bars to a letter; null with no columns to press. */
export function barsFill(columns: readonly Rgb[] | null | undefined, text: string, perLetter: number): string | null {
  if (!columns || columns.length === 0) return null;
  return barGradient(pressBars(columns, barCount(letterCount(text), perLetter)));
}
