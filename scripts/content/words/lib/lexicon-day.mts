/**
 * Making one Lexicon day (pure; `../lexicon.mts` does the reading and writing). A day is an answer
 * from the common words, its letters plus a few more to make nine, and the dictionary those nine
 * spell. The extra letters are drawn like English letters (by how often each appears in the word
 * list) until the nine make a fair hand (`fairHand`) and the dictionary holds
 * `DAY_WORDS.min`–`DAY_WORDS.max` words, so days are alike in size; then the nine are shuffled so
 * the answer never sits spelled out in them.
 */
import type { Rng } from "@/core/random";
import { canSpell, JUMBLE_SIZE } from "@/games/lexicon/letters";
import { isConsistentLexicon, thumbIndex, type LexiconPuzzle, type LexiconSolution } from "@/games/lexicon/schema";

/** How many words a day's dictionary may hold. */
export const DAY_WORDS = { min: 60, max: 120 } as const;
/** Draws of extra letters to try per answer before giving up on it. */
const ATTEMPTS = 400;
/** A jumble's shape: no letter more than twice (S piles up from plurals otherwise), and enough vowels to make words. */
export const MAX_REPEAT = 2;
export const MIN_VOWELS = 3;

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

/** How often each letter appears across `words`: the weights extra letters are drawn by. */
export function letterWeights(words: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const w of words) for (const ch of w) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : 1));
}

function drawLetter(weights: readonly [string, number][], total: number, rng: Rng): string {
  let at = rng.next() * total;
  for (const [ch, w] of weights) {
    at -= w;
    if (at < 0) return ch;
  }
  return weights.at(-1)![0];
}

/** The nine letters in an order that doesn't spell `answer` (forwards or backwards) anywhere. */
export function shuffleLetters(letters: string, answer: string, rng: Rng): string {
  const reversed = [...answer].reverse().join("");
  for (let i = 0; i < 100; i++) {
    const order = rng.shuffle([...letters]).join("");
    if (!order.includes(answer) && !order.includes(reversed)) return order;
  }
  throw new Error(`Couldn't shuffle ${letters} without spelling ${answer}`);
}

/**
 * A day for `answer`, or null when no draw of extra letters gives a dictionary of the right size
 * (an answer like "rhythm" makes too few words whatever is added).
 */
export function makeDay(
  answer: AnswerEntry,
  words: readonly string[],
  rng: Rng,
  weights: readonly [string, number][] = letterWeights(words),
): { puzzle: LexiconPuzzle; solution: LexiconSolution } | null {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  const extra = JUMBLE_SIZE - answer.word.length;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let letters = answer.word;
    for (let i = 0; i < extra; i++) letters += drawLetter(weights, total, rng);
    if (!fairHand(letters)) continue;
    const dictionary = dictionaryFor(letters, words);
    if (dictionary.length < DAY_WORDS.min || dictionary.length > DAY_WORDS.max) continue;
    const puzzle: LexiconPuzzle = {
      letters: shuffleLetters(letters, answer.word, rng),
      total: dictionary.length,
      tabs: thumbIndex(dictionary),
    };
    const solution: LexiconSolution = { answer: answer.word, words: dictionary, entry: { pos: answer.pos, definition: answer.definition } };
    if (!isConsistentLexicon(puzzle, solution)) throw new Error(`Inconsistent day for ${answer.word} (generator bug)`);
    return { puzzle, solution };
  }
  return null;
}

/**
 * A day for the first answer (in a random order) that hasn't been used and makes a day. Every
 * answer is used once: the list holds about five years of days.
 */
export function pickDay(
  answers: readonly AnswerEntry[],
  used: ReadonlySet<string>,
  words: readonly string[],
  rng: Rng,
): { puzzle: LexiconPuzzle; solution: LexiconSolution } | null {
  const weights = letterWeights(words);
  for (const answer of rng.shuffle(answers.filter((a) => !used.has(a.word)))) {
    const day = makeDay(answer, words, rng, weights);
    if (day) return day;
  }
  return null;
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
