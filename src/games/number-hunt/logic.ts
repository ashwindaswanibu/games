import { z } from "zod";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";

/**
 * Number Hunt — the reference game. Find the secret number between 1 and 100 in 7 guesses;
 * each miss tells you whether to go higher or lower.
 *
 * It exists to exercise every part of the platform (daily generation, validated moves, win/loss,
 * scoring, share grid, reveal) with as little game logic as possible. Copy this folder as the
 * starting point for a new game.
 */

export const MIN = 1;
export const MAX = 100;
export const MAX_GUESSES = 7;

const puzzleSchema = z.object({ min: z.number().int(), max: z.number().int(), maxGuesses: z.number().int().positive() });
const solutionSchema = z.object({ secret: z.number().int() });
const moveSchema = z.object({ guess: z.number().int() });

type Puzzle = z.infer<typeof puzzleSchema>;
type Solution = z.infer<typeof solutionSchema>;
type Move = z.infer<typeof moveSchema>;

export type Hint = "higher" | "lower" | "correct";
export interface State {
  guesses: { value: number; hint: Hint }[];
}

const HINT_EMOJI: Record<Hint, string> = { higher: "⬆️", lower: "⬇️", correct: "✅" };

export const numberHunt = defineGame<Puzzle, Solution, State, Move, Solution>({
  id: "number-hunt",
  name: "Number Hunt",
  tagline: `Find the number from ${MIN}–${MAX} in ${MAX_GUESSES} guesses`,
  rules: [
    `A secret number between ${MIN} and ${MAX} is picked each day.`,
    "After each guess you're told to go higher or lower.",
    `You have ${MAX_GUESSES} guesses. Fewer guesses, more points.`,
  ],
  accent: "#f59e0b",
  emoji: "🎯",
  // Placeholder: Number Hunt is the reference game, not a word game. It sits in "words" only so the
  // bucketed Today page and bucket boards have a live game to show until real Words games land.
  bucket: "words",
  availability: "live",

  puzzleSchema,
  solutionSchema,
  moveSchema,

  generate({ rng }) {
    return {
      puzzle: { min: MIN, max: MAX, maxGuesses: MAX_GUESSES },
      solution: { secret: rng.int(MIN, MAX) },
    };
  },

  initialState: () => ({ guesses: [] }),

  applyMove({ puzzle, solution, state, move }) {
    const { guess } = move;
    if (guess < puzzle.min || guess > puzzle.max) {
      return { ok: false, error: `Guess a number from ${puzzle.min} to ${puzzle.max}.` };
    }
    if (state.guesses.some((g) => g.value === guess)) {
      return { ok: false, error: `You already guessed ${guess}.` };
    }
    const hint: Hint = guess === solution.secret ? "correct" : guess < solution.secret ? "higher" : "lower";
    return { ok: true, state: { guesses: [...state.guesses, { value: guess, hint }] } };
  },

  outcome({ puzzle, state }) {
    if (state.guesses.at(-1)?.hint === "correct") return "won";
    return state.guesses.length >= puzzle.maxGuesses ? "lost" : "in_progress";
  },

  score({ puzzle, state, outcome }) {
    const n = state.guesses.length;
    const won = outcome === "won";
    return {
      score: attemptsScore(n, puzzle.maxGuesses, won),
      label: `${won ? n : "X"}/${puzzle.maxGuesses}`,
    };
  },

  shareGrid: ({ state }) => state.guesses.map((g) => HINT_EMOJI[g.hint]).join(""),

  reveal: ({ solution }) => solution,
});

/** The range still consistent with the hints so far — used by the UI to help the player. */
export function remainingRange(puzzle: Puzzle, state: State): { low: number; high: number } {
  let low = puzzle.min;
  let high = puzzle.max;
  for (const { value, hint } of state.guesses) {
    if (hint === "higher") low = Math.max(low, value + 1);
    else if (hint === "lower") high = Math.min(high, value - 1);
    else return { low: value, high: value };
  }
  return { low, high };
}
