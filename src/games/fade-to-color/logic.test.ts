import { describe, expect, it } from "vitest";
import { referencedAssetIds } from "@/core/assets";
import { attemptsScore } from "@/core/scoring";
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
  pickWorth,
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
const stop: ResolvedMove = { type: "stop" };
const skips = (n: number): ResolvedMove[] => Array.from({ length: n }, () => skip);
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
    const lost = play([stop, pick(thief)]);
    expect(outcome(lost)).toBe("lost");
    expect(fadeToColor.applyMove({ puzzle, solution, state: lost, move: guess(answer) })).toEqual({ ok: false, error: finished });
  });

  it("lists guessed film ids, ignoring skips", () => {
    expect(guessedFilmIds(play([guess(heat), skip, guess(up)]))).toEqual([11, 12]);
  });
});

describe("fade-to-color: stop the film", () => {
  it("opens the four on any reel without using an attempt or unlocking a level", () => {
    const state = play([skip, guess(heat), stop]);
    expect(state.options).toEqual(OPTIONS);
    expect(state.turns).toHaveLength(2);
    expect(state.unlocked).toEqual(LEVELS.slice(1, 3));
    expect(outcome(state)).toBe("in_progress");
    expect(awaitingPick(state)).toBe(true);
  });

  it("brings the four up after a wrong guess on reel 10 (the run-out)", () => {
    const state = play(NINE_SKIPS_AND_A_MISS);
    expect(state.options).toEqual(OPTIONS);
    expect(state.unlocked).toEqual(LEVELS.slice(1));
    expect(outcome(state)).toBe("in_progress");
  });

  it("refuses a skip on reel 10: guess or take the four", () => {
    expect(fadeToColor.applyMove({ puzzle, solution, state: play(skips(MAX_GUESSES - 1)), move: skip })).toEqual({
      ok: false,
      error: "On the last reel, guess or take the four.",
    });
  });

  it("keeps the four out of the state until the film is stopped", () => {
    const nine = play([...skips(MAX_GUESSES - 2), guess(heat)]);
    expect(nine.turns).toHaveLength(MAX_GUESSES - 1);
    for (const secret of ["Collateral", "Drive", "Nightcrawler", "Thief"]) expect(JSON.stringify(nine)).not.toContain(secret);
  });

  it("refuses a pick before the film is stopped, and a second stop", () => {
    expect(fadeToColor.applyMove({ puzzle, solution, state: play([skip]), move: pick(answer) })).toEqual({ ok: false, error: "Stop the film first." });
    expect(fadeToColor.applyMove({ puzzle, solution, state: play([stop]), move: stop })).toEqual({ ok: false, error: "The four are already up." });
  });

  it("accepts only a pick of one of the four while they're up, never a film already guessed", () => {
    const state = play([guess(thief), stop]);
    const only = { ok: false, error: "You stopped the film: pick one of the four." };
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: skip })).toEqual(only);
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: guess(answer) })).toEqual(only);
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: pick(up) })).toEqual({ ok: false, error: "Pick one of the 4 films." });
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: pick(thief) })).toEqual({ ok: false, error: "You already guessed Thief: it isn't the one." });
  });

  it("scores a right pick at half of naming the film on that reel", () => {
    const worths = Array.from({ length: MAX_GUESSES }, (_, i) => finish(play([...skips(i), stop, pick(answer)])).score);
    expect(worths).toEqual([50, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
    expect(worths).toEqual(Array.from({ length: MAX_GUESSES }, (_, i) => pickWorth(i + 1)));
  });

  it("labels and marks a right pick by the reel it was stopped on", () => {
    expect(finish(play([stop, pick(answer)]))).toEqual({ score: 50, label: "Pick 1/10", grid: "🟡" });
    expect(finish(play([guess(heat), skip, guess(up), stop, pick(answer)]))).toEqual({ score: 35, label: "Pick 4/10", grid: "🟥⬛🟥🟡" });
    expect(finish(play([...NINE_SKIPS_AND_A_MISS, pick(answer)]))).toEqual({ score: 5, label: "Pick 10/10", grid: `${"⬛".repeat(9)}🟥🟡` });
  });

  it("loses on a wrong pick, and nothing more can be played", () => {
    const state = play([skip, stop, pick(drive)]);
    expect(outcome(state)).toBe("lost");
    expect(finish(state)).toEqual({ score: 0, label: "X/10", grid: "⬛⚫" });
    expect(fadeToColor.applyMove({ puzzle, solution, state, move: pick(answer) })).toEqual({ ok: false, error: "Today's film is already finished." });
  });

  it("still reads a play that gave up on reel 10 before that was refused", () => {
    const old: State = { turns: Array.from({ length: MAX_GUESSES }, () => ({ skipped: true as const })), unlocked: LEVELS.slice(1), options: [], pick: null };
    expect(fadeToColorStateSchema.parse(old)).toEqual(old);
    expect(outcome(old)).toBe("lost");
    expect(finish(old)).toEqual({ score: 0, label: "X/10", grid: "⬛".repeat(10) });
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

  it("scores a name at double the pick on the same reel", () => {
    for (let reel = 1; reel <= MAX_GUESSES; reel++) {
      const named = finish(play([...skips(reel - 1), guess(answer)])).score;
      const picked = finish(play([...skips(reel - 1), stop, pick(answer)])).score;
      expect(named).toBe(2 * picked);
    }
  });

  it("keeps the share grid free of spoilers", () => {
    expect(finish(play([guess(heat), guess(answer)])).grid).not.toMatch(/Heat|Collateral|\d{4}/);
  });
});

describe("fade-to-color reveal", () => {
  it("hands over the film, all ten levels and the frame credit", () => {
    expect(fadeToColor.reveal!({ puzzle, solution })).toEqual({ film: answer, levels: LEVELS, credit: solution.credit, options: OPTIONS });
  });

  it("round-trips puzzle and state through JSON", () => {
    const state = play([guess(heat), skip]);
    expect(JSON.parse(JSON.stringify(puzzle))).toEqual(puzzle);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("fade-to-color friendDetail (what friends see of a finished play)", () => {
  const detail = (state: State) => fadeToColor.friendDetail!(state);

  it("is the film picked from the four, right or wrong", () => {
    expect(detail(play([skip, stop, pick(answer)]))).toStrictEqual({ pickId: answer.id });
    expect(detail(play([stop, pick(thief)]))).toStrictEqual({ pickId: thief.id });
    expect(detail(play([...NINE_SKIPS_AND_A_MISS, pick(drive)]))).toStrictEqual({ pickId: drive.id });
  });

  it("is no pick when the film was named, or got away without one", () => {
    expect(detail(play([guess(heat), guess(answer)]))).toStrictEqual({ pickId: null });
    // From before skipping the last reel was refused: giving up ended the play.
    const gaveUp = play(skips(MAX_GUESSES - 1));
    expect(detail({ ...gaveUp, turns: [...gaveUp.turns, { skipped: true }] })).toStrictEqual({ pickId: null });
  });

  it("carries only the pick, never the films a player typed (even among the four)", () => {
    expect(detail(play([guess(drive), guess(heat), stop, pick(answer)]))).toStrictEqual({ pickId: answer.id });
  });

  it("is JSON-safe, as it travels to the browser as is", () => {
    const value = detail(play([stop, pick(answer)]));
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
  });
});
