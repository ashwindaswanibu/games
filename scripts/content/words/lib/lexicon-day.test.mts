import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRng } from "@/core/random";
import { canSpell, JUMBLE_SIZE } from "@/games/lexicon/letters";
import { isConsistentLexicon } from "@/games/lexicon/schema";
import { DAY_WORDS, dictionaryFor, fairHand, makeDay, parseAnswers, pickDay, shuffleLetters } from "./lexicon-day.mjs";

const DATA = new URL("../data/", import.meta.url);
const words = readFileSync(new URL("lexicon-words.txt", DATA), "utf8").split("\n").filter(Boolean);
const answers = parseAnswers(readFileSync(new URL("lexicon-answers.tsv", DATA), "utf8"));
const rng = (n: number) => createRng([n, 2, 3, 4]);

describe("the word data", () => {
  it("is sorted, lower case and 3–9 letters; answers are among the words", () => {
    expect([...words].sort()).toEqual(words);
    expect(words.every((w) => /^[a-z]{3,9}$/.test(w))).toBe(true);
    const all = new Set(words);
    expect(answers.length).toBeGreaterThan(1500);
    expect(answers.every((a) => all.has(a.word) && a.word.length >= 5 && a.word.length <= 7 && a.definition.length > 0)).toBe(true);
  });
});

describe("making a day", () => {
  it("lists exactly the words the letters spell, in order", () => {
    const dictionary = dictionaryFor("stareqxyz", words);
    expect(dictionary).toContain("stare");
    expect(dictionary.every((w) => canSpell(w, "stareqxyz"))).toBe(true);
    expect([...dictionary].sort()).toEqual(dictionary);
  });

  it("makes consistent days of the right size that never spell the answer", () => {
    for (let n = 1; n <= 12; n++) {
      const day = pickDay(answers, new Set(), words, rng(n));
      expect(day).not.toBeNull();
      const { puzzle, solution } = day!;
      expect(isConsistentLexicon(puzzle, solution)).toBe(true);
      expect(puzzle.letters).toHaveLength(JUMBLE_SIZE);
      expect(puzzle.total).toBeGreaterThanOrEqual(DAY_WORDS.min);
      expect(puzzle.total).toBeLessThanOrEqual(DAY_WORDS.max);
      expect(puzzle.letters.includes(solution.answer)).toBe(false);
      expect(fairHand(puzzle.letters)).toBe(true);
    }
  });

  it("deals fair hands: no letter over twice, three vowels or more", () => {
    expect(fairHand("srtarssse")).toBe(false);
    expect(fairHand("bcdfghkla")).toBe(false);
    expect(fairHand("clutchoge")).toBe(true);
  });

  it("is the same day for the same seed, and skips used answers", () => {
    const a = pickDay(answers, new Set(), words, rng(7))!;
    const b = pickDay(answers, new Set(), words, rng(7))!;
    expect(a).toEqual(b);
    const c = pickDay(answers, new Set([a.solution.answer]), words, rng(7))!;
    expect(c.solution.answer).not.toBe(a.solution.answer);
  });

  it("gives up on an answer that can't make a day", () => {
    expect(makeDay({ word: "rhythm", pos: "noun", definition: "x" }, ["rhythm"], rng(1))).toBeNull();
  });

  it("shuffles without spelling the answer either way", () => {
    for (let n = 0; n < 50; n++) {
      const order = shuffleLetters("stareabcd", "stare", rng(n));
      expect(order.includes("stare") || order.includes("erats")).toBe(false);
      expect([...order].sort().join("")).toBe([..."stareabcd"].sort().join(""));
    }
  });
});
