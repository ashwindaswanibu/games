import { describe, expect, it } from "vitest";
import { referencedAssetIds } from "@/core/assets";
import { shareMarkRow } from "@/core/share-marks";
import type { FilmDetails } from "@/games/_movies/schemas";
import {
  FRAME_COUNT,
  frameByFrame,
  framesInView,
  guessedFilmIds,
  stateSchema,
  type Puzzle,
  type ResolvedMove,
  type Solution,
  type State,
} from "./logic";

const ref = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, width: 1280, height: 720 });
const FRAMES = [1, 2, 3, 4, 5, 6].map(ref);

const answer: FilmDetails = { id: 10, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] };
const heat: FilmDetails = { id: 11, title: "Heat", year: 1995, genres: ["Crime", "Drama"], directors: ["Michael Mann"] };
const up: FilmDetails = { id: 12, title: "Up", year: 2009, genres: ["Animation"], directors: ["Pete Docter", "Bob Peterson"] };

const puzzle: Puzzle = { fixture: false, first: FRAMES[0] };
const solution: Solution = { answer, later: FRAMES.slice(1) };
const initial = frameByFrame.initialState(puzzle);

const guess = (film: FilmDetails): ResolvedMove => ({ type: "guess", film });
const skip: ResolvedMove = { type: "skip" };

function play(moves: ResolvedMove[], from: State = initial): State {
  return moves.reduce((state, move) => {
    const result = frameByFrame.applyMove({ puzzle, solution, state, move });
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }, from);
}

const outcome = (state: State) => frameByFrame.outcome({ puzzle, solution, state });
const finish = (state: State) => {
  const o = outcome(state);
  if (o === "in_progress") throw new Error("not finished");
  return {
    ...frameByFrame.score({ puzzle, solution, state, outcome: o, elapsedMs: 0 }),
    grid: frameByFrame.shareGrid({ puzzle, state, outcome: o }),
  };
};

describe("frame-by-frame schemas", () => {
  it("accept a well-formed puzzle and solution", () => {
    expect(frameByFrame.puzzleSchema.parse(puzzle)).toEqual(puzzle);
    expect(frameByFrame.solutionSchema.parse(solution)).toEqual(solution);
  });

  it("require exactly five distinct later frames", () => {
    expect(frameByFrame.solutionSchema.safeParse({ answer, later: FRAMES.slice(1, 5) }).success).toBe(false);
    expect(frameByFrame.solutionSchema.safeParse({ answer, later: FRAMES }).success).toBe(false);
    expect(frameByFrame.solutionSchema.safeParse({ answer, later: [FRAMES[1], FRAMES[1], FRAMES[2], FRAMES[3], FRAMES[4]] }).success).toBe(false);
  });

  it("keep the puzzle to the first frame (no extra fields)", () => {
    expect(frameByFrame.puzzleSchema.safeParse({ ...puzzle, answer }).success).toBe(false);
  });

  it("accept only guess-by-id and skip moves from the browser", () => {
    expect(frameByFrame.moveSchema.safeParse({ type: "guess", filmId: 10 }).success).toBe(true);
    expect(frameByFrame.moveSchema.safeParse({ type: "skip" }).success).toBe(true);
    expect(frameByFrame.moveSchema.safeParse({ type: "guess", filmId: 10, title: "Collateral" }).success).toBe(false);
    expect(frameByFrame.moveSchema.safeParse({ type: "guess", filmId: -1 }).success).toBe(false);
  });
});

describe("frame-by-frame applyMove", () => {
  it("starts on frame 1 with nothing unlocked", () => {
    expect(initial).toEqual({ turns: [], unlocked: [] });
    expect(framesInView(puzzle, initial)).toEqual([FRAMES[0]]);
    expect(outcome(initial)).toBe("in_progress");
  });

  it("records a wrong guess with clues and unlocks the next frame", () => {
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
    expect(state.unlocked).toEqual([FRAMES[1]]);
    expect(stateSchema.parse(state)).toEqual(state);
  });

  it("gives negative clues when nothing matches", () => {
    const [turn] = play([guess(up)]).turns;
    expect(turn).toMatchObject({
      clues: [
        { kind: "year", direction: "earlier" },
        { kind: "genres", shared: [], match: "none" },
        { kind: "director", shared: [], match: "different" },
      ],
    });
  });

  it("stores only the guessed film's ref in the state, never its or the answer's facts", () => {
    const state = play([guess(heat)]);
    const json = JSON.stringify(state);
    expect(json).not.toContain("Collateral");
    expect(json).not.toContain("Drama");
  });

  it("unlocks a frame on a skip, with no clues", () => {
    const state = play([skip]);
    expect(state).toEqual({ turns: [{ skipped: true }], unlocked: [FRAMES[1]] });
  });

  it("holds exactly the frames earned after each miss", () => {
    let state = initial;
    for (let misses = 1; misses <= FRAME_COUNT; misses++) {
      state = play([misses % 2 ? skip : guess({ ...up, id: 100 + misses })], state);
      const earned = Math.min(misses, FRAME_COUNT - 1);
      expect(state.unlocked).toEqual(FRAMES.slice(1, 1 + earned));
      // The browser-visible parts (puzzle + state) reference exactly frames 1…earned+1.
      const visible = new Set([...referencedAssetIds(puzzle), ...referencedAssetIds(state)]);
      expect([...visible].sort()).toEqual(FRAMES.slice(0, 1 + earned).map((f) => f.id));
    }
  });

  it("unlocks nothing more on a correct guess", () => {
    const state = play([skip, guess(answer)]);
    expect(state.unlocked).toEqual([FRAMES[1]]);
    expect(state.turns.at(-1)).toEqual({ film: { id: 10, title: "Collateral", year: 2004 }, correct: true, clues: [] });
  });

  it("rejects a film already guessed, without using a turn", () => {
    const state = play([guess(heat)]);
    expect(frameByFrame.applyMove({ puzzle, solution, state, move: guess(heat) })).toEqual({ ok: false, error: "You already guessed Heat." });
  });

  it("allows several skips in a row", () => {
    expect(play([skip, skip, skip]).unlocked).toEqual(FRAMES.slice(1, 4));
  });

  it("rejects moves once won", () => {
    const state = play([guess(answer)]);
    expect(frameByFrame.applyMove({ puzzle, solution, state, move: skip })).toEqual({ ok: false, error: "This puzzle is already finished." });
  });

  it("rejects moves once lost", () => {
    const state = play([skip, skip, skip, skip, skip, skip]);
    expect(outcome(state)).toBe("lost");
    expect(frameByFrame.applyMove({ puzzle, solution, state, move: guess(answer) })).toEqual({
      ok: false,
      error: "This puzzle is already finished.",
    });
  });

  it("lists guessed film ids, ignoring skips", () => {
    expect(guessedFilmIds(play([guess(heat), skip, guess(up)]))).toEqual([11, 12]);
  });
});

describe("frame-by-frame outcome, score and share grid", () => {
  it("wins on the first frame for 100", () => {
    const state = play([guess(answer)]);
    expect(outcome(state)).toBe("won");
    expect(finish(state)).toEqual({ score: 100, label: "1/6", grid: "🟩⬜⬜⬜⬜⬜" });
  });

  it("scores by the frame the film was named on", () => {
    expect(finish(play([skip, guess(heat), guess(answer)]))).toEqual({ score: 76, label: "3/6", grid: "⬛🟥🟩⬜⬜⬜" });
  });

  it("wins on the last frame for the floor score", () => {
    expect(finish(play([skip, skip, skip, skip, skip, guess(answer)]))).toEqual({ score: 40, label: "6/6", grid: "⬛⬛⬛⬛⬛🟩" });
  });

  it("loses after six misses for 0", () => {
    const state = play([guess(heat), skip, guess(up), skip, skip, skip]);
    expect(outcome(state)).toBe("lost");
    expect(finish(state)).toEqual({ score: 0, label: "X/6", grid: "🟥⬛🟥⬛⬛⬛" });
  });

  it("keeps the share grid free of spoilers", () => {
    const { grid } = finish(play([guess(heat), guess(answer)]));
    expect(grid).not.toMatch(/Heat|Collateral|\d{4}/);
  });
});

describe("frame-by-frame reveal", () => {
  it("hands over the film and all six frames, hardest first", () => {
    expect(frameByFrame.reveal!({ puzzle, solution })).toEqual({ film: answer, frames: FRAMES });
  });

  it("round-trips puzzle and state through JSON", () => {
    const state = play([guess(heat), skip]);
    expect(JSON.parse(JSON.stringify(puzzle))).toEqual(puzzle);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("frame-by-frame on the home", () => {
  const home = frameByFrame.home!;
  const finished = (moves: ResolvedMove[]) => {
    const state = play(moves);
    const o = outcome(state);
    if (o === "in_progress") throw new Error("not finished");
    const { label, grid } = finish(state);
    const marks = shareMarkRow(grid);
    return { marks, line: home.line({ outcome: o, label, marks, par: null }) };
  };

  it("draws one 4:3 frame per frame of the film: a lost play uses all of them", () => {
    expect(home.form).toEqual({ kind: "frames", count: FRAME_COUNT, aspect: "4:3", finalPick: false });
    expect(finished(Array.from({ length: FRAME_COUNT }, () => skip)).marks).toHaveLength(FRAME_COUNT);
  });

  it("says on which frame it was named (unused frames don't count), or that it wasn't", () => {
    expect(finished([guess(answer)]).line).toBe("Named on frame 1");
    expect(finished([guess(heat), guess(answer)]).line).toBe("Named on frame 2");
    expect(finished([guess(heat), skip, skip, guess(up), skip, skip]).line).toBe(`Not named in ${FRAME_COUNT} frames`);
  });
});
