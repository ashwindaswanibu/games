import type { Outcome } from "@/core/game";
import { isSkip, LEVEL_COUNT, reelOf, stoppedEarly, type State } from "../logic";

/** How one reel went: named, a wrong guess, or skipped. */
export type ReelMark = "solved" | "missed" | "skipped";
/** A pick from the four: right or wrong. */
export type PickMark = "right" | "wrong";

export interface GridMarks {
  reels: ReelMark[];
  pick: PickMark | null;
}

const REEL_MARKS: Readonly<Record<string, ReelMark>> = { "🟩": "solved", "🟥": "missed", "⬛": "skipped" };

/**
 * A share grid read back: one square per reel used, then a circle if a pick was made (🟡 right,
 * ⚫ wrong). Older grids still read: 🟨 was a right pick, and an eleventh 🟥 a wrong one.
 */
export function parseGrid(grid: string): GridMarks {
  const reels: ReelMark[] = [];
  let pick: PickMark | null = null;
  for (const ch of grid) {
    if (ch === "🟡" || ch === "🟨") pick = "right";
    else if (ch === "⚫") pick = "wrong";
    else if (REEL_MARKS[ch]) {
      if (reels.length < LEVEL_COUNT) reels.push(REEL_MARKS[ch]);
      else if (ch === "🟥") pick = "wrong";
    }
  }
  return { reels, pick };
}

/** A grid in words, for screen readers. */
export function describeGrid({ reels, pick }: GridMarks): string {
  const n = reels.length;
  if (pick && n < LEVEL_COUNT) return pick === "right" ? `Stopped on reel ${n + 1} and picked it` : `Stopped on reel ${n + 1}, wrong pick`;
  if (pick) return pick === "right" ? "Picked after the last reel" : "Out of reels, wrong pick";
  return reels.at(-1) === "solved" ? `Named on reel ${n}` : `Not named in ${n} ${n === 1 ? "reel" : "reels"}`;
}

/** The end card's headline: how the film was named or picked, or how it got away. */
export function endKicker(state: State, status: Outcome): string {
  const reel = reelOf(state);
  const early = stoppedEarly(state);
  if (state.pick?.correct) return !early ? "Picked after the last reel" : reel === 1 ? "Picked by color alone" : `Picked on reel ${reel}`;
  if (state.pick) return early ? `Stopped on reel ${reel} · the film was` : "Out of reels · the film was";
  if (status === "won") return `Named on reel ${state.turns.length}`;
  // From before the last reel's skip was refused: giving up ended the play.
  const last = state.turns.at(-1);
  return last && isSkip(last) ? "You gave up · the film was" : "Out of reels · the film was";
}
