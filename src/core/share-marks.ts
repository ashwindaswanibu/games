import type { ShareMarkKind } from "./home-view";

/**
 * Share grids to marks. Every game writes its spoiler-free result as a short emoji grid
 * (`GameDefinition.shareGrid`); the home draws each symbol as a cut-paper mark instead of an emoji.
 * This maps symbols to meanings, independent of which game used which emoji.
 *
 * Symbols are split into graphemes (not code points), so an emoji with a variation selector
 * (⬆️, 🏳️, 🎞️) is one mark. Nothing is ever dropped: an unknown symbol becomes `other`.
 */

/** Rows of marks, one per non-blank line of the grid (every current game writes one line). */
export type ShareMarks = readonly (readonly ShareMarkKind[])[];

/**
 * Symbol → mark. Each emoji is listed both with and without the emoji variation selector (U+FE0F),
 * because games and copy-paste round trips produce either form.
 */
const KIND_BY_SYMBOL: ReadonlyMap<string, ShareMarkKind> = new Map<string, ShareMarkKind>([
  ["🟩", "hit"],
  ["✅", "hit"],
  ["✅️", "hit"],
  ["🟨", "near"],
  ["🟥", "miss"],
  ["⬛", "skip"],
  ["⬛️", "skip"],
  ["⬜", "unused"],
  ["⬜️", "unused"],
  ["⬆", "up"],
  ["⬆️", "up"],
  ["⬇", "down"],
  ["⬇️", "down"],
  ["🎞", "link"],
  ["🎞️", "link"],
  ["⭐", "win"],
  ["⭐️", "win"],
  ["🏳", "flag"],
  ["🏳️", "flag"],
]);

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The mark for one grapheme (a single symbol of a share grid). */
export function shareMarkKind(symbol: string): ShareMarkKind {
  return KIND_BY_SYMBOL.get(symbol) ?? "other";
}

/**
 * One row of marks per non-blank line of `grid`. Whitespace around and inside a line is not a
 * mark (grids are written without spaces; a stray space from a paste shouldn't become a square).
 * `shareMarks("")` is `[]`.
 */
export function shareMarks(grid: string): ShareMarks {
  return grid
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      Array.from(graphemes.segment(line), ({ segment }) => segment)
        .filter((segment) => segment.trim().length > 0)
        .map(shareMarkKind),
    );
}

/** Every mark of `grid` in reading order, as one row (what the home draws). */
export function shareMarkRow(grid: string): ShareMarkKind[] {
  return shareMarks(grid).flat();
}
