import { describe, expect, it } from "vitest";
import { shareMarkRow } from "@/core/share-marks";
import { MAX_GUESSES, numberHunt, remainingRange, type State } from "./logic";

const puzzle = { min: 1, max: 100, maxGuesses: MAX_GUESSES };
const solution = { secret: 42 };

function play(guesses: number[]): State {
  let state = numberHunt.initialState(puzzle);
  for (const guess of guesses) {
    const result = numberHunt.applyMove({ puzzle, solution, state, move: { guess } });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

describe("number hunt", () => {
  it("gives higher/lower hints and wins on the secret", () => {
    const state = play([50, 25, 42]);
    expect(state.guesses.map((g) => g.hint)).toEqual(["lower", "higher", "correct"]);
    expect(numberHunt.outcome({ puzzle, solution, state })).toBe("won");
    expect(numberHunt.score({ puzzle, solution, state, outcome: "won", elapsedMs: 0 })).toEqual({ score: 80, label: "3/7" });
    expect(numberHunt.shareGrid({ puzzle, state, outcome: "won" })).toBe("⬇️⬆️✅");
  });

  it("loses after the last guess", () => {
    const state = play([1, 2, 3, 4, 5, 6, 7]);
    expect(numberHunt.outcome({ puzzle, solution, state })).toBe("lost");
    expect(numberHunt.score({ puzzle, solution, state, outcome: "lost", elapsedMs: 0 })).toEqual({ score: 0, label: "X/7" });
  });

  it("rejects out-of-range and repeated guesses without consuming a turn", () => {
    const state = play([50]);
    expect(numberHunt.applyMove({ puzzle, solution, state, move: { guess: 0 } }).ok).toBe(false);
    expect(numberHunt.applyMove({ puzzle, solution, state, move: { guess: 101 } }).ok).toBe(false);
    expect(numberHunt.applyMove({ puzzle, solution, state, move: { guess: 50 } }).ok).toBe(false);
  });

  it("rejects malformed moves at the schema boundary", () => {
    expect(numberHunt.moveSchema.safeParse({ guess: 4.5 }).success).toBe(false);
    expect(numberHunt.moveSchema.safeParse({ guess: "42" }).success).toBe(false);
    expect(numberHunt.moveSchema.safeParse({}).success).toBe(false);
  });

  it("narrows the remaining range", () => {
    expect(remainingRange(puzzle, play([50, 25]))).toEqual({ low: 26, high: 49 });
  });
});

describe("number hunt on the home", () => {
  const finished = (guesses: number[]) => {
    const state = play(guesses);
    const outcome = numberHunt.outcome({ puzzle, solution, state });
    if (outcome === "in_progress") throw new Error("not finished");
    const { label } = numberHunt.score({ puzzle, solution, state, outcome, elapsedMs: 0 });
    const grid = numberHunt.shareGrid({ puzzle, state, outcome });
    const marks = shareMarkRow(grid);
    return { marks, line: numberHunt.home!.line({ outcome, label, grid, marks, par: null }) };
  };

  it("draws one slot per guess: a lost play fills all seven", () => {
    expect(numberHunt.home!.form).toEqual({ kind: "slots", count: MAX_GUESSES });
    expect(finished([1, 2, 3, 4, 5, 6, 7]).marks).toHaveLength(MAX_GUESSES);
  });

  it("says on which guess it was found, or that it wasn't", () => {
    expect(finished([50, 25, 42]).line).toBe("Found on guess 3");
    expect(finished([42]).line).toBe("Found on guess 1");
    expect(finished([1, 2, 3, 4, 5, 6, 7]).line).toBe("Not found in 7 guesses");
  });
});
