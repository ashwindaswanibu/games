/**
 * Making one Lexicon day (pure; `../lexicon.mts` does the reading and writing). A day's nine letters
 * come from a seed: one common nine-letter word, or two common words that make nine together
 * (owner, 2026-10-13: "start with a nine letter word", "merge 5,4 words too"), so the letters read
 * like words, not a random draw. A seed makes a day when its letters are a fair hand (`fairHand`)
 * whose dictionary holds `DAY_WORDS.min`–`DAY_WORDS.max` words, so days are alike in size, and a
 * common word in that dictionary is left to be the answer. Then the nine are shuffled so neither
 * the answer nor the seed's words sit spelled out in them.
 */
import { daysBetween, type PuzzleDate } from "@/core/day";
import type { Rng } from "@/core/random";
import { canSpell, JUMBLE_SIZE, MIN_WORD } from "@/games/lexicon/letters";
import { isConsistentLexicon, thumbIndex, type LexiconPuzzle, type LexiconSolution } from "@/games/lexicon/schema";

/** How many words a day's dictionary may hold. */
export const DAY_WORDS = { min: 60, max: 120 } as const;
/** A jumble's shape: no letter more than twice (S piles up from plurals otherwise), and enough vowels to make words. */
export const MAX_REPEAT = 2;
export const MIN_VOWELS = 3;

/** A day's seed: one nine-letter word, or two words that make nine, in the order they're joined. */
export type Seed = readonly string[];

export interface SeedWords {
  /** Common nine-letter words (`data/lexicon-seeds.txt`). */
  wholes: readonly string[];
  /** Common short words, two of which make nine (`data/lexicon-seed-parts.txt`). */
  parts: readonly string[];
}

/** How long each word of a two-word seed may be: 3 + 6 up to 6 + 3. */
export const SEED_PART_LENGTHS = { min: MIN_WORD, max: JUMBLE_SIZE - MIN_WORD } as const;
/** The share of days whose seed is one nine-letter word; the rest join two. */
export const WHOLE_SHARE = 0.6;
/** Days before the same nine letters may come round again. */
export const SEED_REST_DAYS = 365;
/** Two-word seeds to try before giving up (roughly a third make a day). */
const PAIR_ATTEMPTS = 2000;

export interface Day {
  puzzle: LexiconPuzzle;
  solution: LexiconSolution;
}

/** Whether nine letters look like a fair hand: no letter over `MAX_REPEAT` times, at least `MIN_VOWELS` vowels. */
export function fairHand(letters: string): boolean {
  const counts = new Map<string, number>();
  for (const ch of letters) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const vowels = [...letters].filter((ch) => "aeiou".includes(ch)).length;
  return [...counts.values()].every((n) => n <= MAX_REPEAT) && vowels >= MIN_VOWELS;
}

export interface AnswerEntry {
  word: string;
  pos: string;
  definition: string;
}

/** The words `letters` can spell, in dictionary order (`words` must be sorted). */
export function dictionaryFor(letters: string, words: readonly string[]): string[] {
  return words.filter((w) => w.length <= letters.length && canSpell(w, letters));
}

/** What rests between uses: the nine letters, however they were made (MOONLIGHT is MOON + LIGHT is LIGHT + MOON). */
export function seedKey(seed: Seed): string {
  return [...seed.join("")].sort().join("");
}

/** The seeds resting on `date`: those of other days less than `SEED_REST_DAYS` before or after it. */
export function restingSeeds(seeds: ReadonlyMap<PuzzleDate, Seed>, date: PuzzleDate): Set<string> {
  const resting = new Set<string>();
  for (const [other, seed] of seeds) if (other !== date && Math.abs(daysBetween(other, date)) < SEED_REST_DAYS) resting.add(seedKey(seed));
  return resting;
}

/** The nine letters in an order that spells none of `hidden` (forwards or backwards) anywhere. */
export function shuffleLetters(letters: string, hidden: readonly string[], rng: Rng): string {
  const runs = hidden.flatMap((w) => [w, [...w].reverse().join("")]);
  for (let i = 0; i < 100; i++) {
    const order = rng.shuffle([...letters]).join("");
    if (!runs.some((run) => order.includes(run))) return order;
  }
  throw new Error(`Couldn't shuffle ${letters} without spelling ${hidden.join(", ")}`);
}

/**
 * The day `seed` makes, or null: when its letters aren't a fair hand, their dictionary is the wrong
 * size, or no common word in it is left to be the answer. `answers` are the common words by word.
 */
export function dayFromSeed(seed: Seed, answers: ReadonlyMap<string, AnswerEntry>, used: ReadonlySet<string>, words: readonly string[], rng: Rng): Day | null {
  const letters = seed.join("");
  if (letters.length !== JUMBLE_SIZE || !fairHand(letters)) return null;
  const dictionary = dictionaryFor(letters, words);
  if (dictionary.length < DAY_WORDS.min || dictionary.length > DAY_WORDS.max) return null;
  // Never a word the seed spells out as it stands: one of its two words, or a run of the nine-letter one.
  const open = dictionary.filter((w) => answers.has(w) && !used.has(w) && !letters.includes(w));
  if (open.length === 0) return null;
  const answer = answers.get(rng.pick(open))!;
  const puzzle: LexiconPuzzle = {
    letters: shuffleLetters(letters, [answer.word, ...seed], rng),
    total: dictionary.length,
    tabs: thumbIndex(dictionary),
  };
  const solution: LexiconSolution = {
    answer: answer.word,
    words: dictionary,
    entry: { pos: answer.pos, definition: answer.definition },
    seed: [...seed],
  };
  if (!isConsistentLexicon(puzzle, solution)) throw new Error(`Inconsistent day for ${seed.join(" + ")} (generator bug)`);
  return { puzzle, solution };
}

/**
 * A day from a seed that isn't resting (`resting`, by `seedKey`) with an answer never used before
 * (`used`; the answers hold about five years of days): one nine-letter word on `WHOLE_SHARE` of
 * days, two words joined on the rest, each falling back to the other.
 */
export function pickDay(
  seeds: SeedWords,
  answers: readonly AnswerEntry[],
  used: ReadonlySet<string>,
  resting: ReadonlySet<string>,
  words: readonly string[],
  rng: Rng,
): Day | null {
  const entries = new Map(answers.map((a) => [a.word, a]));
  const whole = (): Day | null => {
    for (const w of rng.shuffle(seeds.wholes)) {
      if (resting.has(seedKey([w]))) continue;
      const day = dayFromSeed([w], entries, used, words, rng);
      if (day) return day;
    }
    return null;
  };
  const byLength = new Map<number, string[]>();
  for (const w of seeds.parts) byLength.set(w.length, [...(byLength.get(w.length) ?? []), w]);
  const splits: [number, number][] = [];
  for (let a = SEED_PART_LENGTHS.min; a <= SEED_PART_LENGTHS.max; a++) if (byLength.has(a) && byLength.has(JUMBLE_SIZE - a)) splits.push([a, JUMBLE_SIZE - a]);
  const pair = (): Day | null => {
    if (splits.length === 0) return null;
    for (let i = 0; i < PAIR_ATTEMPTS; i++) {
      const [a, b] = rng.pick(splits);
      const seed = [rng.pick(byLength.get(a)!), rng.pick(byLength.get(b)!)];
      if (seed[0] === seed[1] || resting.has(seedKey(seed))) continue;
      const day = dayFromSeed(seed, entries, used, words, rng);
      if (day) return day;
    }
    return null;
  };
  return rng.next() < WHOLE_SHARE ? (whole() ?? pair()) : (pair() ?? whole());
}

/** `lexicon-answers.tsv` → entries. */
export function parseAnswers(text: string): AnswerEntry[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [word, pos, definition] = line.split("\t");
      if (!word || !pos || !definition) throw new Error(`Bad answers line: ${line}`);
      return { word, pos, definition };
    });
}
