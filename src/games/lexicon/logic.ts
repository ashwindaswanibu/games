import { z } from "zod";
import { defineGame } from "@/core/game";
import { canSpell, compareWords, indexOfWord, isLetters, JUMBLE_SIZE, MIN_WORD, normalizeWord } from "./letters";
import { lexiconPuzzleSchema, lexiconSolutionSchema, type LexiconEntry, type LexiconPuzzle, type LexiconSolution } from "./schema";

/**
 * Lexicon: nine letters make a small dictionary (every word of three or more letters they can
 * spell); today's word is one of its pages. Guess any word from the letters and learn whether
 * today's word comes before or after it. The gap closes in, page by page, until one is left.
 *
 * - A guess must be a word in today's dictionary that can still be today's word (inside the gap).
 *   Anything else is refused and costs nothing: a non-word, letters the day doesn't have, a word
 *   already outside the gap, one already tried.
 * - Guesses never run out. Giving up shows the word and scores 0.
 * - Score by the guess that finds it: 100, 90, 80, 70, 60, then 5 fewer a guess, never below 10.
 *   Days are made with 60–120 words, so they're alike in size (see the content pipeline).
 *
 * Every rule is pure: the day's dictionary is in the solution, which `applyMove` reads.
 */

/** Points for finding the word on guess 1, 2, 3, …; the last stands for every guess after. */
export const SCORE_BY_GUESS = [100, 90, 80, 70, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10] as const;

export type { LexiconEntry, LexiconPuzzle, LexiconSolution } from "./schema";

/** Which way today's word lies from a guess: after it, before it, or this is it. */
export type Side = "after" | "before" | "found";

export interface LexiconGuess {
  word: string;
  /** Its page in today's dictionary (0-based). */
  page: number;
  side: Side;
}

export interface LexiconState {
  guesses: LexiconGuess[];
  gaveUp: boolean;
}

/** What the browser sends. */
export const lexiconMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("guess"), word: z.string().min(1).max(40) }),
  z.strictObject({ type: z.literal("give-up") }),
]);
export type LexiconMove = z.infer<typeof lexiconMoveSchema>;

/** Shown after the play ends. */
export interface LexiconReveal {
  answer: string;
  /** Its page in today's dictionary. */
  page: number;
  entry: LexiconEntry;
}

/**
 * The gap: the pages today's word can still be on, between the closest guess before it (`low`,
 * -1 for none) and the closest after it (`high`, the dictionary's size for none). `left` counts
 * the pages strictly between.
 */
export function gapOf(puzzle: Pick<LexiconPuzzle, "total">, state: LexiconState): { low: number; high: number; lowWord: string | null; highWord: string | null; left: number } {
  let low = -1;
  let high = puzzle.total;
  let lowWord: string | null = null;
  let highWord: string | null = null;
  for (const g of state.guesses) {
    if (g.side === "after" && g.page > low) {
      low = g.page;
      lowWord = g.word;
    }
    if (g.side === "before" && g.page < high) {
      high = g.page;
      highWord = g.word;
    }
  }
  return { low, high, lowWord, highWord, left: Math.max(0, high - low - 1) };
}

export function found(state: LexiconState): boolean {
  return state.guesses.at(-1)?.side === "found";
}

/** Points for finding the word on guess `n`. */
export function pointsFor(n: number): number {
  return SCORE_BY_GUESS[Math.min(Math.max(1, n), SCORE_BY_GUESS.length) - 1]!;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const caps = (word: string) => word.toUpperCase();

/** Why a typed guess can't be played, or null. Free to ask: refused guesses cost nothing. */
export function guessRefusal(puzzle: LexiconPuzzle, solution: Pick<LexiconSolution, "words">, state: LexiconState, word: string): string | null {
  if (!isLetters(word)) return "Letters only.";
  if (word.length < MIN_WORD || word.length > JUMBLE_SIZE) return `Use ${MIN_WORD} to ${JUMBLE_SIZE} letters.`;
  if (!canSpell(word, puzzle.letters)) return "Only today's letters, each used once.";
  if (state.guesses.some((g) => g.word === word)) return `You've tried ${caps(word)} already.`;
  const page = indexOfWord(solution.words, word);
  if (page < 0) return `${caps(word)} isn't in today's dictionary.`;
  const { low, high, lowWord, highWord } = gapOf(puzzle, state);
  if (page <= low) return `Today's word comes after ${caps(lowWord!)}.`;
  if (page >= high) return `Today's word comes before ${caps(highWord!)}.`;
  return null;
}

export const lexicon = defineGame<LexiconPuzzle, LexiconSolution, LexiconState, LexiconMove, LexiconReveal>({
  id: "lexicon",
  name: "Lexicon",
  tagline: "Close the dictionary on one word",
  rules: [
    "Nine letters make today's dictionary: every word of three or more letters they can spell. Today's word is one of its pages.",
    "Guess any word from the letters, each used once. You'll learn whether today's word comes before or after it.",
    "The gap closes in; the count tells you how many words are still inside it.",
    "Find it on your first guess for 100; each guess after costs a little. Guesses never run out.",
  ],
  accent: "#c93a1b",
  emoji: "📖",
  bucket: "words",
  availability: "testing",

  puzzleSchema: lexiconPuzzleSchema,
  solutionSchema: lexiconSolutionSchema,
  moveSchema: lexiconMoveSchema,

  initialState: () => ({ guesses: [], gaveUp: false }),

  applyMove({ puzzle, solution, state, move }) {
    if (state.gaveUp || found(state)) return { ok: false, error: "Today's game is over." };
    if (move.type === "give-up") return { ok: true, state: { ...state, gaveUp: true } };

    const word = normalizeWord(move.word);
    const refusal = guessRefusal(puzzle, solution, state, word);
    if (refusal) return { ok: false, error: refusal };
    const order = compareWords(word, solution.answer);
    const guess: LexiconGuess = { word, page: indexOfWord(solution.words, word), side: order === 0 ? "found" : order < 0 ? "after" : "before" };
    return { ok: true, state: { ...state, guesses: [...state.guesses, guess] } };
  },

  outcome({ state }) {
    if (found(state)) return "won";
    return state.gaveUp ? "lost" : "in_progress";
  },

  score({ state, outcome }) {
    if (outcome !== "won") return { score: 0, label: "Gave up" };
    const n = state.guesses.length;
    return { score: pointsFor(n), label: `Found on guess ${n}` };
  },

  /** One mark per guess: ▸ today's word is after it, ◂ before it, ◆ found; a flag for giving up. */
  shareGrid({ state, outcome }) {
    const marks = state.guesses.map((g) => (g.side === "after" ? "▸" : g.side === "before" ? "◂" : "◆")).join("");
    return outcome === "won" ? marks : `${marks}🏳️`;
  },

  /** Friends see each other's guesses once they've finished too. */
  friendDetail: (state) => ({ guesses: state.guesses.map((g) => g.word) }),

  reveal: ({ solution }) => ({
    answer: solution.answer,
    page: indexOfWord(solution.words, solution.answer),
    entry: solution.entry,
  }),
});

/** For the UI: how a guess reads. */
export function describeGuess(guess: LexiconGuess): string {
  return guess.side === "found" ? `${caps(guess.word)}: found` : `Today's word comes ${guess.side} ${caps(guess.word)}`;
}

/** For the UI: the gap in words. */
export function describeGap(puzzle: Pick<LexiconPuzzle, "total">, state: LexiconState): string {
  const { left, lowWord, highWord } = gapOf(puzzle, state);
  const bounds = [lowWord ? `after ${caps(lowWord)}` : null, highWord ? `before ${caps(highWord)}` : null].filter(Boolean).join(", ");
  return `${plural(left, "word")} left${bounds ? `, ${bounds}` : ""}`;
}
