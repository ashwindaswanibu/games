import { describe, expect, it } from "vitest";
import { canSpell, indexOfWord, perfectGuesses } from "./letters";
import { describeGap, gapOf, guessRefusal, lexicon, pointsFor, type LexiconPuzzle, type LexiconSolution, type LexiconState } from "./logic";
import { isConsistentLexicon, thumbIndex } from "./schema";

// Today's letters spell these (a small dictionary for the tests); the word is "stare".
const words = ["arts", "aster", "east", "eats", "rate", "rates", "rest", "sat", "sea", "sear", "seat", "stare", "star", "tar", "tea", "tear"].sort();
const puzzle: LexiconPuzzle = { letters: "qtxsyaezr", length: 5, total: words.length, tabs: thumbIndex(words) };
const solution: LexiconSolution = { answer: "stare", words, entry: { pos: "verb", definition: "look at with fixed eyes" } };

function play(...guesses: string[]): LexiconState {
  let state = lexicon.initialState(puzzle);
  for (const word of guesses) {
    const result = lexicon.applyMove({ puzzle, solution, state, move: { type: "guess", word } });
    if (!result.ok) throw new Error(`refused: ${result.error}`);
    state = result.state;
  }
  return state;
}

const refuse = (state: LexiconState, word: string) => {
  const result = lexicon.applyMove({ puzzle, solution, state, move: { type: "guess", word } });
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
};

describe("letters", () => {
  it("spells only from the day's letters, each once", () => {
    expect(canSpell("stare", "qtxsyaezr")).toBe(true);
    expect(canSpell("street", "qtxsyaezr")).toBe(false);
    expect(indexOfWord(words, "stare")).toBe(words.indexOf("stare"));
    expect(indexOfWord(words, "zzz")).toBe(-1);
  });

  it("knows how many guesses perfect halving needs", () => {
    expect([1, 2, 3, 7, 60, 120].map(perfectGuesses)).toEqual([1, 2, 2, 3, 6, 7]);
  });

  it("checks a day is consistent", () => {
    expect(isConsistentLexicon(puzzle, solution)).toBe(true);
    expect(isConsistentLexicon({ ...puzzle, total: 3 }, solution)).toBe(false);
    expect(isConsistentLexicon(puzzle, { ...solution, answer: "stars" })).toBe(false);
  });
});

describe("guessing", () => {
  it("says which way the word lies and closes the gap", () => {
    const state = play("rate", "tar");
    expect(state.guesses.map((g) => g.side)).toEqual(["after", "before"]);
    const gap = gapOf(puzzle, state);
    expect(gap.lowWord).toBe("rate");
    expect(gap.highWord).toBe("tar");
    // Strictly between rate and tar: rates rest sat sea sear seat star stare.
    expect(gap.left).toBe(8);
    expect(describeGap(puzzle, state)).toBe("8 words left, after RATE, before TAR");
  });

  it("finds the word", () => {
    const state = play("rate", "tar", "stare");
    expect(state.guesses.at(-1)!.side).toBe("found");
    expect(lexicon.outcome({ puzzle, solution, state })).toBe("won");
  });

  it("refuses, for free, what can't be today's word", () => {
    const state = play("rate", "tar");
    expect(refuse(state, "st4re")).toBe("Letters only.");
    expect(refuse(state, "st")).toBe("Use 3 to 9 letters.");
    expect(refuse(state, "street")).toBe("Only today's letters, each used once.");
    expect(refuse(state, "rats")).toBe("RATS isn't in today's dictionary.");
    expect(refuse(state, "rate")).toBe("You've tried RATE already.");
    expect(refuse(state, "east")).toBe("Today's word comes after RATE.");
    expect(refuse(state, "tea")).toBe("Today's word comes before TAR.");
    expect(guessRefusal(puzzle, solution, state, "seat")).toBeNull();
  });

  it("takes guesses however they're typed", () => {
    expect(play("  RATE ").guesses[0]!.word).toBe("rate");
  });

  it("never runs out of guesses; giving up ends it with nothing", () => {
    const state = play("arts", "aster", "east", "eats", "rate");
    expect(lexicon.outcome({ puzzle, solution, state })).toBe("in_progress");
    const result = lexicon.applyMove({ puzzle, solution, state, move: { type: "give-up" } });
    if (!result.ok) throw new Error(result.error);
    expect(lexicon.outcome({ puzzle, solution, state: result.state })).toBe("lost");
    expect(lexicon.score({ puzzle, solution, state: result.state, outcome: "lost", elapsedMs: 0 })).toEqual({ score: 0, label: "Gave up" });
  });

  it("refuses every move once the game is over", () => {
    const state = play("stare");
    expect(refuse(state, "rate")).toBe("Today's game is over.");
  });
});

describe("score, share and reveal", () => {
  it("scores by the guess that finds it: steep, then gentle, never below 10", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 10, 14, 15, 30].map(pointsFor)).toEqual([100, 90, 80, 70, 60, 55, 50, 45, 35, 15, 10, 10]);
    const state = play("rate", "tar", "stare");
    expect(lexicon.score({ puzzle, solution, state, outcome: "won", elapsedMs: 0 })).toEqual({ score: 80, label: "Found on guess 3" });
  });

  it("shares only which way each guess pointed", () => {
    expect(lexicon.shareGrid({ puzzle, state: play("rate", "tar", "stare"), outcome: "won" })).toBe("▸◂◆");
  });

  it("reveals the word and its entry; friends see the guesses", () => {
    expect(lexicon.reveal?.({ puzzle, solution })).toEqual({ answer: "stare", page: words.indexOf("stare"), entry: solution.entry });
    expect(lexicon.friendDetail?.(play("rate", "stare"))).toEqual({ guesses: ["rate", "stare"] });
  });

  it("keeps the dictionary and the word out of the puzzle and initial state", () => {
    const visible = JSON.stringify({ puzzle, state: lexicon.initialState(puzzle) });
    expect(visible).not.toContain("stare");
    expect(visible).not.toContain("tear");
    expect(visible).not.toContain("rates");
  });
});
