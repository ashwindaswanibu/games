import { describe, expect, it } from "vitest";
import { referencedAssetIds } from "@/core/assets";
import { attemptsScore } from "@/core/scoring";
import { shareMarkRow } from "@/core/share-marks";
import type { FilmDetails, FilmRef } from "@/games/_movies/schemas";
import {
  fadeToColor,
  fadeToColorStateSchema,
  guessedFilmIds,
  LEVEL_COUNT,
  LAST_REEL_SCORE,
  levelsInView,
  MAX_GUESSES,
  awaitingPick,
  resultLine,
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
const drive: FilmDetails = { id: 13, title: "Drive", year: 2011, genres: ["Crime", "Thriller"], directors: ["Nicolas Winding Refn"] };
const thief: FilmDetails = { id: 14, title: "Thief", year: 1981, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] };
const nightcrawler: FilmDetails = { id: 15, title: "Nightcrawler", year: 2014, genres: ["Crime", "Thriller"], directors: ["Dan Gilroy"] };

const ref = ({ id, title, year }: FilmDetails): FilmRef => ({ id, title, year });
const OPTIONS = [drive, answer, nightcrawler, thief].map(ref);

const puzzle: Puzzle = { fixture: false, maxGuesses: MAX_GUESSES, first: LEVELS[0]!, look: { saturation: 0.31, monochrome: false } };
const solution: Solution = {
  answer,
  levels: LEVELS,
  pace: "normal",
  credit: { source: "movie-screencaps.com", url: "https://movie-screencaps.com/collateral-2004/" },
  options: OPTIONS,
};
const initial = fadeToColor.initialState(puzzle);

const guess = (film: FilmDetails): ResolvedMove => ({ type: "guess", film: ref(film) });
const skip: ResolvedMove = { type: "skip" };
const pick = (film: FilmDetails): ResolvedMove => ({ type: "pick", filmId: film.id });
/** Nine skips and a wrong guess on reel 10: the final pick is open. */
const NINE_SKIPS_AND_A_MISS: ResolvedMove[] = [...Array.from({ length: MAX_GUESSES - 1 }, () => skip), guess(heat)];
const decoy = (n: number): FilmDetails => ({ ...up, id: 100 + n, title: `Decoy ${n}` });

function play(moves: ResolvedMove[], from: State = initial): State {
  return moves.reduce((state, move) => {
    const result = fadeToColor.applyMove({ puzzle, solution, state, move });
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }, from);
}

const outcome = (state: State) => fadeToColor.outcome({ puzzle, solution, state });
const finish = (state: State) => {
  const o = outcome(state);
  if (o === "in_progress") throw new Error("not finished");
  return {
    ...fadeToColor.score({ puzzle, solution, state, outcome: o, elapsedMs: 0 }),
    grid: fadeToColor.shareGrid({ puzzle, state, outcome: o }),
  };
};

describe("fade-to-color schemas", () => {
  it("accept a well-formed puzzle and solution", () => {
    expect(fadeToColor.puzzleSchema.parse(puzzle)).toEqual(puzzle);
    expect(fadeToColor.solutionSchema.parse(solution)).toEqual(solution);
    expect(fadeToColor.solutionSchema.parse({ ...solution, credit: null }).credit).toBeNull();
  });

  it("require exactly ten distinct levels", () => {
    expect(fadeToColor.solutionSchema.safeParse({ ...solution, levels: LEVELS.slice(1) }).success).toBe(false);
    expect(fadeToColor.solutionSchema.safeParse({ ...solution, levels: [...LEVELS, level(11)] }).success).toBe(false);
    expect(fadeToColor.solutionSchema.safeParse({ ...solution, levels: [LEVELS[1], ...LEVELS.slice(1)] }).success).toBe(false);
  });

  it("keep the puzzle to level 1 and the film's look (no extra fields)", () => {
    expect(fadeToColor.puzzleSchema.safeParse({ ...puzzle, answer }).success).toBe(false);
    expect(fadeToColor.puzzleSchema.safeParse({ ...puzzle, levels: LEVELS }).success).toBe(false);
  });

  it("insist on ten guesses and lowercase hex colours", () => {
    expect(fadeToColor.puzzleSchema.safeParse({ ...puzzle, maxGuesses: 6 }).success).toBe(false);
    expect(fadeToColor.puzzleSchema.safeParse({ ...puzzle, first: { ...LEVELS[0], average: "#ABCDEF" } }).success).toBe(false);
    expect(fadeToColor.puzzleSchema.safeParse({ ...puzzle, first: { ...LEVELS[0], dominant: "red" } }).success).toBe(false);
  });

  it("require four distinct final-pick options that include the answer", () => {
    expect(fadeToColor.solutionSchema.safeParse({ ...solution, options: OPTIONS.slice(1) }).success).toBe(false);
    expect(fadeToColor.solutionSchema.safeParse({ ...solution, options: [ref(heat), ref(up), ref(drive), ref(thief)] }).success).toBe(false);
    expect(fadeToColor.solutionSchema.safeParse({ ...solution, options: [OPTIONS[1], ...OPTIONS.slice(1)] }).success).toBe(false);
  });

  it("allow a state with no options or all four, and a pick only from them", () => {
    expect(fadeToColorStateSchema.safeParse({ ...initial, options: OPTIONS.slice(0, 2) }).success).toBe(false);
    expect(fadeToColorStateSchema.safeParse({ ...initial, options: OPTIONS, pick: { film: ref(up), correct: false } }).success).toBe(false);
    expect(fadeToColorStateSchema.safeParse({ ...initial, options: OPTIONS, pick: { film: ref(drive), correct: false } }).success).toBe(true);
  });

  it("accept only guess-by-id, skip and pick-by-id moves from the browser", () => {
    expect(fadeToColor.moveSchema.safeParse({ type: "guess", filmId: 10 }).success).toBe(true);
    expect(fadeToColor.moveSchema.safeParse({ type: "skip" }).success).toBe(true);
    expect(fadeToColor.moveSchema.safeParse({ type: "pick", filmId: 10 }).success).toBe(true);
    expect(fadeToColor.moveSchema.safeParse({ type: "pick", filmId: 10, correct: true }).success).toBe(false);
    expect(fadeToColor.moveSchema.safeParse({ type: "give-up" }).success).toBe(false);
    expect(fadeToColor.moveSchema.safeParse({ type: "guess", filmId: 10, title: "Collateral" }).success).toBe(false);
    expect(fadeToColor.moveSchema.safeParse({ type: "guess", filmId: -1 }).success).toBe(false);
  });
});

describe("fade-to-color applyMove", () => {
  it("starts on level 1 with nothing unlocked", () => {
    expect(initial).toEqual({ turns: [], unlocked: [], options: [], pick: null });
    expect(levelsInView(puzzle, initial)).toEqual([LEVELS[0]]);
    expect(outcome(initial)).toBe("in_progress");
  });

  it("records a wrong guess as the film and a miss, with no clues, and unlocks level 2", () => {
    const state = play([guess(heat)]);
    expect(state.turns).toEqual([{ film: { id: 11, title: "Heat", year: 1995 }, correct: false }]);
    expect(state.unlocked).toEqual([LEVELS[1]]);
    expect(fadeToColorStateSchema.parse(state)).toEqual(state);
  });

  it("gives nothing away about the answer in the state (no clues of any kind)", () => {
    const json = JSON.stringify(play([guess(heat), skip, guess(up)]));
    for (const secret of ["Collateral", "2004", "Michael Mann", "Crime", "Thriller", "clues"]) expect(json).not.toContain(secret);
  });

  it("refuses a turn with clues in it", () => {
    const withClues = { turns: [{ film: ref(heat), correct: false, clues: [] }], unlocked: [LEVELS[1]] };
    expect(fadeToColorStateSchema.safeParse(withClues).success).toBe(false);
  });

  it("keeps only the film's ref from a resolved guess, whatever else it carries", () => {
    const state = play([{ type: "guess", film: heat } as ResolvedMove]);
    expect(state.turns).toEqual([{ film: { id: 11, title: "Heat", year: 1995 }, correct: false }]);
  });

  it("unlocks a level on a skip", () => {
    expect(play([skip])).toEqual({ turns: [{ skipped: true }], unlocked: [LEVELS[1]], options: [], pick: null });
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
    // The tenth move was a wrong guess: the final pick is open, the play isn't over.
    expect(outcome(state)).toBe("in_progress");
    expect(awaitingPick(state)).toBe(true);
  });

  it("unlocks nothing more on a correct guess", () => {
    const state = play([skip, guess(answer)]);
    expect(state.unlocked).toEqual([LEVELS[1]]);
    expect(state.turns.at(-1)).toEqual({ film: { id: 10, title: "Collateral", year: 2004 }, correct: true });
  });

  it("rejects a film already guessed, without using a turn", () => {
    const state = play([guess(heat)]);
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: guess(heat) })).toEqual({ ok: false, error: "You already guessed Heat." });
  });

  it("rejects moves once won or lost", () => {
    const finished = "Today's film is already finished.";
    expect(fadeToColor.applyMove({ puzzle, solution, state: play([guess(answer)]), move: skip })).toEqual({ ok: false, error: finished });
    const lost = play(Array.from({ length: MAX_GUESSES }, () => skip));
    expect(outcome(lost)).toBe("lost");
    expect(fadeToColor.applyMove({ puzzle, solution, state: lost, move: guess(answer) })).toEqual({ ok: false, error: finished });
  });

  it("lists guessed film ids, ignoring skips", () => {
    expect(guessedFilmIds(play([guess(heat), skip, guess(up)]))).toEqual([11, 12]);
  });
});

describe("fade-to-color final pick", () => {
  it("opens after a wrong guess on reel 10, with the four options and no new level", () => {
    const state = play(NINE_SKIPS_AND_A_MISS);
    expect(state.options).toEqual(OPTIONS);
    expect(state.pick).toBeNull();
    expect(state.unlocked).toEqual(LEVELS.slice(1));
    expect(outcome(state)).toBe("in_progress");
  });

  it("doesn't open when the player gives up (skips) on reel 10", () => {
    const state = play(Array.from({ length: MAX_GUESSES }, () => skip));
    expect(state.options).toEqual([]);
    expect(outcome(state)).toBe("lost");
  });

  it("keeps the options (and so the answer's title) out of the state until it opens", () => {
    const nine = play([...Array.from({ length: MAX_GUESSES - 2 }, () => skip), guess(heat)]);
    expect(nine.turns).toHaveLength(MAX_GUESSES - 1);
    for (const secret of ["Collateral", "Drive", "Nightcrawler", "Thief"]) expect(JSON.stringify(nine)).not.toContain(secret);
  });

  it("refuses a pick before it opens", () => {
    expect(fadeToColor.applyMove({ puzzle, solution, state: play([skip]), move: pick(answer) })).toEqual({ ok: false, error: "There's nothing to pick yet." });
  });

  it("accepts only a pick, and only one of the options, while it's open", () => {
    const state = play(NINE_SKIPS_AND_A_MISS);
    const only = { ok: false, error: "Every reel is used: pick one of the 4 films." };
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: skip })).toEqual(only);
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: guess(answer) })).toEqual(only);
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: pick(up) })).toEqual({ ok: false, error: "Pick one of the 4 films." });
  });

  it("wins for the pick score when the answer is picked", () => {
    const state = play([...NINE_SKIPS_AND_A_MISS, pick(answer)]);
    expect(state.pick).toEqual({ film: ref(answer), correct: true });
    expect(outcome(state)).toBe("won");
    expect(finish(state)).toEqual({ score: 5, label: "Final pick", grid: `${"⬛".repeat(9)}🟥🟨` });
  });

  it("loses on a wrong pick, and nothing more can be played", () => {
    const state = play([...NINE_SKIPS_AND_A_MISS, pick(thief)]);
    expect(outcome(state)).toBe("lost");
    expect(finish(state)).toEqual({ score: 0, label: "X/10", grid: `${"⬛".repeat(9)}🟥🟥` });
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: pick(answer) })).toEqual({ ok: false, error: "Today's film is already finished." });
  });
});

describe("fade-to-color outcome, score and share grid", () => {
  it("wins on level 1 for 100", () => {
    expect(finish(play([guess(answer)]))).toEqual({ score: 100, label: "1/10", grid: "🟩" });
  });

  it("scores by the attempt the film was named on, one mark per attempt", () => {
    expect(finish(play([skip, guess(heat), guess(answer)]))).toEqual({ score: attemptsScore(3, 10, true, LAST_REEL_SCORE), label: "3/10", grid: "⬛🟥🟩" });
  });

  it("scores 100, 90, 80 … 10 by reel", () => {
    const scores = Array.from({ length: MAX_GUESSES }, (_, i) => finish(play([...Array.from({ length: i }, () => skip), guess(answer)])).score);
    expect(scores).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  });

  it("loses after giving up on reel 10 for 0", () => {
    const moves = Array.from({ length: MAX_GUESSES }, (_, i) => (i % 3 === 0 && i < MAX_GUESSES - 1 ? guess(decoy(i)) : skip));
    expect(finish(play(moves))).toEqual({ score: 0, label: "X/10", grid: "🟥⬛⬛🟥⬛⬛🟥⬛⬛⬛" });
  });

  it("keeps the share grid free of spoilers", () => {
    expect(finish(play([guess(heat), guess(answer)])).grid).not.toMatch(/Heat|Collateral|\d{4}/);
  });
});

describe("fade-to-color reveal", () => {
  it("hands over the film, all ten levels and the frame credit", () => {
    expect(fadeToColor.reveal!({ puzzle, solution })).toEqual({ film: answer, levels: LEVELS, credit: solution.credit });
  });

  it("round-trips puzzle and state through JSON", () => {
    const state = play([guess(heat), skip]);
    expect(JSON.parse(JSON.stringify(puzzle))).toEqual(puzzle);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("fade-to-color on the home", () => {
  const home = fadeToColor.home!;
  const finished = (moves: ResolvedMove[]) => {
    const state = play(moves);
    const o = outcome(state);
    if (o === "in_progress") throw new Error("not finished");
    const { label, grid } = finish(state);
    const marks = shareMarkRow(grid);
    return { marks, line: home.line({ outcome: o, label, marks, par: null }) };
  };
  const skips = (n: number) => Array.from({ length: n }, () => skip);

  it("draws one 3:2 frame per reel and a final-pick disc", () => {
    expect(home.form).toEqual({ kind: "frames", count: LEVEL_COUNT, aspect: "3:2", finalPick: true });
    expect(finished(skips(LEVEL_COUNT)).marks).toHaveLength(LEVEL_COUNT);
    expect(finished([...NINE_SKIPS_AND_A_MISS, pick(answer)]).marks).toHaveLength(LEVEL_COUNT + 1);
  });

  it("speaks the end credits' lines", () => {
    expect(finished([guess(heat), skip, guess(answer)]).line).toBe("Named on reel 3");
    expect(finished([guess(answer)]).line).toBe("Named on reel 1");
    expect(finished(skips(LEVEL_COUNT)).line).toBe("Not named in 10 reels");
    expect(finished([...NINE_SKIPS_AND_A_MISS, pick(answer)]).line).toBe("Named on the final pick");
    expect(finished([...NINE_SKIPS_AND_A_MISS, pick(drive)]).line).toBe("Not named, even on the final pick");
  });

  it("resultLine covers every ending", () => {
    expect(resultLine({ reels: 4, named: true, finalPick: false })).toBe("Named on reel 4");
    expect(resultLine({ reels: 10, named: false, finalPick: false })).toBe("Not named in 10 reels");
    expect(resultLine({ reels: 10, named: true, finalPick: true })).toBe("Named on the final pick");
    expect(resultLine({ reels: 10, named: false, finalPick: true })).toBe("Not named, even on the final pick");
  });
});
