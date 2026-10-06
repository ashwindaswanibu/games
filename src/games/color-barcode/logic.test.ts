import { describe, expect, it } from "vitest";
import { referencedAssetIds } from "@/core/assets";
import { attemptsScore } from "@/core/scoring";
import type { FilmDetails } from "@/games/_movies/schemas";
import {
  colorBarcode,
  colorBarcodeStateSchema,
  guessedFilmIds,
  LEVEL_COUNT,
  levelsInView,
  MAX_GUESSES,
  type LevelRef,
  type Puzzle,
  type ResolvedMove,
  type Solution,
  type State,
} from "./logic";

const level = (n: number): LevelRef => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  width: 2400,
  height: 800,
  average: "#3a2f28",
  dominant: "#8a6a4f",
});
const LEVELS = Array.from({ length: LEVEL_COUNT }, (_, i) => level(i + 1));

const answer: FilmDetails = { id: 10, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] };
const heat: FilmDetails = { id: 11, title: "Heat", year: 1995, genres: ["Crime", "Drama"], directors: ["Michael Mann"] };
const up: FilmDetails = { id: 12, title: "Up", year: 2009, genres: ["Animation"], directors: ["Pete Docter", "Bob Peterson"] };

const puzzle: Puzzle = { fixture: false, maxGuesses: MAX_GUESSES, first: LEVELS[0]!, look: { saturation: 0.31, monochrome: false } };
const solution: Solution = { answer, levels: LEVELS, pace: "normal", credit: { source: "movie-screencaps.com", url: "https://movie-screencaps.com/collateral-2004/" } };
const initial = colorBarcode.initialState(puzzle);

const guess = (film: FilmDetails): ResolvedMove => ({ type: "guess", film });
const skip: ResolvedMove = { type: "skip" };
const decoy = (n: number): FilmDetails => ({ ...up, id: 100 + n, title: `Decoy ${n}` });

function play(moves: ResolvedMove[], from: State = initial): State {
  return moves.reduce((state, move) => {
    const result = colorBarcode.applyMove({ puzzle, solution, state, move });
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }, from);
}

const outcome = (state: State) => colorBarcode.outcome({ puzzle, solution, state });
const finish = (state: State) => {
  const o = outcome(state);
  if (o === "in_progress") throw new Error("not finished");
  return {
    ...colorBarcode.score({ puzzle, solution, state, outcome: o, elapsedMs: 0 }),
    grid: colorBarcode.shareGrid({ puzzle, state, outcome: o }),
  };
};

describe("color-barcode schemas", () => {
  it("accept a well-formed puzzle and solution", () => {
    expect(colorBarcode.puzzleSchema.parse(puzzle)).toEqual(puzzle);
    expect(colorBarcode.solutionSchema.parse(solution)).toEqual(solution);
    expect(colorBarcode.solutionSchema.parse({ ...solution, credit: null }).credit).toBeNull();
  });

  it("require exactly ten distinct levels", () => {
    expect(colorBarcode.solutionSchema.safeParse({ ...solution, levels: LEVELS.slice(1) }).success).toBe(false);
    expect(colorBarcode.solutionSchema.safeParse({ ...solution, levels: [...LEVELS, level(11)] }).success).toBe(false);
    expect(colorBarcode.solutionSchema.safeParse({ ...solution, levels: [LEVELS[1], ...LEVELS.slice(1)] }).success).toBe(false);
  });

  it("keep the puzzle to level 1 and the film's look (no extra fields)", () => {
    expect(colorBarcode.puzzleSchema.safeParse({ ...puzzle, answer }).success).toBe(false);
    expect(colorBarcode.puzzleSchema.safeParse({ ...puzzle, levels: LEVELS }).success).toBe(false);
  });

  it("insist on ten guesses and lowercase hex colours", () => {
    expect(colorBarcode.puzzleSchema.safeParse({ ...puzzle, maxGuesses: 6 }).success).toBe(false);
    expect(colorBarcode.puzzleSchema.safeParse({ ...puzzle, first: { ...LEVELS[0], average: "#ABCDEF" } }).success).toBe(false);
    expect(colorBarcode.puzzleSchema.safeParse({ ...puzzle, first: { ...LEVELS[0], dominant: "red" } }).success).toBe(false);
  });

  it("accept only guess-by-id and skip moves from the browser", () => {
    expect(colorBarcode.moveSchema.safeParse({ type: "guess", filmId: 10 }).success).toBe(true);
    expect(colorBarcode.moveSchema.safeParse({ type: "skip" }).success).toBe(true);
    expect(colorBarcode.moveSchema.safeParse({ type: "give-up" }).success).toBe(false);
    expect(colorBarcode.moveSchema.safeParse({ type: "guess", filmId: 10, title: "Collateral" }).success).toBe(false);
    expect(colorBarcode.moveSchema.safeParse({ type: "guess", filmId: -1 }).success).toBe(false);
  });
});

describe("color-barcode applyMove", () => {
  it("starts on level 1 with nothing unlocked", () => {
    expect(initial).toEqual({ turns: [], unlocked: [] });
    expect(levelsInView(puzzle, initial)).toEqual([LEVELS[0]]);
    expect(outcome(initial)).toBe("in_progress");
  });

  it("records a wrong guess with year, genre and director clues and unlocks level 2", () => {
    const state = play([guess(heat)]);
    expect(state.turns).toEqual([
      {
        film: { id: 11, title: "Heat", year: 1995 },
        correct: false,
        clues: [
          { kind: "year", guessYear: 1995, direction: "later" },
          { kind: "genres", shared: ["Crime"], match: "some" },
          { kind: "director", shared: ["Michael Mann"], match: "same" },
        ],
      },
    ]);
    expect(state.unlocked).toEqual([LEVELS[1]]);
    expect(colorBarcodeStateSchema.parse(state)).toEqual(state);
  });

  it("stores only the guessed film's ref in the state, never its or the answer's facts", () => {
    const json = JSON.stringify(play([guess(heat)]));
    expect(json).not.toContain("Collateral");
    expect(json).not.toContain("Drama");
  });

  it("unlocks a level on a skip, with no clues", () => {
    expect(play([skip])).toEqual({ turns: [{ skipped: true }], unlocked: [LEVELS[1]] });
  });

  it("holds exactly the levels earned after each miss", () => {
    let state = initial;
    for (let misses = 1; misses <= MAX_GUESSES; misses++) {
      state = play([misses % 2 ? skip : guess(decoy(misses))], state);
      const earned = Math.min(misses, LEVEL_COUNT - 1);
      expect(state.unlocked).toEqual(LEVELS.slice(1, 1 + earned));
      // The browser-visible parts (puzzle + state) reference exactly levels 1…earned+1.
      const visible = new Set([...referencedAssetIds(puzzle), ...referencedAssetIds(state)]);
      expect([...visible].sort()).toEqual(LEVELS.slice(0, 1 + earned).map((l) => l.id));
    }
    expect(outcome(state)).toBe("lost");
  });

  it("unlocks nothing more on a correct guess", () => {
    const state = play([skip, guess(answer)]);
    expect(state.unlocked).toEqual([LEVELS[1]]);
    expect(state.turns.at(-1)).toEqual({ film: { id: 10, title: "Collateral", year: 2004 }, correct: true, clues: [] });
  });

  it("rejects a film already guessed, without using a turn", () => {
    const state = play([guess(heat)]);
    expect(colorBarcode.applyMove({ puzzle, solution, state, move: guess(heat) })).toEqual({ ok: false, error: "You already guessed Heat." });
  });

  it("rejects moves once won or lost", () => {
    const finished = "Today's barcode is already finished.";
    expect(colorBarcode.applyMove({ puzzle, solution, state: play([guess(answer)]), move: skip })).toEqual({ ok: false, error: finished });
    const lost = play(Array.from({ length: MAX_GUESSES }, () => skip));
    expect(outcome(lost)).toBe("lost");
    expect(colorBarcode.applyMove({ puzzle, solution, state: lost, move: guess(answer) })).toEqual({ ok: false, error: finished });
  });

  it("lists guessed film ids, ignoring skips", () => {
    expect(guessedFilmIds(play([guess(heat), skip, guess(up)]))).toEqual([11, 12]);
  });
});

describe("color-barcode outcome, score and share grid", () => {
  it("wins on level 1 for 100", () => {
    expect(finish(play([guess(answer)]))).toEqual({ score: 100, label: "1/10", grid: "🟩" });
  });

  it("scores by the attempt the film was named on, one mark per attempt", () => {
    expect(finish(play([skip, guess(heat), guess(answer)]))).toEqual({ score: attemptsScore(3, 10, true), label: "3/10", grid: "⬛🟥🟩" });
  });

  it("wins on level 10 for the floor score", () => {
    const state = play([...Array.from({ length: 9 }, () => skip), guess(answer)]);
    expect(finish(state)).toEqual({ score: 40, label: "10/10", grid: `${"⬛".repeat(9)}🟩` });
  });

  it("loses after ten wrong guesses or skips for 0", () => {
    const moves = Array.from({ length: MAX_GUESSES }, (_, i) => (i % 3 === 0 ? guess(decoy(i)) : skip));
    expect(finish(play(moves))).toEqual({ score: 0, label: "X/10", grid: "🟥⬛⬛🟥⬛⬛🟥⬛⬛🟥" });
  });

  it("keeps the share grid free of spoilers", () => {
    expect(finish(play([guess(heat), guess(answer)])).grid).not.toMatch(/Heat|Collateral|\d{4}/);
  });
});

describe("color-barcode reveal", () => {
  it("hands over the film, all ten levels and the frame credit", () => {
    expect(colorBarcode.reveal!({ puzzle, solution })).toEqual({ film: answer, levels: LEVELS, credit: solution.credit });
  });

  it("round-trips puzzle and state through JSON", () => {
    const state = play([guess(heat), skip]);
    expect(JSON.parse(JSON.stringify(puzzle))).toEqual(puzzle);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
