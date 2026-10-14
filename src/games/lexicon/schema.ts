import * as z from "zod";
import { ANSWER_LENGTHS, canSpell, compareWords, JUMBLE_SIZE, MIN_WORD } from "./letters";

/**
 * Lexicon: stored puzzle and solution shapes, shared by the game (`./logic.ts`) and the content
 * pipeline that writes the daily puzzles (`scripts/content/words/lexicon.mts`). Pure zod.
 *
 * A day is nine letters and the dictionary they make: every word of 3+ letters the letters can
 * spell, each letter used once. Today's word is one of them. The puzzle says how many words there
 * are and where each initial letter starts (the book's thumb index); the words themselves stay on
 * the server, so the only way to learn them is to guess.
 */

const word = z.string().regex(/^[a-z]+$/).min(MIN_WORD).max(JUMBLE_SIZE);

export const lexiconPuzzleSchema = z
  .strictObject({
    /** The nine letters, in the order the day shows them. */
    letters: z.string().regex(new RegExp(`^[a-z]{${JUMBLE_SIZE}}$`)),
    /**
     * Letters in today's word: written on days before 12 October 2026, when the length was shown.
     * It isn't any more (owner, 2026-10-12: it misled players into hunting a nine-letter word, and
     * the game reads cleaner as before-or-after alone), so new days leave it out.
     */
    length: z.number().int().min(ANSWER_LENGTHS.min).max(ANSWER_LENGTHS.max).optional(),
    /** Words in today's dictionary. */
    total: z.number().int().min(2).max(2000),
    /** The thumb index: each initial letter present, and the position of its first word. */
    tabs: z.array(z.strictObject({ letter: z.string().regex(/^[a-z]$/), at: z.number().int().min(0) })).min(1).max(26),
    /** Set only on DEV FIXTURE puzzles. */
    fixture: z.literal(true).optional(),
  });
export type LexiconPuzzle = z.infer<typeof lexiconPuzzleSchema>;

/** A dictionary's entry for today's word, shown when the book opens at it. */
export const lexiconEntrySchema = z.strictObject({
  /** "noun", "verb", "adjective", "adverb". */
  pos: z.string().min(1).max(20),
  definition: z.string().min(1).max(400),
});
export type LexiconEntry = z.infer<typeof lexiconEntrySchema>;

export const lexiconSolutionSchema = z.strictObject({
  answer: word,
  /** Today's dictionary, in order, today's word among them. */
  words: z.array(word).min(2).max(2000),
  entry: lexiconEntrySchema,
  /**
   * What the nine letters were made from: one nine-letter word, or two words joined (owner,
   * 2026-10-13). Written on days from 13 October 2026; older days drew letters at random.
   */
  seed: z.array(word).min(1).max(2).optional(),
});
export type LexiconSolution = z.infer<typeof lexiconSolutionSchema>;

/** The thumb index for a sorted dictionary: each initial letter and where its words start. */
export function thumbIndex(words: readonly string[]): LexiconPuzzle["tabs"] {
  const tabs: LexiconPuzzle["tabs"] = [];
  words.forEach((w, at) => {
    if (tabs.at(-1)?.letter !== w[0]) tabs.push({ letter: w[0]!, at });
  });
  return tabs;
}

/** The puzzle and solution agree (checked when puzzles are written). */
export function isConsistentLexicon(puzzle: LexiconPuzzle, solution: LexiconSolution): boolean {
  const { words, answer, seed } = solution;
  const sortedLetters = (letters: string) => [...letters].sort().join("");
  const sorted = words.every((w, i) => i === 0 || compareWords(words[i - 1]!, w) < 0);
  return (
    sorted &&
    words.every((w) => canSpell(w, puzzle.letters)) &&
    words.includes(answer) &&
    (puzzle.length === undefined || answer.length === puzzle.length) &&
    (seed === undefined || sortedLetters(seed.join("")) === sortedLetters(puzzle.letters)) &&
    puzzle.total === words.length &&
    JSON.stringify(puzzle.tabs) === JSON.stringify(thumbIndex(words))
  );
}
