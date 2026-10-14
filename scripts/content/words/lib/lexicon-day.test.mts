import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, parsePuzzleDate, type PuzzleDate } from "@/core/day";
import { createRng } from "@/core/random";
import { canSpell, JUMBLE_SIZE } from "@/games/lexicon/letters";
import { isConsistentLexicon } from "@/games/lexicon/schema";
import { DAY_WORDS, dayFromSeed, dictionaryFor, fairHand, parseAnswers, pickDay, restingSeeds, SEED_REST_DAYS, seedKey, shuffleLetters, type Seed } from "./lexicon-day.mjs";

const DATA = new URL("../data/", import.meta.url);
const words = readFileSync(new URL("lexicon-words.txt", DATA), "utf8").split("\n").filter(Boolean);
const answers = parseAnswers(readFileSync(new URL("lexicon-answers.tsv", DATA), "utf8"));
const list = (name: string) => readFileSync(new URL(name, DATA), "utf8").split("\n").filter(Boolean);
const seeds = { wholes: list("lexicon-seeds.txt"), parts: list("lexicon-seed-parts.txt") };
const entries = new Map(answers.map((a) => [a.word, a]));
const rng = (n: number) => createRng([n, 2, 3, 4]);

describe("the word data", () => {
  it("is sorted, lower case and 3–9 letters; answers are among the words", () => {
    expect([...words].sort()).toEqual(words);
    expect(words.every((w) => /^[a-z]{3,9}$/.test(w))).toBe(true);
    const all = new Set(words);
    expect(answers.length).toBeGreaterThan(1500);
    expect(answers.every((a) => all.has(a.word) && a.word.length >= 5 && a.word.length <= 7 && a.definition.length > 0)).toBe(true);
  });

  it("has seeds of nine letters and parts of three to six, all guess words", () => {
    const all = new Set(words);
    expect(seeds.wholes.length).toBeGreaterThan(500);
    expect(seeds.parts.length).toBeGreaterThan(1500);
    expect(seeds.wholes.every((w) => all.has(w) && w.length === JUMBLE_SIZE)).toBe(true);
    expect(seeds.parts.every((w) => all.has(w) && w.length >= 3 && w.length <= 6)).toBe(true);
  });
});

describe("making a day", () => {
  it("lists exactly the words the letters spell, in order", () => {
    const dictionary = dictionaryFor("stareqxyz", words);
    expect(dictionary).toContain("stare");
    expect(dictionary.every((w) => canSpell(w, "stareqxyz"))).toBe(true);
    expect([...dictionary].sort()).toEqual(dictionary);
  });

  it("makes consistent days of the right size from a seed, never spelling the answer or the seed's words", () => {
    let wholes = 0;
    for (let n = 1; n <= 24; n++) {
      const day = pickDay(seeds, answers, new Set(), new Set(), words, rng(n));
      expect(day).not.toBeNull();
      const { puzzle, solution } = day!;
      expect(isConsistentLexicon(puzzle, solution)).toBe(true);
      expect(puzzle.letters).toHaveLength(JUMBLE_SIZE);
      expect(puzzle.total).toBeGreaterThanOrEqual(DAY_WORDS.min);
      expect(puzzle.total).toBeLessThanOrEqual(DAY_WORDS.max);
      expect(fairHand(puzzle.letters)).toBe(true);
      const seed = solution.seed!;
      if (seed.length === 1) {
        wholes++;
        expect(seeds.wholes).toContain(seed[0]);
      } else {
        expect(seed).toHaveLength(2);
        expect(seed.every((w) => seeds.parts.includes(w))).toBe(true);
      }
      expect(seed.join("").includes(solution.answer)).toBe(false);
      for (const w of [solution.answer, ...seed]) expect(puzzle.letters.includes(w)).toBe(false);
    }
    // Both kinds turn up.
    expect(wholes).toBeGreaterThan(0);
    expect(wholes).toBeLessThan(24);
  });

  it("deals fair hands: no letter over twice, three vowels or more", () => {
    expect(fairHand("srtarssse")).toBe(false);
    expect(fairHand("bcdfghkla")).toBe(false);
    expect(fairHand("clutchoge")).toBe(true);
  });

  it("is the same day for the same seed, and skips used answers and resting seeds", () => {
    const a = pickDay(seeds, answers, new Set(), new Set(), words, rng(7))!;
    const b = pickDay(seeds, answers, new Set(), new Set(), words, rng(7))!;
    expect(a).toEqual(b);
    const c = pickDay(seeds, answers, new Set([a.solution.answer]), new Set([seedKey(a.solution.seed!)]), words, rng(7))!;
    expect(c.solution.answer).not.toBe(a.solution.answer);
    expect(seedKey(c.solution.seed!)).not.toBe(seedKey(a.solution.seed!));
  });

  it("refuses a seed whose letters make a lopsided hand, a dictionary of the wrong size, or no answer left", () => {
    expect(dayFromSeed(["rhythmics"], entries, new Set(), words, rng(1))).toBeNull();
    expect(dayFromSeed(["sassy", "mess"], entries, new Set(), words, rng(1))).toBeNull();
    const day = pickDay(seeds, answers, new Set(), new Set(), words, rng(3))!;
    const seed = day.solution.seed!;
    expect(dayFromSeed(seed, entries, new Set(day.solution.words), words, rng(3))).toBeNull();
  });

  it("never picks a word the seed spells out as the answer", () => {
    for (let n = 0; n < 20; n++) {
      const day = dayFromSeed(["plain", "tour"], entries, new Set(), words, rng(n));
      if (day) expect(["plain", "tour"]).not.toContain(day.solution.answer);
    }
  });

  it("rests the same nine letters, however they're made, for a year either side", () => {
    expect(seedKey(["moonlight"])).toBe(seedKey(["light", "moon"]));
    const on = (d: string) => parsePuzzleDate(d);
    const days = new Map<PuzzleDate, Seed>([[on("2026-11-01"), ["moonlight"]], [on("2027-12-01"), ["fruit", "clock"]]]);
    expect(restingSeeds(days, on("2026-11-01"))).toEqual(new Set());
    expect(restingSeeds(days, on("2027-06-01"))).toEqual(new Set([seedKey(["moonlight"]), seedKey(["fruit", "clock"])]));
    expect(restingSeeds(days, addDays(on("2026-11-01"), SEED_REST_DAYS))).toEqual(new Set([seedKey(["fruit", "clock"])]));
  });

  it("shuffles without spelling any hidden word either way", () => {
    for (let n = 0; n < 50; n++) {
      const order = shuffleLetters("stareabcd", ["stare", "bcd"], rng(n));
      for (const run of ["stare", "erats", "bcd", "dcb"]) expect(order.includes(run)).toBe(false);
      expect([...order].sort().join("")).toBe([..."stareabcd"].sort().join(""));
    }
  });
});
