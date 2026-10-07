import { describe, expect, it } from "vitest";
import { referencedAssetIds } from "@/core/assets";
import { shareMarkRow } from "@/core/share-marks";
import type { FilmDetails } from "@/games/_movies/schemas";
import {
  colorGrade,
  currentTry,
  guessedFilmIds,
  MAX_TRIES,
  revealSchema,
  stateSchema,
  STAGES,
  type Puzzle,
  type ResolvedMove,
  type Solution,
  type State,
} from "./logic";

const asset = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, width: 1280, height: 720 });
const NEUTRAL = asset(1);
const GRADED = asset(2);
const BLURRED = asset(3);
const STILL = asset(4);

const puzzle: Puzzle = {
  fixture: false,
  palette: [
    { hex: "#101820", share: 0.4 },
    { hex: "#d07a2c", share: 0.25 },
    { hex: "#efe4cf", share: 0.15 },
    { hex: "#2b7a6c", share: 0.12 },
    { hex: "#8c1c24", share: 0.08 },
  ],
};

const HEAT: FilmDetails = { id: 1, title: "Heat", year: 1995, genres: ["Crime", "Drama"], directors: ["Michael Mann"] };
const COLLATERAL: FilmDetails = { id: 2, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] };
const AMELIE: FilmDetails = { id: 3, title: "Amélie", year: 2001, genres: ["Comedy", "Romance"], directors: ["Jean-Pierre Jeunet"] };
const ALIEN: FilmDetails = { id: 4, title: "Alien", year: 1979, genres: ["Horror"], directors: ["Ridley Scott"] };
const VERTIGO: FilmDetails = { id: 5, title: "Vertigo", year: 1958, genres: ["Thriller"], directors: ["Alfred Hitchcock"] };

const solution: Solution = { answer: HEAT, neutral: NEUTRAL, graded: GRADED, blurred: BLURRED, still: STILL };

const guess = (film: FilmDetails): ResolvedMove => ({ type: "guess", film });
const SKIP: ResolvedMove = { type: "skip" };

function play(moves: readonly ResolvedMove[]): State {
  let state = colorGrade.initialState(puzzle);
  for (const move of moves) {
    const result = colorGrade.applyMove({ puzzle, solution, state, move });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

const outcomeOf = (state: State) => colorGrade.outcome({ puzzle, solution, state });
const finish = (state: State) => {
  const outcome = outcomeOf(state);
  if (outcome === "in_progress") throw new Error("not finished");
  return {
    score: colorGrade.score({ puzzle, solution, state, outcome, elapsedMs: 60_000 }),
    grid: colorGrade.shareGrid({ puzzle, state, outcome }),
  };
};

describe("schemas", () => {
  it("accepts valid moves and rejects anything else", () => {
    expect(colorGrade.moveSchema.safeParse({ type: "guess", filmId: 12 }).success).toBe(true);
    expect(colorGrade.moveSchema.safeParse({ type: "skip" }).success).toBe(true);
    expect(colorGrade.moveSchema.safeParse({ type: "guess", filmId: -1 }).success).toBe(false);
    expect(colorGrade.moveSchema.safeParse({ type: "guess", filmId: "12" }).success).toBe(false);
    expect(colorGrade.moveSchema.safeParse({ type: "guess", title: "Heat" }).success).toBe(false);
    expect(colorGrade.moveSchema.safeParse({ type: "peek" }).success).toBe(false);
  });

  it("requires a five-colour palette of lowercase hex whose shares sum to 1", () => {
    expect(colorGrade.puzzleSchema.safeParse(puzzle).success).toBe(true);
    expect(colorGrade.puzzleSchema.safeParse({ ...puzzle, palette: puzzle.palette.slice(0, 4) }).success).toBe(false);
    expect(colorGrade.puzzleSchema.safeParse({ ...puzzle, palette: puzzle.palette.map((s) => ({ ...s, hex: s.hex.toUpperCase() })) }).success).toBe(false);
    expect(colorGrade.puzzleSchema.safeParse({ ...puzzle, palette: puzzle.palette.map((s) => ({ ...s, share: 0.1 })) }).success).toBe(false);
  });

  it("keeps the puzzle free of secret images", () => {
    expect(referencedAssetIds(puzzle).size).toBe(0);
    expect(colorGrade.solutionSchema.safeParse(solution).success).toBe(true);
  });
});

describe("stages and unlocking", () => {
  it("starts on the palette with no images", () => {
    const state = colorGrade.initialState(puzzle);
    expect(state.turns).toEqual([]);
    expect(referencedAssetIds(state).size).toBe(0);
    expect(currentTry(state)).toBe(1);
    expect(STAGES[0]).toBe("palette");
    expect(stateSchema.safeParse(state).success).toBe(true);
  });

  it("unlocks exactly the earned images, one stage per miss or skip", () => {
    const ids = (state: State) => [...referencedAssetIds(state)].sort();
    const one = play([guess(AMELIE)]);
    expect(ids(one)).toEqual([NEUTRAL.id, GRADED.id].sort());
    expect(one.unlocked).toEqual({ neutral: NEUTRAL, graded: GRADED, blurred: null, still: null });

    const two = play([guess(AMELIE), SKIP]);
    expect(ids(two)).toEqual([NEUTRAL.id, GRADED.id, BLURRED.id].sort());

    const three = play([guess(AMELIE), SKIP, guess(ALIEN)]);
    expect(ids(three)).toEqual([NEUTRAL.id, GRADED.id, BLURRED.id, STILL.id].sort());

    // Try 5 is a last guess with nothing new to unlock.
    const four = play([guess(AMELIE), SKIP, guess(ALIEN), SKIP]);
    expect(four.unlocked).toEqual(three.unlocked);
    expect(currentTry(four)).toBe(5);
    expect(stateSchema.safeParse(four).success).toBe(true);
  });

  it("unlocks nothing more on a win; the rest arrives with the reveal", () => {
    const state = play([guess(AMELIE), guess(HEAT)]);
    expect(state.unlocked).toEqual({ neutral: NEUTRAL, graded: GRADED, blurred: null, still: null });
    const reveal = colorGrade.reveal!({ puzzle, solution });
    expect(revealSchema.parse(reveal)).toEqual({ answer: HEAT, neutral: NEUTRAL, graded: GRADED, blurred: BLURRED, still: STILL });
  });

  it("leaks nothing about the answer into the state but clues", () => {
    const state = play([guess(COLLATERAL), SKIP, guess(AMELIE)]);
    const json = JSON.stringify(state);
    expect(json).not.toContain("Heat");
    expect(json).not.toContain('"id":1,');
    // Guesses are stored as refs, not with their own facts.
    expect(state.turns[0]).toEqual({
      film: { id: 2, title: "Collateral", year: 2004 },
      correct: false,
      clues: [
        { kind: "year", guessYear: 2004, direction: "earlier" },
        { kind: "genres", shared: ["Crime"], match: "some" },
        { kind: "director", shared: ["Michael Mann"], match: "same" },
      ],
    });
  });
});

describe("applyMove", () => {
  it("records a correct guess without clues and finishes the play", () => {
    const state = play([guess(HEAT)]);
    expect(state.turns).toEqual([{ film: { id: 1, title: "Heat", year: 1995 }, correct: true, clues: [] }]);
    expect(outcomeOf(state)).toBe("won");
    expect(currentTry(state)).toBeNull();
  });

  it("gives year, genre and director clues on a miss", () => {
    const [turn] = play([guess(AMELIE)]).turns;
    expect(turn).toEqual({
      film: { id: 3, title: "Amélie", year: 2001 },
      correct: false,
      clues: [
        { kind: "year", guessYear: 2001, direction: "earlier" },
        { kind: "genres", shared: [], match: "none" },
        { kind: "director", shared: [], match: "different" },
      ],
    });
  });

  it("rejects a film that was already guessed, without using a try", () => {
    const state = play([guess(AMELIE)]);
    const result = colorGrade.applyMove({ puzzle, solution, state, move: guess(AMELIE) });
    expect(result).toEqual({ ok: false, error: "You already guessed Amélie." });
    expect(guessedFilmIds(state)).toEqual([3]);
  });

  it("rejects moves once the play is over", () => {
    for (const state of [play([guess(HEAT)]), play([SKIP, SKIP, SKIP, SKIP, SKIP])]) {
      expect(colorGrade.applyMove({ puzzle, solution, state, move: SKIP })).toEqual({ ok: false, error: "This puzzle is already finished." });
      expect(colorGrade.applyMove({ puzzle, solution, state, move: guess(VERTIGO) }).ok).toBe(false);
    }
  });

  it("does not mutate the previous state", () => {
    const before = play([guess(AMELIE)]);
    const snapshot = JSON.stringify(before);
    colorGrade.applyMove({ puzzle, solution, state: before, move: SKIP });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("outcome, score and share grid", () => {
  it("scores a first-try solve 100", () => {
    expect(finish(play([guess(HEAT)]))).toEqual({ score: { score: 100, label: "1/5" }, grid: "🟩⬜⬜⬜⬜" });
  });

  it("scores later solves lower, down to 40 on the final try", () => {
    expect(finish(play([guess(AMELIE), SKIP, guess(HEAT)]))).toEqual({ score: { score: 70, label: "3/5" }, grid: "🟥⬛🟩⬜⬜" });
    expect(finish(play([SKIP, SKIP, SKIP, SKIP, guess(HEAT)])).score).toEqual({ score: 40, label: "5/5" });
  });

  it("loses after five tries without the answer", () => {
    const state = play([guess(AMELIE), guess(ALIEN), SKIP, guess(VERTIGO), guess(COLLATERAL)]);
    expect(state.turns).toHaveLength(MAX_TRIES);
    expect(outcomeOf(state)).toBe("lost");
    expect(finish(state)).toEqual({ score: { score: 0, label: "X/5" }, grid: "🟥🟥⬛🟥🟥" });
  });

  it("is in progress until then", () => {
    expect(outcomeOf(play([]))).toBe("in_progress");
    expect(outcomeOf(play([SKIP, SKIP, SKIP, SKIP]))).toBe("in_progress");
  });

  it("round-trips its state through JSON", () => {
    const state = play([guess(COLLATERAL), SKIP]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("color grade on the home", () => {
  it("draws one 4:3 frame per try: a lost play uses all of them", () => {
    expect(colorGrade.home!.form).toEqual({ kind: "frames", count: MAX_TRIES, aspect: "4:3", finalPick: false });
    const { grid } = finish(play(Array.from({ length: MAX_TRIES }, () => SKIP)));
    expect(shareMarkRow(grid)).toHaveLength(MAX_TRIES);
  });

  it("has no result line of its own (the label says it)", () => {
    const { grid, score } = finish(play([SKIP, guess(HEAT)]));
    expect(colorGrade.home!.line({ outcome: "won", label: score.label, marks: shareMarkRow(grid), par: null })).toBeNull();
  });
});
